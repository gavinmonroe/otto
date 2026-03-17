// ---------------------------------------------------------------------------
// MrEnhancedStrip — enhanced MR row strip with queue controls + progress.
//
// Extends the existing MrPreviewStrip pattern with:
// - Priority score pill (color-coded by urgency)
// - Queue action button (enqueue/pause/resume/cancel)
// - Progress bar (visible when review is running or paused)
//
// Design: same strip layout as MrPreviewStrip (flex row, 4px 10px padding,
// shadow DOM compatible inline styles). The priority pill and action button
// are appended to the right side. Progress bar appears below the strip.
//
// Data flow: preview data is passed in (fetched by the content script in
// batch), queue state comes from the parent via props (from queue status
// broadcasts). No internal data fetching — the content script owns the data.
// ---------------------------------------------------------------------------

import React, { useCallback } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { LanguageBar } from './LanguageBar';
import { ReviewProgressBar } from './ReviewProgressBar';
import type { MrPreviewData } from '@/types/mr-preview';
import type { QueuedReview, QueueItemStatus } from '@/types/review-queue';
import type { ReviewPriority } from '@/types/review-queue';

type Props = {
  preview: MrPreviewData;
  queueItem: QueuedReview | null;
  priority: ReviewPriority | null;
  onEnqueue: (mrIid: number, failedTasksOnly?: boolean) => void;
  onPause: (mrIid: number) => void;
  onResume: (mrIid: number) => void;
  onCancel: (mrIid: number) => void;
};

export function MrEnhancedStrip({
  preview,
  queueItem,
  priority,
  onEnqueue,
  onPause,
  onResume,
  onCancel,
}: Props) {
  const theme = useTheme();
  const status = queueItem?.status ?? null;

  const handleAction = useCallback(() => {
    switch (status) {
      case 'running':
        onPause(preview.mrIid);
        break;
      case 'paused':
        onResume(preview.mrIid);
        break;
      case 'error':
      case 'complete':
        // Re-enqueue for retry or re-review
        onEnqueue(preview.mrIid);
        break;
      case 'queued':
        onCancel(preview.mrIid);
        break;
      default:
        onEnqueue(preview.mrIid);
        break;
    }
  }, [status, preview.mrIid, onEnqueue, onPause, onResume, onCancel]);

  const s = styles(theme);

  return (
    <div style={s.wrapper}>
      <div style={s.strip}>
        {/* Left: existing preview data */}
        <StatePill state={preview.state} theme={theme} />
        <FilesPill count={preview.filesChanged} theme={theme} />
        <LinesPill added={preview.linesAdded} removed={preview.linesRemoved} theme={theme} />
        <LanguageBar languages={preview.languages} />

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right: priority + risk + queue actions */}
        {preview.riskLevel && <RiskPill level={preview.riskLevel} theme={theme} />}
        {priority && <PriorityPill priority={priority} theme={theme} />}

        {/* Paused state gets two buttons: Resume + Cancel */}
        {status === 'paused' ? (
          <>
            <QueueActionButton
              status="paused"
              theme={theme}
              onClick={() => onResume(preview.mrIid)}
            />
            <QueueActionButton
              status={null}
              theme={theme}
              onClick={() => onCancel(preview.mrIid)}
              overrideConfig={{ label: 'Cancel review', icon: '×', color: theme.textMuted }}
            />
          </>
        ) : (
          <QueueActionButton
            status={status}
            theme={theme}
            onClick={handleAction}
          />
        )}
      </div>

      {/* Progress bar — only when review is active or paused */}
      {queueItem?.progress && (status === 'running' || status === 'paused') && (
        <div style={s.progressRow}>
          <ReviewProgressBar
            progress={queueItem.progress}
            paused={status === 'paused'}
          />
        </div>
      )}

      {/* Error message */}
      {status === 'error' && queueItem?.error && (
        <div style={s.errorRow}>
          <span style={{ color: theme.error, fontSize: '10px' }}>
            {queueItem.error}
          </span>
        </div>
      )}

      {/* Failed tasks indicator — shown on complete reviews with partial failures */}
      {status === 'complete' && queueItem?.progress && (() => {
        const failedTasks = Object.entries(queueItem.progress.tasks)
          .filter(([_, snap]) => snap.status === 'error')
          .map(([name]) => name);
        if (failedTasks.length === 0) return null;
        return (
          <div style={s.errorRow}>
            <span style={{ color: theme.warning, fontSize: '10px' }}>
              {failedTasks.length} task{failedTasks.length !== 1 ? 's' : ''} failed ({failedTasks.join(', ')})
            </span>
            <button
              onClick={() => onEnqueue(preview.mrIid, true)}
              style={{
                background: 'none',
                border: `1px solid ${theme.borderSubtle}`,
                borderRadius: '6px',
                color: theme.warning,
                fontSize: '9px',
                fontWeight: 600,
                padding: '1px 6px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                marginLeft: '6px',
              }}
            >
              Retry Failed
            </button>
          </div>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatePill({ state, theme }: { state: MrPreviewData['state']; theme: OttoTheme }) {
  const configs: Record<string, { bg: string; color: string }> = {
    opened: { bg: theme.successBg, color: theme.success },
    merged: { bg: theme.infoBg, color: theme.info },
    closed: { bg: theme.errorBg, color: theme.error },
    locked: { bg: theme.bgMuted, color: theme.textSecondary },
  };
  const config = configs[state] ?? configs.opened;
  return (
    <span style={{
      ...pillStyle,
      background: config.bg,
      color: config.color,
    }}>
      {STATE_LABELS[state] ?? state}
    </span>
  );
}

function FilesPill({ count, theme }: { count: number; theme: OttoTheme }) {
  return (
    <span style={{ ...pillStyle, background: theme.bgMuted, color: theme.textSecondary }}>
      {count} {count === 1 ? 'file' : 'files'}
    </span>
  );
}

function LinesPill({ added, removed, theme }: { added: number; removed: number; theme: OttoTheme }) {
  return (
    <span style={{
      ...pillStyle,
      background: theme.bgMuted,
      color: theme.textSecondary,
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
    }}>
      <span style={{ color: theme.success, fontWeight: 600 }}>+{formatNumber(added)}</span>
      <span style={{ color: theme.error, fontWeight: 600 }}>-{formatNumber(removed)}</span>
    </span>
  );
}

function RiskPill({ level, theme }: { level: 'low' | 'medium' | 'high'; theme: OttoTheme }) {
  const configs: Record<string, { bg: string; color: string }> = {
    low: { bg: theme.successBg, color: theme.success },
    medium: { bg: theme.warningBg, color: theme.warning },
    high: { bg: theme.errorBg, color: theme.error },
  };
  const config = configs[level] ?? configs.low;
  return (
    <span style={{
      ...pillStyle,
      background: config.bg,
      color: config.color,
    }}>
      {level} risk
    </span>
  );
}

function PriorityPill({ priority, theme }: { priority: ReviewPriority; theme: OttoTheme }) {
  const color = priority.score >= 60
    ? theme.error
    : priority.score >= 35
      ? theme.warning
      : theme.success;

  const bg = priority.score >= 60
    ? theme.errorBg
    : priority.score >= 35
      ? theme.warningBg
      : theme.successBg;

  const tooltip = priority.signals.map((s) => `${s.label} (+${s.weight})`).join('\n');

  return (
    <span
      title={tooltip}
      style={{
        ...pillStyle,
        background: bg,
        color,
        cursor: 'default',
      }}
    >
      P{priority.score}
    </span>
  );
}

function QueueActionButton({
  status,
  theme,
  onClick,
  overrideConfig,
}: {
  status: QueueItemStatus | null;
  theme: OttoTheme;
  onClick: () => void;
  overrideConfig?: { label: string; icon: string; color: string };
}) {
  const { label, icon, color } = overrideConfig ?? getActionConfig(status, theme);

  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '22px',
        height: '22px',
        border: `1px solid ${theme.borderSubtle}`,
        borderRadius: '6px',
        background: theme.bgSubtle,
        color,
        cursor: 'pointer',
        padding: 0,
        fontSize: '11px',
        lineHeight: 1,
        flexShrink: 0,
        transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = theme.bgMuted; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = theme.bgSubtle; }}
    >
      {icon}
    </button>
  );
}

function getActionConfig(
  status: QueueItemStatus | null,
  theme: OttoTheme,
): { label: string; icon: string; color: string } {
  switch (status) {
    case 'running':
      return { label: 'Pause review', icon: '⏸', color: theme.warning };
    case 'paused':
      return { label: 'Resume review', icon: '▶', color: theme.brand };
    case 'queued':
      return { label: 'Cancel (queued)', icon: '×', color: theme.textMuted };
    case 'complete':
      return { label: 'Re-review', icon: '↻', color: theme.success };
    case 'error':
      return { label: 'Retry review', icon: '↻', color: theme.error };
    default:
      return { label: 'Start review', icon: '▶', color: theme.brand };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Constants — same as MrPreviewStrip for visual consistency
// ---------------------------------------------------------------------------

const STATE_LABELS: Record<string, string> = {
  opened: 'Open',
  merged: 'Merged',
  closed: 'Closed',
  locked: 'Locked',
};

const STATE_COLORS: Record<string, { bg: string; color: string; bgDark: string; colorDark: string }> = {
  opened: { bg: '#f0fdf4', color: '#16a34a', bgDark: '#064e3b', colorDark: '#4ade80' },
  merged: { bg: '#f5f3ff', color: '#7c3aed', bgDark: '#2e1065', colorDark: '#c4b5fd' },
  closed: { bg: '#fef2f2', color: '#dc2626', bgDark: '#450a0a', colorDark: '#fca5a5' },
  locked: { bg: '#f3f4f6', color: '#6b7280', bgDark: '#374151', colorDark: '#9ca3af' },
};

const RISK_COLORS: Record<string, { bg: string; color: string; bgDark: string; colorDark: string }> = {
  low: { bg: '#f0fdf4', color: '#16a34a', bgDark: '#064e3b', colorDark: '#4ade80' },
  medium: { bg: '#fffbeb', color: '#d97706', bgDark: '#451a03', colorDark: '#fbbf24' },
  high: { bg: '#fef2f2', color: '#dc2626', bgDark: '#450a0a', colorDark: '#fca5a5' },
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pillStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: '6px',
  fontSize: '10px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  lineHeight: '1.6',
};

function styles(theme: OttoTheme) {
  return {
    wrapper: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '0px',
    } as React.CSSProperties,
    strip: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 10px',
      borderRadius: '0 0 4px 4px',
      fontSize: '10px',
      lineHeight: '1.4',
      marginTop: '-1px',
      background: theme.bgSubtle,
      border: `1px solid ${theme.borderSubtle}`,
    } as React.CSSProperties,
    progressRow: {
      padding: '3px 10px 4px',
      background: theme.bgSubtle,
      borderLeft: `1px solid ${theme.borderSubtle}`,
      borderRight: `1px solid ${theme.borderSubtle}`,
      borderBottom: `1px solid ${theme.borderSubtle}`,
      borderRadius: '0 0 4px 4px',
      marginTop: '-1px',
    } as React.CSSProperties,
    errorRow: {
      padding: '2px 10px 3px',
      background: theme.errorBg,
      borderLeft: `1px solid ${theme.borderSubtle}`,
      borderRight: `1px solid ${theme.borderSubtle}`,
      borderBottom: `1px solid ${theme.borderSubtle}`,
      borderRadius: '0 0 4px 4px',
      marginTop: '-1px',
    } as React.CSSProperties,
  };
}
