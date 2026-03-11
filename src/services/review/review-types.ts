// ---------------------------------------------------------------------------
// Review types — shared between orchestrator and store.
// Re-exports from the main types file plus orchestrator-specific types.
// ---------------------------------------------------------------------------

export type { 
  MrContext,
  MrReview,
  MrSummary,
  FileReview,
  ReviewComment,
  ReviewCommentStatus,
  RelatedFile,
  EdgeCase,
  ReviewStatus,
  DiffFileData,
} from '@/types/review';

/**
 * Tasks that the review orchestrator can execute.
 * Used by the streaming protocol to specify which tasks to run.
 */
export type ReviewTask = 'summary' | 'codeReview' | 'edgeCases' | 'relatedFiles';

/**
 * Progress tracking for the review pipeline.
 * Each task has its own status so the UI can show granular progress.
 */
export type ReviewProgress = {
  summary: TaskProgress;
  codeReview: TaskProgress;
  edgeCases: TaskProgress;
  relatedFiles: TaskProgress;
};

export type TaskProgress = {
  status: 'idle' | 'loading' | 'streaming' | 'complete' | 'error';
  error: string | null;
  /** For code review: tracks per-file progress */
  filesTotal: number;
  filesComplete: number;
};

export const INITIAL_TASK_PROGRESS: TaskProgress = {
  status: 'idle',
  error: null,
  filesTotal: 0,
  filesComplete: 0,
};

export const INITIAL_REVIEW_PROGRESS: ReviewProgress = {
  summary: { ...INITIAL_TASK_PROGRESS },
  codeReview: { ...INITIAL_TASK_PROGRESS },
  edgeCases: { ...INITIAL_TASK_PROGRESS },
  relatedFiles: { ...INITIAL_TASK_PROGRESS },
};
