// ---------------------------------------------------------------------------
// MrListToolbar — sort controls + queue actions above the MR list.
//
// Injected before the GitLab .issuable-list element. Provides:
// - Sort dropdown (Priority, Newest, Oldest, Most Files, Most Lines)
// - "Queue All" button to batch-enqueue visible MRs
// - Queue count badge showing active/total
//
// Design: thin bar matching GitLab's existing toolbar height. Simple
// controls, no decorative elements. Uses the same pill/button patterns
// as the rest of Otto's injected UI.
// ---------------------------------------------------------------------------

import React from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import type { QueueSortKey } from '@/types/review-queue';

type Props = {
  sortKey: QueueSortKey;
  onSortChange: (key: QueueSortKey) => void;
  onQueueAll: () => void;
  queuedCount: number;
  totalCount: number;
};

const SORT_OPTIONS: Array<{ key: QueueSortKey; label: string }> = [
  { key: 'priority', label: 'Priority' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'mostFiles', label: 'Most Files' },
  { key: 'mostLines', label: 'Most Lines' },
];

export function MrListToolbar({
  sortKey,
  onSortChange,
  onQueueAll,
  queuedCount,
  totalCount,
}: Props) {
  const theme = useTheme();
  const s = styles(theme);

  return (
    <div style={s.container}>
      <div style={s.left}>
        <span style={s.label}>Sort by</span>
        <select
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as QueueSortKey)}
          style={s.select}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div style={s.right}>
        {queuedCount > 0 && (
          <span style={s.queueBadge}>
            {queuedCount} in queue
          </span>
        )}
        <button
          onClick={onQueueAll}
          style={s.queueButton}
          onMouseEnter={(e) => { e.currentTarget.style.background = theme.brandHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = theme.brand; }}
        >
          Queue All ({totalCount})
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function styles(theme: OttoTheme) {
  return {
    container: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 10px',
      background: theme.bgSubtle,
      borderBottom: `1px solid ${theme.border}`,
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      lineHeight: '1.4',
    } as React.CSSProperties,
    left: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    } as React.CSSProperties,
    right: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    } as React.CSSProperties,
    label: {
      color: theme.textSecondary,
      fontSize: '11px',
      fontWeight: 500,
    } as React.CSSProperties,
    select: {
      appearance: 'auto' as const,
      background: theme.bg,
      color: theme.text,
      border: `1px solid ${theme.border}`,
      borderRadius: '4px',
      padding: '2px 6px',
      fontSize: '11px',
      cursor: 'pointer',
      fontFamily: 'inherit',
      outline: 'none',
    } as React.CSSProperties,
    queueBadge: {
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: '3px',
      fontSize: '10px',
      fontWeight: 600,
      background: theme.infoBg,
      color: theme.info,
    } as React.CSSProperties,
    queueButton: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 10px',
      borderRadius: '4px',
      border: 'none',
      background: theme.brand,
      color: '#ffffff',
      fontSize: '11px',
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'background 150ms ease',
    } as React.CSSProperties,
  };
}
