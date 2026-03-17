// ---------------------------------------------------------------------------
// TeamDigestBanner — collapsible team activity summary for the MR list page.
//
// Design decisions:
// - Injected at the top of the MR list, above the toolbar.
// - Collapsible, starts collapsed. Remembers state in chrome.storage.local.
// - Shows team aggregate stats + personal stats (filtered client-side).
// - Shows actionable items (stale MRs) with links.
// - One-shot fetch on mount — no polling, no subscriptions, no streaming.
// - Dismissable per period (don't re-show the same daily digest after dismiss).
// ---------------------------------------------------------------------------

import React, { useState, useEffect } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';

// ---------------------------------------------------------------------------
// Types (matches Botto's digest data model)
// ---------------------------------------------------------------------------

type TeamStats = {
  mrs_merged: number;
  mrs_open: number;
  avg_time_to_first_review_hours: number | null;
  sandbox_fixes_applied: number;
  review_comments_accepted: number;
  review_comments_dismissed: number;
};

type MemberStats = {
  user_id: string;
  display_name: string;
  mrs_authored: number;
  mrs_reviewed: number;
  comments_made: number;
  suggestions_accepted: number;
};

type ActionableItem = {
  kind: 'stale_review' | 'unreviewed_mr';
  mr_iid: number;
  project_path: string;
  message: string;
  age_hours: number;
  web_url: string;
};

export type TeamDigest = {
  period: 'daily' | 'weekly';
  generated_at: number;
  team_stats: TeamStats;
  member_stats: MemberStats[];
  actionable: ActionableItem[];
};

type Props = {
  digest: TeamDigest;
  userId: string;
  onDismiss: () => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeamDigestBanner({ digest, userId, onDismiss }: Props) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const stats = digest.team_stats;
  const myStats = digest.member_stats.find(
    (m) => m.user_id.toLowerCase() === userId.toLowerCase(),
  );
  const periodLabel = digest.period === 'daily' ? 'Today' : 'This week';

  return (
    <div style={containerStyle(theme)}>
      <div style={headerStyle(theme)}>
        <button
          onClick={() => setExpanded(!expanded)}
          style={toggleStyle(theme)}
          aria-label={expanded ? 'Collapse digest' : 'Expand digest'}
        >
          <span style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', transition: 'transform 150ms ease' }}>
            &#9654;
          </span>
        </button>

        <span style={summaryTextStyle(theme)}>
          {periodLabel}: {stats.mrs_merged} merged, {stats.mrs_open} open
          {stats.sandbox_fixes_applied > 0 && `, ${stats.sandbox_fixes_applied} sandbox fixes`}
        </span>

        <button onClick={onDismiss} style={dismissStyle(theme)} aria-label="Dismiss digest">
          &#10005;
        </button>
      </div>

      {expanded && (
        <div style={bodyStyle(theme)}>
          {/* Team stats */}
          <div style={sectionStyle(theme)}>
            <div style={statRowStyle}>
              <span style={statLabelStyle(theme)}>Comments accepted</span>
              <span style={statValueStyle(theme)}>{stats.review_comments_accepted}</span>
            </div>
            <div style={statRowStyle}>
              <span style={statLabelStyle(theme)}>Comments dismissed</span>
              <span style={statValueStyle(theme)}>{stats.review_comments_dismissed}</span>
            </div>
          </div>

          {/* Personal stats */}
          {myStats && (
            <div style={sectionStyle(theme)}>
              <div style={sectionLabelStyle(theme)}>Your activity</div>
              <div style={statRowStyle}>
                <span style={statLabelStyle(theme)}>MRs authored</span>
                <span style={statValueStyle(theme)}>{myStats.mrs_authored}</span>
              </div>
              {myStats.suggestions_accepted > 0 && (
                <div style={statRowStyle}>
                  <span style={statLabelStyle(theme)}>Suggestions accepted</span>
                  <span style={statValueStyle(theme)}>{myStats.suggestions_accepted}</span>
                </div>
              )}
            </div>
          )}

          {/* Actionable items */}
          {digest.actionable.length > 0 && (
            <div style={sectionStyle(theme)}>
              <div style={sectionLabelStyle(theme)}>Needs attention</div>
              {digest.actionable.slice(0, 5).map((item, i) => (
                <a
                  key={i}
                  href={item.web_url}
                  style={actionLinkStyle(theme)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.message}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — inline, matching existing Otto injected UI patterns
// ---------------------------------------------------------------------------

function containerStyle(t: OttoTheme): React.CSSProperties {
  return {
    borderBottom: `1px solid ${t.border}`,
    background: t.bgSubtle,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: '12px',
    lineHeight: '1.5',
  };
}

function headerStyle(t: OttoTheme): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
  };
}

function toggleStyle(t: OttoTheme): React.CSSProperties {
  return {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: t.textSecondary,
    fontSize: '9px',
    padding: '2px',
    lineHeight: 1,
  };
}

function summaryTextStyle(t: OttoTheme): React.CSSProperties {
  return {
    flex: 1,
    color: t.text,
    fontWeight: 500,
  };
}

function dismissStyle(t: OttoTheme): React.CSSProperties {
  return {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: t.textSecondary,
    fontSize: '11px',
    padding: '2px 4px',
    lineHeight: 1,
  };
}

function bodyStyle(t: OttoTheme): React.CSSProperties {
  return {
    padding: '0 12px 8px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  };
}

function sectionStyle(t: OttoTheme): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  };
}

function sectionLabelStyle(t: OttoTheme): React.CSSProperties {
  return {
    color: t.textSecondary,
    fontSize: '11px',
    fontWeight: 500,
    marginBottom: '2px',
  };
}

const statRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

function statLabelStyle(t: OttoTheme): React.CSSProperties {
  return {
    color: t.textSecondary,
  };
}

function statValueStyle(t: OttoTheme): React.CSSProperties {
  return {
    color: t.text,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
  };
}

function actionLinkStyle(t: OttoTheme): React.CSSProperties {
  return {
    color: t.brand,
    textDecoration: 'none',
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}
