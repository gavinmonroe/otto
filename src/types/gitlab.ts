// ---------------------------------------------------------------------------
// GitLab API response types — typed representations of GitLab REST API v4.
//
// These are intentionally minimal: we only type the fields Otto actually uses.
// GitLab returns many more fields, but typing unused fields creates maintenance
// burden with no benefit. Add fields here as features need them.
// ---------------------------------------------------------------------------

export type GitLabProject = {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch: string;
  web_url: string;
};

export type GitLabMergeRequest = {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  source_branch: string;
  target_branch: string;
  author: {
    id: number;
    username: string;
    name: string;
  };
  labels: string[];
  web_url: string;
  diff_refs: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
  } | null;
};

/**
 * Lightweight MR summary for list endpoints — used by file activity feature.
 * Intentionally separate from GitLabMergeRequest to keep the list response
 * type minimal (we don't need diff_refs, labels, etc. for activity lookups).
 */
export type GitLabMergedMrSummary = {
  iid: number;
  title: string;
  author: {
    username: string;
  };
  web_url: string;
  merged_at: string | null;    // ISO 8601 — null if not yet merged
};

export type GitLabDiffFile = {
  old_path: string;
  new_path: string;
  a_mode: string;
  b_mode: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  diff: string;           // Unified diff text
};

export type GitLabMrChanges = GitLabMergeRequest & {
  changes: GitLabDiffFile[];
};

export type GitLabTreeItem = {
  id: string;
  name: string;
  type: 'tree' | 'blob';
  path: string;
  mode: string;
};

export type GitLabBlameRange = {
  commit: {
    id: string;
    message: string;
    author_name: string;
    authored_date: string;
  };
  lines: string[];
};

// ---------------------------------------------------------------------------
// MR Discussion / Note types — used by the comment follow-up feature.
// ---------------------------------------------------------------------------

export type GitLabNote = {
  id: number;
  body: string;
  author: {
    id: number;
    username: string;
    name: string;
  };
  created_at: string;
  updated_at: string;
  system: boolean;           // true for auto-generated notes (e.g., "merged", "assigned")
  resolvable: boolean;
  resolved: boolean;
  position: GitLabNotePosition | null;
};

export type GitLabNotePosition = {
  base_sha: string;
  start_sha: string;
  head_sha: string;
  old_path: string;
  new_path: string;
  position_type: 'text' | 'image';
  old_line: number | null;
  new_line: number | null;
  line_range: {
    start: { line_code: string; type: 'new' | 'old'; new_line: number | null; old_line: number | null };
    end: { line_code: string; type: 'new' | 'old'; new_line: number | null; old_line: number | null };
  } | null;
};

export type GitLabDiscussion = {
  id: string;
  individual_note: boolean;  // true if this is a standalone note, not a thread
  notes: GitLabNote[];
};
