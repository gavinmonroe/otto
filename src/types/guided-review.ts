// ---------------------------------------------------------------------------
// Guided Review types — data structures for the slide-based review mode.
//
// Design decisions:
// - ReviewSlide is a discriminated union on `kind` so the renderer can
//   exhaustively switch on it.
// - Each variant carries all the context the slide renderer needs — no
//   additional store lookups required during render.
// - `priority` is pre-computed during queue building so the list can be
//   sorted once and re-sorted only when data changes.
// - `completed` is tracked per-slide so navigation can skip finished items
//   while the sidebar still shows them with checkmarks.
// - Thread slides carry the full GitLabDiscussion so we can render all
//   notes, show file context, and link back to the GitLab UI.
// ---------------------------------------------------------------------------

import type { ReviewComment, FileReview, EdgeCase, RelatedFile } from './review';
import type { GitLabDiscussion } from './gitlab';
import type { ReviewPhase } from './cluster';

// ---------------------------------------------------------------------------
// Slide variants
// ---------------------------------------------------------------------------

export type CommentSlide = {
  kind: 'comment';
  id: string;                    // Same as ReviewComment.id
  comment: ReviewComment;
  fileReview: FileReview;        // Parent file context (summary, risk, sibling comments)
  relatedFiles: RelatedFile[];   // Related files that reference this file
  priority: number;
  /** Set when this slide is part of a cross-MR guided review. */
  crossMr?: CrossMrContext;
};

export type EdgeCaseSlide = {
  kind: 'edgeCase';
  id: string;                    // Same as EdgeCase.id
  edgeCase: EdgeCase;
  fileReview: FileReview | null; // May not exist if edge case references an unreviewed file
  relatedFiles: RelatedFile[];
  priority: number;
  /** Set when this slide is part of a cross-MR guided review. */
  crossMr?: CrossMrContext;
};

export type ThreadSlide = {
  kind: 'thread';
  id: string;                    // GitLabDiscussion.id
  discussion: GitLabDiscussion;
  filePath: string | null;       // Resolved from the first note's position
  lineRange: { start: number; end: number } | null;
  fileReview: FileReview | null; // Otto's review of this file, if available
  relatedFiles: RelatedFile[];
  priority: number;
  latestReplyAt: number;         // Timestamp of most recent note (for sorting)
  /** Set when this slide is part of a cross-MR guided review. */
  crossMr?: CrossMrContext;
};

export type ReviewSlide = CommentSlide | EdgeCaseSlide | ThreadSlide;

// ---------------------------------------------------------------------------
// Cross-MR context — attached to slides in cross-MR guided review mode.
// ---------------------------------------------------------------------------

/** Context identifying which MR and review phase a slide belongs to. */
export type CrossMrContext = {
  mrIid: number;
  mrTitle: string;
  /** Phase from the AI-generated review order (e.g., "API Layer", "Frontend"). */
  phase: ReviewPhase;
  /** Index of this phase in the review order (for phase grouping in the sidebar). */
  phaseIndex: number;
};

// ---------------------------------------------------------------------------
// Slide completion state — tracked separately from the slide data so we
// don't need to rebuild the queue when a user acts on a slide.
// ---------------------------------------------------------------------------

export type SlideCompletionMap = Record<string, boolean>;
