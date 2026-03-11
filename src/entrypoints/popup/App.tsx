// ---------------------------------------------------------------------------
// Popup — compact status indicator + quick settings access.
//
// The popup is intentionally minimal. It shows:
// - Connection status (AI + GitLab)
// - Quick link to the full options page
// - Current page detection (are we on a GitLab MR?)
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { useSettings } from '@/hooks/use-settings';
import { OttoLogo } from '@/components/OttoLogo';

export function App() {
  const { settings, loading } = useSettings();
  const [currentTab, setCurrentTab] = useState<{ url: string; title: string } | null>(null);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        setCurrentTab({ url: tabs[0].url || '', title: tabs[0].title || '' });
      }
    });
  }, []);

  const isOnGitLabMr = currentTab?.url?.match(/\/-\/merge_requests\/\d+/) !== null;
  const isOnDiffs = currentTab?.url?.includes('/diffs') === true;
  const hasAiConfig = !!settings.ai.baseUrl;
  const hasGitLabConfig = settings.gitlab.hosts.length > 0;

  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <OttoLogo size={24} />
        <span style={{ fontWeight: 600, fontSize: '15px' }}>Otto</span>
      </div>

      {loading ? (
        <div style={bodyStyle}>
          <p style={{ color: '#9ca3af', fontSize: '13px' }}>Loading...</p>
        </div>
      ) : (
        <div style={bodyStyle}>
          {/* Status indicators */}
          <div style={statusRowStyle}>
            <StatusDot ok={hasAiConfig} />
            <span>AI Provider</span>
            <span style={statusValueStyle}>
              {hasAiConfig ? 'Configured' : 'Not set'}
            </span>
          </div>
          <div style={statusRowStyle}>
            <StatusDot ok={hasGitLabConfig} />
            <span>GitLab</span>
            <span style={statusValueStyle}>
              {hasGitLabConfig ? `${settings.gitlab.hosts.length} host(s)` : 'Not set'}
            </span>
          </div>

          {/* Current page */}
          <div style={{ ...statusRowStyle, borderBottom: 'none', paddingBottom: 0 }}>
            <StatusDot ok={isOnDiffs} warn={isOnGitLabMr && !isOnDiffs} />
            <span>Current page</span>
            <span style={statusValueStyle}>
              {isOnDiffs ? 'MR Diffs' : isOnGitLabMr ? 'GitLab MR' : 'Not an MR'}
            </span>
          </div>

          {/* Guidance */}
          {!hasAiConfig && (
            <div style={hintStyle}>
              Set up your AI provider to start reviewing.
            </div>
          )}
          {hasAiConfig && !hasGitLabConfig && (
            <div style={hintStyle}>
              Add a GitLab host for full repo context.
            </div>
          )}
          {hasAiConfig && isOnGitLabMr && !isOnDiffs && (
            <div style={hintStyle}>
              Navigate to the "Changes" tab to use Otto.
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={footerStyle}>
        <button onClick={handleOpenOptions} style={settingsButtonStyle}>
          Settings
        </button>
      </div>
    </div>
  );
}

function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  const color = ok ? '#16a34a' : warn ? '#d97706' : '#d1d5db';
  return (
    <div style={{
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
    }} />
  );
}

const containerStyle: React.CSSProperties = {
  width: '280px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: '13px',
  color: '#1f2937',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 14px',
  borderBottom: '1px solid #f3f4f6',
  background: '#f9fafb',
};

const bodyStyle: React.CSSProperties = {
  padding: '10px 14px',
};

const statusRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 0',
  borderBottom: '1px solid #f3f4f6',
  fontSize: '13px',
};

const statusValueStyle: React.CSSProperties = {
  marginLeft: 'auto',
  color: '#6b7280',
  fontSize: '12px',
};

const hintStyle: React.CSSProperties = {
  marginTop: '10px',
  padding: '8px',
  background: '#fffbeb',
  border: '1px solid #fef3c7',
  borderRadius: '6px',
  fontSize: '12px',
  color: '#92400e',
};

const footerStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderTop: '1px solid #f3f4f6',
  background: '#f9fafb',
};

const settingsButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 14px',
  borderRadius: '6px',
  background: '#0c93e7',
  color: '#ffffff',
  border: 'none',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
};
