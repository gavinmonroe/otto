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
