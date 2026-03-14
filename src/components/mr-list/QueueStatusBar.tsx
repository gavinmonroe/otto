// ---------------------------------------------------------------------------
// QueueStatusBar — sticky footer showing global queue progress.
//
// Visible when the queue has active items (running or queued).
// Shows: current review info, overall progress, pause/cancel controls.
//
// Design: thin bar at the bottom of the list area. Unobtrusive — similar
// to a status bar. Disappears when queue is empty or all complete.
// ---------------------------------------------------------------------------

import React from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import type { QueueStatus } from '@/types/review-queue';

type Props = {
  status: QueueStatus;
  onPauseAll: () => void;
  onCancelAll: () => void;
};

export function QueueStatusBar({ status, onPauseAll, onCancelAll }: Props) {
  const theme = useTheme();

  const running = status.items.find((i) => i.status === 'running');
  const queuedCount = status.items.filter((i) => i.status === 'queued').length;
  const activeCount = status.items.filter((i) =>
    i.status === 'running' || i.status === 'queued' || i.status === 'paused',
  ).length;

  // Don't render if nothing is active
  if (activeCount === 0) return null;

  const s = styles(theme);

  // Overall progress across all items
  const overallPercent = status.totalCount > 0
    ? Math.round((status.completedCount / status.totalCount) * 100)
    : 0;

  return (
    <div style={s.container}>
      <div style={s.left}>
        {running ? (
          <span style={s.statusText}>
            Reviewing <span style={s.mrRef}>!{running.mrIid}</span>
            {running.title && (
              <span style={s.mrTitle}> — {truncate(running.title, 40)}</span>
            )}
          </span>
        ) : queuedCount > 0 ? (
          <span style={s.statusText}>
            {queuedCount} review{queuedCount !== 1 ? 's' : ''} queued
          </span>
        ) : (
          <span style={s.statusText}>Queue paused</span>
        )}
      </div>

      <div style={s.center}>
        <div style={s.progressTrack}>
          <div style={{
            ...s.progressFill,
            width: `${overallPercent}%`,
            background: theme.brand,
          }} />
        </div>
        <span style={s.progressLabel}>
          {status.completedCount}/{status.totalCount}
        </span>
      </div>

      <div style={s.right}>
        <button
          onClick={onPauseAll}
          style={s.actionBtn}
          title="Pause all reviews"
          onMouseEnter={(e) => { e.currentTarget.style.background = theme.bgMuted; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Pause All
        </button>
        <button
          onClick={onCancelAll}
          style={s.actionBtn}
          title="Cancel all queued reviews"
          onMouseEnter={(e) => { e.currentTarget.style.background = theme.bgMuted; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function styles(theme: OttoTheme) {
  return {
    container: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '5px 10px',
      background: theme.bgSubtle,
      borderTop: `1px solid ${theme.border}`,
      fontSize: '11px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      lineHeight: '1.4',
    } as React.CSSProperties,
    left: {
      flex: 1,
      minWidth: 0,
      overflow: 'hidden',
    } as React.CSSProperties,
    center: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flexShrink: 0,
    } as React.CSSProperties,
    right: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      flexShrink: 0,
    } as React.CSSProperties,
    statusText: {
      color: theme.textSecondary,
      fontSize: '11px',
      whiteSpace: 'nowrap' as const,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    } as React.CSSProperties,
    mrRef: {
      fontWeight: 600,
      color: theme.brand,
    } as React.CSSProperties,
    mrTitle: {
      color: theme.textMuted,
    } as React.CSSProperties,
    progressTrack: {
      width: '80px',
      height: '4px',
      borderRadius: '2px',
      background: theme.bgMuted,
      overflow: 'hidden' as const,
    } as React.CSSProperties,
    progressFill: {
      height: '100%',
      borderRadius: '2px',
      transition: 'width 300ms ease',
    } as React.CSSProperties,
    progressLabel: {
      fontSize: '10px',
      fontWeight: 600,
      color: theme.textMuted,
      minWidth: '24px',
    } as React.CSSProperties,
    actionBtn: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: '4px',
      border: `1px solid ${theme.borderSubtle}`,
      background: 'transparent',
      color: theme.textSecondary,
      fontSize: '10px',
      fontWeight: 500,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'background 150ms ease',
    } as React.CSSProperties,
  };
}
