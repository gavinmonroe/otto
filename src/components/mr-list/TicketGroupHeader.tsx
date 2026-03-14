// ---------------------------------------------------------------------------
// TicketGroupHeader — section divider for ticket-grouped MRs in the list.
//
// Inserted as a DOM element before the first MR row in a ticket group.
// Shows the ticket key, optional Jira title/status, MR count, and
// expand/collapse toggle.
//
// Design: subtle divider row that sits between GitLab's native MR rows.
// Uses the same ▾/▸ collapse pattern as MrOverviewPanel sections.
// Left border accent (2px brand) on the header for visual grouping.
// Compact — should not dominate the list visually.
// ---------------------------------------------------------------------------

import React from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import type { TicketGroup } from '@/types/review-queue';

type Props = {
  group: TicketGroup;
  onToggle: (ticketKey: string) => void;
};

export function TicketGroupHeader({ group, onToggle }: Props) {
  const theme = useTheme();
  const s = styles(theme);

  return (
    <button
      onClick={() => onToggle(group.ticketKey)}
      aria-expanded={group.expanded}
      style={s.container}
      onMouseEnter={(e) => { e.currentTarget.style.background = theme.bgMuted; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = theme.bgSubtle; }}
    >
      <span style={s.toggle}>
        {group.expanded ? '▾' : '▸'}
      </span>

      <span style={s.ticketKey}>
        {group.ticketKey}
      </span>

      {group.ticketTitle && (
        <span style={s.ticketTitle}>
          {group.ticketTitle}
        </span>
      )}

      {group.ticketStatus && (
        <span style={{
          ...s.statusPill,
          background: statusBg(group.ticketStatus, theme),
          color: statusColor(group.ticketStatus, theme),
        }}>
          {group.ticketStatus}
        </span>
      )}

      <span style={{ flex: 1 }} />

      <span style={s.count}>
        {group.mrIids.length} {group.mrIids.length === 1 ? 'MR' : 'MRs'}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status color mapping — maps common Jira statuses to semantic colors
// ---------------------------------------------------------------------------

function statusBg(status: string, theme: OttoTheme): string {
  const lower = status.toLowerCase();
  if (lower === 'done' || lower === 'closed' || lower === 'resolved') return theme.successBg;
  if (lower === 'in progress' || lower === 'in review') return theme.infoBg;
  if (lower === 'blocked' || lower === 'on hold') return theme.warningBg;
  return theme.bgMuted;
}

function statusColor(status: string, theme: OttoTheme): string {
  const lower = status.toLowerCase();
  if (lower === 'done' || lower === 'closed' || lower === 'resolved') return theme.success;
  if (lower === 'in progress' || lower === 'in review') return theme.info;
  if (lower === 'blocked' || lower === 'on hold') return theme.warning;
  return theme.textSecondary;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function styles(theme: OttoTheme) {
  return {
    container: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      width: '100%',
      padding: '5px 10px',
      background: theme.bgSubtle,
      borderLeft: `2px solid ${theme.brand}`,
      borderTop: `1px solid ${theme.borderSubtle}`,
      borderBottom: `1px solid ${theme.borderSubtle}`,
      borderRight: 'none',
      borderRadius: 0,
      cursor: 'pointer',
      fontSize: '11px',
      lineHeight: '1.4',
      fontFamily: 'inherit',
      textAlign: 'left' as const,
      transition: 'background 150ms ease',
    } as React.CSSProperties,
    toggle: {
      fontSize: '10px',
      color: theme.textMuted,
      width: '10px',
      flexShrink: 0,
    } as React.CSSProperties,
    ticketKey: {
      fontWeight: 600,
      color: theme.brand,
      fontSize: '11px',
      flexShrink: 0,
    } as React.CSSProperties,
    ticketTitle: {
      color: theme.textSecondary,
      fontSize: '11px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
      maxWidth: '300px',
    } as React.CSSProperties,
    statusPill: {
      display: 'inline-block',
      padding: '0px 5px',
      borderRadius: '3px',
      fontSize: '9px',
      fontWeight: 600,
      whiteSpace: 'nowrap' as const,
      lineHeight: '1.6',
      flexShrink: 0,
    } as React.CSSProperties,
    count: {
      color: theme.textMuted,
      fontSize: '10px',
      flexShrink: 0,
    } as React.CSSProperties,
  };
}
