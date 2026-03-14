// ---------------------------------------------------------------------------
// FollowUpButton — small button injected into GitLab comment action bars.
//
// Triggers the comment follow-up analysis when clicked. Shows loading state
// while the AI processes, and toggles the FollowUpPanel visibility when
// the analysis is complete.
//
// Design decisions:
// - Matches GitLab's native note action button sizing and placement.
// - Uses the OttoLogo for brand recognition at small size.
// - Reads follow-up state from the Zustand store so re-renders are minimal.
// - Sends the ANALYZE_COMMENT message to the service worker, which handles
//   cache lookup, file fetching, and AI calls.
// ---------------------------------------------------------------------------

import { useCallback } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { OttoLogo } from '@/components/OttoLogo';
import { OttoLogoAnimated } from '@/components/OttoLogoAnimated';
import { useReviewStore } from '@/services/review/review-store';
import { sendMessage } from '@/lib/messaging';
import { parseCommentThread, computeThreadHash } from '@/services/gitlab/comment-parser';
import type { FollowUpStatus } from '@/types/followup';

type FollowUpButtonProps = {
  /** The DOM element of the note this button is attached to */
  noteElement: HTMLElement;
  /** Callback to show/hide the panel below the discussion */
  onTogglePanel: (commentId: string) => void;
};

export function FollowUpButton({ noteElement, onTogglePanel }: FollowUpButtonProps) {
  const theme = useTheme();
  const mrContext = useReviewStore((s) => s.mrContext);

  // Derive the commentId from the note element for store lookups
  const commentId = getCommentId(noteElement);
  const status = useReviewStore((s) => s.followUpStatus[commentId] || 'idle') as FollowUpStatus;
  const error = useReviewStore((s) => s.followUpErrors[commentId]);

  const handleClick = useCallback(async () => {
    if (!mrContext) return;

    // If we already have a result, just toggle the panel
    if (status === 'complete') {
      onTogglePanel(commentId);
      return;
    }

    // If already loading, do nothing
    if (status === 'loading') return;

    // Parse the thread from the DOM
    const thread = parseCommentThread(noteElement);
    if (!thread) {
      useReviewStore.getState().setFollowUpStatus(commentId, 'error', 'Could not parse comment thread from page.');
      return;
    }

    const threadHash = computeThreadHash(thread.notes);

    // Mark as loading
    useReviewStore.getState().setFollowUpStatus(commentId, 'loading');

    // Resolve the GitLab host for this page
    const hostResult = await sendMessage({
      type: 'RESOLVE_GITLAB_HOST',
      payload: { pageUrl: window.location.href },
    });

    const hostId = hostResult.ok ? hostResult.data?.id ?? null : null;

    // Send the analysis request
    const result = await sendMessage({
      type: 'ANALYZE_COMMENT',
      payload: {
        hostId,
        projectId: mrContext.projectId,
        mrIid: mrContext.mrIid,
        projectPath: mrContext.projectPath,
        sourceBranch: mrContext.sourceBranch,
        mrTitle: mrContext.title,
        mrDescription: mrContext.description,
        thread,
        threadHash,
      },
    });

    if (result.ok) {
      useReviewStore.getState().setFollowUp(commentId, result.data);
      onTogglePanel(commentId);
    } else {
      useReviewStore.getState().setFollowUpStatus(commentId, 'error', result.error);
    }
  }, [mrContext, noteElement, commentId, status, onTogglePanel]);

  const s = buildStyles(theme, status);

  return (
    <button
      onClick={handleClick}
      style={s.button}
      title={
        status === 'error' ? `Error: ${error}`
          : status === 'loading' ? 'Analyzing comment...'
            : status === 'complete' ? 'Show follow-up analysis'
              : 'Analyze this comment with Otto'
      }
      disabled={status === 'loading'}
      aria-label="Otto follow-up"
    >
      {status === 'loading' ? (
        <OttoLogoAnimated size={14} />
      ) : (
        <OttoLogo size={14} />
      )}
      {status === 'complete' && <span style={s.dot} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCommentId(noteElement: HTMLElement): string {
  // Try to get the note ID from the DOM
  const noteId =
    noteElement.getAttribute('data-note-id') ||
    noteElement.closest('[data-note-id]')?.getAttribute('data-note-id') ||
    noteElement.id?.replace('note_', '');

  return noteId || `dom-${noteElement.textContent?.slice(0, 50).trim() || 'unknown'}`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function buildStyles(theme: OttoTheme, status: FollowUpStatus) {
  const isComplete = status === 'complete';
  const isError = status === 'error';

  return {
    button: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative' as const,
      width: '28px',
      height: '28px',
      borderRadius: '4px',
      border: `1px solid ${isError ? theme.errorBorder : isComplete ? theme.brand : theme.border}`,
      background: isComplete
        ? (theme.isDark ? 'rgba(12, 147, 231, 0.15)' : 'rgba(12, 147, 231, 0.08)')
        : 'transparent',
      cursor: status === 'loading' ? 'default' : 'pointer',
      color: isError ? theme.error : theme.brandText,
      transition: 'background 0.15s, border-color 0.15s',
      padding: 0,
    } as React.CSSProperties,

    spinner: {
      display: 'inline-block',
      width: '14px',
      height: '14px',
      border: `2px solid ${theme.border}`,
      borderTopColor: theme.brand,
      borderRadius: '50%',
      animation: 'otto-followup-spin 0.6s linear infinite',
    } as React.CSSProperties,

    dot: {
      position: 'absolute' as const,
      top: '2px',
      right: '2px',
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      background: theme.brand,
    } as React.CSSProperties,
  };
}
