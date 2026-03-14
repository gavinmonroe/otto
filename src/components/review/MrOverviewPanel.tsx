// ---------------------------------------------------------------------------
// MrOverviewPanel — the main Otto banner injected above the diff file list.
//
// Uses ThemeContext for dark/light mode support. All colors come from
// useTheme() so they adapt automatically when GitLab is in dark mode.
// ---------------------------------------------------------------------------

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Settings, RefreshCw, Play, List, Presentation } from 'lucide-react';
import { useReview } from '@/hooks/use-review';
import { useReviewStore } from '@/services/review/review-store';
import { useGitLabContext } from '@/hooks/use-gitlab-context';
import { useSettings } from '@/hooks/use-settings';
import { useTheme } from '@/components/ThemeContext';
import { sendMessage } from '@/lib/messaging';
import { OttoLogo } from '@/components/OttoLogo';
import { OttoLogoAnimated } from '@/components/OttoLogoAnimated';
import { Markdown } from '@/components/Markdown';
import { RelatedFilesPanel } from './RelatedFilesPanel';
import { EdgeCaseAnalysis } from './EdgeCaseAnalysis';
import { TrustBadge } from './TrustBadge';
import { BehavioralDeltaPanel } from './BehavioralDeltaPanel';
import { AdversarialTestsPanel } from './AdversarialTestsPanel';
import { ContractsPanel } from './ContractsPanel';
import { GuidedReviewPanel } from '@/components/guided-review/GuidedReviewPanel';
import type { ToggleableFeature, ReviewMode } from '@/types/settings';
import type { ReviewTask } from '@/services/review/review-types';

export function MrOverviewPanel() {
  const review = useReview();
  const { context: gitlabContext, loading: contextLoading } = useGitLabContext();
  const { settings, loading: settingsLoading } = useSettings();
  const theme = useTheme();
  const [showRelated, setShowRelated] = useState(false);
  const [showEdgeCases, setShowEdgeCases] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showAcValidation, setShowAcValidation] = useState(true); // Open by default — high value
  const [showBehavioralDelta, setShowBehavioralDelta] = useState(true); // Open by default — high value
  const [showAdversarialTests, setShowAdversarialTests] = useState(false);
  const [showContracts, setShowContracts] = useState(false);

  // Review mode — persisted in settings, with local override for instant toggle
  const [modeOverride, setModeOverride] = useState<ReviewMode | null>(null);
  const reviewMode: ReviewMode = modeOverride ?? settings.preferences.reviewMode ?? 'default';

  const handleToggleMode = useCallback((mode: ReviewMode) => {
    setModeOverride(mode);
    // Persist to settings in the background — don't block the UI
    const updated = {
      ...settings,
      preferences: { ...settings.preferences, reviewMode: mode },
    };
    sendMessage({ type: 'SAVE_SETTINGS', payload: updated });
  }, [settings]);

  // Collapse/expand GitLab's diff list based on review mode
  useEffect(() => {
    const isGuidedActive = reviewMode === 'guided' && review.status === 'complete';
    // Find all direct children of .diff-files-holder except our own container
    const holder = document.querySelector('.diff-files-holder');
    if (!holder) return;

    const children = holder.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as HTMLElement;
      // Skip our own injected elements — WXT creates a custom element
      // named <otto-overview> as the shadow host (from name: 'otto-overview')
      const tag = child.tagName.toLowerCase();
      if (tag === 'otto-overview' || tag === 'otto-chat') continue;

      if (isGuidedActive) {
        child.dataset.ottoCollapsed = child.style.display || '';
        child.style.display = 'none';
      } else if (child.dataset.ottoCollapsed !== undefined) {
        child.style.display = child.dataset.ottoCollapsed;
        delete child.dataset.ottoCollapsed;
      }
    }

    // Cleanup: restore on unmount
    return () => {
      if (!holder) return;
      const children = holder.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i] as HTMLElement;
        if (child.dataset.ottoCollapsed !== undefined) {
          child.style.display = child.dataset.ottoCollapsed;
          delete child.dataset.ottoCollapsed;
        }
      }
    };
  }, [reviewMode, review.status]);

  const handleStartReview = useCallback(() => {
    const enabled = settings.preferences.enabledFeatures;
    const allTasks: ReviewTask[] = ['summary', 'codeReview', 'edgeCases'];
    if (gitlabContext?.isConfigured) {
      allTasks.push('relatedFiles');
    }
    // Include verification tasks if enabled
    if (enabled.adversarialTests) allTasks.push('adversarialTests');
    if (enabled.contracts) allTasks.push('contracts');
    if (enabled.behavioralDelta) allTasks.push('behavioralDelta');
    // Filter to only enabled features (core review tasks use !== false for backwards compat)
    const tasks = allTasks.filter((t) => enabled[t as keyof typeof enabled] !== false);
    if (tasks.length === 0) return;
    review.startReview(tasks);
  }, [review, gitlabContext, settings]);

  const handleRegenerate = useCallback(() => {
    const enabled = settings.preferences.enabledFeatures;
    const allTasks: ReviewTask[] = ['summary', 'codeReview', 'edgeCases'];
    if (gitlabContext?.isConfigured) {
      allTasks.push('relatedFiles');
    }
    if (enabled.adversarialTests) allTasks.push('adversarialTests');
    if (enabled.contracts) allTasks.push('contracts');
    if (enabled.behavioralDelta) allTasks.push('behavioralDelta');
    const tasks = allTasks.filter((t) => enabled[t as keyof typeof enabled] !== false);
    if (tasks.length === 0) return;
    review.regenerateReview(tasks);
  }, [review, gitlabContext, settings]);

  /** Run a single disabled feature on-demand without resetting existing results. */
  const handleRunFeature = useCallback((feature: ToggleableFeature) => {
    // These are all valid ReviewTask types that can be run ad-hoc
    const runnableFeatures: ReviewTask[] = [
      'summary', 'codeReview', 'edgeCases', 'relatedFiles',
      'adversarialTests', 'contracts', 'behavioralDelta',
    ];
    if (runnableFeatures.includes(feature as ReviewTask)) {
      const currentStatus = useReviewStore.getState().status;
      if (currentStatus === 'idle') {
        review.startReview([feature as ReviewTask]);
      } else {
        review.retryTasks([feature as ReviewTask]);
      }
    }
    // acValidation can't be triggered ad-hoc — it runs automatically when
    // tickets with AC exist during a review. The disabled row is informational.
  }, [review]);

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
  const enabled = settings.preferences.enabledFeatures;

  if (isLoading) {
    return (
      <div style={s.panel}>
        <div style={s.header}>
          <OttoLogoAnimated size={20} />
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
          {isComplete ? <OttoLogo size={20} /> : <OttoLogoAnimated size={20} />}
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
          {/* Mode toggle — only when review is complete */}
          {isComplete && (
            <div style={{
              display: 'inline-flex',
              borderRadius: '6px',
              border: `1px solid ${theme.borderSubtle}`,
              overflow: 'hidden',
            }}>
              <button
                onClick={() => handleToggleMode('default')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  background: reviewMode === 'default'
                    ? (theme.isDark ? '#1e3a5f' : '#eff6ff')
                    : 'transparent',
                  color: reviewMode === 'default' ? theme.brand : theme.textMuted,
                }}
                title="Standard diff view"
              >
                <List size={12} />
                Default
              </button>
              <button
                onClick={() => handleToggleMode('guided')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: 500,
                  border: 'none',
                  borderLeft: `1px solid ${theme.borderSubtle}`,
                  cursor: 'pointer',
                  background: reviewMode === 'guided'
                    ? (theme.isDark ? '#1e3a5f' : '#eff6ff')
                    : 'transparent',
                  color: reviewMode === 'guided' ? theme.brand : theme.textMuted,
                }}
                title="Guided slide-by-slide review"
              >
                <Presentation size={12} />
                Guided
              </button>
            </div>
          )}
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
            <ProgressItem label="Tests" status={review.progress.adversarialTests.status} theme={theme} />
            <ProgressItem label="Contracts" status={review.progress.contracts.status} theme={theme} />
            <ProgressItem label="Behavior" status={review.progress.behavioralDelta.status} theme={theme} />
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
      {(review.summaryDelta || review.summary || review.progress.summary.status === 'error') && (
        <div style={s.section}>
          <div style={s.sectionHeader}>Summary</div>
          {review.progress.summary.status === 'error' && !review.summary && (
            <div style={{ fontSize: '12px', color: theme.error, padding: '6px 8px', background: theme.errorBg, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{review.progress.summary.error || 'Summary generation failed.'}</span>
              <button onClick={() => review.retryTasks(['summary'])} style={s.retryButton}>Retry</button>
            </div>
          )}
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

      {/* Code Review error/retry — shown when file reviews fail */}
      {review.progress.codeReview.status === 'error' && review.fileReviews.length === 0 && (
        <div style={s.section}>
          <div style={{ fontSize: '12px', color: theme.error, padding: '6px 8px', background: theme.errorBg, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{review.progress.codeReview.error || 'File reviews failed.'}</span>
            <button onClick={() => review.retryTasks(['codeReview'])} style={s.retryButton}>Retry</button>
          </div>
        </div>
      )}

      {/* Linked Tickets */}
      {(reviewMode === 'default' || !isComplete) && review.ticketKeys.length > 0 && review.ticketContext && (
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
      {(reviewMode === 'default' || !isComplete) && review.acValidation && review.acValidation.results.length > 0 && (
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
      {(reviewMode === 'default' || !isComplete) && review.fileActivity && review.fileActivity.fileActivities.length > 0 && (
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
      {(reviewMode === 'default' || !isComplete) && (review.relatedFiles.length > 0 || review.progress.relatedFiles?.status === 'error') && (
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
      {(reviewMode === 'default' || !isComplete) && (review.edgeCases.length > 0 || review.edgeCasesDelta || review.progress.edgeCases.status === 'error') && (
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

      {/* Disabled feature placeholders — shown when a feature is turned off
           in settings but the review is idle or complete. Clicking runs it ad-hoc. */}
      {(reviewMode === 'default' || !isComplete) && (isIdle || isComplete) && (
        <>
          {enabled.summary === false && !review.summary && (
            <DisabledFeatureRow label="Summary" feature="summary" onRun={handleRunFeature} theme={theme} />
          )}
          {enabled.codeReview === false && review.fileReviews.length === 0 && (
            <DisabledFeatureRow label="Code Review" feature="codeReview" onRun={handleRunFeature} theme={theme} />
          )}
          {enabled.edgeCases === false && review.edgeCases.length === 0 && (
            <DisabledFeatureRow label="Edge Cases" feature="edgeCases" onRun={handleRunFeature} theme={theme} />
          )}
          {enabled.relatedFiles === false && review.relatedFiles.length === 0 && (
            <DisabledFeatureRow label="Related Files" feature="relatedFiles" onRun={handleRunFeature} theme={theme} />
          )}
          {enabled.acValidation === false && !review.acValidation && (
            <DisabledFeatureRow label="AC Validation" feature="acValidation" onRun={handleRunFeature} theme={theme} />
          )}
          {enabled.adversarialTests === false && !review.verification.adversarialTests && (
            <DisabledFeatureRow label="Stress Tests" feature="adversarialTests" onRun={handleRunFeature} theme={theme} />
          )}
          {enabled.contracts === false && !review.verification.contracts && (
            <DisabledFeatureRow label="Contracts" feature="contracts" onRun={handleRunFeature} theme={theme} />
          )}
          {enabled.behavioralDelta === false && !review.verification.behavioralDelta && (
            <DisabledFeatureRow label="Behavioral Delta" feature="behavioralDelta" onRun={handleRunFeature} theme={theme} />
          )}
        </>
      )}

      {/* Verification Trust Assessment — cross-cutting, shown above all verification sections */}
      {(reviewMode === 'default' || !isComplete) && review.verification.trust && (
        <div style={s.section}>
          <TrustBadge trust={review.verification.trust} />
        </div>
      )}

      {/* Behavioral Delta (collapsible) — shows first among verification, highest reviewer value */}
      {(reviewMode === 'default' || !isComplete) && (review.verification.behavioralDelta || review.behavioralDeltaDelta || review.progress.behavioralDelta.status === 'error') && (
        <div style={s.section}>
          <button onClick={() => setShowBehavioralDelta(!showBehavioralDelta)} style={s.collapsibleHeader}>
            <span>
              {showBehavioralDelta ? '▾' : '▸'} Behavioral Delta
              {review.verification.behavioralDelta
                ? ` (${review.verification.behavioralDelta.changed.length} changed, ${review.verification.behavioralDelta.preserved.length} preserved${review.verification.behavioralDelta.unexpected.length > 0 ? `, ${review.verification.behavioralDelta.unexpected.length} unexpected` : ''})`
                : review.progress.behavioralDelta.status === 'error'
                  ? ' (failed)'
                  : review.behavioralDeltaDelta ? ' (analyzing...)' : ''}
            </span>
          </button>
          {showBehavioralDelta && review.verification.behavioralDelta && (
            <BehavioralDeltaPanel data={review.verification.behavioralDelta} />
          )}
          {showBehavioralDelta && review.progress.behavioralDelta.status === 'error' && review.progress.behavioralDelta.error && (
            <div style={{ fontSize: '12px', color: theme.error, marginTop: '6px', padding: '6px 8px', background: theme.errorBg, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{review.progress.behavioralDelta.error}</span>
              <button onClick={() => review.retryTasks(['behavioralDelta'])} style={s.retryButton}>Retry</button>
            </div>
          )}
          {showBehavioralDelta && !review.verification.behavioralDelta && review.behavioralDeltaDelta && (
            <div style={{ fontSize: '13px', marginTop: '8px', whiteSpace: 'pre-wrap' }}>
              <Markdown content={review.behavioralDeltaDelta} compact />
              <span style={{ color: theme.brand }}>|</span>
            </div>
          )}
        </div>
      )}

      {/* Adversarial Tests (collapsible) */}
      {(reviewMode === 'default' || !isComplete) && (review.verification.adversarialTests || review.adversarialTestsDelta || review.progress.adversarialTests.status === 'error') && (
        <div style={s.section}>
          <button onClick={() => setShowAdversarialTests(!showAdversarialTests)} style={s.collapsibleHeader}>
            <span>
              {showAdversarialTests ? '▾' : '▸'} Stress Tests
              {review.verification.adversarialTests
                ? ` (${review.verification.adversarialTests.totalTests} tests)`
                : review.progress.adversarialTests.status === 'error'
                  ? ' (failed)'
                  : review.adversarialTestsDelta ? ' (generating...)' : ''}
            </span>
          </button>
          {showAdversarialTests && review.verification.adversarialTests && (
            <AdversarialTestsPanel data={review.verification.adversarialTests} trust={review.verification.trust} />
          )}
          {showAdversarialTests && review.progress.adversarialTests.status === 'error' && review.progress.adversarialTests.error && (
            <div style={{ fontSize: '12px', color: theme.error, marginTop: '6px', padding: '6px 8px', background: theme.errorBg, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{review.progress.adversarialTests.error}</span>
              <button onClick={() => review.retryTasks(['adversarialTests'])} style={s.retryButton}>Retry</button>
            </div>
          )}
          {showAdversarialTests && !review.verification.adversarialTests && review.adversarialTestsDelta && (
            <div style={{ fontSize: '13px', marginTop: '8px', whiteSpace: 'pre-wrap' }}>
              <Markdown content={review.adversarialTestsDelta} compact />
              <span style={{ color: theme.brand }}>|</span>
            </div>
          )}
        </div>
      )}

      {/* Contracts (collapsible) */}
      {(reviewMode === 'default' || !isComplete) && (review.verification.contracts || review.contractsDelta || review.progress.contracts.status === 'error') && (
        <div style={s.section}>
          <button onClick={() => setShowContracts(!showContracts)} style={s.collapsibleHeader}>
            <span>
              {showContracts ? '▾' : '▸'} Inferred Contracts
              {review.verification.contracts
                ? ` (${review.verification.contracts.contracts.length} functions)`
                : review.progress.contracts.status === 'error'
                  ? ' (failed)'
                  : review.contractsDelta ? ' (inferring...)' : ''}
            </span>
          </button>
          {showContracts && review.verification.contracts && (
            <ContractsPanel data={review.verification.contracts} />
          )}
          {showContracts && review.progress.contracts.status === 'error' && review.progress.contracts.error && (
            <div style={{ fontSize: '12px', color: theme.error, marginTop: '6px', padding: '6px 8px', background: theme.errorBg, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{review.progress.contracts.error}</span>
              <button onClick={() => review.retryTasks(['contracts'])} style={s.retryButton}>Retry</button>
            </div>
          )}
          {showContracts && !review.verification.contracts && review.contractsDelta && (
            <div style={{ fontSize: '13px', marginTop: '8px', whiteSpace: 'pre-wrap' }}>
              <Markdown content={review.contractsDelta} compact />
              <span style={{ color: theme.brand }}>|</span>
            </div>
          )}
        </div>
      )}

      {/* Guided Review Panel — replaces collapsible sections when in guided mode */}
      {reviewMode === 'guided' && isComplete && (
        <GuidedReviewPanel
          hostId={gitlabContext?.host?.id ?? null}
          projectId={review.mrContext?.projectId ?? null}
          mrIid={review.mrContext?.mrIid ?? 0}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

import type { OttoTheme } from '@/components/ThemeContext';
import type { FileActivityData, AcValidationData, AcValidationStatus } from '@/types/review';

/**
 * Disabled feature row — shows when a feature is turned off in settings.
 * Clicking the row runs the feature ad-hoc without changing settings.
 */
function DisabledFeatureRow({
  label,
  feature,
  onRun,
  theme,
}: {
  label: string;
  feature: ToggleableFeature;
  onRun: (feature: ToggleableFeature) => void;
  theme: OttoTheme;
}) {
  return (
    <div style={{
      padding: '8px 14px',
      borderBottom: `1px solid ${theme.borderSubtle}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          fontSize: '12px',
          fontWeight: 600,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.05em',
          color: theme.textMuted,
        }}>
          {label}
        </span>
        <span style={{
          fontSize: '10px',
          padding: '1px 5px',
          borderRadius: '3px',
          background: theme.bgMuted,
          color: theme.textMuted,
          fontWeight: 500,
        }}>
          off
        </span>
      </div>
      <button
        onClick={() => onRun(feature)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px 8px',
          borderRadius: '4px',
          background: 'transparent',
          color: theme.brand,
          border: `1px solid ${theme.borderSubtle}`,
          fontSize: '11px',
          fontWeight: 500,
          cursor: 'pointer',
        }}
        title={`Run ${label} once (feature is disabled in settings)`}
      >
        <Play size={10} />
        Run
      </button>
    </div>
  );
}

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
