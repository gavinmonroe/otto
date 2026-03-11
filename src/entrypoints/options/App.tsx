// ---------------------------------------------------------------------------
// Options Page — full settings UI for Otto.
//
// Accessible via chrome-extension://id/options.html or the popup's
// "Settings" link. Contains all configuration: AI provider, GitLab
// connections, and preferences.
// ---------------------------------------------------------------------------

import { useSettings } from '@/hooks/use-settings';
import { AiProviderForm } from '@/components/settings/AiProviderForm';
import { GitLabConnectionForm } from '@/components/settings/GitLabConnectionForm';
import { OttoLogo } from '@/components/OttoLogo';

export function App() {
  const { settings, loading, error, updateSettings, updateAiConfig, updatePreferences } = useSettings();

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>
          <OttoLogo size={32} />
          <h1 style={{ fontSize: '20px', fontWeight: 600 }}>Otto Settings</h1>
        </div>
        <p style={{ padding: '20px', color: '#6b7280' }}>Loading settings...</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <OttoLogo size={32} />
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, margin: 0 }}>Otto Settings</h1>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
            AI-powered code review for GitLab merge requests
          </p>
        </div>
      </div>

      {error && (
        <div style={errorBannerStyle}>{error}</div>
      )}

      <div style={contentStyle}>
        <AiProviderForm settings={settings} onUpdate={updateAiConfig} />
        <GitLabConnectionForm settings={settings} onUpdate={updateSettings} />

        {/* Preferences */}
        <div style={sectionStyle}>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>Preferences</h3>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#6b7280' }}>
            Customize Otto's behavior.
          </p>

          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={settings.preferences.autoReview}
              onChange={(e) => updatePreferences({ autoReview: e.target.checked })}
              style={{ marginRight: '8px' }}
            />
            Auto-review when opening MR diffs
          </label>

          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={settings.preferences.streamResponses}
              onChange={(e) => updatePreferences({ streamResponses: e.target.checked })}
              style={{ marginRight: '8px' }}
            />
            Stream AI responses in real-time
          </label>

          <div style={{ marginTop: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>
              Theme
            </label>
            <select
              value={settings.preferences.theme}
              onChange={(e) => updatePreferences({ theme: e.target.value as 'light' | 'dark' | 'auto' })}
              style={{
                padding: '6px 10px',
                fontSize: '13px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                background: '#ffffff',
              }}
            >
              <option value="auto">Auto (match GitLab)</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>

        {/* About */}
        <div style={{ ...sectionStyle, background: '#f9fafb' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 600 }}>About Otto</h3>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
            Version 0.1.0 — AI-powered code review for GitLab MRs.
          </p>
          <p style={{ fontSize: '12px', color: '#9ca3af', margin: '4px 0 0' }}>
            Otto connects to any OpenAI-compatible API endpoint and uses GitLab's REST API
            to provide intelligent code review suggestions directly in your merge request diff view.
          </p>
        </div>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  maxWidth: '720px',
  margin: '0 auto',
  padding: '20px',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '24px',
  paddingBottom: '16px',
  borderBottom: '1px solid #e5e7eb',
};

const contentStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '24px',
  padding: '16px',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  background: '#ffffff',
};

const errorBannerStyle: React.CSSProperties = {
  padding: '10px 14px',
  marginBottom: '16px',
  background: '#fef2f2',
  color: '#991b1b',
  border: '1px solid #fecaca',
  borderRadius: '8px',
  fontSize: '13px',
};

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  fontSize: '13px',
  marginBottom: '8px',
  cursor: 'pointer',
};
