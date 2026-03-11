// ---------------------------------------------------------------------------
// ReviewActions — accept/dismiss/edit action buttons for review comments.
// Theme-aware via useTheme().
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import type { ReviewComment, ReviewCommentStatus } from '@/types/review';
import { useTheme } from '@/components/ThemeContext';
import { useChatStore } from '@/services/chat/chat-store';

type ReviewActionsProps = {
  comment: ReviewComment;
  onUpdateStatus: (commentId: string, status: ReviewCommentStatus, editedBody?: string) => void;
};

export function ReviewActions({ comment, onUpdateStatus }: ReviewActionsProps) {
  const theme = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.editedBody || comment.body);
  const [copied, setCopied] = useState(false);

  const handleAccept = useCallback(async () => {
    // Copy the suggestion summary (human-readable) if available, otherwise fall back to body
    const textToCopy = comment.suggestionSummary || comment.editedBody || comment.body;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      onUpdateStatus(comment.id, 'accepted');
      setTimeout(() => setCopied(false), 2000);
    } catch {
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

  const handleAskOtto = useCallback(() => {
    useChatStore.getState().askAboutComment(comment);
  }, [comment]);

  const btnBase: React.CSSProperties = {
    padding: '2px 8px',
    borderRadius: '3px',
    fontSize: '11px',
    cursor: 'pointer',
    border: `1px solid ${theme.border}`,
    background: 'transparent',
    color: theme.brandText,
  };

  if (comment.status === 'dismissed') {
    return (
      <span style={{ fontSize: '11px', color: theme.textMuted, fontStyle: 'italic' }}>
        Dismissed
      </span>
    );
  }

  if (comment.status === 'accepted') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
        <span style={{ fontSize: '11px', color: theme.success, fontStyle: 'italic' }}>
          {copied ? 'Copied to clipboard' : 'Accepted'}
        </span>
        {comment.suggestionSummary && (
          <span style={{ fontSize: '12px', color: theme.textSecondary, lineHeight: '1.4' }}>
            {comment.suggestionSummary}
          </span>
        )}
      </div>
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
            border: `1px solid ${theme.border}`,
            background: theme.bg,
            color: theme.text,
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
          <button
            style={{ ...btnBase, background: theme.isDark ? '#064e3b' : '#dcfce7', color: theme.isDark ? '#4ade80' : '#166534', borderColor: theme.isDark ? '#065f46' : '#86efac' }}
            onClick={handleSaveEdit}
          >
            Save
          </button>
          <button style={btnBase} onClick={() => setIsEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
      <button
        style={{ ...btnBase, background: theme.isDark ? '#064e3b' : '#dcfce7', color: theme.isDark ? '#4ade80' : '#166534', borderColor: theme.isDark ? '#065f46' : '#86efac' }}
        onClick={handleAccept}
      >
        Accept
      </button>
      <button style={btnBase} onClick={() => setIsEditing(true)}>
        Edit
      </button>
      <button
        style={{ ...btnBase, background: theme.isDark ? '#450a0a' : '#fee2e2', color: theme.isDark ? '#fca5a5' : '#991b1b', borderColor: theme.isDark ? '#7f1d1d' : '#fca5a5' }}
        onClick={handleDismiss}
      >
        Dismiss
      </button>
      <button
        style={{ ...btnBase, display: 'flex', alignItems: 'center', gap: '3px' }}
        onClick={handleAskOtto}
        title="Ask Otto about this comment"
      >
        <MessageSquare size={11} />
        Ask
      </button>
    </div>
  );
}
