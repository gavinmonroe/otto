// ---------------------------------------------------------------------------
// InlineCommentThread — compact review comment injected directly into
// GitLab's diff view, after the line it references.
//
// Rendered inside a shadow DOM container that's inserted as a new row
// in the diff grid. Styled to look native to GitLab's diff UI while
// being clearly marked as Otto's output.
//
// Design decisions:
// - Uses shadow DOM for CSS isolation from GitLab.
// - Compact by default, expandable for full details + suggestion diff.
// - Severity color bar on the left matches the footer comment style.
// - Clicking the comment scrolls to the full review in the footer.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { ChevronRight, ChevronDown, AlertTriangle, AlertCircle, Lightbulb, Info, MessageSquare } from 'lucide-react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { Markdown } from '@/components/Markdown';
import { SuggestionDiff } from '@/components/SuggestionDiff';
import { OttoLogo } from '@/components/OttoLogo';
import type { ReviewComment, ReviewCommentStatus } from '@/types/review';
import { useChatStore } from '@/services/chat/chat-store';

type InlineCommentThreadProps = {
  comment: ReviewComment;
  onUpdateStatus?: (commentId: string, status: ReviewCommentStatus) => void;
};

export function InlineCommentThread({ comment, onUpdateStatus }: InlineCommentThreadProps) {
  const [expanded, setExpanded] = useState(false);
  const theme = useTheme();
  const isDismissed = comment.status === 'dismissed';

  const severityConfig = {
    critical: { icon: AlertCircle, color: theme.isDark ? '#fca5a5' : '#dc2626', bg: theme.isDark ? '#450a0a' : '#fef2f2' },
    warning: { icon: AlertTriangle, color: theme.isDark ? '#fbbf24' : '#d97706', bg: theme.isDark ? '#451a03' : '#fffbeb' },
    suggestion: { icon: Lightbulb, color: theme.isDark ? '#93c5fd' : '#2563eb', bg: theme.isDark ? '#1e3a5f' : '#eff6ff' },
    info: { icon: Info, color: theme.isDark ? '#a5b4fc' : '#4f46e5', bg: theme.isDark ? '#1e1b4b' : '#eef2ff' },
  };

  const config = severityConfig[comment.severity] || severityConfig.info;
  const Icon = config.icon;

  const s = buildStyles(theme, config.color, isDismissed);

  return (
    <div data-otto-comment-id={comment.id} style={s.container}>
      {/* Collapsed header — always visible */}
      <button onClick={() => setExpanded(!expanded)} style={s.header}>
        <div style={s.headerLeft}>
          <OttoLogo size={14} />
          {expanded ? <ChevronDown size={14} style={{ color: theme.textMuted }} /> : <ChevronRight size={14} style={{ color: theme.textMuted }} />}
          <Icon size={14} style={{ color: config.color, flexShrink: 0 }} />
          <span style={{
            fontSize: '11px',
            padding: '1px 6px',
            borderRadius: '3px',
            background: config.bg,
            color: config.color,
            fontWeight: 600,
            flexShrink: 0,
          }}>
            {comment.severity}
          </span>
          <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
            {comment.title}
          </span>
        </div>
        {!expanded && onUpdateStatus && comment.status === 'pending' && (
          <div style={s.quickActions}>
            <button
              onClick={(e) => { e.stopPropagation(); onUpdateStatus(comment.id, 'accepted'); }}
              style={s.quickBtn}
              title="Accept"
            >
              ✓
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onUpdateStatus(comment.id, 'dismissed'); }}
              style={s.quickBtn}
              title="Dismiss"
            >
              ✕
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); useChatStore.getState().askAboutComment(comment); }}
              style={s.quickBtn}
              title="Ask Otto about this"
            >
              <MessageSquare size={11} />
            </button>
          </div>
        )}
      </button>

      {/* Expanded body */}
      {expanded && (
        <div style={s.body}>
          <div style={{ fontSize: '13px' }}>
            <Markdown content={comment.editedBody || comment.body} compact />
          </div>

          {comment.suggestion && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: theme.textSecondary, marginBottom: '4px' }}>
                Suggested fix
              </div>
              {comment.originalCode ? (
                <SuggestionDiff
                  originalCode={comment.originalCode}
                  suggestion={comment.suggestion}
                  filePath={comment.filePath}
                  startLine={comment.startLine}
                />
              ) : (
                <Markdown content={`\`\`\`\n${comment.suggestion}\n\`\`\``} compact />
              )}
            </div>
          )}

          {onUpdateStatus && comment.status === 'pending' && (
            <div style={s.actions}>
              <button
                onClick={() => onUpdateStatus(comment.id, 'accepted')}
                style={{ ...s.actionBtn, background: theme.isDark ? '#064e3b' : '#f0fdf4', color: theme.success }}
              >
                Accept
              </button>
              <button
                onClick={() => onUpdateStatus(comment.id, 'dismissed')}
                style={{ ...s.actionBtn, background: theme.isDark ? '#450a0a' : '#fef2f2', color: theme.error }}
              >
                Dismiss
              </button>
              <button
                onClick={() => useChatStore.getState().askAboutComment(comment)}
                style={{ ...s.actionBtn, display: 'flex', alignItems: 'center', gap: '3px' }}
                title="Ask Otto about this comment"
              >
                <MessageSquare size={11} />
                Ask
              </button>
            </div>
          )}

          {comment.status === 'accepted' && comment.suggestionSummary && (
            <div style={{ fontSize: '12px', color: theme.textSecondary, lineHeight: '1.4', marginTop: '6px' }}>
              {comment.suggestionSummary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function buildStyles(theme: OttoTheme, accentColor: string, isDismissed: boolean) {
  return {
    container: {
      borderLeft: `3px solid ${accentColor}`,
      background: theme.isDark ? '#1a1f2e' : '#f8faff',
      borderBottom: `1px solid ${theme.border}`,
      opacity: isDismissed ? 0.5 : 1,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    } as React.CSSProperties,

    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      padding: '6px 12px',
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      textAlign: 'left' as const,
    } as React.CSSProperties,

    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flex: 1,
      minWidth: 0,
    } as React.CSSProperties,

    quickActions: {
      display: 'flex',
      gap: '4px',
      flexShrink: 0,
    } as React.CSSProperties,

    quickBtn: {
      width: '22px',
      height: '22px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '4px',
      border: `1px solid ${theme.border}`,
      background: theme.bgSubtle,
      color: theme.textSecondary,
      cursor: 'pointer',
      fontSize: '12px',
      lineHeight: 1,
    } as React.CSSProperties,

    body: {
      padding: '0 12px 10px 28px',
    } as React.CSSProperties,

    actions: {
      display: 'flex',
      gap: '6px',
      marginTop: '8px',
    } as React.CSSProperties,

    actionBtn: {
      padding: '3px 10px',
      borderRadius: '4px',
      border: 'none',
      fontSize: '12px',
      fontWeight: 500,
      cursor: 'pointer',
    } as React.CSSProperties,
  };
}
