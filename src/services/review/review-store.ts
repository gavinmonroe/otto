// ---------------------------------------------------------------------------
// Review Store — Zustand store for review state in the content script.
//
// This store lives in the content script context. It holds the current
// review state and provides actions for the UI to interact with.
//
// Design decisions:
// - Ephemeral per page load — reviews are not persisted across navigations.
//   This is intentional: MR diffs change, and stale reviews are misleading.
// - The store is the single source of truth for what the UI renders.
// - Stream deltas update the store incrementally for real-time rendering.
// - Comment status changes (accept/dismiss/edit) are local-only — they
//   don't trigger API calls. The user explicitly posts to GitLab.
// - We use Zustand's immer-free approach: spread operators for immutable
//   updates. The state shape is flat enough that this is manageable.
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import type {
  MrContext,
  MrSummary,
  FileReview,
  ReviewComment,
  ReviewCommentStatus,
  RelatedFile,
  EdgeCase,
  ReviewStatus,
} from '@/types/review';
import type { FollowUpAnalysis, FollowUpStatus } from '@/types/followup';
import type { ReviewProgress, ReviewTask } from './review-types';
import { recordSignal } from './reviewer-prefs';
import { INITIAL_REVIEW_PROGRESS } from './review-types';
import type { CachedReview } from './review-cache';

type ReviewState = {
  // MR context (set once when the page loads)
  mrContext: MrContext | null;

  // Overall review status
  status: ReviewStatus;
  error: string | null;

  // Progress message (e.g., "Fetching file context...", "Reviewing src/foo.ts...")
  progressMessage: string | null;

  // Per-task progress
  progress: ReviewProgress;

  // Review results
  summary: MrSummary | null;
  summaryDelta: string;           // Streaming accumulator for summary
  fileReviews: FileReview[];
  fileReviewDeltas: Record<string, string>;  // filePath → streaming accumulator
  relatedFiles: RelatedFile[];
  edgeCases: EdgeCase[];
  edgeCasesDelta: string;         // Streaming accumulator for edge cases

  // Ticket context (from Jira etc.)
  ticketContext: string | null;
  ticketKeys: string[];

  // Timestamps
  startedAt: number | null;
  completedAt: number | null;

  // Follow-up state — keyed by commentId
  followUps: Record<string, FollowUpAnalysis>;
  followUpStatus: Record<string, FollowUpStatus>;
  followUpErrors: Record<string, string>;
};

type ReviewActions = {
  // Initialization
  setMrContext: (context: MrContext) => void;
  reset: () => void;

  // Cache hydration
  hydrateFromCache: (cached: CachedReview) => void;

  // Review lifecycle
  startReview: (tasks: ReviewTask[]) => void;
  completeReview: () => void;
  setError: (error: string) => void;
  setProgressMessage: (message: string | null) => void;

  // Summary
  appendSummaryDelta: (content: string) => void;
  setSummary: (summary: MrSummary) => void;

  // File reviews
  setFileReviewsTotal: (total: number) => void;
  appendFileReviewDelta: (filePath: string, content: string) => void;
  addFileReview: (review: FileReview) => void;

  // Related files
  setRelatedFiles: (files: RelatedFile[]) => void;

  // Edge cases
  appendEdgeCasesDelta: (content: string) => void;
  setEdgeCases: (edgeCases: EdgeCase[]) => void;

  // Ticket context
  setTicketContext: (ticketContext: string, ticketKeys: string[]) => void;

  // Task progress
  setTaskStatus: (task: ReviewTask, status: ReviewProgress[ReviewTask]['status'], error?: string) => void;

  // Comment actions (user interactions)
  updateCommentStatus: (commentId: string, status: ReviewCommentStatus, editedBody?: string) => void;

  // Follow-up actions
  setFollowUp: (commentId: string, analysis: FollowUpAnalysis) => void;
  setFollowUpStatus: (commentId: string, status: FollowUpStatus, error?: string) => void;
  clearFollowUp: (commentId: string) => void;
  clearAllFollowUps: () => void;
};

const INITIAL_STATE: ReviewState = {
  mrContext: null,
  status: 'idle',
  error: null,
  progressMessage: null,
  progress: INITIAL_REVIEW_PROGRESS,
  summary: null,
  summaryDelta: '',
  fileReviews: [],
  fileReviewDeltas: {},
  relatedFiles: [],
  edgeCases: [],
  edgeCasesDelta: '',
  ticketContext: null,
  ticketKeys: [],
  startedAt: null,
  completedAt: null,
  followUps: {},
  followUpStatus: {},
  followUpErrors: {},
};

export const useReviewStore = create<ReviewState & ReviewActions>()((set, get) => ({
  ...INITIAL_STATE,

  setMrContext: (context) => set({ mrContext: context }),

  reset: () => set({ ...INITIAL_STATE, mrContext: get().mrContext }),

  hydrateFromCache: (cached) => {
    const allComplete = { ...INITIAL_REVIEW_PROGRESS };
    for (const key of Object.keys(allComplete) as ReviewTask[]) {
      allComplete[key] = { ...allComplete[key], status: 'complete' };
    }
    if (cached.fileReviews.length > 0) {
      allComplete.codeReview = {
        ...allComplete.codeReview,
        filesTotal: cached.fileReviews.length,
        filesComplete: cached.fileReviews.length,
      };
    }
    set({
      status: 'complete',
      error: null,
      progress: allComplete,
      summary: cached.summary,
      summaryDelta: '',
      fileReviews: cached.fileReviews,
      fileReviewDeltas: {},
      relatedFiles: cached.relatedFiles,
      edgeCases: cached.edgeCases,
      edgeCasesDelta: '',
      ticketContext: cached.ticketContext ?? null,
      ticketKeys: cached.ticketKeys ?? [],
      startedAt: cached.timestamp,
      completedAt: cached.timestamp,
    });
  },

  startReview: (tasks) => {
    const progress = { ...INITIAL_REVIEW_PROGRESS };
    for (const task of tasks) {
      progress[task] = { ...progress[task], status: 'loading' };
    }
    set({
      status: 'loading',
      error: null,
      progress,
      summary: null,
      summaryDelta: '',
      fileReviews: [],
      fileReviewDeltas: {},
      relatedFiles: [],
      edgeCases: [],
      edgeCasesDelta: '',
      startedAt: Date.now(),
      completedAt: null,
    });
  },

  completeReview: () => set({
    status: 'complete',
    completedAt: Date.now(),
  }),

  setError: (error) => set({ status: 'error', error }),

  setProgressMessage: (message) => set({ progressMessage: message }),

  // Summary streaming
  appendSummaryDelta: (content) => set((state) => ({
    summaryDelta: state.summaryDelta + content,
    status: 'streaming',
    progress: {
      ...state.progress,
      summary: { ...state.progress.summary, status: 'streaming' },
    },
  })),

  setSummary: (summary) => set((state) => ({
    summary,
    summaryDelta: '',
    progress: {
      ...state.progress,
      summary: { ...state.progress.summary, status: 'complete' },
    },
  })),

  // File review streaming
  setFileReviewsTotal: (total) => set((state) => ({
    progress: {
      ...state.progress,
      codeReview: { ...state.progress.codeReview, filesTotal: total },
    },
  })),

  appendFileReviewDelta: (filePath, content) => set((state) => ({
    fileReviewDeltas: {
      ...state.fileReviewDeltas,
      [filePath]: (state.fileReviewDeltas[filePath] || '') + content,
    },
    status: 'streaming',
    progress: {
      ...state.progress,
      codeReview: { ...state.progress.codeReview, status: 'streaming' },
    },
  })),

  addFileReview: (review) => set((state) => {
    const { [review.filePath]: _, ...remainingDeltas } = state.fileReviewDeltas;
    const filesComplete = state.progress.codeReview.filesComplete + 1;
    return {
      fileReviews: [...state.fileReviews, review],
      fileReviewDeltas: remainingDeltas,
      progress: {
        ...state.progress,
        codeReview: {
          ...state.progress.codeReview,
          filesComplete,
          status: filesComplete >= state.progress.codeReview.filesTotal ? 'complete' : 'streaming',
        },
      },
    };
  }),

  // Related files
  setRelatedFiles: (files) => set((state) => ({
    relatedFiles: files,
    progress: {
      ...state.progress,
      relatedFiles: { ...state.progress.relatedFiles, status: 'complete' },
    },
  })),

  // Edge cases streaming
  appendEdgeCasesDelta: (content) => set((state) => ({
    edgeCasesDelta: state.edgeCasesDelta + content,
    progress: {
      ...state.progress,
      edgeCases: { ...state.progress.edgeCases, status: 'streaming' },
    },
  })),

  setEdgeCases: (edgeCases) => set((state) => ({
    edgeCases,
    edgeCasesDelta: '',
    progress: {
      ...state.progress,
      edgeCases: { ...state.progress.edgeCases, status: 'complete' },
    },
  })),

  setTicketContext: (ticketContext, ticketKeys) => set({
    ticketContext,
    ticketKeys,
  }),

  // Task progress — also clears delta for the failed task
  setTaskStatus: (task, status, error) => set((state) => {
    const updates: Partial<ReviewState> = {
      progress: {
        ...state.progress,
        [task]: { ...state.progress[task], status, error: error || null },
      },
    };
    // Clear streaming deltas on error so raw JSON doesn't linger
    if (status === 'error') {
      if (task === 'edgeCases') updates.edgeCasesDelta = '';
      if (task === 'summary') updates.summaryDelta = '';
    }
    return updates;
  }),

  // Comment actions
  updateCommentStatus: (commentId, status, editedBody) => {
    const state = get();

    // Record signal for reviewer preferences learning.
    // "edited" counts as accepted (reviewer cared enough to refine).
    if (status === 'accepted' || status === 'dismissed' || status === 'edited') {
      const comment = state.fileReviews
        .flatMap((fr) => fr.comments)
        .find((c) => c.id === commentId);
      if (comment && state.mrContext?.hostUrl) {
        recordSignal(state.mrContext.hostUrl, {
          category: comment.category,
          severity: comment.severity,
          action: status === 'dismissed' ? 'dismissed' : 'accepted',
        }).catch(() => {}); // Fire and forget — don't block UI
      }
    }

    set({
      fileReviews: state.fileReviews.map((fr) => ({
        ...fr,
        comments: fr.comments.map((c) =>
          c.id === commentId
            ? { ...c, status, editedBody: editedBody ?? c.editedBody }
            : c,
        ),
      })),
    });
  },

  // Follow-up actions
  setFollowUp: (commentId, analysis) => set((state) => ({
    followUps: { ...state.followUps, [commentId]: analysis },
    followUpStatus: { ...state.followUpStatus, [commentId]: 'complete' as const },
  })),

  setFollowUpStatus: (commentId, status, error) => set((state) => ({
    followUpStatus: { ...state.followUpStatus, [commentId]: status },
    followUpErrors: error
      ? { ...state.followUpErrors, [commentId]: error }
      : state.followUpErrors,
  })),

  clearFollowUp: (commentId) => set((state) => {
    const { [commentId]: _fu, ...remainingFollowUps } = state.followUps;
    const { [commentId]: _st, ...remainingStatus } = state.followUpStatus;
    const { [commentId]: _er, ...remainingErrors } = state.followUpErrors;
    return {
      followUps: remainingFollowUps,
      followUpStatus: remainingStatus,
      followUpErrors: remainingErrors,
    };
  }),

  clearAllFollowUps: () => set({
    followUps: {},
    followUpStatus: {},
    followUpErrors: {},
  }),
}));
