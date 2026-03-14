// ---------------------------------------------------------------------------
// Stream dispatcher — shared logic for dispatching stream chunks to the
// review store. Used by both the useReview hook (manual review) and the
// auto-review function in the content script.
//
// Extracted to avoid duplicating the chunk→store mapping in two places.
//
// Performance: streaming deltas are batched and flushed at ~60fps via
// requestAnimationFrame. This prevents hundreds of store updates per second
// from hammering subscriptions and crashing the tab on large MRs.
//
// Health-aware: when the health monitor detects degradation, flushing is
// throttled (degraded → 30fps) or paused (critical → buffer only, flush
// on completion or recovery). This prevents Otto from being the cause of
// the very crash it's trying to detect.
// ---------------------------------------------------------------------------

import { useReviewStore } from '@/services/review/review-store';
import { openStream } from '@/lib/messaging';
import type { StreamChunk, StreamRequest } from '@/types/messages';
import type { ReviewTask } from '@/services/review/review-types';
import type { MrContext } from '@/types/review';
import {
  loadCachedReview,
  saveCachedReview,
  computeDiffHash,
  computeFileDiffHashes,
  type CachedReview,
} from './review-cache';
import { getHealthLevel, onHealthLevelChange, type HealthLevel } from './health-monitor';

// ---------------------------------------------------------------------------
// Delta batching — accumulates streaming deltas and flushes based on
// the current health level.
//
// normal:   flush at ~60fps via requestAnimationFrame
// degraded: flush at ~30fps via setTimeout(33)
// critical: pause flushing (buffer only), flush on completion or recovery
// ---------------------------------------------------------------------------

let pendingSummaryDelta = '';
const pendingFileDeltas = new Map<string, string>();
let pendingEdgeCasesDelta = '';
let pendingAdversarialTestsDelta = '';
let pendingContractsDelta = '';
let pendingBehavioralDeltaDelta = '';
let flushScheduled = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Subscribe to health level changes — flush buffered deltas on recovery
let healthCleanup: (() => void) | null = null;

function ensureHealthSubscription(): void {
  if (healthCleanup) return;
  healthCleanup = onHealthLevelChange(
    (level) => {
      // When recovering from critical, flush any buffered deltas
      if (level !== 'critical' && hasPendingDeltas()) {
        scheduleDeltaFlush();
      }
    },
    // onCleanup — monitor shut down, reset so we re-subscribe on restart
    () => { healthCleanup = null; },
  );
}

function hasPendingDeltas(): boolean {
  return !!(pendingSummaryDelta || pendingFileDeltas.size > 0 || pendingEdgeCasesDelta
    || pendingAdversarialTestsDelta || pendingContractsDelta || pendingBehavioralDeltaDelta);
}

function scheduleDeltaFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;

  // Cancel any pending timer from a previous health level to prevent
  // stacking a setTimeout and rAF simultaneously during transitions.
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const level = getHealthLevel();

  if (level === 'critical') {
    // Don't schedule — deltas stay buffered until completion or recovery
    flushScheduled = false;
    return;
  }

  if (level === 'degraded') {
    // Throttle to ~30fps
    flushTimer = setTimeout(flushDeltas, 33);
  } else {
    // Normal — full 60fps via rAF
    requestAnimationFrame(flushDeltas);
  }
}

function flushDeltas(): void {
  flushScheduled = false;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const s = useReviewStore.getState();

  if (pendingSummaryDelta) {
    s.appendSummaryDelta(pendingSummaryDelta);
    pendingSummaryDelta = '';
  }

  if (pendingFileDeltas.size > 0) {
    for (const [filePath, content] of pendingFileDeltas) {
      s.appendFileReviewDelta(filePath, content);
    }
    pendingFileDeltas.clear();
  }

  if (pendingEdgeCasesDelta) {
    s.appendEdgeCasesDelta(pendingEdgeCasesDelta);
    pendingEdgeCasesDelta = '';
  }

  if (pendingAdversarialTestsDelta) {
    s.appendAdversarialTestsDelta(pendingAdversarialTestsDelta);
    pendingAdversarialTestsDelta = '';
  }

  if (pendingContractsDelta) {
    s.appendContractsDelta(pendingContractsDelta);
    pendingContractsDelta = '';
  }

  if (pendingBehavioralDeltaDelta) {
    s.appendBehavioralDeltaDelta(pendingBehavioralDeltaDelta);
    pendingBehavioralDeltaDelta = '';
  }
}

/**
 * Dispatch a stream chunk to the review store.
 * Delta chunks are batched; completion/error chunks are dispatched immediately.
 * Health-aware: delta flushing is throttled or paused based on tab health.
 */
export function dispatchStreamChunk(chunk: StreamChunk): void {
  ensureHealthSubscription();
  const s = useReviewStore.getState();

  switch (chunk.type) {
    case 'STREAM_SUMMARY_DELTA':
      pendingSummaryDelta += chunk.payload.content;
      scheduleDeltaFlush();
      break;
    case 'STREAM_SUMMARY_COMPLETE':
      // Flush any pending summary delta first
      if (pendingSummaryDelta) {
        s.appendSummaryDelta(pendingSummaryDelta);
        pendingSummaryDelta = '';
      }
      s.setSummary(chunk.payload.summary);
      break;
    case 'STREAM_FILE_REVIEW_DELTA': {
      const existing = pendingFileDeltas.get(chunk.payload.filePath) || '';
      pendingFileDeltas.set(chunk.payload.filePath, existing + chunk.payload.content);
      scheduleDeltaFlush();
      break;
    }
    case 'STREAM_FILE_REVIEW_COMPLETE': {
      // Flush any pending delta for this file first
      const filePath = chunk.payload.fileReview.filePath;
      if (pendingFileDeltas.has(filePath)) {
        s.appendFileReviewDelta(filePath, pendingFileDeltas.get(filePath)!);
        pendingFileDeltas.delete(filePath);
      }
      s.addFileReview(chunk.payload.fileReview);
      break;
    }
    case 'STREAM_RELATED_FILES_COMPLETE':
      s.setRelatedFiles(chunk.payload.files);
      break;
    case 'STREAM_EDGE_CASES_DELTA':
      pendingEdgeCasesDelta += chunk.payload.content;
      scheduleDeltaFlush();
      break;
    case 'STREAM_EDGE_CASES_COMPLETE':
      // Flush any pending edge cases delta first
      if (pendingEdgeCasesDelta) {
        s.appendEdgeCasesDelta(pendingEdgeCasesDelta);
        pendingEdgeCasesDelta = '';
      }
      s.setEdgeCases(chunk.payload.edgeCases);
      break;
    case 'STREAM_TICKET_CONTEXT':
      s.setTicketContext(chunk.payload.ticketContext, chunk.payload.ticketKeys);
      break;
    case 'STREAM_FILE_ACTIVITY_COMPLETE':
      s.setFileActivity(chunk.payload.fileActivity);
      s.setTaskStatus('fileActivity' as ReviewTask, 'complete');
      break;
    case 'STREAM_AC_VALIDATION_COMPLETE':
      s.setAcValidation(chunk.payload.acValidation);
      break;
    // Verification stream chunks
    case 'STREAM_ADVERSARIAL_TESTS_DELTA':
      pendingAdversarialTestsDelta += chunk.payload.content;
      scheduleDeltaFlush();
      // Mark verification as generating on first delta
      if (s.verification.status === 'idle') s.setVerificationGenerating();
      break;
    case 'STREAM_ADVERSARIAL_TESTS_COMPLETE':
      if (pendingAdversarialTestsDelta) {
        s.appendAdversarialTestsDelta(pendingAdversarialTestsDelta);
        pendingAdversarialTestsDelta = '';
      }
      s.setAdversarialTests(chunk.payload.data);
      break;
    case 'STREAM_CONTRACTS_DELTA':
      pendingContractsDelta += chunk.payload.content;
      scheduleDeltaFlush();
      if (s.verification.status === 'idle') s.setVerificationGenerating();
      break;
    case 'STREAM_CONTRACTS_COMPLETE':
      if (pendingContractsDelta) {
        s.appendContractsDelta(pendingContractsDelta);
        pendingContractsDelta = '';
      }
      s.setContracts(chunk.payload.data);
      break;
    case 'STREAM_BEHAVIORAL_DELTA_DELTA':
      pendingBehavioralDeltaDelta += chunk.payload.content;
      scheduleDeltaFlush();
      if (s.verification.status === 'idle') s.setVerificationGenerating();
      break;
    case 'STREAM_BEHAVIORAL_DELTA_COMPLETE':
      if (pendingBehavioralDeltaDelta) {
        s.appendBehavioralDeltaDelta(pendingBehavioralDeltaDelta);
        pendingBehavioralDeltaDelta = '';
      }
      s.setBehavioralDelta(chunk.payload.data);
      break;
    case 'STREAM_TRUST_COMPLETE':
      s.setTrustAssessment(chunk.payload.trust);
      break;
    case 'STREAM_CI_EXECUTION_COMPLETE':
      s.setCiExecution(chunk.payload.result);
      break;
    case 'STREAM_PROGRESS':
      // Ignore empty keepalive messages from the service worker
      if (chunk.payload.message) {
        s.setProgressMessage(chunk.payload.message);
      }
      break;
    case 'STREAM_TASK_ERROR': {
      const task = chunk.payload.task;
      if (!task.startsWith('codeReview:')) {
        s.setTaskStatus(task as ReviewTask, 'error', chunk.payload.error);
      }
      break;
    }
    case 'STREAM_ALL_COMPLETE':
      // Flush any remaining deltas before completing
      flushDeltas();
      s.completeReview();
      break;
    case 'STREAM_REVIEW_PAUSED':
      // Review was paused (queue feature). Flush deltas so partial results
      // are visible, but don't mark as complete — the review can be resumed.
      flushDeltas();
      break;
  }
}

/**
 * Try to load a cached review and hydrate the store.
 * Returns true if cache was found and loaded, false otherwise.
 */
export async function tryLoadCachedReview(mrContext: MrContext): Promise<boolean> {
  const diffHash = computeDiffHash(mrContext.diffFiles);
  const cached = await loadCachedReview(mrContext.projectPath, mrContext.mrIid, diffHash);

  if (cached) {
    const store = useReviewStore.getState();
    store.hydrateFromCache(cached);
    return true;
  }

  return false;
}

/**
 * Retry specific failed tasks without resetting existing review results.
 * Opens a new stream for just the specified tasks.
 * Returns a disconnect function to cancel the stream.
 */
export function retryReviewTasks(
  mrContext: MrContext,
  tasks: ReviewTask[],
  onDisconnect?: () => void,
): () => void {
  const store = useReviewStore.getState();

  // Clear error state for the tasks being retried
  for (const task of tasks) {
    store.setTaskStatus(task, 'loading');
  }

  // Filter to stream-compatible tasks (fileActivity runs automatically in the orchestrator)
  const streamTasks = tasks.filter(
    (t): t is Exclude<ReviewTask, 'fileActivity'> => t !== 'fileActivity',
  );

  return openStream(
    { type: 'STREAM_REVIEW', payload: { mrContext, tasks: streamTasks } },
    {
      onChunk: (chunk) => {
        dispatchStreamChunk(chunk);

        // Update cache when retry completes
        if (chunk.type === 'STREAM_ALL_COMPLETE') {
          const state = useReviewStore.getState();
          const diffHash = computeDiffHash(mrContext.diffFiles);
          const cached: CachedReview = {
            version: 1,
            projectPath: mrContext.projectPath,
            mrIid: mrContext.mrIid,
            diffHash,
            timestamp: Date.now(),
            summary: state.summary,
            fileReviews: state.fileReviews,
            relatedFiles: state.relatedFiles,
            edgeCases: state.edgeCases,
            fileDiffHashes: computeFileDiffHashes(mrContext.diffFiles),
            ticketContext: state.ticketContext,
            ticketKeys: state.ticketKeys,
            fileActivity: state.fileActivity,
            acValidation: state.acValidation,
            verification: state.verification,
          };
          saveCachedReview(cached);
        }
      },
      onDisconnect: () => {
        onDisconnect?.();
      },
    },
  );
}

/**
 * Start a review stream and dispatch all chunks to the store.
 * Returns a disconnect function to cancel the stream.
 *
 * Used by:
 * - useReview hook (manual "Review MR" button)
 * - Auto-review in the content script
 *
 * @param skipCache - If true, bypass cache (used for regeneration)
 */
export function startReviewStream(
  mrContext: MrContext,
  tasks: ReviewTask[],
  onDisconnect?: () => void,
  skipCache?: boolean,
): () => void {
  const store = useReviewStore.getState();
  store.reset();
  store.startReview(tasks);
  store.setFileReviewsTotal(mrContext.diffFiles.length);

  // Filter to stream-compatible tasks (fileActivity runs automatically in the orchestrator)
  const streamTasks = tasks.filter(
    (t): t is Exclude<ReviewTask, 'fileActivity'> => t !== 'fileActivity',
  );

  return openStream(
    { type: 'STREAM_REVIEW', payload: { mrContext, tasks: streamTasks } },
    {
      onChunk: (chunk) => {
        dispatchStreamChunk(chunk);

        // Save to cache when all tasks complete
        if (chunk.type === 'STREAM_ALL_COMPLETE') {
          const state = useReviewStore.getState();
          const diffHash = computeDiffHash(mrContext.diffFiles);
          const cached: CachedReview = {
            version: 1,
            projectPath: mrContext.projectPath,
            mrIid: mrContext.mrIid,
            diffHash,
            timestamp: Date.now(),
            summary: state.summary,
            fileReviews: state.fileReviews,
            relatedFiles: state.relatedFiles,
            edgeCases: state.edgeCases,
            fileDiffHashes: computeFileDiffHashes(mrContext.diffFiles),
            ticketContext: state.ticketContext,
            ticketKeys: state.ticketKeys,
            fileActivity: state.fileActivity,
            acValidation: state.acValidation,
            verification: state.verification,
          };
          saveCachedReview(cached);
        }
      },
      onDisconnect: () => {
        const state = useReviewStore.getState();
        if (state.status === 'loading' || state.status === 'streaming') {
          state.setError('Connection to Otto lost. Try again.');
        }
        onDisconnect?.();
      },
    },
  );
}
