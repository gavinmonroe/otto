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
  FileActivityData,
  AcValidationData,
} from '@/types/review';
import type {
  VerificationData,
  AdversarialTestData,
  ContractData,
  BehavioralDeltaData,
  TrustAssessment,
  CiExecutionResult,
} from '@/types/verification';
import { EMPTY_VERIFICATION_DATA } from '@/types/verification';
import type { FollowUpAnalysis, FollowUpStatus } from '@/types/followup';
import type { ReviewProgress, ReviewTask } from './review-types';
import { recordSignal } from './reviewer-prefs';
import { INITIAL_REVIEW_PROGRESS, INITIAL_TASK_PROGRESS } from './review-types';
import type { CachedReview } from './review-cache';
import type { HealthLevel } from './health-monitor';

// --- Debug: track store update frequency ---
let storeUpdateCount = 0;
let storeUpdateTimer: ReturnType<typeof setInterval> | null = null;
function startStoreUpdateCounter() {
  if (storeUpdateTimer) return;
  storeUpdateTimer = setInterval(() => {
    if (storeUpdateCount > 0) {
      console.log(`[Otto:store] ${storeUpdateCount} set() calls in last 1s`);
      storeUpdateCount = 0;
    }
  }, 1000);
}
function countStoreUpdate() {
  storeUpdateCount++;
  startStoreUpdateCounter();
}

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

  // File activity (cross-MR awareness)
  fileActivity: FileActivityData | null;

  // Acceptance criteria validation
  acValidation: AcValidationData | null;

  // Verification (adversarial tests, contracts, behavioral delta, trust)
  verification: VerificationData;
  adversarialTestsDelta: string;   // Streaming accumulator
  contractsDelta: string;          // Streaming accumulator
  behavioralDeltaDelta: string;    // Streaming accumulator

  // Timestamps
  startedAt: number | null;
  completedAt: number | null;

  // Follow-up state — keyed by commentId
  followUps: Record<string, FollowUpAnalysis>;
  followUpStatus: Record<string, FollowUpStatus>;
  followUpErrors: Record<string, string>;

  // Tab health level (set by health monitor on transitions only)
  healthLevel: HealthLevel;

  // Fix jobs — keyed by commentId. Tracks sandbox fix progress per comment.
  fixJobs: Record<string, FixJobState>;
};

/** State of a sandbox fix job for a single comment. */
export type FixJobState = {
  jobId: string | null;
  status: 'pending' | 'cloning' | 'setting_up' | 'running' | 'testing' | 'pushing' | 'complete' | 'failed';
  detail: string;
  commitSha: string | null;
  error: string | null;
};

/** Human-readable labels for fix pipeline stages. */
export const FIX_STAGE_LABELS: Record<FixJobState['status'], string> = {
  pending: 'Requesting fix...',
  cloning: 'Cloning repository...',
  setting_up: 'Installing dependencies...',
  running: 'Applying fix...',
  testing: 'Running tests...',
  pushing: 'Pushing to branch...',
  complete: 'Fix applied',
  failed: 'Fix failed',
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
  /** Set status without resetting results. Used by queue subscription to show
   *  loading state while preserving any partial data from a prior cache load. */
  setStatus: (status: ReviewStatus) => void;

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

  // File activity
  setFileActivity: (data: FileActivityData) => void;

  // Acceptance criteria validation
  setAcValidation: (data: AcValidationData) => void;

  // Verification
  setVerificationGenerating: () => void;
  setAdversarialTests: (data: AdversarialTestData) => void;
  appendAdversarialTestsDelta: (content: string) => void;
  setContracts: (data: ContractData) => void;
  appendContractsDelta: (content: string) => void;
  setBehavioralDelta: (data: BehavioralDeltaData) => void;
  appendBehavioralDeltaDelta: (content: string) => void;
  setTrustAssessment: (trust: TrustAssessment) => void;
  setCiExecution: (result: CiExecutionResult) => void;

  // Task progress
  setTaskStatus: (task: ReviewTask, status: ReviewProgress[ReviewTask]['status'], error?: string) => void;

  // Comment actions (user interactions)
  updateCommentStatus: (commentId: string, status: ReviewCommentStatus, editedBody?: string) => void;

  // Follow-up actions
  setFollowUp: (commentId: string, analysis: FollowUpAnalysis) => void;
  setFollowUpStatus: (commentId: string, status: FollowUpStatus, error?: string) => void;
  clearFollowUp: (commentId: string) => void;
  clearAllFollowUps: () => void;

  // Health
  setHealthLevel: (level: HealthLevel) => void;

  // Fix jobs (sandbox auto-fix via Botto)
  startFixJob: (commentId: string) => void;
  updateFixJob: (commentId: string, update: Partial<FixJobState>) => void;
  clearFixJob: (commentId: string) => void;
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
  fileActivity: null,
  acValidation: null,
  verification: { ...EMPTY_VERIFICATION_DATA },
  adversarialTestsDelta: '',
  contractsDelta: '',
  behavioralDeltaDelta: '',
  startedAt: null,
  completedAt: null,
  followUps: {},
  followUpStatus: {},
  followUpErrors: {},
  healthLevel: 'normal',
  fixJobs: {},
};

export const useReviewStore = create<ReviewState & ReviewActions>()((rawSet, get) => {
  // Wrap set to count updates for debugging
  const set: typeof rawSet = (...args: any[]) => {
    countStoreUpdate();
    return (rawSet as any)(...args);
  };

  return {
  ...INITIAL_STATE,

  setMrContext: (context) => set({ mrContext: context }),

  reset: () => set({ ...INITIAL_STATE, mrContext: get().mrContext, healthLevel: get().healthLevel }),

  hydrateFromCache: (cached) => {
    const progress = { ...INITIAL_REVIEW_PROGRESS };

    // Only mark tasks as complete if they have actual cached data.
    // This is critical for partial caches saved mid-review — tasks that
    // haven't completed yet should stay idle, not be marked complete.
    if (cached.summary) {
      progress.summary = { ...progress.summary, status: 'complete' };
    }
    if (cached.fileReviews.length > 0) {
      progress.codeReview = {
        ...progress.codeReview,
        status: 'complete',
        filesTotal: cached.fileReviews.length,
        filesComplete: cached.fileReviews.length,
      };
    }
    if (cached.edgeCases.length > 0) {
      progress.edgeCases = { ...progress.edgeCases, status: 'complete' };
    }
    if (cached.relatedFiles.length > 0) {
      progress.relatedFiles = { ...progress.relatedFiles, status: 'complete' };
    }
    if (cached.fileActivity) {
      progress.fileActivity = { ...progress.fileActivity, status: 'complete' };
    }

    // Verification tasks — only if data exists
    const v = cached.verification;
    if (v?.adversarialTests) {
      progress.adversarialTests = { ...progress.adversarialTests, status: 'complete' };
    }
    if (v?.contracts) {
      progress.contracts = { ...progress.contracts, status: 'complete' };
    }
    if (v?.behavioralDelta) {
      progress.behavioralDelta = { ...progress.behavioralDelta, status: 'complete' };
    }

    // Determine overall status: complete only if all core tasks have data
    const isFullyComplete = !!(cached.summary && cached.fileReviews.length > 0);

    set({
      status: isFullyComplete ? 'complete' : get().status,
      error: null,
      progress,
      summary: cached.summary,
      summaryDelta: '',
      fileReviews: cached.fileReviews,
      fileReviewDeltas: {},
      relatedFiles: cached.relatedFiles,
      edgeCases: cached.edgeCases,
      edgeCasesDelta: '',
      ticketContext: cached.ticketContext ?? null,
      ticketKeys: cached.ticketKeys ?? [],
      fileActivity: cached.fileActivity ?? null,
      acValidation: cached.acValidation ?? null,
      verification: cached.verification ?? { ...EMPTY_VERIFICATION_DATA },
      adversarialTestsDelta: '',
      contractsDelta: '',
      behavioralDeltaDelta: '',
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
  setStatus: (status) => set({ status }),

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

  setFileActivity: (data) => set({ fileActivity: data }),

  setAcValidation: (data) => set({ acValidation: data }),

  // Verification actions
  setVerificationGenerating: () => set((state) => ({
    verification: { ...state.verification, status: 'generating' },
  })),

  setAdversarialTests: (data) => set((state) => ({
    verification: { ...state.verification, adversarialTests: data },
    adversarialTestsDelta: '',
    progress: {
      ...state.progress,
      adversarialTests: { ...state.progress.adversarialTests, status: 'complete' },
    },
  })),

  appendAdversarialTestsDelta: (content) => set((state) => ({
    adversarialTestsDelta: state.adversarialTestsDelta + content,
    progress: {
      ...state.progress,
      adversarialTests: { ...state.progress.adversarialTests, status: 'streaming' },
    },
  })),

  setContracts: (data) => set((state) => ({
    verification: { ...state.verification, contracts: data },
    contractsDelta: '',
    progress: {
      ...state.progress,
      contracts: { ...state.progress.contracts, status: 'complete' },
    },
  })),

  appendContractsDelta: (content) => set((state) => ({
    contractsDelta: state.contractsDelta + content,
    progress: {
      ...state.progress,
      contracts: { ...state.progress.contracts, status: 'streaming' },
    },
  })),

  setBehavioralDelta: (data) => set((state) => ({
    verification: { ...state.verification, behavioralDelta: data },
    behavioralDeltaDelta: '',
    progress: {
      ...state.progress,
      behavioralDelta: { ...state.progress.behavioralDelta, status: 'complete' },
    },
  })),

  appendBehavioralDeltaDelta: (content) => set((state) => ({
    behavioralDeltaDelta: state.behavioralDeltaDelta + content,
    progress: {
      ...state.progress,
      behavioralDelta: { ...state.progress.behavioralDelta, status: 'streaming' },
    },
  })),

  setTrustAssessment: (trust) => set((state) => ({
    verification: { ...state.verification, trust, status: 'complete', generatedAt: Date.now() },
  })),

  setCiExecution: (result) => set((state) => ({
    verification: { ...state.verification, execution: result, executedAt: Date.now() },
  })),

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
      if (task === 'adversarialTests') updates.adversarialTestsDelta = '';
      if (task === 'contracts') updates.contractsDelta = '';
      if (task === 'behavioralDelta') updates.behavioralDeltaDelta = '';
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

  setHealthLevel: (level) => set({ healthLevel: level }),

  // Fix jobs
  startFixJob: (commentId) => set((state) => ({
    fixJobs: {
      ...state.fixJobs,
      [commentId]: {
        jobId: null,
        status: 'pending',
        detail: 'Requesting fix...',
        commitSha: null,
        error: null,
      },
    },
  })),

  updateFixJob: (commentId, update) => set((state) => {
    const existing = state.fixJobs[commentId];
    if (!existing) return {};
    return {
      fixJobs: {
        ...state.fixJobs,
        [commentId]: { ...existing, ...update },
      },
    };
  }),

  clearFixJob: (commentId) => set((state) => {
    const { [commentId]: _, ...remaining } = state.fixJobs;
    return { fixJobs: remaining };
  }),
};
});
