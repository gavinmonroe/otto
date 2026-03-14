// ---------------------------------------------------------------------------
// Review Queue types — data structures for the MR list command center.
//
// These types are shared between:
// - Queue manager (background service worker)
// - Priority scorer (background)
// - Ticket grouper (content script + background)
// - UI components (content script)
// - Message passing protocol (both sides)
//
// Design decisions:
// - QueuedReview carries enough MR metadata for display + priority scoring
//   without requiring additional API calls after enqueue.
// - ReviewProgressSnapshot is a flat, serializable representation of
//   ReviewProgress — it goes through chrome.storage and port messages.
// - Priority signals are human-readable strings so the UI can display
//   them directly without mapping logic.
// - Queue status uses a discriminated union for the item status so
//   consumers can exhaustively switch on it.
// - TicketGroup is computed client-side from MR metadata — not persisted.
//   It's recomputed on every render since the grouping is cheap and the
//   source data (MR titles/branches) can change between page loads.
// ---------------------------------------------------------------------------

import type { ReviewTask, TaskProgress } from '@/services/review/review-types';

// ---------------------------------------------------------------------------
// Queue item
// ---------------------------------------------------------------------------

/**
 * Status of a queued review job.
 * - queued: waiting to be processed
 * - running: actively being reviewed by the orchestrator
 * - paused: user paused mid-review, partial results cached
 * - complete: review finished successfully
 * - error: review failed (error message in QueuedReview.error)
 */
export type QueueItemStatus = 'queued' | 'running' | 'paused' | 'complete' | 'error';

/**
 * A single MR review job in the queue.
 *
 * Carries all metadata needed for display and priority scoring.
 * The queue manager persists these to chrome.storage.local so the
 * queue survives service worker restarts.
 */
export type QueuedReview = {
  /** MR internal ID (the !123 number) */
  mrIid: number;
  /** GitLab project path (e.g., "group/project") */
  projectPath: string;
  /** GitLab project numeric ID */
  projectId: number;
  /** GitLab host URL (e.g., "https://gitlab.com") */
  hostUrl: string;
  /** GitLab host config ID (UUID from settings) */
  hostId: string;
  /** MR title */
  title: string;
  /** MR author username */
  authorUsername: string;
  /** Source branch name */
  sourceBranch: string;
  /** Target branch name */
  targetBranch: string;
  /** MR labels */
  labels: string[];
  /** MR state from GitLab */
  mrState: 'opened' | 'closed' | 'merged' | 'locked';

  // --- Preview data (from FETCH_MR_PREVIEW) ---
  /** Number of files changed */
  filesChanged: number;
  /** Total lines added */
  linesAdded: number;
  /** Total lines removed */
  linesRemoved: number;
  /** Risk level from previous review cache, if available */
  riskLevel?: 'low' | 'medium' | 'high';

  // --- Queue state ---
  /** Current status of this queue item */
  status: QueueItemStatus;
  /** Computed priority */
  priority: ReviewPriority;
  /** Snapshot of review progress (updated as tasks complete) */
  progress: ReviewProgressSnapshot | null;
  /** Which review tasks to run */
  tasks: ReviewTask[];

  // --- Timestamps ---
  /** When the item was added to the queue */
  enqueuedAt: number;
  /** When the review started running (null if not started) */
  startedAt: number | null;
  /** When the review completed or errored (null if not finished) */
  completedAt: number | null;
  /** When the review was paused (null if not paused) */
  pausedAt: number | null;

  /** Error message if status is 'error' */
  error: string | null;
};

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

/**
 * Computed priority for a queued MR review.
 * The score determines queue ordering — higher score = reviewed first.
 */
export type ReviewPriority = {
  /** Composite score from 0-100. Higher = more urgent. */
  score: number;
  /** Overall risk assessment derived from diff characteristics */
  riskLevel: 'low' | 'medium' | 'high';
  /** Human-readable signals explaining the score */
  signals: PrioritySignal[];
};

/**
 * A single factor contributing to the priority score.
 * Displayed in the UI as tooltip/detail content.
 */
export type PrioritySignal = {
  /** Human-readable label (e.g., "High risk", "Large diff (500+ lines)") */
  label: string;
  /** How much this signal contributed to the composite score (0-100 scale) */
  weight: number;
  /** Category for grouping/icons in the UI */
  category: 'risk' | 'size' | 'staleness' | 'labels' | 'approvals';
};

// ---------------------------------------------------------------------------
// Progress snapshot
// ---------------------------------------------------------------------------

/**
 * Serializable snapshot of review progress.
 *
 * This is a flattened version of ReviewProgress that can be stored in
 * chrome.storage.local and sent over message ports. The full ReviewProgress
 * type uses the Zustand store's internal structure which isn't serializable.
 *
 * The overallPercent is pre-computed so the UI doesn't need to know the
 * task weighting logic — it just renders the number.
 */
export type ReviewProgressSnapshot = {
  /** Per-task status */
  tasks: Record<string, TaskProgressSnapshot>;
  /** Total files to review (for code review task) */
  filesTotal: number;
  /** Files reviewed so far */
  filesComplete: number;
  /** Pre-computed overall progress percentage (0-100) */
  overallPercent: number;
};

/**
 * Snapshot of a single task's progress.
 * Mirrors TaskProgress but without the error detail (kept in QueuedReview.error).
 */
export type TaskProgressSnapshot = {
  status: 'idle' | 'loading' | 'streaming' | 'complete' | 'error';
};

// ---------------------------------------------------------------------------
// Ticket grouping
// ---------------------------------------------------------------------------

/**
 * A group of MRs that share a ticket reference.
 *
 * Computed client-side by scanning MR titles and branch names for
 * Jira-style ticket keys (e.g., PROJ-1234). Not persisted — recomputed
 * on each page load since it's cheap and source data can change.
 */
export type TicketGroup = {
  /** The ticket key (e.g., "PROJ-1234") */
  ticketKey: string;
  /** Ticket title from Jira, if available. Null if Jira not configured or fetch failed. */
  ticketTitle: string | null;
  /** Ticket status from Jira (e.g., "In Progress"). Null if unavailable. */
  ticketStatus: string | null;
  /** MR IIDs in this group, ordered by priority (highest first) */
  mrIids: number[];
  /** Whether the group is expanded in the UI */
  expanded: boolean;
};

// ---------------------------------------------------------------------------
// Sort options
// ---------------------------------------------------------------------------

/**
 * Available sort keys for the MR list.
 * 'priority' is the default — auto-sorts by computed priority score.
 */
export type QueueSortKey = 'priority' | 'newest' | 'oldest' | 'mostFiles' | 'mostLines';

// ---------------------------------------------------------------------------
// Queue status (broadcast from background to content scripts)
// ---------------------------------------------------------------------------

/**
 * Full queue state broadcast to content scripts.
 * Sent whenever the queue changes (enqueue, status change, progress update).
 *
 * The content script uses this to update the UI without polling.
 * Includes the full item list so the UI can render without local state
 * management — the background is the single source of truth.
 */
export type QueueStatus = {
  /** Project path this queue belongs to */
  projectPath: string;
  /** All items in the queue (ordered by priority) */
  items: QueuedReview[];
  /** Number of completed reviews */
  completedCount: number;
  /** Number of items currently running */
  runningCount: number;
  /** Total items (all statuses) */
  totalCount: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a ReviewProgressSnapshot from the orchestrator's task progress.
 * Used by the queue manager to capture progress during a running review.
 *
 * Task weights for overall percentage calculation:
 * - summary: 10%
 * - codeReview: 40% (heaviest — scales with file count)
 * - edgeCases: 15%
 * - relatedFiles: 10%
 * - fileActivity: 5%
 * - adversarialTests: 8%
 * - contracts: 6%
 * - behavioralDelta: 6%
 */
const TASK_WEIGHTS: Record<string, number> = {
  summary: 10,
  codeReview: 40,
  edgeCases: 15,
  relatedFiles: 10,
  fileActivity: 5,
  adversarialTests: 8,
  contracts: 6,
  behavioralDelta: 6,
};

export function buildProgressSnapshot(
  taskProgress: Record<string, TaskProgress>,
  activeTasks: ReviewTask[],
): ReviewProgressSnapshot {
  const tasks: Record<string, TaskProgressSnapshot> = {};
  let filesTotal = 0;
  let filesComplete = 0;
  let weightedComplete = 0;
  let totalWeight = 0;

  for (const taskName of activeTasks) {
    const progress = taskProgress[taskName];
    if (!progress) {
      tasks[taskName] = { status: 'idle' };
      continue;
    }

    tasks[taskName] = { status: progress.status };

    if (taskName === 'codeReview') {
      filesTotal = progress.filesTotal;
      filesComplete = progress.filesComplete;
    }

    const weight = TASK_WEIGHTS[taskName] ?? 5;
    totalWeight += weight;

    if (progress.status === 'complete') {
      weightedComplete += weight;
    } else if (progress.status === 'streaming' || progress.status === 'loading') {
      // Partial credit for in-progress tasks.
      // Code review gets proportional credit based on files completed.
      if (taskName === 'codeReview' && progress.filesTotal > 0) {
        weightedComplete += weight * (progress.filesComplete / progress.filesTotal);
      } else {
        // Other tasks: 50% credit when streaming, 25% when loading
        weightedComplete += weight * (progress.status === 'streaming' ? 0.5 : 0.25);
      }
    }
    // idle and error tasks contribute 0
  }

  const overallPercent = totalWeight > 0
    ? Math.round((weightedComplete / totalWeight) * 100)
    : 0;

  return { tasks, filesTotal, filesComplete, overallPercent };
}
