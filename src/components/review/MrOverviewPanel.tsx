// ---------------------------------------------------------------------------
// MrOverviewPanel — the main Otto banner injected above the diff file list.
//
// Shows:
// - Review trigger button (or cancel button while reviewing)
// - MR summary (streaming or complete)
// - Overall progress indicators for each task
// - Related files panel (collapsible)
// - Edge case analysis panel (collapsible)
// - Settings shortcut (opens options page)
//
// Design decisions:
// - This is the primary entry point for the user. It should be immediately
//   visible and clearly branded as Otto.
// - The summary streams in real-time so the user sees progress immediately.
// - Task progress is shown as a compact status bar, not verbose logs.
// - Related files and edge cases are collapsible to avoid overwhelming
//   the user with information they may not need right now.
// - The "not configured" state is prominent and links to settings.
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';
import { Settings } from 'lucide-react';
import { useReview } from '@/hooks/use-review';
import { useGitLabContext } from '@/hooks/use-gitlab-context';
import { OttoLogo } from '@/components/OttoLogo';
import { RelatedFilesPanel } from './RelatedFilesPanel';
import { EdgeCaseAnalysis } from './EdgeCaseAnalysis';

export function MrOverviewPanel() {
  const review = useReview();
  const { context: gitlabContext, loading: contextLoading } = useGitLabContext();
  const [showRelated, setShowRelated] = useState(false);
  const [showEdgeCases, setShowEdgeCases] = useState(false);

  const handleStartReview = useCallback(() => {
    review.startReview(['summary', 'codeReview', 'edgeCases', 'relatedFiles']);
  }, [review]);

  const handleOpenSettings = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    // Fallback: open options page directly
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  }, []);

  const isIdle = review.status === 'idle';
  const isActive = review.status === 'loading' || review.status === 'streaming';
  const isComplete = review.status === 'complete';
  const hasError = review.status === 'error';

  // Not configured state
  if (!contextLoading && gitlabContext && !gitlabContext.isConfigured) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>
          <OttoLogo size={20} />
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Otto</span>
        </div>
        <div style={{ padding: '12px', fontSize: '13px', color: '#6b7280' }}>
          <p style={{ margin: '0 0 8px' }}>
            Otto needs a GitLab Personal Access Token to review this MR.
          </p>
          <button onClick={handleOpenSettings} style={linkButtonStyle}>
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <OttoLogo size={20} />
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Otto</span>
          {review.mrContext && (
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              {review.mrContext.diffFiles.length} files changed
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isIdle && (
            <button onClick={handleStartReview} style={primaryButtonStyle}>
              Review MR
            </button>
          )}
          {isActive && (
            <button onClick={review.cancelReview} style={secondaryButtonStyle}>
              Cancel
            </button>
          )}
          {isComplete && (
            <button onClick={handleStartReview} style={secondaryButtonStyle}>
              Re-review
            </button>
          )}
          <button onClick={handleOpenSettings} style={iconButtonStyle} title="Otto Settings">
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Error */}
      {hasError && review.error && (
        <div style={errorStyle}>
          {review.error}
        </div>
      )}

      {/* Progress bar */}
      {isActive && (
        <div style={progressBarStyle}>
          <ProgressItem label="Summary" status={review.progress.summary.status} />
          <ProgressItem
            label={`Files (${review.progress.codeReview.filesComplete}/${review.progress.codeReview.filesTotal})`}
            status={review.progress.codeReview.status}
          />
          <ProgressItem label="Edge Cases" status={review.progress.edgeCases.status} />
          <ProgressItem label="Related" status={review.progress.relatedFiles.status} />
        </div>
      )}

      {/* Summary */}
      {(review.summaryDelta || review.summary) && (
        <div style={sectionStyle}>
          <div style={sectionHeaderStyle}>Summary</div>
          {review.summary ? (
            <div>
              <p style={{ margin: '0 0 8px', fontSize: '13px' }}>{review.summary.overview}</p>
              <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#6b7280' }}>
                {review.summary.riskAssessment}
              </p>
              {review.summary.keyChanges.length > 0 && (
                <ul style={{ margin: '0', padding: '0 0 0 16px', fontSize: '12px' }}>
                  {review.summary.keyChanges.map((change, i) => (
                    <li key={i} style={{ marginBottom: '2px' }}>{change}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div style={{ fontSize: '13px', whiteSpace: 'pre-wrap' }}>
              {review.summaryDelta}
              <span style={cursorStyle}>|</span>
            </div>
          )}
        </div>
      )}

      {/* Related Files (collapsible) */}
      {review.relatedFiles.length > 0 && (
        <div style={sectionStyle}>
          <button
            onClick={() => setShowRelated(!showRelated)}
            style={collapsibleHeaderStyle}
          >
            <span>{showRelated ? '▾' : '▸'} Related Files ({review.relatedFiles.length})</span>
          </button>
          {showRelated && <RelatedFilesPanel files={review.relatedFiles} />}
        </div>
      )}

      {/* Edge Cases (collapsible) */}
      {review.edgeCases.length > 0 && (
        <div style={sectionStyle}>
          <button
            onClick={() => setShowEdgeCases(!showEdgeCases)}
            style={collapsibleHeaderStyle}
          >
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

function ProgressItem({ label, status }: { label: string; status: string }) {
  const color = status === 'complete' ? '#16a34a'
    : status === 'streaming' ? '#0c93e7'
    : status === 'error' ? '#dc2626'
    : status === 'loading' ? '#d97706'
    : '#9ca3af';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
      <div style={{
        width: '6px', height: '6px', borderRadius: '50%', background: color,
        animation: (status === 'loading' || status === 'streaming') ? 'otto-pulse 1.5s infinite' : 'none',
      }} />
      <span style={{ color }}>{label}</span>
    </div>
  );
}

// OttoLogo and Settings icon are imported from shared components / lucide-react

// ---------------------------------------------------------------------------
// Inline styles — used because this renders inside a shadow DOM where
// Tailwind classes from the main stylesheet may not be available for
// the overview panel's WXT shadow root mount.
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  margin: '0 0 16px',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  background: '#ffffff',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: '14px',
  color: '#1f2937',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderBottom: '1px solid #f3f4f6',
  background: '#f9fafb',
};

const sectionStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid #f3f4f6',
};

const sectionHeaderStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: '#6b7280',
  marginBottom: '6px',
};

const progressBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  padding: '6px 14px',
  background: '#f9fafb',
  borderBottom: '1px solid #f3f4f6',
};

const errorStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: '#fef2f2',
  color: '#991b1b',
  fontSize: '13px',
  borderBottom: '1px solid #fecaca',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '5px 14px',
  borderRadius: '6px',
  background: '#0c93e7',
  color: '#ffffff',
  border: 'none',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '5px 14px',
  borderRadius: '6px',
  background: '#f3f4f6',
  color: '#374151',
  border: '1px solid #e5e7eb',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
};

const iconButtonStyle: React.CSSProperties = {
  padding: '4px',
  borderRadius: '4px',
  background: 'transparent',
  border: 'none',
  color: '#6b7280',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
};

const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#0c93e7',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
  padding: 0,
  textDecoration: 'underline',
};

const collapsibleHeaderStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: '#6b7280',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  width: '100%',
};

const cursorStyle: React.CSSProperties = {
  animation: 'otto-blink 1s step-end infinite',
  color: '#0c93e7',
};
