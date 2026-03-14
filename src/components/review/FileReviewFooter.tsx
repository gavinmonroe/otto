// ---------------------------------------------------------------------------
// FileReviewFooter — collapsible review sections injected into each diff
// file's footer area.
//
// Each AI comment renders as its own collapsible row, similar to GitLab's
// native discussion threads. The user sees severity + title at a glance,
// and can expand any comment to see the full analysis, suggestion, and
// accept/dismiss/edit actions.
//
// Also includes a file-level summary and risk indicator at the top.
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, AlertTriangle, AlertCircle, Lightbulb, Info } from 'lucide-react';
import { useReviewStore } from '@/services/review/review-store';
import { useTheme } from '@/components/ThemeContext';
import type { OttoTheme } from '@/components/ThemeContext';
import { Markdown } from '@/components/Markdown';
import { SuggestionDiff } from '@/components/SuggestionDiff';
import { ReviewActions } from './ReviewActions';
import { OttoLogo } from '@/components/OttoLogo';
import { OttoLogoAnimated } from '@/components/OttoLogoAnimated';
import type { ReviewComment as ReviewCommentType, ReviewCommentStatus, FileActivity } from '@/types/review';

type FileReviewFooterProps = {
  filePath: string;
};

export function FileReviewFooter({ filePath }: FileReviewFooterProps) {
  const theme = useTheme();
  const fileReview = useReviewStore((s) =>
    s.fileReviews.find((fr) => fr.filePath === filePath),
  );
  const fileReviewDelta = useReviewStore((s) => s.fileReviewDeltas[filePath]);
  const overallStatus = useReviewStore((s) => s.status);
  const updateCommentStatus = useReviewStore((s) => s.updateCommentStatus);
  const fileActivityEntry = useReviewStore((s) => {
    if (!s.fileActivity) return null;
    return s.fileActivity.fileActivities.find((a) => a.filePath === filePath) ?? null;
  });

  const isStreaming = !!fileReviewDelta && !fileReview;
  const isReviewActive = overallStatus === 'loading' || overallStatus === 'streaming';

  // Nothing to show yet
  if (!fileReview && !isStreaming) return null;

  const handleUpdateStatus = (commentId: string, status: ReviewCommentStatus, editedBody?: string) => {
    updateCommentStatus(commentId, status, editedBody);
  };

  const s = buildStyles(theme);

  return (
    <div style={s.container}>
      {/* Streaming indicator + live delta */}
      {isStreaming && (
        <>
          <div style={s.streamingRow}>
            <OttoLogoAnimated size={14} />
            <span>Otto is reviewing this file...</span>
          </div>
          {fileReviewDelta && (
            <div style={s.streamingBody}>
              <Markdown content={fileReviewDelta} compact />
              <span style={{ color: theme.brand }}>|</span>
            </div>
          )}
        </>
      )}

      {/* File summary header */}
      {fileReview && (
        <div style={s.summaryRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <OttoLogo size={16} />
            <span style={{ fontWeight: 600, fontSize: '12px' }}>Otto Review</span>
            <RiskBadge riskLevel={fileReview.riskLevel} theme={theme} />
            <span style={{ fontSize: '12px', color: theme.textSecondary }}>
              {fileReview.comments.length === 0
                ? 'No issues found'
                : `${fileReview.comments.length} suggestion${fileReview.comments.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <span style={{ fontSize: '11px', color: theme.textMuted }}>{fileReview.summary}</span>
        </div>
      )}

      {/* Recent file activity banner */}
      {fileActivityEntry && fileActivityEntry.recentMrs.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 14px',
          fontSize: '11px',
          color: theme.warning,
          background: theme.isDark ? '#451a0320' : '#fffbeb80',
          borderBottom: `1px solid ${theme.borderSubtle}`,
        }}>
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          <span>
            Also modified in {fileActivityEntry.recentMrs.length} recent MR{fileActivityEntry.recentMrs.length !== 1 ? 's' : ''}:
            {' '}
            {fileActivityEntry.recentMrs.slice(0, 3).map((mr, i) => (
              <span key={mr.iid}>
                {i > 0 && ', '}
                <a
                  href={mr.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: theme.brand, textDecoration: 'none' }}
                >
                  !{mr.iid}
                </a>
              </span>
            ))}
            {fileActivityEntry.recentMrs.length > 3 && ` +${fileActivityEntry.recentMrs.length - 3} more`}
          </span>
        </div>
      )}

      {/* Individual comment rows */}
      {fileReview?.comments.map((comment) => (
        <CommentRow
          key={comment.id}
          comment={comment}
          theme={theme}
          onUpdateStatus={handleUpdateStatus}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommentRow — a single collapsible comment
// ---------------------------------------------------------------------------

function CommentRow({
  comment,
  theme,
  onUpdateStatus,
}: {
  comment: ReviewCommentType;
  theme: OttoTheme;
  onUpdateStatus: (id: string, status: ReviewCommentStatus, editedBody?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDismissed = comment.status === 'dismissed';
  const s = buildStyles(theme);

  const severityConfig = {
    critical: { icon: AlertCircle, color: theme.isDark ? '#fca5a5' : '#dc2626', bg: theme.isDark ? '#450a0a' : '#fef2f2' },
    warning: { icon: AlertTriangle, color: theme.isDark ? '#fbbf24' : '#d97706', bg: theme.isDark ? '#451a03' : '#fffbeb' },
    suggestion: { icon: Lightbulb, color: theme.isDark ? '#93c5fd' : '#2563eb', bg: theme.isDark ? '#1e3a5f' : '#eff6ff' },
    info: { icon: Info, color: theme.isDark ? '#a5b4fc' : '#4f46e5', bg: theme.isDark ? '#1e1b4b' : '#eef2ff' },
  };

  const config = severityConfig[comment.severity] || severityConfig.info;
  const Icon = config.icon;
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <div
      data-otto-comment-id={comment.id}
      style={{
        ...s.commentRow,
        opacity: isDismissed ? 0.5 : 1,
        borderLeft: `3px solid ${config.color}`,
      }}
    >
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={s.commentHeader}
      >
        <ChevronIcon size={14} style={{ color: theme.textMuted, flexShrink: 0 }} />
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
        <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text, textAlign: 'left' }}>
          {comment.title}
        </span>
        {comment.startLine && (
          <span style={{ fontSize: '11px', color: theme.textMuted, marginLeft: 'auto', flexShrink: 0 }}>
            L{comment.startLine}{comment.endLine && comment.endLine !== comment.startLine ? `-${comment.endLine}` : ''}
          </span>
        )}
        <span style={{ fontSize: '11px', color: theme.textMuted, flexShrink: 0 }}>
          {comment.category}
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div style={s.commentBody}>
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

          <div style={{ marginTop: '8px' }}>
            <ReviewActions comment={comment} onUpdateStatus={onUpdateStatus} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RiskBadge
// ---------------------------------------------------------------------------

function RiskBadge({ riskLevel, theme }: { riskLevel: string; theme: OttoTheme }) {
  const config: Record<string, { bg: string; color: string }> = {
    high: { bg: theme.isDark ? '#450a0a' : '#fef2f2', color: theme.isDark ? '#fca5a5' : '#dc2626' },
    medium: { bg: theme.isDark ? '#451a03' : '#fffbeb', color: theme.isDark ? '#fbbf24' : '#d97706' },
    low: { bg: theme.isDark ? '#064e3b' : '#f0fdf4', color: theme.isDark ? '#4ade80' : '#16a34a' },
  };
  const c = config[riskLevel] || config.low;

  return (
    <span style={{
      fontSize: '11px',
      padding: '1px 6px',
      borderRadius: '3px',
      background: c.bg,
      color: c.color,
      fontWeight: 600,
    }}>
      {riskLevel} risk
    </span>
  );
}

// ---------------------------------------------------------------------------
// Theme-aware styles
// ---------------------------------------------------------------------------

function buildStyles(t: OttoTheme) {
  return {
    container: {
      borderTop: `1px solid ${t.border}`,
      background: t.bgSubtle,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    } as React.CSSProperties,

    streamingRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 14px',
      fontSize: '12px',
      color: t.brand,
      borderBottom: `1px solid ${t.borderSubtle}`,
    } as React.CSSProperties,

    streamingBody: {
      padding: '8px 14px',
      fontSize: '13px',
      color: t.text,
      borderBottom: `1px solid ${t.borderSubtle}`,
      whiteSpace: 'pre-wrap' as const,
    } as React.CSSProperties,

    summaryRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      padding: '8px 14px',
      borderBottom: `1px solid ${t.borderSubtle}`,
      flexWrap: 'wrap' as const,
    } as React.CSSProperties,

    commentRow: {
      borderBottom: `1px solid ${t.borderSubtle}`,
    } as React.CSSProperties,

    commentHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      width: '100%',
      padding: '8px 14px',
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      textAlign: 'left' as const,
      fontSize: '13px',
      color: t.text,
    } as React.CSSProperties,

    commentBody: {
      padding: '0 14px 12px 40px',
    } as React.CSSProperties,
  };
}
