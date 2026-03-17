// ---------------------------------------------------------------------------
// Conflict Radar types — overlapping changes between in-flight MRs.
//
// These types match Botto's wire format (types/cluster.rs ConflictReport).
// Used by the conflict store and UI components to display warnings about
// files/lines that other open MRs are also modifying.
// ---------------------------------------------------------------------------

/** A single diff hunk parsed from unified diff headers. */
export type DiffHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
};

/** How two MRs overlap on a file. */
export type OverlapType = 'line_range' | 'same_file';

/** Severity of a file conflict between two MRs. */
export type ConflictSeverity = 'high' | 'medium';

/** A single MR that conflicts with the current MR on a specific file. */
export type ConflictingMr = {
  mrIid: number;
  mrTitle: string;
  author: string;
  webUrl: string;
  overlapType: OverlapType;
  yourHunks: DiffHunk[];
  theirHunks: DiffHunk[];
  severity: ConflictSeverity;
  /** AI-generated explanation of the semantic conflict (if enabled). */
  semanticNote: string | null;
};

/** All conflicts on a single file. */
export type FileConflict = {
  filePath: string;
  conflictingMrs: ConflictingMr[];
};

/** Complete conflict report for an MR. */
export type ConflictReport = {
  mrIid: number;
  conflicts: FileConflict[];
};
