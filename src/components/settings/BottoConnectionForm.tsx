// ---------------------------------------------------------------------------
// Settings: Botto Connection Form
//
// Configures the connection to a Botto server. Includes:
//   - Server URL input + connection test
//   - API key input
//   - Enable/disable toggle
//   - Server capabilities display (sandbox, shared triage, etc.)
//   - Auto-discovery from GitLab integration
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';
import type { OttoSettings, BottoConfig } from '@/types/settings';
import {
  formSectionStyle,
  sectionTitleStyle,
  descriptionStyle,
  fieldStyle,
  labelStyle,
  inputStyle,
  testButtonStyle,
} from './AiProviderForm';

type BottoConnectionFormProps = {
  settings: OttoSettings;
  onUpdate: (settings: OttoSettings) => Promise<void>;
};

type TestState = 'idle' | 'testing' | 'success' | 'error';

type ServerInfo = {
  version: string;
  capabilities: {
    sandbox: boolean;
    shared_triage: boolean;
    review_queue: boolean;
    webhooks: boolean;
  };
};

export function BottoConnectionForm({ settings, onUpdate }: BottoConnectionFormProps) {
  const botto = settings.botto ?? { enabled: false, serverUrl: '', apiKey: '' };
  const [serverUrl, setServerUrl] = useState(botto.serverUrl);
  const [apiKey, setApiKey] = useState(botto.apiKey);
  const [enabled, setEnabled] = useState(botto.enabled);
  const [testState, setTestState] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);

  const handleSave = useCallback(async () => {
    const newBotto: BottoConfig = {
      enabled,
      serverUrl: serverUrl.replace(/\/+$/, ''),
      apiKey,
    };
    await onUpdate({ ...settings, botto: newBotto });
  }, [settings, onUpdate, enabled, serverUrl, apiKey]);

  const handleTest = useCallback(async () => {
    if (!serverUrl) return;

    setTestState('testing');
    setTestMessage('connecting...');
    setServerInfo(null);

    try {
      // Convert ws:// to http:// for the discovery endpoint
      const httpUrl = serverUrl
        .replace(/^wss:\/\//, 'https://')
        .replace(/^ws:\/\//, 'http://')
        .replace(/\/ws\/?$/, '');

      const resp = await fetch(`${httpUrl}/.well-known/botto`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data = await resp.json();
      setServerInfo({
        version: data.version,
        capabilities: data.capabilities,
      });
      setTestState('success');
      setTestMessage(`Connected to Botto v${data.version}`);

      // Auto-fill WebSocket URL if we got one from discovery
      if (data.ws && !serverUrl.startsWith('ws')) {
        setServerUrl(data.ws);
      }
    } catch (e) {
      setTestState('error');
      setTestMessage(e instanceof Error ? e.message : 'connection failed');
    }
  }, [serverUrl]);

  const handleDiscover = useCallback(async () => {
    // Try to discover Botto from the first GitLab host
    const host = settings.gitlab.hosts[0];
    if (!host) {
      setTestMessage('Add a GitLab host first');
      setTestState('error');
      return;
    }

    setTestState('testing');
    setTestMessage('checking GitLab for Botto integration...');

    try {
      const resp = await fetch(`${host.url}/.well-known/botto`, {
        signal: AbortSignal.timeout(5000),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.ws) {
          setServerUrl(data.ws);
          setTestState('success');
          setTestMessage(`Discovered Botto at ${data.ws}`);
          return;
        }
      }

      setTestState('error');
      setTestMessage('No Botto integration found on this GitLab instance');
    } catch {
      setTestState('error');
      setTestMessage('Discovery failed — enter the server URL manually');
    }
  }, [settings.gitlab.hosts]);

  const statusColor = testState === 'success' ? '#22c55e' : testState === 'error' ? '#ef4444' : '#888';

  return (
    <div style={formSectionStyle}>
      <h3 style={sectionTitleStyle}>Botto Server</h3>
      <p style={descriptionStyle}>
        Connect to a Botto server to share reviews across your team.
        All AI calls, caching, and review data are centralized through Botto.
      </p>

      <div style={fieldStyle}>
        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              // Auto-save on toggle
              const newBotto: BottoConfig = {
                enabled: e.target.checked,
                serverUrl: serverUrl.replace(/\/+$/, ''),
                apiKey,
              };
              onUpdate({ ...settings, botto: newBotto });
            }}
            style={{ marginRight: 8 }}
          />
          Enable Botto
        </label>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Server URL</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="wss://botto.example.com/ws"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={handleTest} style={testButtonStyle} disabled={!serverUrl}>
            Test
          </button>
          {settings.gitlab.hosts.length > 0 && (
            <button onClick={handleDiscover} style={testButtonStyle}>
              Discover
            </button>
          )}
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="shared team secret"
          style={inputStyle}
        />
      </div>

      {testMessage && (
        <p style={{ color: statusColor, fontSize: 13, margin: '8px 0' }}>
          {testMessage}
        </p>
      )}

      {serverInfo && (
        <div style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 6,
          background: 'var(--otto-bg-secondary, #f5f5f5)',
          fontSize: 13,
        }}>
          <strong>Server Capabilities</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            <li>Sandbox (auto-fix): {serverInfo.capabilities.sandbox ? '✓ enabled' : '✗ disabled'}</li>
            <li>Shared triage: {serverInfo.capabilities.shared_triage ? '✓ available' : '✗ unavailable'}</li>
            <li>Review queue: {serverInfo.capabilities.review_queue ? '✓ enabled' : '✗ disabled'}</li>
            <li>Webhooks: {serverInfo.capabilities.webhooks ? '✓ configured' : '✗ not configured'}</li>
          </ul>
        </div>
      )}

      <button
        onClick={handleSave}
        style={{
          ...testButtonStyle,
          marginTop: 12,
          background: '#6366f1',
          color: '#fff',
          border: 'none',
        }}
      >
        Save
      </button>
    </div>
  );
}
