// ---------------------------------------------------------------------------
// MrOverviewPanel — the main Otto banner injected above the diff file list.
//
// Uses ThemeContext for dark/light mode support. All colors come from
// useTheme() so they adapt automatically when GitLab is in dark mode.
// ---------------------------------------------------------------------------

import { useState, useCallback, useMemo } from 'react';
import { Settings, RefreshCw } from 'lucide-react';
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
  const [showActivity, setShowActivity] = useState(false);
  const [showAcValidation, setShowAcValidation] = useState(true); // Open by default — high value

  const handleStartReview = useCallback(() => {
    const tasks: Array<'summary' | 'codeReview' | 'edgeCases' | 'relatedFiles'> = ['summary', 'codeReview', 'edgeCases'];
    if (gitlabContext?.isConfigured) {
      tasks.push('relatedFiles');
    }
    review.startReview(tasks);
  }, [review, gitlabContext]);

  const handleRegenerate = useCallback(() => {
    const tasks: Array<'summary' | 'codeReview' | 'edgeCases' | 'relatedFiles'> = ['summary', 'codeReview', 'edgeCases'];
    if (gitlabContext?.isConfigured) {
      tasks.push('relatedFiles');
    }
    review.regenerateReview(tasks);
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
            <button onClick={handleRegenerate} style={s.secondaryButton} title="Clear cache and re-review">
              <RefreshCw size={13} style={{ marginRight: '4px' }} />
              Regenerate
            </button>
          )}
          <button onClick={handleOpenSettings} style={s.iconButton} title="Otto Settings">
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Error */}
      {hasError && review.error && (
        <div style={s.error}>
          {review.error.replace(/Try again\.?/, '').trim()}{' '}
          <button
            onClick={handleStartReview}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 'inherit',
              fontWeight: 600,
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            Try again
          </button>
        </div>
      )}

      {/* Progress bar */}
      {isActive && (
        <>
          <div style={s.progressBar}>
            <ProgressItem label="Summary" status={review.progress.summary.status} theme={theme} />
            <ProgressItem
              label={`Files (${review.progress.codeReview.filesComplete}/${review.progress.codeReview.filesTotal})`}
              status={review.progress.codeReview.status}
              theme={theme}
            />
            <ProgressItem label="Edge Cases" status={review.progress.edgeCases.status} theme={theme} />
            <ProgressItem label="Related" status={review.progress.relatedFiles.status} theme={theme} />
            <ProgressItem label="Recent MRs" status={review.progress.fileActivity.status} theme={theme} />
          </div>
          {review.progressMessage && (
            <div style={{
              padding: '4px 14px',
              fontSize: '11px',
              color: theme.textMuted,
              background: theme.bgSubtle,
              borderBottom: `1px solid ${theme.borderSubtle}`,
              fontStyle: 'italic',
            }}>
              {review.progressMessage}
            </div>
          )}
        </>
      )}

      {/* Summary */}
      {(review.summaryDelta || review.summary) && (
        <div style={s.section}>
          <div style={s.sectionHeader}>Summary</div>
          {review.summary ? (
            <div style={{ fontSize: '13px' }}>
              <Markdown content={review.summary.overview} compact />
              {review.summary.keyChanges.length > 0 && (
                <div style={{ marginTop: '4px' }}>
                  <Markdown content={review.summary.keyChanges.map((c) => `- ${c}`).join('\n')} compact />
                </div>
              )}
              {review.summary.affectedAreas.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                  {review.summary.affectedAreas.map((area, i) => (
                    <span key={i} style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: theme.isDark ? '#1e293b' : '#f1f5f9',
                      color: theme.textSecondary,
                      border: `1px solid ${theme.borderSubtle}`,
                    }}>
                      {area}
                    </span>
                  ))}
                </div>
              )}
              <div style={{
                fontSize: '12px',
                color: theme.textSecondary,
                marginTop: '6px',
                padding: '4px 8px',
                background: theme.bgSubtle,
                borderRadius: '4px',
                borderLeft: `3px solid ${
                  review.summary.riskAssessment.toLowerCase().includes('high') ? theme.error
                  : review.summary.riskAssessment.toLowerCase().includes('medium') ? theme.warning
                  : theme.success
                }`,
              }}>
                <Markdown content={review.summary.riskAssessment} compact />
              </div>

              {/* File Activity inline in summary */}
              {review.status === 'complete' && !review.fileActivity && (
                <div style={{
                  fontSize: '12px',
                  color: theme.textMuted,
                  marginTop: '6px',
                  padding: '4px 8px',
                  background: theme.bgSubtle,
                  borderRadius: '4px',
                  fontStyle: 'italic',
                }}>
                  No recent file activity in the last 30 days.
                </div>
              )}
              {review.fileActivity && review.fileActivity.fileActivities.length > 0 && (
                <div style={{
                  fontSize: '12px',
                  marginTop: '6px',
                  padding: '6px 8px',
                  background: theme.bgSubtle,
                  borderRadius: '4px',
                  borderLeft: `3px solid ${theme.warning}`,
                }}>
                  <div style={{ fontWeight: 600, fontSize: '11px', color: theme.warning, marginBottom: '4px' }}>
                    Recent File Activity
                  </div>
                  {review.fileActivity.fileActivities.map((activity) => (
                    <div key={activity.filePath} style={{ marginBottom: '3px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', color: theme.text }}>
                        {activity.filePath}
                      </span>
                      <span style={{ fontSize: '11px', color: theme.textMuted }}> — also in </span>
                      {activity.recentMrs.map((mr, i) => (
                        <span key={mr.iid} style={{ fontSize: '11px' }}>
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
                    </div>
                  ))}
                </div>
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

      {/* Linked Tickets */}
      {review.ticketKeys.length > 0 && review.ticketContext && (
        <div style={s.section}>
          <div style={s.sectionHeader}>
            Linked Tickets ({review.ticketKeys.join(', ')})
          </div>
          <div style={{ fontSize: '12px' }}>
            <Markdown content={review.ticketContext} compact />
          </div>
        </div>
      )}

      {/* Acceptance Criteria Validation */}
      {review.acValidation && review.acValidation.results.length > 0 && (
        <div style={s.section}>
          <button onClick={() => setShowAcValidation(!showAcValidation)} style={s.collapsibleHeader}>
            <span>
              {showAcValidation ? '▾' : '▸'} Requirements Check
              {' '}
              <AcStatusPills acValidation={review.acValidation} theme={theme} />
            </span>
          </button>
          {showAcValidation && (
            <AcValidationPanel acValidation={review.acValidation} theme={theme} />
          )}
        </div>
      )}

      {/* Recent File Activity (collapsible) */}
      {review.fileActivity && review.fileActivity.fileActivities.length > 0 && (
        <div style={s.section}>
          <button onClick={() => setShowActivity(!showActivity)} style={s.collapsibleHeader}>
            <span>
              {showActivity ? '▾' : '▸'} Recent Activity ({review.fileActivity.fileActivities.length} file{review.fileActivity.fileActivities.length !== 1 ? 's' : ''} with recent changes)
            </span>
          </button>
          {showActivity && (
            <FileActivitySummary fileActivity={review.fileActivity} theme={theme} hostUrl={review.mrContext?.hostUrl ?? ''} />
          )}
        </div>
      )}

      {/* Related Files (collapsible) */}
      {(review.relatedFiles.length > 0 || review.progress.relatedFiles?.status === 'error') && (
        <div style={s.section}>
          <button onClick={() => setShowRelated(!showRelated)} style={s.collapsibleHeader}>
            <span>
              {showRelated ? '▾' : '▸'} Related Files
              {review.relatedFiles.length > 0
                ? ` (${review.relatedFiles.length})`
                : review.progress.relatedFiles?.status === 'error'
                  ? ' (failed)'
                  : ''}
            </span>
          </button>
          {showRelated && review.relatedFiles.length > 0 && (
            <RelatedFilesPanel files={review.relatedFiles} />
          )}
          {showRelated && review.progress.relatedFiles?.status === 'error' && (
            <div style={{ fontSize: '12px', color: theme.error, marginTop: '6px', padding: '6px 8px', background: theme.errorBg, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{review.progress.relatedFiles.error || 'Related files discovery failed.'}</span>
              <button
                onClick={() => review.retryTasks(['relatedFiles'])}
                style={s.retryButton}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {/* Edge Cases (collapsible) */}
      {(review.edgeCases.length > 0 || review.edgeCasesDelta || review.progress.edgeCases.status === 'error') && (
        <div style={s.section}>
          <button onClick={() => setShowEdgeCases(!showEdgeCases)} style={s.collapsibleHeader}>
            <span>
              {showEdgeCases ? '▾' : '▸'} Edge Cases
              {review.edgeCases.length > 0
                ? ` (${review.edgeCases.length})`
                : review.progress.edgeCases.status === 'error'
                  ? ' (failed)'
                  : review.edgeCasesDelta ? ' (analyzing...)' : ''}
            </span>
          </button>
          {showEdgeCases && review.edgeCases.length > 0 && (
            <EdgeCaseAnalysis edgeCases={review.edgeCases} />
          )}
          {showEdgeCases && review.progress.edgeCases.status === 'error' && review.progress.edgeCases.error && (
            <div style={{ fontSize: '12px', color: theme.error, marginTop: '6px', padding: '6px 8px', background: theme.errorBg, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{review.progress.edgeCases.error}</span>
              <button
                onClick={() => review.retryTasks(['edgeCases'])}
                style={s.retryButton}
              >
                Retry
              </button>
            </div>
          )}
          {showEdgeCases && !review.edgeCases.length && review.edgeCasesDelta && (
            <div style={{ fontSize: '13px', marginTop: '8px', whiteSpace: 'pre-wrap' }}>
              <Markdown content={review.edgeCasesDelta} compact />
              <span style={{ color: theme.brand }}>|</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

import type { OttoTheme } from '@/components/ThemeContext';
import type { FileActivityData, AcValidationData, AcValidationStatus } from '@/types/review';

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

function FileActivitySummary({ fileActivity, theme, hostUrl }: { fileActivity: FileActivityData; theme: OttoTheme; hostUrl: string }) {
  return (
    <div style={{ marginTop: '8px', fontSize: '12px' }}>
      <div style={{
        fontSize: '11px',
        color: theme.textMuted,
        marginBottom: '6px',
      }}>
        {fileActivity.totalRecentMrs} MR{fileActivity.totalRecentMrs !== 1 ? 's' : ''} merged in the last {fileActivity.lookbackDays} days touched files in this diff.
      </div>
      {fileActivity.fileActivities.map((activity) => (
        <div key={activity.filePath} style={{
          padding: '6px 8px',
          marginBottom: '4px',
          background: theme.bgSubtle,
          borderRadius: '4px',
          borderLeft: `3px solid ${theme.warning}`,
        }}>
          <div style={{
            fontWeight: 500,
            fontSize: '12px',
            marginBottom: '3px',
            fontFamily: 'monospace',
            color: theme.text,
          }}>
            {activity.filePath.split('/').pop()}
            <span style={{ color: theme.textMuted, fontWeight: 400, marginLeft: '4px' }}>
              {activity.filePath.includes('/') ? activity.filePath.slice(0, activity.filePath.lastIndexOf('/')) : ''}
            </span>
          </div>
          {activity.recentMrs.map((mr) => {
            const daysAgo = Math.round(
              (Date.now() - new Date(mr.mergedAt).getTime()) / (24 * 60 * 60 * 1000),
            );
            return (
              <div key={mr.iid} style={{
                fontSize: '11px',
                color: theme.textSecondary,
                marginLeft: '4px',
                lineHeight: '1.5',
              }}>
                <a
                  href={mr.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: theme.brand, textDecoration: 'none' }}
                >
                  !{mr.iid}
                </a>
                {' '}{mr.title.length > 60 ? mr.title.slice(0, 60) + '\u2026' : mr.title}
                {' '}<span style={{ color: theme.textMuted }}>@{mr.author} · {daysAgo}d ago</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function AcStatusPills({ acValidation, theme }: { acValidation: AcValidationData; theme: OttoTheme }) {
  const { satisfiedCount, unclearCount, notFoundCount } = acValidation;
  return (
    <span style={{ display: 'inline-flex', gap: '4px', marginLeft: '4px' }}>
      {satisfiedCount > 0 && (
        <span style={{
          fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
          background: theme.isDark ? '#064e3b' : '#f0fdf4',
          color: theme.isDark ? '#4ade80' : '#16a34a',
          fontWeight: 600,
        }}>
          {satisfiedCount} met
        </span>
      )}
      {unclearCount > 0 && (
        <span style={{
          fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
          background: theme.isDark ? '#451a03' : '#fffbeb',
          color: theme.isDark ? '#fbbf24' : '#d97706',
          fontWeight: 600,
        }}>
          {unclearCount} unclear
        </span>
      )}
      {notFoundCount > 0 && (
        <span style={{
          fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
          background: theme.isDark ? '#450a0a' : '#fef2f2',
          color: theme.isDark ? '#fca5a5' : '#dc2626',
          fontWeight: 600,
        }}>
          {notFoundCount} not found
        </span>
      )}
    </span>
  );
}

function AcValidationPanel({ acValidation, theme }: { acValidation: AcValidationData; theme: OttoTheme }) {
  const statusConfig: Record<AcValidationStatus, { icon: string; color: string; bg: string }> = {
    satisfied: {
      icon: '\u2713',
      color: theme.isDark ? '#4ade80' : '#16a34a',
      bg: theme.isDark ? '#064e3b' : '#f0fdf4',
    },
    unclear: {
      icon: '?',
      color: theme.isDark ? '#fbbf24' : '#d97706',
      bg: theme.isDark ? '#451a03' : '#fffbeb',
    },
    'not-found': {
      icon: '\u2717',
      color: theme.isDark ? '#fca5a5' : '#dc2626',
      bg: theme.isDark ? '#450a0a' : '#fef2f2',
    },
  };

  return (
    <div style={{ marginTop: '8px', fontSize: '12px' }}>
      {acValidation.results.map((result) => (
        <div key={result.ticketKey}>
          {acValidation.results.length > 1 && (
            <div style={{
              fontSize: '11px', fontWeight: 600, color: theme.textSecondary,
              marginBottom: '4px', marginTop: '4px',
            }}>
              {result.ticketKey}
            </div>
          )}
          {result.criteria.map((criterion, i) => {
            const config = statusConfig[criterion.status];
            return (
              <div key={i} style={{
                padding: '6px 8px',
                marginBottom: '4px',
                background: config.bg,
                borderRadius: '4px',
                borderLeft: `3px solid ${config.color}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                  <span style={{
                    fontWeight: 700, color: config.color, fontSize: '13px',
                    lineHeight: '1.4', flexShrink: 0, width: '14px', textAlign: 'center',
                  }}>
                    {config.icon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, color: theme.text, lineHeight: '1.4' }}>
                      {criterion.criterion}
                    </div>
                    <div style={{ color: theme.textSecondary, marginTop: '2px', fontSize: '11px' }}>
                      <Markdown content={criterion.explanation} compact />
                    </div>
                    {criterion.evidence.length > 0 && (
                      <div style={{ marginTop: '3px', fontSize: '11px', color: theme.textMuted }}>
                        {criterion.evidence.map((e, j) => (
                          <span key={j} style={{ fontFamily: 'monospace' }}>
                            {j > 0 && ', '}
                            {e.filePath.split('/').pop()}
                            {e.startLine ? `:${e.startLine}` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{
            fontSize: '11px', color: theme.textMuted, marginTop: '4px',
            fontStyle: 'italic',
          }}>
            {result.summary}
          </div>
        </div>
      ))}
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
      display: 'inline-flex',
      alignItems: 'center',
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

    retryButton: {
      padding: '3px 10px',
      borderRadius: '4px',
      background: t.btnSecondaryBg,
      color: t.btnSecondaryText,
      border: `1px solid ${t.btnSecondaryBorder}`,
      fontSize: '11px',
      fontWeight: 500,
      cursor: 'pointer',
      flexShrink: 0,
    } as React.CSSProperties,
  };
}
