// ---------------------------------------------------------------------------
// Options Page — full settings UI for Otto.
//
// Accessible via chrome-extension://id/options.html or the popup's
// "Settings" link. Contains all configuration: AI provider, GitLab
// connections, and preferences.
//
// Supports dark mode via saved preference or system prefers-color-scheme.
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { OttoSettings } from '@/types/settings';
import { useSettings } from '@/hooks/use-settings';
import { AiProviderForm } from '@/components/settings/AiProviderForm';
import { CustomPromptsForm } from '@/components/settings/CustomPromptsForm';
import { GitLabConnectionForm } from '@/components/settings/GitLabConnectionForm';
import { JiraConnectionForm } from '@/components/settings/JiraConnectionForm';
import { ReviewerPreferencesForm } from '@/components/settings/ReviewerPreferencesForm';
import { FeatureTogglesForm } from '@/components/settings/FeatureTogglesForm';
import { BottoConnectionForm } from '@/components/settings/BottoConnectionForm';
import { BottoServerConfigForm } from '@/components/settings/BottoServerConfigForm';
import { BrandColorForm } from '@/components/settings/BrandColorForm';
import { OttoLogo } from '@/components/OttoLogo';
import { exportConfig, importConfig } from '@/lib/settings-io';
import { DEFAULT_HUE, generateOptionsTheme, getLogoColor } from '@/lib/palette';

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
  const brandHue = settings.preferences.brandHue ?? DEFAULT_HUE;
  const t = useMemo(() => getTheme(isDark, brandHue), [isDark, brandHue]);
  const logoColor = useMemo(() => getLogoColor(brandHue), [brandHue]);

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
        <OttoLogo size={32} brandColor={logoColor} />
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
        <BottoConnectionForm settings={settings} onUpdate={updateSettings} />
        <BottoServerConfigForm settings={settings} />
        <JiraConnectionForm settings={settings} onUpdate={updateSettings} />
        <ReviewerPreferencesForm settings={settings} />

        {/* Import / Export */}
        <ConfigPortSection settings={settings} onUpdate={updateSettings} theme={t} />

        {/* Brand Color */}
        <BrandColorForm settings={settings} onUpdate={updatePreferences} isDark={isDark} optionsTheme={t} />

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
// Import / Export Config
// ---------------------------------------------------------------------------

function ConfigPortSection({
  settings,
  onUpdate,
  theme: t,
}: {
  settings: OttoSettings;
  onUpdate: (updates: Partial<OttoSettings>) => Promise<void>;
  theme: OptionsTheme;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<
    | { type: 'idle' }
    | { type: 'success'; warnings: string[] }
    | { type: 'error'; message: string }
  >({ type: 'idle' });

  const handleExport = useCallback(() => {
    exportConfig(settings);
  }, [settings]);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset the input so the same file can be re-selected
    e.target.value = '';

    const result = await importConfig(file, settings);
    if (!result.ok) {
      setStatus({ type: 'error', message: result.error });
      return;
    }

    await onUpdate(result.settings);
    setStatus({ type: 'success', warnings: result.warnings });
  }, [settings, onUpdate]);

  return (
    <div style={{ ...sectionStyle, background: t.cardBg, borderColor: t.border }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600, color: t.text }}>
        Import / Export Config
      </h3>
      <p style={{ margin: '0 0 16px', fontSize: '13px', color: t.textMuted }}>
        Share your Otto configuration with your team. Secrets (API keys, PATs, tokens) are
        stripped on export and preserved on import.
      </p>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button onClick={handleExport} style={configButtonStyle(t)}>
          Export Config
        </button>
        <button onClick={() => fileInputRef.current?.click()} style={configButtonStyle(t)}>
          Import Config
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleImport}
          style={{ display: 'none' }}
        />
      </div>

      {status.type === 'success' && (
        <div style={{
          marginTop: '12px',
          padding: '10px 14px',
          background: isDarkTheme(t) ? '#052e16' : '#f0fdf4',
          color: isDarkTheme(t) ? '#86efac' : '#166534',
          border: `1px solid ${isDarkTheme(t) ? '#14532d' : '#bbf7d0'}`,
          borderRadius: '8px',
          fontSize: '13px',
        }}>
          <span>Config imported successfully.</span>
          {status.warnings.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: '18px' }}>
              {status.warnings.map((w, i) => (
                <li key={i} style={{ marginBottom: '2px' }}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {status.type === 'error' && (
        <div style={{
          marginTop: '12px',
          padding: '10px 14px',
          background: t.errorBg,
          color: t.error,
          border: `1px solid ${t.errorBorder}`,
          borderRadius: '8px',
          fontSize: '13px',
        }}>
          {status.message}
        </div>
      )}
    </div>
  );
}

function configButtonStyle(t: OptionsTheme): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: '6px',
    background: isDarkTheme(t) ? '#374151' : '#f3f4f6',
    color: t.text,
    border: `1px solid ${t.border}`,
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
  };
}

/** Quick check — the theme object doesn't carry an isDark flag, so infer from lightness. */
function isDarkTheme(t: OptionsTheme): boolean {
  // Dark themes have dark bg — check if it starts with a low-lightness hex
  // The generateOptionsTheme dark bg is always a dark color.
  return t.bg !== '#ffffff';
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

function getTheme(isDark: boolean, brandHue: number = DEFAULT_HUE): OptionsTheme {
  return generateOptionsTheme(brandHue, isDark);
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
