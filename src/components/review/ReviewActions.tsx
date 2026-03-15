// ---------------------------------------------------------------------------
// ReviewActions — accept/dismiss/edit/fix action buttons for review comments.
// Theme-aware via useTheme().
//
// The "Fix" button only appears when:
//   1. The comment has a suggestion (code fix)
//   2. Botto is connected with sandbox enabled
// It triggers a sandboxed auto-fix: clone → apply → test → push.
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect } from 'react';
import { MessageSquare, Wrench, Loader2, Check, X } from 'lucide-react';
import type { ReviewComment, ReviewCommentStatus } from '@/types/review';
import { useTheme } from '@/components/ThemeContext';
import { useChatStore } from '@/services/chat/chat-store';
import { useReviewStore, type FixJobState } from '@/services/review/review-store';
import { getBottoClient } from '@/lib/botto-client';

type ReviewActionsProps = {
  comment: ReviewComment;
  onUpdateStatus: (commentId: string, status: ReviewCommentStatus, editedBody?: string) => void;
};

/** Human-readable labels for fix pipeline stages. */
const FIX_STAGE_LABELS: Record<FixJobState['status'], string> = {
  pending: 'Requesting fix...',
  cloning: 'Cloning repository...',
  setting_up: 'Installing dependencies...',
  running: 'Applying fix...',
  testing: 'Running tests...',
  pushing: 'Pushing to branch...',
  complete: 'Fix applied',
  failed: 'Fix failed',
};

export function ReviewActions({ comment, onUpdateStatus }: ReviewActionsProps) {
  const theme = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.editedBody || comment.body);
  const [copied, setCopied] = useState(false);

  const fixJob = useReviewStore((s) => s.fixJobs[comment.id]);
  const mrContext = useReviewStore((s) => s.mrContext);

  const handleAccept = useCallback(async () => {
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

  const handleFix = useCallback(() => {
    if (!comment.suggestion || !mrContext) return;

    const settings = (globalThis as any).__ottoSettings;
    const bottoClient = getBottoClient(settings);
    if (!bottoClient?.isConnected()) return;

    // Start tracking in the store
    useReviewStore.getState().startFixJob(comment.id);

    // Send the fix request to Botto
    bottoClient.requestFix(
      mrContext.projectPath,
      mrContext.mrIid,
      comment.id,
      comment.suggestion,
      comment.filePath,
      comment.originalCode ?? '',
      mrContext.sourceBranch,
      comment.body,
      comment.title,
      comment.severity,
      mrContext.targetBranch,
      comment.startLine,
      comment.endLine,
    );
  }, [comment, mrContext]);

  // Track Botto connection state reactively so the fix button appears/disappears
  // as the WebSocket connects, reconnects, or drops.
  const [bottoConnected, setBottoConnected] = useState(() => {
    try {
      const settings = (globalThis as any).__ottoSettings;
      const client = getBottoClient(settings);
      return client?.isConnected() ?? false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      const settings = (globalThis as any).__ottoSettings;
      const client = getBottoClient(settings);
      if (!client) return;
      // onConnectionChange returns an unsubscribe function
      return client.onConnectionChange((state) => {
        setBottoConnected(state === 'connected');
      });
    } catch (e) {
      console.warn('[otto] Failed to subscribe to Botto connection state:', e);
    }
  }, []);

  // Check if fix button should be shown:
  // comment has a suggestion AND Botto is connected with sandbox enabled
  const canFix = (() => {
    if (!comment.suggestion) return false;
    if (!bottoConnected) return false;
    try {
      const settings = (globalThis as any).__ottoSettings;
      const client = getBottoClient(settings);
      const caps = client?.getCapabilities();
      return caps?.sandbox_enabled ?? false;
    } catch (e) {
      console.warn('[otto] canFix check failed:', e);
      return false;
    }
  })();

  const btnBase: React.CSSProperties = {
    padding: '2px 8px',
    borderRadius: '3px',
    fontSize: '11px',
    cursor: 'pointer',
    border: `1px solid ${theme.border}`,
    background: 'transparent',
    color: theme.brandText,
  };

  // --- Fix in progress or completed: show inline status ---
  if (fixJob) {
    const isActive = !['complete', 'failed'].includes(fixJob.status);
    const label = fixJob.detail || FIX_STAGE_LABELS[fixJob.status];

    if (fixJob.status === 'complete') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
          <span style={{ fontSize: '11px', color: theme.success, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Check size={12} />
            Fix applied
            {fixJob.commitSha && (
              <code style={{ fontSize: '10px', color: theme.textMuted, marginLeft: '4px' }}>
                {fixJob.commitSha.slice(0, 8)}
              </code>
            )}
          </span>
          <button
            style={{ ...btnBase, fontSize: '10px', padding: '1px 6px', alignSelf: 'flex-start' }}
            onClick={() => useReviewStore.getState().clearFixJob(comment.id)}
          >
            Dismiss
          </button>
        </div>
      );
    }

    if (fixJob.status === 'failed') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
          <span style={{ fontSize: '11px', color: theme.isDark ? '#fca5a5' : '#991b1b', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <X size={12} />
            {fixJob.error || 'Fix failed'}
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button style={{ ...btnBase, fontSize: '10px', padding: '1px 6px' }} onClick={handleFix}>
              Retry
            </button>
            <button
              style={{ ...btnBase, fontSize: '10px', padding: '1px 6px' }}
              onClick={() => useReviewStore.getState().clearFixJob(comment.id)}
            >
              Dismiss
            </button>
          </div>
        </div>
      );
    }

    // Active fix in progress
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
        <Loader2 size={12} style={{ animation: 'otto-spin 1s linear infinite', color: theme.brandText }} />
        <span style={{ fontSize: '11px', color: theme.textSecondary }}>{label}</span>
      </div>
    );
  }

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
      {canFix && (
        <button
          style={{
            ...btnBase,
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            background: theme.isDark ? '#1e1b4b' : '#eef2ff',
            color: theme.isDark ? '#a5b4fc' : '#4338ca',
            borderColor: theme.isDark ? '#312e81' : '#a5b4fc',
          }}
          onClick={handleFix}
          title="Auto-fix: clone, apply, test, and push this suggestion"
        >
          <Wrench size={11} />
          Fix
        </button>
      )}
    </div>
  );
}
