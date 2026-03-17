// ---------------------------------------------------------------------------
// Guided Review Queue Builder — constructs and sorts the slide queue.
//
// Pure function: takes review data + GitLab threads, returns sorted slides.
// Re-run whenever the underlying data changes (new comments, thread updates,
// comment status changes).
//
// Priority tiers (highest first):
//   1. Unresolved threads with recent replies — needs human attention now
//   2. Critical comments (bug, security, logic-error) — by file risk score
//   3. Warning comments — by file risk score
//   4. Critical edge cases
//   5. Suggestion/info comments — by file risk score
//   6. Moderate/minor edge cases
//
// Within each tier, items are sub-sorted by file priority score (same
// algorithm as ReviewQueuePanel) so the reviewer walks through the most
// impactful files first.
// ---------------------------------------------------------------------------

import type {
  ReviewSlide,
  CommentSlide,
  EdgeCaseSlide,
  ThreadSlide,
  SlideCompletionMap,
  CrossMrContext,
} from '@/types/guided-review';
import type { FileReview, EdgeCase, RelatedFile } from '@/types/review';
import type { GitLabDiscussion } from '@/types/gitlab';
import type { ClusterReviewOrder } from '@/types/cluster';

// ---------------------------------------------------------------------------
// Priority tier bases — large gaps so sub-sorting within a tier works cleanly.
// Higher number = higher priority = shown first.
// ---------------------------------------------------------------------------

const TIER_THREAD_ACTIVE   = 100_000;
const TIER_CRITICAL        =  80_000;
const TIER_WARNING         =  60_000;
const TIER_EDGE_CRITICAL   =  50_000;
const TIER_SUGGESTION_INFO =  30_000;
const TIER_EDGE_MODERATE   =  20_000;
const TIER_EDGE_MINOR      =  10_000;

// ---------------------------------------------------------------------------
// File priority score — reuses the same formula as ReviewQueuePanel.
// Exported so tests can verify consistency.
// ---------------------------------------------------------------------------

const RISK_MULTIPLIER: Record<string, number> = { high: 15, medium: 8, low: 0 };

export function computeFilePriorityScore(fr: FileReview): number {
  let critical = 0, warning = 0, suggestion = 0, info = 0;
  for (const c of fr.comments) {
    if (c.severity === 'critical') critical++;
    else if (c.severity === 'warning') warning++;
    else if (c.severity === 'suggestion') suggestion++;
    else info++;
  }
  return (
    critical * 10 +
    warning * 5 +
    suggestion * 2 +
    info +
    (RISK_MULTIPLIER[fr.riskLevel] ?? 0)
  );
}

// ---------------------------------------------------------------------------
// Build the slide queue
// ---------------------------------------------------------------------------

export type BuildQueueInput = {
  fileReviews: FileReview[];
  edgeCases: EdgeCase[];
  relatedFiles: RelatedFile[];
  discussions: GitLabDiscussion[];
};

export function buildSlideQueue(input: BuildQueueInput): ReviewSlide[] {
  const { fileReviews, edgeCases, relatedFiles, discussions } = input;

  // Pre-compute file priority scores and index by path for O(1) lookup
  const fileByPath = new Map<string, FileReview>();
  const fileScoreByPath = new Map<string, number>();
  for (const fr of fileReviews) {
    fileByPath.set(fr.filePath, fr);
    fileScoreByPath.set(fr.filePath, computeFilePriorityScore(fr));
  }

  // Helper: find related files that reference a given file path
  const getRelatedForFile = (filePath: string | null): RelatedFile[] => {
    if (!filePath) return [];
    return relatedFiles.filter(
      (rf) => rf.filePath === filePath || rf.reason.includes(filePath.split('/').pop() ?? ''),
    );
  };

  const slides: ReviewSlide[] = [];

  // --- Comment slides ---
  for (const fr of fileReviews) {
    const fileScore = fileScoreByPath.get(fr.filePath) ?? 0;
    const related = getRelatedForFile(fr.filePath);

    for (const comment of fr.comments) {
      let tierBase: number;
      if (comment.severity === 'critical') {
        tierBase = TIER_CRITICAL;
      } else if (comment.severity === 'warning') {
        tierBase = TIER_WARNING;
      } else {
        tierBase = TIER_SUGGESTION_INFO;
      }

      const slide: CommentSlide = {
        kind: 'comment',
        id: comment.id,
        comment,
        fileReview: fr,
        relatedFiles: related,
        priority: tierBase + fileScore,
      };
      slides.push(slide);
    }
  }

  // --- Edge case slides ---
  for (const ec of edgeCases) {
    const fr = ec.filePath ? fileByPath.get(ec.filePath) ?? null : null;
    const fileScore = ec.filePath ? (fileScoreByPath.get(ec.filePath) ?? 0) : 0;
    const related = getRelatedForFile(ec.filePath);

    let tierBase: number;
    if (ec.severity === 'critical') {
      tierBase = TIER_EDGE_CRITICAL;
    } else if (ec.severity === 'moderate') {
      tierBase = TIER_EDGE_MODERATE;
    } else {
      tierBase = TIER_EDGE_MINOR;
    }

    const slide: EdgeCaseSlide = {
      kind: 'edgeCase',
      id: ec.id,
      edgeCase: ec,
      fileReview: fr,
      relatedFiles: related,
      priority: tierBase + fileScore,
    };
    slides.push(slide);
  }

  // --- Thread slides (unresolved only) ---
  for (const disc of discussions) {
    // Skip individual notes (not threads) and system notes
    if (disc.individual_note) continue;

    const notes = disc.notes.filter((n) => !n.system);
    if (notes.length === 0) continue;

    // Only include unresolved threads
    const hasResolvable = notes.some((n) => n.resolvable);
    const allResolved = hasResolvable && notes.every((n) => !n.resolvable || n.resolved);
    if (allResolved) continue;

    // Extract file context from the first note's position
    const firstNoteWithPosition = notes.find((n) => n.position);
    const filePath = firstNoteWithPosition?.position?.new_path ?? null;
    const lineRange = resolveLineRange(firstNoteWithPosition);

    const fr = filePath ? fileByPath.get(filePath) ?? null : null;
    const related = getRelatedForFile(filePath);

    // Most recent reply timestamp — threads with newer replies sort higher
    const latestReplyAt = Math.max(
      ...notes.map((n) => new Date(n.updated_at || n.created_at).getTime()),
    );

    // Recency bonus: threads updated in the last hour get a boost
    const recencyBonus = (Date.now() - latestReplyAt) < 3_600_000 ? 500 : 0;

    const slide: ThreadSlide = {
      kind: 'thread',
      id: disc.id,
      discussion: disc,
      filePath,
      lineRange,
      fileReview: fr,
      relatedFiles: related,
      priority: TIER_THREAD_ACTIVE + recencyBonus,
      latestReplyAt,
    };
    slides.push(slide);
  }

  // Sort descending by priority, then by latestReplyAt for threads at same priority
  slides.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    // For threads at the same priority, most recent first
    if (a.kind === 'thread' && b.kind === 'thread') {
      return b.latestReplyAt - a.latestReplyAt;
    }
    return 0;
  });

  return slides;
}

// ---------------------------------------------------------------------------
// Completion helpers
// ---------------------------------------------------------------------------

/**
 * Derive completion state from review comment statuses and thread resolution.
 * A comment slide is complete when its status is accepted/dismissed/edited.
 * A thread slide is complete when all resolvable notes are resolved.
 * Edge case slides are never auto-completed (no action model for them yet).
 */
export function deriveCompletionMap(slides: ReviewSlide[]): SlideCompletionMap {
  const map: SlideCompletionMap = {};
  for (const slide of slides) {
    switch (slide.kind) {
      case 'comment':
        map[slide.id] = slide.comment.status !== 'pending';
        break;
      case 'thread': {
        const resolvableNotes = slide.discussion.notes.filter((n) => n.resolvable);
        map[slide.id] = resolvableNotes.length > 0 && resolvableNotes.every((n) => n.resolved);
        break;
      }
      case 'edgeCase':
        map[slide.id] = false;
        break;
    }
  }
  return map;
}

/**
 * Find the next non-completed slide index from a given position.
 * Wraps around. Returns -1 if all slides are completed.
 */
export function findNextIncompleteIndex(
  slides: ReviewSlide[],
  completionMap: SlideCompletionMap,
  currentIndex: number,
  direction: 1 | -1 = 1,
): number {
  if (slides.length === 0) return -1;

  for (let i = 1; i <= slides.length; i++) {
    const idx = ((currentIndex + i * direction) % slides.length + slides.length) % slides.length;
    if (!completionMap[slides[idx].id]) return idx;
  }

  return -1; // All completed
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveLineRange(
  note: { position: import('@/types/gitlab').GitLabNotePosition | null } | undefined,
): { start: number; end: number } | null {
  if (!note?.position) return null;
  const pos = note.position;

  if (pos.line_range) {
    const startLine = pos.line_range.start.new_line ?? pos.line_range.start.old_line ?? null;
    const endLine = pos.line_range.end.new_line ?? pos.line_range.end.old_line ?? null;
    if (startLine !== null && endLine !== null) {
      return { start: startLine, end: endLine };
    }
  }

  const line = pos.new_line ?? pos.old_line;
  if (line !== null) {
    return { start: line, end: line };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Cross-MR guided review slide builder
// ---------------------------------------------------------------------------

/**
 * Build a slide queue that interleaves slides from multiple MRs according
 * to an AI-generated review order. Each slide gets a `crossMr` context
 * so the UI can show phase labels and MR attribution.
 *
 * Phases are ordered as the AI specified (foundational → implementation → tests).
 * Within each phase, slides follow the same priority tiers as the single-MR builder.
 */
export type CrossMrReviewInput = {
  reviewOrder: ClusterReviewOrder;
  /** Map of MR IID → that MR's review data. */
  reviewsByMr: Map<number, {
    mrTitle: string;
    fileReviews: FileReview[];
    edgeCases: EdgeCase[];
    relatedFiles: RelatedFile[];
  }>;
};

export function buildCrossMrSlideQueue(input: CrossMrReviewInput): ReviewSlide[] {
  const { reviewOrder, reviewsByMr } = input;
  const slides: ReviewSlide[] = [];

  // Phase priority: first phase gets highest base, decreasing by 1000 per phase.
  // This ensures phase ordering is respected while still allowing within-phase
  // priority sorting (critical > warning > suggestion).
  const PHASE_GAP = 1000;

  for (let phaseIdx = 0; phaseIdx < reviewOrder.phases.length; phaseIdx++) {
    const phase = reviewOrder.phases[phaseIdx];
    const phaseBase = (reviewOrder.phases.length - phaseIdx) * PHASE_GAP;

    const mrData = reviewsByMr.get(phase.mrIid);
    if (!mrData) continue;

    const crossMr: CrossMrContext = {
      mrIid: phase.mrIid,
      mrTitle: mrData.mrTitle,
      phase,
      phaseIndex: phaseIdx,
    };

    // Filter file reviews to only files in this phase
    const phaseFiles = new Set(phase.files);
    const phaseFileReviews = mrData.fileReviews.filter((fr) => phaseFiles.has(fr.filePath));

    // Build file index for this phase
    const fileByPath = new Map<string, FileReview>();
    const fileScoreByPath = new Map<string, number>();
    for (const fr of phaseFileReviews) {
      fileByPath.set(fr.filePath, fr);
      fileScoreByPath.set(fr.filePath, computeFilePriorityScore(fr));
    }

    // Comment slides for this phase
    for (const fr of phaseFileReviews) {
      const fileScore = fileScoreByPath.get(fr.filePath) ?? 0;
      const related = mrData.relatedFiles.filter(
        (rf) => rf.filePath === fr.filePath || rf.reason.includes(fr.filePath.split('/').pop() ?? ''),
      );

      for (const comment of fr.comments) {
        let tierBase: number;
        if (comment.severity === 'critical') tierBase = TIER_CRITICAL;
        else if (comment.severity === 'warning') tierBase = TIER_WARNING;
        else tierBase = TIER_SUGGESTION_INFO;

        const slide: CommentSlide = {
          kind: 'comment',
          id: `${phase.mrIid}:${comment.id}`,
          comment,
          fileReview: fr,
          relatedFiles: related,
          priority: phaseBase + tierBase + fileScore,
          crossMr,
        };
        slides.push(slide);
      }
    }

    // Edge case slides for files in this phase
    const phaseEdgeCases = mrData.edgeCases.filter(
      (ec) => ec.filePath && phaseFiles.has(ec.filePath),
    );
    for (const ec of phaseEdgeCases) {
      const fr = ec.filePath ? fileByPath.get(ec.filePath) ?? null : null;
      const fileScore = ec.filePath ? (fileScoreByPath.get(ec.filePath) ?? 0) : 0;

      let tierBase: number;
      if (ec.severity === 'critical') tierBase = TIER_EDGE_CRITICAL;
      else if (ec.severity === 'moderate') tierBase = TIER_EDGE_MODERATE;
      else tierBase = TIER_EDGE_MINOR;

      const slide: EdgeCaseSlide = {
        kind: 'edgeCase',
        id: `${phase.mrIid}:${ec.id}`,
        edgeCase: ec,
        fileReview: fr,
        relatedFiles: [],
        priority: phaseBase + tierBase + fileScore,
        crossMr,
      };
      slides.push(slide);
    }
  }

  // Sort descending by priority (phase ordering is baked into the priority values)
  slides.sort((a, b) => b.priority - a.priority);

  return slides;
}
