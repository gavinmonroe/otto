// ---------------------------------------------------------------------------
// FileReviewCard — per-file review button + expandable review panel.
//
// Injected into each .diff-file's header area. Shows a small button that
// expands to reveal AI-generated review comments for that specific file.
//
// Design decisions:
// - Starts as a compact button to minimize visual noise on the MR page.
// - Expands inline to show comments — no modal or popup that blocks the diff.
// - Subscribes to the review store for this specific file's data.
// - Can trigger a single-file review independently of the full MR review.
// - Shows a badge with comment count when review is complete.
// ---------------------------------------------------------------------------

import { useState, useCallback, useMemo } from 'react';
import { useReviewStore } from '@/services/review/review-store';
import { openStream } from '@/lib/messaging';
import { OttoLogo } from '@/components/OttoLogo';
import { useTheme } from '@/components/ThemeContext';
import { ReviewComment } from './ReviewComment';
import type { StreamChunk } from '@/types/messages';
import type { ReviewCommentStatus } from '@/types/review';

type FileReviewCardProps = {
  filePath: string;
};

export function FileReviewCard({ filePath }: FileReviewCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [singleFileLoading, setSingleFileLoading] = useState(false);
  const theme = useTheme();

  // Subscribe to this file's review data from the store
  const fileReview = useReviewStore((s) =>
    s.fileReviews.find((fr) => fr.filePath === filePath),
  );
  const fileReviewDelta = useReviewStore((s) => s.fileReviewDeltas[filePath]);
  const overallStatus = useReviewStore((s) => s.status);
  const updateCommentStatus = useReviewStore((s) => s.updateCommentStatus);

  const isLoading = overallStatus === 'loading' || overallStatus === 'streaming' || singleFileLoading;
  const isStreaming = !!fileReviewDelta && !fileReview;
  const commentCount = fileReview?.comments.length ?? 0;
  const hasComments = commentCount > 0;

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleSingleFileReview = useCallback(() => {
    const mrContext = useReviewStore.getState().mrContext;
    if (!mrContext) return;

    const file = mrContext.diffFiles.find((f) => f.filePath === filePath);
    if (!file) return;

    setSingleFileLoading(true);

    // Create a minimal context with just this file
    const singleFileContext = {
      ...mrContext,
      diffFiles: [file],
    };

    const disconnect = openStream(
      {
        type: 'STREAM_REVIEW',
        payload: { mrContext: singleFileContext, tasks: ['codeReview'] },
      },
      {
        onChunk: (chunk: StreamChunk) => {
          const state = useReviewStore.getState();
          switch (chunk.type) {
            case 'STREAM_FILE_REVIEW_DELTA':
              state.appendFileReviewDelta(chunk.payload.filePath, chunk.payload.content);
              break;
            case 'STREAM_FILE_REVIEW_COMPLETE':
              state.addFileReview(chunk.payload.fileReview);
              break;
            case 'STREAM_ALL_COMPLETE':
              setSingleFileLoading(false);
              break;
            case 'STREAM_TASK_ERROR':
              setSingleFileLoading(false);
              break;
          }
        },
        onDisconnect: () => {
          setSingleFileLoading(false);
        },
      },
    );
  }, [filePath]);

  const handleUpdateStatus = useCallback(
    (commentId: string, status: ReviewCommentStatus, editedBody?: string) => {
      updateCommentStatus(commentId, status, editedBody);
    },
    [updateCommentStatus],
  );

  // Determine button label and style
  const buttonContent = useMemo(() => {
    if (singleFileLoading || isStreaming) {
      return (
        <>
          <span className="otto-spinner" />
          <span>Reviewing...</span>
        </>
      );
    }
    if (fileReview) {
      return (
        <>
          <OttoLogo size={14} />
          <span>Otto</span>
          {hasComments && (
            <span className="otto-badge otto-badge-count">{commentCount}</span>
          )}
        </>
      );
    }
    return (
      <>
        <OttoLogo size={14} />
        <span>Otto</span>
      </>
    );
  }, [singleFileLoading, isStreaming, fileReview, hasComments, commentCount]);

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        className="otto-file-btn"
        onClick={fileReview ? handleToggle : handleSingleFileReview}
        title={fileReview ? 'Toggle review comments' : 'Review this file with Otto'}
      >
        {buttonContent}
      </button>

      {expanded && fileReview && (
        <div className="otto-review-panel">
          <div style={{ marginBottom: '8px', fontWeight: 600, fontSize: '13px' }}>
            {fileReview.summary}
          </div>
          <div style={{ marginBottom: '8px', fontSize: '11px' }}>
            Risk: <span style={{
              fontWeight: 600,
              color: fileReview.riskLevel === 'high'
                ? (theme.isDark ? '#fca5a5' : '#dc2626')
                : fileReview.riskLevel === 'medium'
                ? theme.warning
                : theme.success,
            }}>{fileReview.riskLevel}</span>
          </div>
          {fileReview.comments.length === 0 ? (
            <div className="otto-empty">No issues found. Looks good!</div>
          ) : (
            fileReview.comments.map((comment) => (
              <ReviewComment
                key={comment.id}
                comment={comment}
                onUpdateStatus={handleUpdateStatus}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
