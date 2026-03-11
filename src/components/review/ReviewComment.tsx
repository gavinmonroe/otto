// ---------------------------------------------------------------------------
// ReviewComment — renders a single AI-generated review comment.
// Theme-aware via useTheme().
// ---------------------------------------------------------------------------

import type { ReviewComment as ReviewCommentType, ReviewCommentStatus } from '@/types/review';
import { useTheme } from '@/components/ThemeContext';
import { ReviewActions } from './ReviewActions';

type ReviewCommentProps = {
  comment: ReviewCommentType;
  onUpdateStatus: (commentId: string, status: ReviewCommentStatus, editedBody?: string) => void;
};

export function ReviewComment({ comment, onUpdateStatus }: ReviewCommentProps) {
  const theme = useTheme();
  const isDismissed = comment.status === 'dismissed';

  const severityColors: Record<string, { bg: string; text: string }> = {
    critical: { bg: theme.isDark ? '#450a0a' : '#fecaca', text: theme.isDark ? '#fca5a5' : '#991b1b' },
    warning: { bg: theme.isDark ? '#451a03' : '#fef3c7', text: theme.isDark ? '#fbbf24' : '#92400e' },
    suggestion: { bg: theme.isDark ? '#1e3a5f' : '#dbeafe', text: theme.isDark ? '#93c5fd' : '#1e40af' },
    info: { bg: theme.isDark ? '#1e1b4b' : '#e0e7ff', text: theme.isDark ? '#a5b4fc' : '#3730a3' },
  };

  const colors = severityColors[comment.severity] || severityColors.info;

  return (
    <div style={{
      padding: '8px 0',
      borderBottom: `1px solid ${theme.borderSubtle}`,
      opacity: isDismissed ? 0.5 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-block',
          padding: '1px 6px',
          borderRadius: '3px',
          fontSize: '11px',
          fontWeight: 600,
          background: colors.bg,
          color: colors.text,
        }}>
          {comment.severity}
        </span>
        <span style={{ fontSize: '11px', color: theme.textMuted }}>{comment.category}</span>
        {comment.startLine && (
          <span style={{ fontSize: '11px', color: theme.textMuted }}>
            L{comment.startLine}{comment.endLine && comment.endLine !== comment.startLine ? `-${comment.endLine}` : ''}
          </span>
        )}
      </div>
      <div style={{ fontWeight: 600, margin: '4px 0 2px', color: theme.text }}>{comment.title}</div>
      <div style={{ fontSize: '12px', lineHeight: '1.5', color: theme.text }}>{comment.editedBody || comment.body}</div>
      {comment.suggestion && (
        <pre style={{
          margin: '6px 0',
          padding: '6px 8px',
          fontSize: '11px',
          fontFamily: 'monospace',
          background: theme.isDark ? '#0f172a' : 'rgba(0,0,0,0.04)',
          color: theme.text,
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
