// ---------------------------------------------------------------------------
// Queue Manager — background service for managing MR review queue.
//
// Singleton that lives in the service worker. Manages an ordered queue of
// MR review jobs, runs them one at a time, and broadcasts status to
// connected content scripts.
//
// Design decisions:
// - State is persisted to chrome.storage.local so it survives SW restarts.
//   The SW can be killed at any time — on restart, rehydrate() recovers.
// - Concurrency of 1: only one review runs at a time. Chrome extension
//   memory constraints + API rate limits make parallel reviews risky.
// - Connected content scripts receive broadcasts via a Set<Port>.
//   Ports are cleaned up on disconnect automatically.
// - The queue manager does NOT import the orchestrator directly — it
//   receives an executor function at init time. This avoids circular
//   dependencies and makes testing easier.
// - AbortController per running review enables clean pause/cancel.
// - Progress snapshots are captured from stream chunks and persisted
//   periodically (not on every chunk — that would thrash storage).
//
// Lifecycle:
// 1. Background script calls initQueueManager() at startup
// 2. Content scripts send messages (ENQUEUE_REVIEW, PAUSE_REVIEW, etc.)
// 3. Background handlers delegate to the singleton
// 4. Queue manager runs reviews, broadcasts status, persists state
// ---------------------------------------------------------------------------

import type {
  QueuedReview,
  QueueItemStatus,
  QueueStatus,
  ReviewProgressSnapshot,
} from '@/types/review-queue';
import type { ReviewTask } from '@/services/review/review-types';
import type { StreamChunk } from '@/types/messages';
import type { MrContext, MrSummary, FileReview, RelatedFile, EdgeCase, FileActivityData, AcValidationData } from '@/types/review';
import type { VerificationData } from '@/types/verification';
import { EMPTY_VERIFICATION_DATA } from '@/types/verification';
import { buildProgressSnapshot } from '@/types/review-queue';
import type { TaskProgress } from '@/services/review/review-types';
import { INITIAL_TASK_PROGRESS } from '@/services/review/review-types';
import {
  saveCachedReview,
  computeDiffHash,
  computeFileDiffHashes,
  type CachedReview,
} from '@/services/review/review-cache';

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const QUEUE_STORAGE_PREFIX = 'otto_queue:';

function storageKey(projectPath: string): string {
  return `${QUEUE_STORAGE_PREFIX}${projectPath}`;
}

// ---------------------------------------------------------------------------
// Types for the executor callback
// ---------------------------------------------------------------------------

/**
 * Function signature for executing a review.
 * The queue manager calls this to start a review — it's wired to
 * executeReview() from the orchestrator at init time.
 */
export type ReviewExecutor = (
  context: MrContext,
  tasks: ReviewTask[],
  send: (chunk: StreamChunk) => void,
  signal: AbortSignal,
) => Promise<void>;

/**
 * Function to build MrContext for a queued review.
 * The queue manager can't build MrContext itself (needs GitLab API calls).
 * This is wired to a function that fetches MR changes and builds context.
 */
export type ContextBuilder = (
  hostId: string,
  projectId: number,
  mrIid: number,
) => Promise<MrContext | null>;

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

/** In-memory queue state, keyed by projectPath */
const queues = new Map<string, QueuedReview[]>();

/** AbortController for the currently running review */
let activeAbort: AbortController | null = null;

/** Key identifying the currently running review */
let activeKey: { projectPath: string; mrIid: number } | null = null;

/** Connected content script ports for broadcasting */
const connectedPorts = new Set<chrome.runtime.Port>();

/** Executor function — set at init time */
let executor: ReviewExecutor | null = null;

/** Context builder function — set at init time */
let contextBuilder: ContextBuilder | null = null;

/** Debounce timer for persisting state */
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Track task progress for the active review */
let activeTaskProgress: Record<string, TaskProgress> = {};
let activeReviewTasks: ReviewTask[] = [];

/** Accumulate review results for cache saving */
let activeResults: {
  summary: MrSummary | null;
  fileReviews: FileReview[];
  relatedFiles: RelatedFile[];
  edgeCases: EdgeCase[];
  fileActivity: FileActivityData | null;
  acValidation: AcValidationData | null;
  verification: VerificationData;
  ticketContext: string | null;
  ticketKeys: string[];
} = createEmptyResults();

/** MrContext for the active review (needed for cache key computation) */
let activeMrContext: MrContext | null = null;

function createEmptyResults() {
  return {
    summary: null as MrSummary | null,
    fileReviews: [] as FileReview[],
    relatedFiles: [] as RelatedFile[],
    edgeCases: [] as EdgeCase[],
    fileActivity: null as FileActivityData | null,
    acValidation: null as AcValidationData | null,
    verification: { ...EMPTY_VERIFICATION_DATA },
    ticketContext: null as string | null,
    ticketKeys: [] as string[],
  };
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the queue manager. Call once from the background script.
 * Rehydrates persisted queue state and resumes any interrupted reviews.
 */
export async function initQueueManager(
  exec: ReviewExecutor,
  ctxBuilder: ContextBuilder,
): Promise<void> {
  executor = exec;
  contextBuilder = ctxBuilder;
  await rehydrate();
}

/**
 * Register a content script port for queue status broadcasts.
 * Call this when a content script connects with name 'otto-queue'.
 */
export function registerPort(port: chrome.runtime.Port): void {
  connectedPorts.add(port);
  port.onDisconnect.addListener(() => {
    connectedPorts.delete(port);
  });

  // Send current state immediately so the UI is up to date
  const projectPath = port.name.replace('otto-queue:', '');
  if (projectPath) {
    const status = getQueueStatus(projectPath);
    try {
      port.postMessage({ type: 'QUEUE_STATUS_UPDATE', payload: status });
    } catch {
      connectedPorts.delete(port);
    }
  }
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

/**
 * Add an MR to the review queue.
 * If the MR is already queued (any status except 'complete' or 'error'),
 * this is a no-op and returns the existing item.
 */
export async function enqueueReview(item: QueuedReview): Promise<QueuedReview> {
  const queue = getOrCreateQueue(item.projectPath);

  // Check for duplicate — don't re-enqueue active/queued items
  const existing = queue.find((q) => q.mrIid === item.mrIid);
  if (existing && (existing.status === 'queued' || existing.status === 'running' || existing.status === 'paused')) {
    return existing;
  }

  // Remove any completed/errored entry for this MR (re-enqueue scenario)
  const filtered = queue.filter((q) => q.mrIid !== item.mrIid);

  // Insert sorted by priority (highest first)
  const insertIdx = filtered.findIndex((q) => q.priority.score < item.priority.score);
  if (insertIdx === -1) {
    filtered.push(item);
  } else {
    filtered.splice(insertIdx, 0, item);
  }

  queues.set(item.projectPath, filtered);
  await persistQueueImmediate(item.projectPath);
  broadcastStatus(item.projectPath);

  // Try to start the next review if nothing is running
  scheduleNext(item.projectPath);

  return item;
}

/**
 * Pause a running or queued review.
 * If running: aborts the orchestrator, saves progress, sets status to 'paused'.
 * If queued: just sets status to 'paused' (won't be picked up by auto-advance).
 */
export async function pauseReview(projectPath: string, mrIid: number): Promise<boolean> {
  const queue = getOrCreateQueue(projectPath);
  const item = queue.find((q) => q.mrIid === mrIid);
  if (!item) return false;

  if (item.status === 'running') {
    // Abort the active review — the runReview finally block will handle
    // cleanup, state persistence, and scheduling the next review.
    // We do NOT call scheduleNext here to avoid a race with the winding-down executor.
    if (activeAbort && activeKey?.projectPath === projectPath && activeKey?.mrIid === mrIid) {
      activeAbort.abort();
      // Don't clear activeAbort/activeKey here — runReview's finally block does it
    }
    item.status = 'paused';
    item.pausedAt = Date.now();
  } else if (item.status === 'queued') {
    item.status = 'paused';
    item.pausedAt = Date.now();
  } else {
    return false; // Can't pause completed/errored items
  }

  await persistQueueImmediate(projectPath);
  broadcastStatus(projectPath);

  // Only schedule next if we paused a queued item (not running — running
  // items will schedule next from their finally block after abort completes)
  if (item.pausedAt && !activeAbort) {
    scheduleNext(projectPath);
  }

  return true;
}

/**
 * Resume a paused review. Sets it back to 'queued' so it gets picked up
 * by the auto-advance logic. The orchestrator will use cached partial
 * results to skip already-completed tasks.
 */
export async function resumeReview(projectPath: string, mrIid: number): Promise<boolean> {
  const queue = getOrCreateQueue(projectPath);
  const item = queue.find((q) => q.mrIid === mrIid);
  if (!item || item.status !== 'paused') return false;

  item.status = 'queued';
  item.pausedAt = null;

  await persistQueueImmediate(projectPath);
  broadcastStatus(projectPath);

  // Try to start it
  scheduleNext(projectPath);

  return true;
}

/**
 * Cancel a review. Removes it from the queue entirely.
 * If running: aborts the orchestrator first.
 */
export async function cancelReview(projectPath: string, mrIid: number): Promise<boolean> {
  const queue = getOrCreateQueue(projectPath);
  const idx = queue.findIndex((q) => q.mrIid === mrIid);
  if (idx === -1) return false;

  const item = queue[idx];
  const wasRunning = item.status === 'running';

  // Abort if running — runReview's finally block handles cleanup + scheduleNext
  if (wasRunning && activeAbort && activeKey?.projectPath === projectPath && activeKey?.mrIid === mrIid) {
    activeAbort.abort();
    // Don't clear activeAbort/activeKey — runReview's finally block does it
  }

  queue.splice(idx, 1);
  queues.set(projectPath, queue);

  await persistQueueImmediate(projectPath);
  broadcastStatus(projectPath);

  // Only schedule next if we cancelled a non-running item
  // Running items will schedule next from their finally block
  if (!wasRunning) {
    scheduleNext(projectPath);
  }

  return true;
}

/**
 * Get the current queue status for a project.
 */
export function getQueueStatus(projectPath: string): QueueStatus {
  const queue = getOrCreateQueue(projectPath);
  return {
    projectPath,
    items: queue,
    completedCount: queue.filter((q) => q.status === 'complete').length,
    runningCount: queue.filter((q) => q.status === 'running').length,
    totalCount: queue.length,
  };
}

/**
 * Get a specific queued review item.
 */
export function getQueuedReview(projectPath: string, mrIid: number): QueuedReview | null {
  const queue = getOrCreateQueue(projectPath);
  return queue.find((q) => q.mrIid === mrIid) ?? null;
}

// ---------------------------------------------------------------------------
// Auto-advance — picks the next queued item and starts it
// ---------------------------------------------------------------------------

function scheduleNext(projectPath: string): void {
  // Don't start if something is already running
  if (activeKey) return;

  // First try the specified project
  const queue = getOrCreateQueue(projectPath);
  const next = queue.find((q) => q.status === 'queued');
  if (next) {
    runReview(next).catch((error) => {
      console.error('[QueueManager] Review execution failed:', error);
    });
    return;
  }

  // No queued items in this project — check all other projects.
  // This handles the case where project A finishes but project B has queued items.
  for (const [otherPath, otherQueue] of queues) {
    if (otherPath === projectPath) continue;
    const otherNext = otherQueue.find((q) => q.status === 'queued');
    if (otherNext) {
      runReview(otherNext).catch((error) => {
        console.error('[QueueManager] Review execution failed:', error);
      });
      return;
    }
  }
}

async function runReview(item: QueuedReview): Promise<void> {
  if (!executor || !contextBuilder) {
    console.error('[QueueManager] Not initialized — executor or contextBuilder missing');
    return;
  }

  // Double-check nothing else is running
  if (activeKey) return;

  // Build MrContext from the queued item's metadata
  const mrContext = await contextBuilder(item.hostId, item.projectId, item.mrIid);
  if (!mrContext) {
    item.status = 'error';
    item.error = 'Failed to fetch MR data from GitLab';
    item.completedAt = Date.now();
    await persistQueueImmediate(item.projectPath);
    broadcastStatus(item.projectPath);
    scheduleNext(item.projectPath);
    return;
  }

  // Set up abort controller
  const abort = new AbortController();
  activeAbort = abort;
  activeKey = { projectPath: item.projectPath, mrIid: item.mrIid };

  // Update item status
  item.status = 'running';
  item.startedAt = Date.now();
  item.error = null;

  // Reset task progress tracking
  activeTaskProgress = {};
  activeReviewTasks = [...item.tasks];
  activeResults = createEmptyResults();
  activeMrContext = mrContext;
  for (const task of item.tasks) {
    activeTaskProgress[task] = { ...INITIAL_TASK_PROGRESS };
  }

  // Initialize progress snapshot immediately so the UI shows a progress bar
  // right away (not just after the first stream chunk arrives)
  item.progress = buildProgressSnapshot(activeTaskProgress, activeReviewTasks);

  await persistQueueImmediate(item.projectPath);
  broadcastStatus(item.projectPath);

  // Wrap the send function to capture progress AND forward chunks to connected ports.
  // This lets the MR page render live results (summary, file reviews, etc.) while
  // the queue review is running — same experience as clicking "Review MR".
  const send = (chunk: StreamChunk): void => {
    handleStreamChunk(item, chunk);
    broadcastChunk(item.projectPath, item.mrIid, chunk);
  };

  try {
    await executor(mrContext, item.tasks, send, abort.signal);

    // If we weren't aborted, mark complete and save to cache
    if (!abort.signal.aborted) {
      item.status = 'complete';
      item.completedAt = Date.now();
      item.progress = buildProgressSnapshot(activeTaskProgress, activeReviewTasks);
      if (item.progress) item.progress.overallPercent = 100;

      // Save accumulated results to review cache so the MR page can load them
      if (activeMrContext) {
        const diffHash = computeDiffHash(activeMrContext.diffFiles);
        const cached: CachedReview = {
          version: 1,
          projectPath: activeMrContext.projectPath,
          mrIid: activeMrContext.mrIid,
          diffHash,
          timestamp: Date.now(),
          summary: activeResults.summary,
          fileReviews: activeResults.fileReviews,
          relatedFiles: activeResults.relatedFiles,
          edgeCases: activeResults.edgeCases,
          fileDiffHashes: computeFileDiffHashes(activeMrContext.diffFiles),
          ticketContext: activeResults.ticketContext,
          ticketKeys: activeResults.ticketKeys,
          fileActivity: activeResults.fileActivity,
          acValidation: activeResults.acValidation,
          verification: activeResults.verification,
        };
        saveCachedReview(cached).catch(() => {
          // Non-fatal — cache save is best-effort
        });
      }
    }
  } catch (error) {
    if (abort.signal.aborted) {
      // Paused or cancelled — status already set by pause/cancel handler.
      // Save partial results to cache so resume can skip completed tasks.
      // Re-read item from queue since pause/cancel may have mutated it externally.
      const currentItem = getOrCreateQueue(item.projectPath).find((q) => q.mrIid === item.mrIid);
      if (activeMrContext && currentItem?.status === 'paused') {
        const diffHash = computeDiffHash(activeMrContext.diffFiles);
        const cached: CachedReview = {
          version: 1,
          projectPath: activeMrContext.projectPath,
          mrIid: activeMrContext.mrIid,
          diffHash,
          timestamp: Date.now(),
          summary: activeResults.summary,
          fileReviews: activeResults.fileReviews,
          relatedFiles: activeResults.relatedFiles,
          edgeCases: activeResults.edgeCases,
          fileDiffHashes: computeFileDiffHashes(activeMrContext.diffFiles),
          ticketContext: activeResults.ticketContext,
          ticketKeys: activeResults.ticketKeys,
          fileActivity: activeResults.fileActivity,
          acValidation: activeResults.acValidation,
          verification: activeResults.verification,
        };
        saveCachedReview(cached).catch(() => { /* best-effort */ });
      }
    } else {
      item.status = 'error';
      item.error = error instanceof Error ? error.message : 'Review failed';
      item.completedAt = Date.now();
    }
  } finally {
    // Clean up active state
    if (activeKey?.projectPath === item.projectPath && activeKey?.mrIid === item.mrIid) {
      activeAbort = null;
      activeKey = null;
    }
    activeTaskProgress = {};
    activeReviewTasks = [];
    activeResults = createEmptyResults();
    activeMrContext = null;

    // Cancel any pending partial cache save
    if (partialCacheDebounce) {
      clearTimeout(partialCacheDebounce);
      partialCacheDebounce = null;
    }

    await persistQueueImmediate(item.projectPath);
    broadcastStatus(item.projectPath);

    // Auto-advance to next queued item
    scheduleNext(item.projectPath);
  }
}

// ---------------------------------------------------------------------------
// Stream chunk handler — captures progress from the orchestrator
// ---------------------------------------------------------------------------

function handleStreamChunk(item: QueuedReview, chunk: StreamChunk): void {
  // Guard against stale chunks — if the active review has moved on (e.g., the
  // executor fired a late callback after its promise resolved), ignore the chunk.
  if (!activeKey || activeKey.mrIid !== item.mrIid) return;

  // Update task progress based on chunk type
  switch (chunk.type) {
    case 'STREAM_SUMMARY_DELTA':
      updateTaskStatus('summary', 'streaming');
      break;
    case 'STREAM_SUMMARY_COMPLETE':
      updateTaskStatus('summary', 'complete');
      activeResults.summary = chunk.payload.summary;
      break;
    case 'STREAM_FILE_REVIEW_DELTA':
      updateTaskStatus('codeReview', 'streaming');
      break;
    case 'STREAM_FILE_REVIEW_COMPLETE':
      updateTaskStatus('codeReview', 'streaming');
      if (activeTaskProgress.codeReview) {
        activeTaskProgress.codeReview.filesComplete++;
      }
      activeResults.fileReviews.push(chunk.payload.fileReview);
      break;
    case 'STREAM_EDGE_CASES_DELTA':
      updateTaskStatus('edgeCases', 'streaming');
      break;
    case 'STREAM_EDGE_CASES_COMPLETE':
      updateTaskStatus('edgeCases', 'complete');
      activeResults.edgeCases = chunk.payload.edgeCases;
      break;
    case 'STREAM_RELATED_FILES_COMPLETE':
      updateTaskStatus('relatedFiles', 'complete');
      activeResults.relatedFiles = chunk.payload.files;
      break;
    case 'STREAM_FILE_ACTIVITY_COMPLETE':
      updateTaskStatus('fileActivity', 'complete');
      activeResults.fileActivity = chunk.payload.fileActivity;
      break;
    case 'STREAM_AC_VALIDATION_COMPLETE':
      activeResults.acValidation = chunk.payload.acValidation;
      break;
    case 'STREAM_TICKET_CONTEXT':
      activeResults.ticketContext = chunk.payload.ticketContext;
      activeResults.ticketKeys = chunk.payload.ticketKeys;
      break;
    case 'STREAM_ADVERSARIAL_TESTS_DELTA':
      updateTaskStatus('adversarialTests', 'streaming');
      break;
    case 'STREAM_ADVERSARIAL_TESTS_COMPLETE':
      updateTaskStatus('adversarialTests', 'complete');
      activeResults.verification.adversarialTests = chunk.payload.data;
      break;
    case 'STREAM_CONTRACTS_DELTA':
      updateTaskStatus('contracts', 'streaming');
      break;
    case 'STREAM_CONTRACTS_COMPLETE':
      updateTaskStatus('contracts', 'complete');
      activeResults.verification.contracts = chunk.payload.data;
      break;
    case 'STREAM_BEHAVIORAL_DELTA_DELTA':
      updateTaskStatus('behavioralDelta', 'streaming');
      break;
    case 'STREAM_BEHAVIORAL_DELTA_COMPLETE':
      updateTaskStatus('behavioralDelta', 'complete');
      activeResults.verification.behavioralDelta = chunk.payload.data;
      break;
    case 'STREAM_TRUST_COMPLETE':
      activeResults.verification.trust = chunk.payload.trust;
      break;
    case 'STREAM_CI_EXECUTION_COMPLETE':
      activeResults.verification.execution = chunk.payload.result;
      break;
    case 'STREAM_TASK_ERROR': {
      const taskName = chunk.payload.task.split(':')[0]; // Handle "codeReview:path" format
      updateTaskStatus(taskName, 'error');
      break;
    }
    case 'STREAM_PROGRESS': {
      // Extract file count info from progress messages
      const fileMatch = chunk.payload.message.match(/Reviewing (\d+) changed files/);
      if (fileMatch && activeTaskProgress.codeReview) {
        activeTaskProgress.codeReview.filesTotal = parseInt(fileMatch[1], 10);
        activeTaskProgress.codeReview.status = 'loading';
      }
      break;
    }
    case 'STREAM_ALL_COMPLETE':
      // Mark any remaining loading/streaming tasks as complete
      for (const [task, progress] of Object.entries(activeTaskProgress)) {
        if (progress.status === 'loading' || progress.status === 'streaming') {
          progress.status = 'complete';
        }
      }
      break;
    case 'STREAM_REVIEW_PAUSED':
      // Orchestrator acknowledged the abort — nothing to do here,
      // the pause/cancel handler already updated the item status.
      break;
  }

  // Update the item's progress snapshot (debounced broadcast)
  item.progress = buildProgressSnapshot(activeTaskProgress, activeReviewTasks);
  debouncedBroadcast(item.projectPath);
}

function updateTaskStatus(task: string, status: TaskProgress['status']): void {
  if (!activeTaskProgress[task]) {
    activeTaskProgress[task] = { ...INITIAL_TASK_PROGRESS };
  }
  // Don't downgrade: complete > streaming > loading > idle
  const current = activeTaskProgress[task].status;
  if (current === 'complete' && status !== 'error') return;
  if (current === 'streaming' && status === 'loading') return;
  activeTaskProgress[task].status = status;
}

/** Debounced broadcast — avoids flooding ports during rapid streaming */
let broadcastDebounce: ReturnType<typeof setTimeout> | null = null;

/** Debounced partial cache save — heavier than broadcast, runs less often */
let partialCacheDebounce: ReturnType<typeof setTimeout> | null = null;

function debouncedBroadcast(projectPath: string): void {
  if (broadcastDebounce) return; // Already scheduled
  broadcastDebounce = setTimeout(() => {
    broadcastDebounce = null;
    broadcastStatus(projectPath);
    // Debounced persist of progress snapshots — survives SW restarts
    persistQueue(projectPath);
  }, 250); // 4 updates/sec max

  // Schedule a partial cache save every 10 seconds during streaming.
  // This ensures that if the user reloads mid-review, partial results
  // (completed summary, some file reviews, etc.) are available from cache.
  if (!partialCacheDebounce && activeMrContext) {
    partialCacheDebounce = setTimeout(() => {
      partialCacheDebounce = null;
      savePartialCache();
    }, 10_000);
  }
}

/**
 * Save partial review results to cache during a running review.
 * Called periodically (every ~10s) so reloads don't lose progress.
 * Only saves if there's meaningful data (at least a summary or file reviews).
 */
function savePartialCache(): void {
  if (!activeMrContext) return;

  // Only save if we have some actual results
  const hasResults = activeResults.summary !== null || activeResults.fileReviews.length > 0;
  if (!hasResults) return;

  const diffHash = computeDiffHash(activeMrContext.diffFiles);
  const cached: CachedReview = {
    version: 1,
    projectPath: activeMrContext.projectPath,
    mrIid: activeMrContext.mrIid,
    diffHash,
    timestamp: Date.now(),
    summary: activeResults.summary,
    fileReviews: activeResults.fileReviews,
    relatedFiles: activeResults.relatedFiles,
    edgeCases: activeResults.edgeCases,
    fileDiffHashes: computeFileDiffHashes(activeMrContext.diffFiles),
    ticketContext: activeResults.ticketContext,
    ticketKeys: activeResults.ticketKeys,
    fileActivity: activeResults.fileActivity,
    acValidation: activeResults.acValidation,
    verification: activeResults.verification,
  };
  saveCachedReview(cached).catch(() => { /* best-effort */ });
}

// ---------------------------------------------------------------------------
// Broadcasting
// ---------------------------------------------------------------------------

function broadcastStatus(projectPath: string): void {
  const status = getQueueStatus(projectPath);
  const message = { type: 'QUEUE_STATUS_UPDATE' as const, payload: status };

  for (const port of connectedPorts) {
    try {
      port.postMessage(message);
    } catch {
      connectedPorts.delete(port);
    }
  }
}

/**
 * Forward a stream chunk to connected ports for a specific MR.
 * This lets the MR page render live results (summary text, file reviews, etc.)
 * while the queue review is running — same experience as "Review MR".
 *
 * Only ports matching the project path receive the chunk. The chunk is wrapped
 * with the mrIid so the MR page can filter for its own MR.
 */
function broadcastChunk(projectPath: string, mrIid: number, chunk: StreamChunk): void {
  const message = { type: 'QUEUE_STREAM_CHUNK' as const, payload: { mrIid, chunk } };

  for (const port of connectedPorts) {
    // Only send to ports for this project
    if (!port.name.endsWith(projectPath)) continue;
    try {
      port.postMessage(message);
    } catch {
      connectedPorts.delete(port);
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function persistQueue(projectPath: string): Promise<void> {
  // Debounce rapid persists (e.g., during progress updates)
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      const queue = queues.get(projectPath) ?? [];
      await chrome.storage.local.set({ [storageKey(projectPath)]: queue });
    } catch {
      // Non-fatal — queue will be rebuilt from scratch on next load
    }
  }, 500);
}

/** Force immediate persist (used before SW shutdown) */
async function persistQueueImmediate(projectPath: string): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    const queue = queues.get(projectPath) ?? [];
    await chrome.storage.local.set({ [storageKey(projectPath)]: queue });
  } catch {
    // Non-fatal
  }
}

/**
 * Rehydrate queue state from chrome.storage.local.
 * Called at init time to recover from SW restarts.
 *
 * Any items that were 'running' when the SW died are reset to 'queued'
 * so they get re-processed. The orchestrator's incremental review logic
 * will skip already-completed tasks using the review cache.
 */
async function rehydrate(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null);
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(QUEUE_STORAGE_PREFIX)) continue;

      const items = value as QueuedReview[];
      if (!Array.isArray(items)) continue;

      const projectPath = key.slice(QUEUE_STORAGE_PREFIX.length);

      // Reset interrupted reviews
      for (const item of items) {
        if (item.status === 'running') {
          item.status = 'queued';
          item.startedAt = null;
        }
      }

      queues.set(projectPath, items);

      // Try to resume processing
      scheduleNext(projectPath);
    }
  } catch {
    // Non-fatal — start with empty queues
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOrCreateQueue(projectPath: string): QueuedReview[] {
  let queue = queues.get(projectPath);
  if (!queue) {
    queue = [];
    queues.set(projectPath, queue);
  }
  return queue;
}
