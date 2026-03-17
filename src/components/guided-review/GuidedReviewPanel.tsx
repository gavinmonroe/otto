// ---------------------------------------------------------------------------
// GuidedReviewPanel — the main orchestrator for guided review mode.
//
// Manages:
// - Fetching unresolved GitLab discussions via API
// - Building and re-sorting the slide queue from review data + threads
// - Current slide index and navigation (arrow keys, buttons)
// - Layout: sidebar (item list) + slide viewer
// - Completion tracking derived from comment statuses
//
// Mounted by MrOverviewPanel when reviewMode === 'guided' and review
// is complete. Receives gitlab context as props to avoid duplicate hooks.
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Layers, CheckCircle2,
} from 'lucide-react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { useReviewStore } from '@/services/review/review-store';
import { sendMessage } from '@/lib/messaging';
import { GuidedReviewSlide } from './GuidedReviewSlide';
import { GuidedReviewSidebar } from './GuidedReviewSidebar';
import {
  buildSlideQueue,
  deriveCompletionMap,
  findNextIncompleteIndex,
} from '@/services/guided-review/slide-queue-builder';
import type { ReviewSlide, SlideCompletionMap } from '@/types/guided-review';
import type { GitLabDiscussion } from '@/types/gitlab';
import type { ReviewCommentStatus } from '@/types/review';

type Props = {
  hostId: string | null;
  projectId: number | null;
  mrIid: number;
};

export function GuidedReviewPanel({ hostId, projectId, mrIid }: Props) {
  const theme = useTheme();
  const s = useMemo(() => buildStyles(theme), [theme]);

  // Review data from store
  const fileReviews = useReviewStore((st) => st.fileReviews);
  const edgeCases = useReviewStore((st) => st.edgeCases);
  const relatedFiles = useReviewStore((st) => st.relatedFiles);
  const updateCommentStatus = useReviewStore((st) => st.updateCommentStatus);

  // Discussions from API
  const [discussions, setDiscussions] = useState<GitLabDiscussion[]>([]);
  const [discussionsLoading, setDiscussionsLoading] = useState(false);

  // Navigation state
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // Refs for stable access in keyboard handler and auto-advance timeout
  const goToNextRef = useRef<() => void>(() => {});
  const goToPrevRef = useRef<() => void>(() => {});
  const activeSlideRef = useRef<ReviewSlide | null>(null);
  const handleUpdateRef = useRef<(id: string, status: ReviewCommentStatus, body?: string) => void>(() => {});

  // Fetch discussions once on mount (and when MR changes)
  useEffect(() => {
    if (!hostId || !projectId) return;

    let cancelled = false;
    setDiscussionsLoading(true);

    sendMessage({
      type: 'FETCH_MR_DISCUSSIONS',
      payload: { hostId, projectId, mrIid },
    }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDiscussions(result.data);
      }
      setDiscussionsLoading(false);
    }).catch(() => {
      if (!cancelled) setDiscussionsLoading(false);
    });

    return () => { cancelled = true; };
  }, [hostId, projectId, mrIid]);

  // Build slide queue — re-sorts when review data or discussions change
  const slides = useMemo(
    () => buildSlideQueue({ fileReviews, edgeCases, relatedFiles, discussions }),
    [fileReviews, edgeCases, relatedFiles, discussions],
  );

  // Derive completion from current comment statuses
  const completionMap = useMemo(() => deriveCompletionMap(slides), [slides]);

  const completedCount = useMemo(
    () => slides.filter((sl) => completionMap[sl.id]).length,
    [slides, completionMap],
  );

  // Clamp active index when slides change
  useEffect(() => {
    if (activeIndex >= slides.length && slides.length > 0) {
      setActiveIndex(slides.length - 1);
    }
  }, [slides.length, activeIndex]);

  // Navigation callbacks
  const goToNext = useCallback(() => {
    if (slides.length === 0) return;
    const next = findNextIncompleteIndex(slides, completionMap, activeIndex, 1);
    if (next >= 0) {
      setActiveIndex(next);
    } else {
      // All complete — just go to next sequentially
      setActiveIndex((activeIndex + 1) % slides.length);
    }
  }, [slides, completionMap, activeIndex]);

  const goToPrev = useCallback(() => {
    if (slides.length === 0) return;
    const prev = findNextIncompleteIndex(slides, completionMap, activeIndex, -1);
    if (prev >= 0) {
      setActiveIndex(prev);
    } else {
      setActiveIndex(((activeIndex - 1) % slides.length + slides.length) % slides.length);
    }
  }, [slides, completionMap, activeIndex]);

  const jumpTo = useCallback((index: number) => {
    if (index >= 0 && index < slides.length) {
      setActiveIndex(index);
    }
  }, [slides.length]);

  // Handle comment status updates — auto-advance after accept/dismiss
  const handleUpdateCommentStatus = useCallback((
    commentId: string,
    status: ReviewCommentStatus,
    editedBody?: string,
  ) => {
    updateCommentStatus(commentId, status, editedBody);

    // Auto-advance to next incomplete slide after accept/dismiss
    // Use ref to avoid stale closure in the timeout
    if (status === 'accepted' || status === 'dismissed') {
      setTimeout(() => goToNextRef.current(), 150);
    }
  }, [updateCommentStatus]);

  // Keep refs in sync
  goToNextRef.current = goToNext;
  goToPrevRef.current = goToPrev;
  activeSlideRef.current = slides[activeIndex] ?? null;
  handleUpdateRef.current = handleUpdateCommentStatus;

  // Keyboard navigation — arrow keys + a/d for accept/dismiss
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when typing
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (target.isContentEditable) return;
      }
      // Don't intercept with modifier keys (except Shift)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          e.stopImmediatePropagation();
          goToNextRef.current();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          e.stopImmediatePropagation();
          goToPrevRef.current();
          break;
        case 'a': {
          // Accept current comment slide
          const slide = activeSlideRef.current;
          if (slide?.kind === 'comment' && slide.comment.status === 'pending') {
            e.preventDefault();
            e.stopImmediatePropagation();
            handleUpdateRef.current(slide.comment.id, 'accepted');
          }
          break;
        }
        case 'd': {
          // Dismiss current comment slide
          const slide = activeSlideRef.current;
          if (slide?.kind === 'comment' && slide.comment.status === 'pending') {
            e.preventDefault();
            e.stopImmediatePropagation();
            handleUpdateRef.current(slide.comment.id, 'dismissed');
          }
          break;
        }
      }
    }

    // Register in capture phase so we fire BEFORE the existing keyboard-manager
    // (which listens in bubbling phase). This lets stopImmediatePropagation
    // prevent the keyboard-manager from double-handling a/d keys.
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []); // Empty deps — uses refs for all mutable state

  // Current slide
  const currentSlide = slides[activeIndex] ?? null;
  const allComplete = slides.length > 0 && completedCount === slides.length;

  // Empty state
  if (slides.length === 0) {
    return (
      <div style={s.emptyState}>
        <Layers size={24} style={{ color: theme.textMuted, marginBottom: '8px' }} />
        <div style={{ fontSize: '13px', color: theme.textSecondary, fontWeight: 500 }}>
          {discussionsLoading ? 'Loading review items...' : 'No review items to show'}
        </div>
        <div style={{ fontSize: '12px', color: theme.textMuted, marginTop: '4px' }}>
          {discussionsLoading
            ? 'Fetching discussions from GitLab...'
            : 'Run a review to populate the guided review queue.'}
        </div>
      </div>
    );
  }

  return (
    <div ref={panelRef} style={s.container} tabIndex={-1}>
      {/* Navigation header */}
      <div style={s.navBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={goToPrev} style={s.navButton} title="Previous (←)">
            <ChevronLeft size={16} />
          </button>
          <span style={{
            fontSize: '12px',
            fontWeight: 600,
            color: theme.textSecondary,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {activeIndex + 1} / {slides.length}
          </span>
          <button onClick={goToNext} style={s.navButton} title="Next (→)">
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Slide type indicator */}
        <SlideTypeIndicator slide={currentSlide} theme={theme} />

        {/* Completion summary */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          color: allComplete ? theme.success : theme.textMuted,
        }}>
          {allComplete && <CheckCircle2 size={13} />}
          <span style={{ fontWeight: 500 }}>
            {completedCount} of {slides.length} done
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        height: '2px',
        background: theme.bgMuted,
      }}>
        <div style={{
          height: '100%',
          width: `${((activeIndex + 1) / slides.length) * 100}%`,
          background: theme.brand,
          transition: 'width 0.2s ease',
        }} />
      </div>

      {/* Main content area: sidebar + slide */}
      <div style={s.body}>
        <GuidedReviewSidebar
          slides={slides}
          completionMap={completionMap}
          activeIndex={activeIndex}
          onJumpTo={jumpTo}
        />
        <div style={s.slideArea}>
          {currentSlide && (
            <GuidedReviewSlide
              key={currentSlide.id}
              slide={currentSlide}
              onUpdateCommentStatus={handleUpdateCommentStatus}
            />
          )}
        </div>
      </div>

      {/* Keyboard hint */}
      <div style={s.keyboardHint}>
        <span>← → navigate</span>
        <span style={{ color: theme.borderSubtle }}>·</span>
        <span>a accept</span>
        <span style={{ color: theme.borderSubtle }}>·</span>
        <span>d dismiss</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SlideTypeIndicator({ slide, theme }: { slide: ReviewSlide | null; theme: OttoTheme }) {
  if (!slide) return null;

  const labels: Record<string, string> = {
    comment: 'Review Comment',
    edgeCase: 'Edge Case',
    thread: 'Discussion Thread',
  };

  return (
    <span style={{
      fontSize: '11px',
      padding: '2px 8px',
      borderRadius: '6px',
      background: theme.bgMuted,
      color: theme.textSecondary,
      fontWeight: 500,
    }}>
      {labels[slide.kind] ?? slide.kind}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function buildStyles(t: OttoTheme) {
  return {
    container: {
      display: 'flex',
      flexDirection: 'column',
      background: t.bg,
      overflow: 'hidden',
      // No border/radius — this component is rendered inside MrOverviewPanel's
      // bordered container. Adding our own would create a double border.
      // Fixed height so the panel doesn't grow unbounded — scrolling is internal
      maxHeight: '70vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '14px',
      color: t.text,
      outline: 'none',
    } as React.CSSProperties,

    navBar: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 14px',
      background: t.bgSubtle,
      borderBottom: `1px solid ${t.borderSubtle}`,
    } as React.CSSProperties,

    navButton: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '28px',
      height: '28px',
      borderRadius: '6px',
      border: `1px solid ${t.borderSubtle}`,
      background: t.bg,
      color: t.textSecondary,
      cursor: 'pointer',
      transition: 'background 0.1s',
    } as React.CSSProperties,

    body: {
      display: 'flex',
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
    } as React.CSSProperties,

    slideArea: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    } as React.CSSProperties,

    emptyState: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      textAlign: 'center',
    } as React.CSSProperties,

    keyboardHint: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      padding: '4px 14px',
      borderTop: `1px solid ${t.borderSubtle}`,
      background: t.bgSubtle,
      fontSize: '10px',
      color: t.textMuted,
      fontFamily: 'monospace',
    } as React.CSSProperties,
  };
}
