// ---------------------------------------------------------------------------
// Review domain types — the core data structures for Otto's review system.
//
// Design decisions:
// - ReviewComment has a `status` field so the UI can track accept/dismiss/edit
//   per comment without mutating the original AI output.
// - FileReview groups comments by file, matching the per-file injection model.
// - MrReview is the top-level container for an entire review session.
// - RelatedFile includes `reason` so the UI can explain why it was surfaced.
// - EdgeCase is structured to support both textual analysis and code references.
// - All IDs are simple strings (crypto.randomUUID) — no need for anything heavier.
// ---------------------------------------------------------------------------

export type ReviewCommentSeverity = 'critical' | 'warning' | 'suggestion' | 'info';

export type ReviewCommentCategory =
  | 'bug'
  | 'logic-error'
  | 'security'
  | 'performance'
  | 'readability'
  | 'style'
  | 'error-handling'
  | 'naming'
  | 'duplication'
  | 'other';

export type ReviewCommentStatus = 'pending' | 'accepted' | 'dismissed' | 'edited';

export type ReviewComment = {
  id: string;
  filePath: string;
  startLine: number | null;   // null if comment is file-level
  endLine: number | null;
  severity: ReviewCommentSeverity;
  category: ReviewCommentCategory;
  title: string;               // One-line summary
  body: string;                // Detailed explanation (markdown)
  originalCode: string | null; // Code being replaced (for diff view)
  suggestion: string | null;   // Suggested code fix, if applicable
  suggestionSummary: string | null; // Human-readable description of what the suggestion does
  status: ReviewCommentStatus;
  editedBody: string | null;   // User's edited version, if status === 'edited'
};

export type FileReview = {
  filePath: string;
  comments: ReviewComment[];
  summary: string;             // One-paragraph summary of this file's changes
  riskLevel: 'low' | 'medium' | 'high';
};

export type RelatedFile = {
  filePath: string;
  reason: string;              // Why this file is relevant
  content: string | null;      // File content (fetched from GitLab API)
  relationship: 'imports' | 'imported-by' | 'shared-type' | 'test' | 'config' | 'other';
};

export type EdgeCase = {
  id: string;
  title: string;
  description: string;         // Detailed analysis (markdown)
  filePath: string | null;     // Primary file this relates to
  lineRange: { start: number; end: number } | null;
  severity: 'critical' | 'moderate' | 'minor';
  category: 'error-handling' | 'boundary-condition' | 'race-condition' | 'null-safety' | 'type-safety' | 'resource-leak' | 'other';
  hypotheticalTrace: string | null;  // Stack trace scenario (markdown/code block)
};

export type MrSummary = {
  overview: string;            // What changed and why (markdown)
  riskAssessment: string;      // Overall risk level explanation
  keyChanges: string[];        // Bullet points of the most important changes
  affectedAreas: string[];     // High-level areas of the codebase affected
};

export type ReviewStatus = 'idle' | 'loading' | 'streaming' | 'complete' | 'error';

export type MrReview = {
  mrIid: number;
  projectPath: string;
  status: ReviewStatus;
  error: string | null;
  summary: MrSummary | null;
  fileReviews: FileReview[];
  relatedFiles: RelatedFile[];
  edgeCases: EdgeCase[];
  startedAt: number | null;    // timestamp
  completedAt: number | null;  // timestamp
};

// ---------------------------------------------------------------------------
// File Activity — cross-MR awareness for files in the current diff.
//
// Surfaces recently-merged MRs that touched the same files, giving the
// reviewer instant context about what's been changing around the code.
// Used by: MrOverviewPanel (aggregate), FileReviewFooter (per-file),
// ReviewQueuePanel (churn indicator), AI prompts (integration risk context).
// ---------------------------------------------------------------------------

/**
 * A recently-merged MR that touched one or more files in the current diff.
 * Intentionally lightweight — we only store what the UI and prompts need.
 */
export type RecentMr = {
  iid: number;
  title: string;
  author: string;              // username, not display name (shorter, linkable)
  mergedAt: string;            // ISO 8601 date string
  webUrl: string;
};

/**
 * Activity summary for a single file in the current diff.
 * Contains the list of recent MRs that modified this file.
 */
export type FileActivity = {
  filePath: string;
  recentMrs: RecentMr[];       // Sorted by mergedAt descending (most recent first)
};

/**
 * Top-level container for all file activity data.
 * Stored in the review cache and passed to the AI prompt builder.
 */
export type FileActivityData = {
  fileActivities: FileActivity[];  // Only files that have activity (sparse)
  totalRecentMrs: number;          // Unique MR count across all files
  lookbackDays: number;            // How far back we searched (for display)
};

// ---------------------------------------------------------------------------
// Acceptance Criteria Validation — checks the diff against ticket requirements.
//
// The AI validates each acceptance criterion from linked Jira tickets against
// the actual code changes. Used by: MrOverviewPanel (requirements checklist),
// summary risk assessment (unmet criteria bump risk), self-review mode.
// ---------------------------------------------------------------------------

export type AcValidationStatus = 'satisfied' | 'unclear' | 'not-found';

/**
 * Validation result for a single acceptance criterion.
 */
export type AcCriterionResult = {
  criterion: string;               // The original criterion text
  status: AcValidationStatus;
  explanation: string;             // Why this status was assigned (markdown)
  evidence: AcEvidence[];          // Files/lines that support the verdict
};

/**
 * A piece of evidence linking a criterion to code in the diff.
 */
export type AcEvidence = {
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  snippet: string | null;          // Brief code excerpt (for display)
};

/**
 * Top-level container for all AC validation results.
 * One per ticket — if multiple tickets are linked, there are multiple results.
 */
export type AcValidationResult = {
  ticketKey: string;
  criteria: AcCriterionResult[];
  summary: string;                 // One-line overall assessment
};

/**
 * Aggregated AC validation data across all linked tickets.
 */
export type AcValidationData = {
  results: AcValidationResult[];
  satisfiedCount: number;
  unclearCount: number;
  notFoundCount: number;
};

// ---------------------------------------------------------------------------
// MR Context — extracted from the page DOM + GitLab API, passed to services.
// This is the "input" to the review pipeline.
// ---------------------------------------------------------------------------

export type MrContext = {
  projectPath: string;         // e.g., "namespace/project"
  projectId: number | null;    // Numeric ID (resolved via API if needed)
  mrIid: number;
  hostUrl: string;             // e.g., "https://gitlab.com"
  title: string;
  description: string | null;
  sourceBranch: string;
  targetBranch: string;
  diffFiles: DiffFileData[];
};

export type DiffFileData = {
  filePath: string;            // new_path from the diff
  oldPath: string | null;      // old_path if renamed
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  diff: string;                // Raw unified diff text
  addedLines: number;
  removedLines: number;
};
