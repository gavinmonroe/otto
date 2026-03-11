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
