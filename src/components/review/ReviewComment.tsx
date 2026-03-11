// ---------------------------------------------------------------------------
// ReviewComment — renders a single AI-generated review comment.
//
// Displays severity badge, category, title, body, optional code suggestion,
// and action buttons (accept/dismiss/edit).
// ---------------------------------------------------------------------------

import type { ReviewComment as ReviewCommentType, ReviewCommentStatus } from '@/types/review';
import { ReviewActions } from './ReviewActions';

type ReviewCommentProps = {
  comment: ReviewCommentType;
  onUpdateStatus: (commentId: string, status: ReviewCommentStatus, editedBody?: string) => void;
};

export function ReviewComment({ comment, onUpdateStatus }: ReviewCommentProps) {
  const severityClass = `otto-severity otto-severity-${comment.severity}`;
  const isDismissed = comment.status === 'dismissed';

  return (
    <div
      className="otto-comment"
      style={{ opacity: isDismissed ? 0.5 : 1 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span className={severityClass}>{comment.severity}</span>
        <span style={{ fontSize: '11px', color: '#6b7280' }}>{comment.category}</span>
        {comment.startLine && (
          <span style={{ fontSize: '11px', color: '#6b7280' }}>
            L{comment.startLine}{comment.endLine && comment.endLine !== comment.startLine ? `-${comment.endLine}` : ''}
          </span>
        )}
      </div>
      <div className="otto-comment-title">{comment.title}</div>
      <div className="otto-comment-body">{comment.editedBody || comment.body}</div>
      {comment.suggestion && (
        <pre style={{
          margin: '6px 0',
          padding: '6px 8px',
          fontSize: '11px',
          fontFamily: 'monospace',
          background: 'rgba(0,0,0,0.04)',
          borderRadius: '4px',
          overflow: 'auto',
          maxHeight: '150px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {comment.suggestion}
        </pre>
      )}
      <ReviewActions comment={comment} onUpdateStatus={onUpdateStatus} />
    </div>
  );
}
