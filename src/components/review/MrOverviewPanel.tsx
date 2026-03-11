// ---------------------------------------------------------------------------
// MrOverviewPanel — the main Otto banner injected above the diff file list.
//
// Uses ThemeContext for dark/light mode support. All colors come from
// useTheme() so they adapt automatically when GitLab is in dark mode.
// ---------------------------------------------------------------------------

import { useState, useCallback, useMemo } from 'react';
import { Settings } from 'lucide-react';
import { useReview } from '@/hooks/use-review';
import { useGitLabContext } from '@/hooks/use-gitlab-context';
import { useSettings } from '@/hooks/use-settings';
import { useTheme } from '@/components/ThemeContext';
import { sendMessage } from '@/lib/messaging';
import { OttoLogo } from '@/components/OttoLogo';
import { Markdown } from '@/components/Markdown';
import { RelatedFilesPanel } from './RelatedFilesPanel';
import { EdgeCaseAnalysis } from './EdgeCaseAnalysis';

export function MrOverviewPanel() {
  const review = useReview();
  const { context: gitlabContext, loading: contextLoading } = useGitLabContext();
  const { settings, loading: settingsLoading } = useSettings();
  const theme = useTheme();
  const [showRelated, setShowRelated] = useState(false);
  const [showEdgeCases, setShowEdgeCases] = useState(false);

  const handleStartReview = useCallback(() => {
    const tasks: Array<'summary' | 'codeReview' | 'edgeCases' | 'relatedFiles'> = ['summary', 'codeReview', 'edgeCases'];
    if (gitlabContext?.isConfigured) {
      tasks.push('relatedFiles');
    }
    review.startReview(tasks);
  }, [review, gitlabContext]);

  const handleOpenSettings = useCallback(() => {
    sendMessage({ type: 'OPEN_OPTIONS' });
  }, []);

  const s = useMemo(() => buildStyles(theme), [theme]);

  const isLoading = contextLoading || settingsLoading;
  const isIdle = review.status === 'idle';
  const isActive = review.status === 'loading' || review.status === 'streaming';
  const isComplete = review.status === 'complete';
  const hasError = review.status === 'error';
  const hasAiConfig = !!settings.ai.baseUrl;

  if (isLoading) {
    return (
      <div style={s.panel}>
        <div style={s.header}>
          <OttoLogo size={20} />
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Otto</span>
        </div>
      </div>
    );
  }

  if (!hasAiConfig) {
    return (
      <div style={s.panel}>
        <div style={s.header}>
          <OttoLogo size={20} />
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Otto</span>
        </div>
        <div style={{ padding: '12px', fontSize: '13px', color: theme.textSecondary }}>
          <p style={{ margin: '0 0 8px' }}>
            Otto needs an AI provider to review this MR. Configure your OpenAI-compatible endpoint in settings.
          </p>
          <button onClick={handleOpenSettings} style={s.linkButton}>
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.panel}>
      {/* Header */}
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <OttoLogo size={20} />
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Otto</span>
          {review.mrContext && (
            <span style={{ fontSize: '12px', color: theme.textSecondary }}>
              {review.mrContext.diffFiles.length} files changed
            </span>
          )}
          {!gitlabContext?.isConfigured && (
            <span style={{ fontSize: '11px', color: theme.warning }} title="Add a GitLab PAT in settings for richer reviews (file context, related files)">
              limited context
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isIdle && (
            <button onClick={handleStartReview} style={s.primaryButton}>
              Review MR
            </button>
          )}
          {isActive && (
            <button onClick={review.cancelReview} style={s.secondaryButton}>
              Cancel
            </button>
          )}
          {isComplete && (
            <button onClick={handleStartReview} style={s.secondaryButton}>
              Re-review
            </button>
          )}
          <button onClick={handleOpenSettings} style={s.iconButton} title="Otto Settings">
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Error */}
      {hasError && review.error && (
        <div style={s.error}>{review.error}</div>
      )}

      {/* Progress bar */}
      {isActive && (
        <div style={s.progressBar}>
          <ProgressItem label="Summary" status={review.progress.summary.status} theme={theme} />
          <ProgressItem
            label={`Files (${review.progress.codeReview.filesComplete}/${review.progress.codeReview.filesTotal})`}
            status={review.progress.codeReview.status}
            theme={theme}
          />
          <ProgressItem label="Edge Cases" status={review.progress.edgeCases.status} theme={theme} />
          <ProgressItem label="Related" status={review.progress.relatedFiles.status} theme={theme} />
        </div>
      )}

      {/* Summary */}
      {(review.summaryDelta || review.summary) && (
        <div style={s.section}>
          <div style={s.sectionHeader}>Summary</div>
          {review.summary ? (
            <div style={{ fontSize: '13px' }}>
              <Markdown content={review.summary.overview} compact />
              <div style={{ fontSize: '12px', color: theme.textSecondary, marginBottom: '6px' }}>
                <Markdown content={review.summary.riskAssessment} compact />
              </div>
              {review.summary.keyChanges.length > 0 && (
                <Markdown content={review.summary.keyChanges.map((c) => `- ${c}`).join('\n')} compact />
              )}
            </div>
          ) : (
            <div style={{ fontSize: '13px', whiteSpace: 'pre-wrap' }}>
              {review.summaryDelta}
              <span style={{ color: theme.brand }}>|</span>
            </div>
          )}
        </div>
      )}

      {/* Related Files (collapsible) */}
      {review.relatedFiles.length > 0 && (
        <div style={s.section}>
          <button onClick={() => setShowRelated(!showRelated)} style={s.collapsibleHeader}>
            <span>{showRelated ? '▾' : '▸'} Related Files ({review.relatedFiles.length})</span>
          </button>
          {showRelated && <RelatedFilesPanel files={review.relatedFiles} />}
        </div>
      )}

      {/* Edge Cases (collapsible) */}
      {review.edgeCases.length > 0 && (
        <div style={s.section}>
          <button onClick={() => setShowEdgeCases(!showEdgeCases)} style={s.collapsibleHeader}>
            <span>{showEdgeCases ? '▾' : '▸'} Edge Cases ({review.edgeCases.length})</span>
          </button>
          {showEdgeCases && <EdgeCaseAnalysis edgeCases={review.edgeCases} />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

import type { OttoTheme } from '@/components/ThemeContext';

function ProgressItem({ label, status, theme }: { label: string; status: string; theme: OttoTheme }) {
  const color = status === 'complete' ? theme.success
    : status === 'streaming' ? theme.brand
    : status === 'error' ? theme.error
    : status === 'loading' ? theme.warning
    : theme.textMuted;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
      <div style={{
        width: '6px', height: '6px', borderRadius: '50%', background: color,
      }} />
      <span style={{ color }}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theme-aware styles
// ---------------------------------------------------------------------------

function buildStyles(t: OttoTheme) {
  return {
    panel: {
      margin: '0 0 16px',
      border: `1px solid ${t.border}`,
      borderRadius: '8px',
      background: t.bg,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '14px',
      color: t.text,
      overflow: 'hidden',
    } as React.CSSProperties,

    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 14px',
      borderBottom: `1px solid ${t.borderSubtle}`,
      background: t.bgSubtle,
    } as React.CSSProperties,

    section: {
      padding: '10px 14px',
      borderBottom: `1px solid ${t.borderSubtle}`,
    } as React.CSSProperties,

    sectionHeader: {
      fontWeight: 600,
      fontSize: '12px',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
      color: t.textSecondary,
      marginBottom: '6px',
    } as React.CSSProperties,

    progressBar: {
      display: 'flex',
      gap: '12px',
      padding: '6px 14px',
      background: t.bgSubtle,
      borderBottom: `1px solid ${t.borderSubtle}`,
    } as React.CSSProperties,

    error: {
      padding: '8px 14px',
      background: t.errorBg,
      color: t.error,
      fontSize: '13px',
      borderBottom: `1px solid ${t.errorBorder}`,
    } as React.CSSProperties,

    primaryButton: {
      padding: '5px 14px',
      borderRadius: '6px',
      background: t.btnPrimaryBg,
      color: t.btnPrimaryText,
      border: 'none',
      fontSize: '13px',
      fontWeight: 500,
      cursor: 'pointer',
    } as React.CSSProperties,

    secondaryButton: {
      padding: '5px 14px',
      borderRadius: '6px',
      background: t.btnSecondaryBg,
      color: t.btnSecondaryText,
      border: `1px solid ${t.btnSecondaryBorder}`,
      fontSize: '13px',
      fontWeight: 500,
      cursor: 'pointer',
    } as React.CSSProperties,

    iconButton: {
      padding: '4px',
      borderRadius: '4px',
      background: 'transparent',
      border: 'none',
      color: t.textSecondary,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
    } as React.CSSProperties,

    linkButton: {
      background: 'none',
      border: 'none',
      color: t.brand,
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: 500,
      padding: 0,
      textDecoration: 'underline',
    } as React.CSSProperties,

    collapsibleHeader: {
      background: 'none',
      border: 'none',
      padding: 0,
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: '12px',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
      color: t.textSecondary,
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      width: '100%',
    } as React.CSSProperties,
  };
}
