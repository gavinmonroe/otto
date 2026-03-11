// ---------------------------------------------------------------------------
// ReviewActions — accept/dismiss/edit action buttons for review comments.
//
// Used by both FileReviewCard and the overview panel. Provides consistent
// interaction patterns for all AI-generated suggestions.
//
// Design decisions:
// - Accept copies the comment body to clipboard (user pastes into GitLab's
//   native comment form). We don't auto-post to avoid accidental submissions.
// - Dismiss marks the comment as dismissed (visual only, no API call).
// - Edit opens an inline textarea for the user to modify before accepting.
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';
import type { ReviewComment, ReviewCommentStatus } from '@/types/review';

type ReviewActionsProps = {
  comment: ReviewComment;
  onUpdateStatus: (commentId: string, status: ReviewCommentStatus, editedBody?: string) => void;
};

export function ReviewActions({ comment, onUpdateStatus }: ReviewActionsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.editedBody || comment.body);
  const [copied, setCopied] = useState(false);

  const handleAccept = useCallback(async () => {
    const textToCopy = comment.editedBody || comment.body;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      onUpdateStatus(comment.id, 'accepted');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in some contexts — fall back to selection
      onUpdateStatus(comment.id, 'accepted');
    }
  }, [comment, onUpdateStatus]);

  const handleDismiss = useCallback(() => {
    onUpdateStatus(comment.id, 'dismissed');
  }, [comment.id, onUpdateStatus]);

  const handleSaveEdit = useCallback(() => {
    onUpdateStatus(comment.id, 'edited', editText);
    setIsEditing(false);
  }, [comment.id, editText, onUpdateStatus]);

  if (comment.status === 'dismissed') {
    return (
      <span style={{ fontSize: '11px', color: '#9ca3af', fontStyle: 'italic' }}>
        Dismissed
      </span>
    );
  }

  if (comment.status === 'accepted') {
    return (
      <span style={{ fontSize: '11px', color: '#16a34a', fontStyle: 'italic' }}>
        {copied ? 'Copied to clipboard' : 'Accepted'}
      </span>
    );
  }

  if (isEditing) {
    return (
      <div style={{ marginTop: '6px' }}>
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          style={{
            width: '100%',
            minHeight: '60px',
            padding: '6px 8px',
            fontSize: '12px',
            fontFamily: 'monospace',
            borderRadius: '4px',
            border: '1px solid var(--border, #e5e7eb)',
            background: 'var(--background, #fff)',
            color: 'var(--foreground, #1f2937)',
            resize: 'vertical',
          }}
        />
        <div className="otto-comment-actions">
          <button className="otto-action-btn otto-action-btn-accept" onClick={handleSaveEdit}>
            Save
          </button>
          <button className="otto-action-btn" onClick={() => setIsEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="otto-comment-actions">
      <button className="otto-action-btn otto-action-btn-accept" onClick={handleAccept}>
        Accept
      </button>
      <button className="otto-action-btn" onClick={() => setIsEditing(true)}>
        Edit
      </button>
      <button className="otto-action-btn otto-action-btn-dismiss" onClick={handleDismiss}>
        Dismiss
      </button>
    </div>
  );
}
