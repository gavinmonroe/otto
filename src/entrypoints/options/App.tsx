// ---------------------------------------------------------------------------
// Options Page — full settings UI for Otto.
//
// Accessible via chrome-extension://id/options.html or the popup's
// "Settings" link. Contains all configuration: AI provider, GitLab
// connections, and preferences.
//
// Supports dark mode via saved preference or system prefers-color-scheme.
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo } from 'react';
import { useSettings } from '@/hooks/use-settings';
import { AiProviderForm } from '@/components/settings/AiProviderForm';
import { CustomPromptsForm } from '@/components/settings/CustomPromptsForm';
import { GitLabConnectionForm } from '@/components/settings/GitLabConnectionForm';
import { JiraConnectionForm } from '@/components/settings/JiraConnectionForm';
import { ReviewerPreferencesForm } from '@/components/settings/ReviewerPreferencesForm';
import { FeatureTogglesForm } from '@/components/settings/FeatureTogglesForm';
import { OttoLogo } from '@/components/OttoLogo';

function useIsDark(themePref: 'light' | 'dark' | 'auto'): boolean {
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (themePref === 'dark') return true;
  if (themePref === 'light') return false;
  return systemDark;
}

export function App() {
  const { settings, loading, error, updateSettings, updateAiConfig, updatePreferences } = useSettings();
  const isDark = useIsDark(settings.preferences.theme);
  const t = useMemo(() => getTheme(isDark), [isDark]);

  useEffect(() => {
    document.body.style.background = t.bg;
    document.body.style.color = t.text;
  }, [t]);

  if (loading) {
    return (
      <div style={{ ...containerStyle, color: t.text }}>
        <div style={{ ...headerStyle, borderColor: t.border }}>
          <OttoLogo size={32} />
          <h1 style={{ fontSize: '20px', fontWeight: 600 }}>Otto Settings</h1>
        </div>
        <p style={{ padding: '20px', color: t.textMuted }}>Loading settings...</p>
      </div>
    );
  }

  return (
    <div style={{ ...containerStyle, color: t.text }}>
      <div style={{ ...headerStyle, borderColor: t.border }}>
        <OttoLogo size={32} />
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, margin: 0, color: t.text }}>Otto Settings</h1>
          <p style={{ fontSize: '13px', color: t.textMuted, margin: 0 }}>
            AI-powered code review for GitLab merge requests
          </p>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '10px 14px',
          marginBottom: '16px',
          background: t.errorBg,
          color: t.error,
          border: `1px solid ${t.errorBorder}`,
          borderRadius: '8px',
          fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      <div style={contentStyle}>
        <AiProviderForm settings={settings} onUpdate={updateAiConfig} />
        <CustomPromptsForm settings={settings} onUpdate={updateAiConfig} />
        <FeatureTogglesForm settings={settings} onUpdate={updatePreferences} />
        <GitLabConnectionForm settings={settings} onUpdate={updateSettings} />
        <JiraConnectionForm settings={settings} onUpdate={updateSettings} />
        <ReviewerPreferencesForm settings={settings} />

        {/* Preferences */}
        <div style={{ ...sectionStyle, background: t.cardBg, borderColor: t.border }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600, color: t.text }}>Preferences</h3>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: t.textMuted }}>
            Customize Otto's behavior.
          </p>

          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={settings.preferences.autoReview}
              onChange={(e) => updatePreferences({ autoReview: e.target.checked })}
              style={{ marginRight: '8px' }}
            />
            <span style={{ color: t.text }}>Auto-review when opening MR diffs</span>
          </label>

          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={settings.preferences.streamResponses}
              onChange={(e) => updatePreferences({ streamResponses: e.target.checked })}
              style={{ marginRight: '8px' }}
            />
            <span style={{ color: t.text }}>Stream AI responses in real-time</span>
          </label>

          <div style={{ marginTop: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500, color: t.text }}>
              Theme
            </label>
            <select
              value={settings.preferences.theme}
              onChange={(e) => updatePreferences({ theme: e.target.value as 'light' | 'dark' | 'auto' })}
              style={{
                padding: '6px 10px',
                fontSize: '13px',
                border: `1px solid ${t.border}`,
                borderRadius: '6px',
                background: t.inputBg,
                color: t.text,
              }}
            >
              <option value="auto">Auto (match system)</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>

        {/* About */}
        <div style={{ ...sectionStyle, background: t.subtleBg, borderColor: t.border }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 600, color: t.text }}>About Otto</h3>
          <p style={{ fontSize: '13px', color: t.textMuted, margin: 0 }}>
            Version 0.1.0 — AI-powered code review for GitLab MRs.
          </p>
          <p style={{ fontSize: '12px', color: t.textMuted, margin: '4px 0 0' }}>
            Otto connects to any OpenAI-compatible API endpoint and uses GitLab's REST API
            to provide intelligent code review suggestions directly in your merge request diff view.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

type OptionsTheme = {
  bg: string;
  text: string;
  textMuted: string;
  border: string;
  cardBg: string;
  subtleBg: string;
  inputBg: string;
  error: string;
  errorBg: string;
  errorBorder: string;
};

function getTheme(isDark: boolean): OptionsTheme {
  if (isDark) {
    return {
      bg: '#111827',
      text: '#f3f4f6',
      textMuted: '#9ca3af',
      border: '#374151',
      cardBg: '#1f2937',
      subtleBg: '#1a2332',
      inputBg: '#374151',
      error: '#fca5a5',
      errorBg: '#450a0a',
      errorBorder: '#7f1d1d',
    };
  }
  return {
    bg: '#ffffff',
    text: '#111827',
    textMuted: '#6b7280',
    border: '#e5e7eb',
    cardBg: '#ffffff',
    subtleBg: '#f9fafb',
    inputBg: '#ffffff',
    error: '#991b1b',
    errorBg: '#fef2f2',
    errorBorder: '#fecaca',
  };
}

// ---------------------------------------------------------------------------
// Layout styles (theme-independent)
// ---------------------------------------------------------------------------

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
  borderBottom: '1px solid',
};

const contentStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '24px',
  padding: '16px',
  border: '1px solid',
  borderRadius: '8px',
};

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  fontSize: '13px',
  marginBottom: '8px',
  cursor: 'pointer',
};
