// ---------------------------------------------------------------------------
// MrPreviewStrip — preview strip injected under each MR row on the list page.
//
// Fetches preview data from the background service worker and renders:
// - MR state pill (opened/merged/closed)
// - Files changed count
// - Lines added/removed
// - Language breakdown bar
// - Risk level pill (if Otto has a cached review)
//
// Design decisions:
// - Self-contained data fetching via useEffect + sendMessage. Each strip
//   independently fetches its own data, allowing the content script to
//   mount strips as MR rows appear (pagination, infinite scroll).
// - Silent error handling — if the fetch fails, the strip simply doesn't
//   render. No error UI cluttering the GitLab page.
// - Loading state is a subtle skeleton bar, not a spinner.
// - All styles are inline via useTheme() to work inside shadow DOM.
// - Pill styling matches existing Otto patterns: borderRadius 3px,
//   fontSize 10px, fontWeight 600, padding 1px 6px.
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { LanguageBar } from './LanguageBar';
import { sendMessage } from '@/lib/messaging';
import type { MrPreviewData } from '@/types/mr-preview';

type Props = {
  hostId: string;
  projectId: number;
  projectPath: string;
  mrIid: number;
};

export function MrPreviewStrip({ hostId, projectId, projectPath, mrIid }: Props) {
  const theme = useTheme();
  const [data, setData] = useState<MrPreviewData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;

    sendMessage({
      type: 'FETCH_MR_PREVIEW',
      payload: { hostId, projectId, projectPath, mrIid },
    }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setData(result.data);
        setStatus('ready');
      } else {
        setStatus('error');
      }
    });

    return () => { cancelled = true; };
  }, [hostId, projectId, projectPath, mrIid]);

  // Silent error — don't render anything
  if (status === 'error') return null;

  // Loading skeleton
  if (status === 'loading') {
    return (
      <div style={{ ...stripStyle, background: theme.bgSubtle, border: `1px solid ${theme.borderSubtle}` }}>
        <div style={{
          width: '100%',
          height: '8px',
          borderRadius: '6px',
          background: theme.bgMuted,
          opacity: 0.5,
        }} />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{
      ...stripStyle,
      background: theme.bgSubtle,
      border: `1px solid ${theme.borderSubtle}`,
    }}>
      <StatePill state={data.state} theme={theme} />
      <FilesPill count={data.filesChanged} theme={theme} />
      <LinesPill added={data.linesAdded} removed={data.linesRemoved} theme={theme} />
      <LanguageBar languages={data.languages} />
      {data.riskLevel && <RiskPill level={data.riskLevel} theme={theme} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — small pills following Otto's existing pattern.
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
    <span style={{
      ...pillStyle,
      background: theme.bgMuted,
      color: theme.textSecondary,
    }}>
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Constants
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

const stripStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 10px',
  borderRadius: '0 0 4px 4px',
  fontSize: '10px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  lineHeight: '1.4',
  marginTop: '-1px', // Overlap with the MR row border for visual continuity
};

const pillStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: '6px',
  fontSize: '10px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  lineHeight: '1.6',
};
