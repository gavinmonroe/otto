// ---------------------------------------------------------------------------
// MR List Preview types — data structures for the merge request list page
// preview strips.
//
// Design decisions:
// - `state` uses GitLab's actual state union (includes 'locked').
// - `riskLevel` is optional — only present if Otto has a cached review.
// - `languages` is pre-sorted descending by linesChanged so the UI can
//   render the bar segments left-to-right without re-sorting.
// - `fetchedAt` enables TTL-based cache invalidation.
// ---------------------------------------------------------------------------

/**
 * A single segment in the language breakdown bar.
 * Pre-computed so the UI component is a pure renderer.
 */
export type LanguageBreakdown = {
  language: string;
  linesChanged: number;
  color: string;         // Hex color for the bar segment
  percentage: number;    // 0–100, computed from total lines changed
};

/**
 * Preview data for a single MR on the list page.
 * Computed from the GitLab MR changes API + optional cached review data.
 */
export type MrPreviewData = {
  mrIid: number;
  projectPath: string;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  languages: LanguageBreakdown[];
  riskLevel?: 'low' | 'medium' | 'high';
  fetchedAt: number;
};
