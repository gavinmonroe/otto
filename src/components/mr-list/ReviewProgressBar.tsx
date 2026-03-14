// ---------------------------------------------------------------------------
// ReviewProgressBar — segmented progress bar for queued MR reviews.
//
// Shows per-task progress as colored segments in a thin horizontal bar.
// Used in MrEnhancedStrip when a review is running or paused.
//
// Design: 4px height, segments proportional to task weight, color-coded
// by status. Paused state uses reduced opacity + striped pattern.
// Matches existing progress indicator patterns (6px dots in MrOverviewPanel)
// but as a bar for the list context where horizontal space is available.
// ---------------------------------------------------------------------------

import React from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import type { ReviewProgressSnapshot } from '@/types/review-queue';

type Props = {
  progress: ReviewProgressSnapshot;
  paused?: boolean;
};

/** Task display order and relative weights (for segment widths) */
const TASK_SEGMENTS: Array<{ key: string; label: string; weight: number }> = [
  { key: 'summary', label: 'Summary', weight: 10 },
  { key: 'codeReview', label: 'Code Review', weight: 40 },
  { key: 'edgeCases', label: 'Edge Cases', weight: 15 },
  { key: 'relatedFiles', label: 'Related Files', weight: 10 },
  { key: 'fileActivity', label: 'File Activity', weight: 5 },
  { key: 'adversarialTests', label: 'Tests', weight: 8 },
  { key: 'contracts', label: 'Contracts', weight: 6 },
  { key: 'behavioralDelta', label: 'Behavioral', weight: 6 },
];

export function ReviewProgressBar({ progress, paused = false }: Props) {
  const theme = useTheme();

  // Filter to only tasks that are active (have a status entry)
  const activeTasks = TASK_SEGMENTS.filter((seg) => progress.tasks[seg.key]);
  if (activeTasks.length === 0) return null;

  const totalWeight = activeTasks.reduce((sum, seg) => sum + seg.weight, 0);

  const s = styles(theme, paused);

  return (
    <div style={s.container}>
      <div style={s.bar}>
        {activeTasks.map((seg) => {
          const taskStatus = progress.tasks[seg.key]?.status ?? 'idle';
          const widthPercent = (seg.weight / totalWeight) * 100;
          const color = statusColor(taskStatus, theme);

          return (
            <div
              key={seg.key}
              title={`${seg.label}: ${taskStatus}`}
              style={{
                width: `${widthPercent}%`,
                height: '100%',
                background: color,
                transition: 'background 200ms ease',
              }}
            />
          );
        })}
      </div>
      <span style={s.label}>
        {paused ? 'Paused' : `${progress.overallPercent}%`}
      </span>
    </div>
  );
}

function statusColor(status: string, theme: OttoTheme): string {
  switch (status) {
    case 'complete': return theme.success;
    case 'streaming': return theme.brand;
    case 'loading': return theme.warning;
    case 'error': return theme.error;
    default: return theme.bgMuted;
  }
}

function styles(theme: OttoTheme, paused: boolean) {
  return {
    container: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      opacity: paused ? 0.6 : 1,
    } as React.CSSProperties,
    bar: {
      flex: 1,
      height: '4px',
      borderRadius: '2px',
      overflow: 'hidden' as const,
      display: 'flex',
      background: theme.bgMuted,
    } as React.CSSProperties,
    label: {
      fontSize: '10px',
      fontWeight: 600,
      color: paused ? theme.textMuted : theme.textSecondary,
      flexShrink: 0,
      minWidth: '32px',
      textAlign: 'right' as const,
    } as React.CSSProperties,
  };
}
