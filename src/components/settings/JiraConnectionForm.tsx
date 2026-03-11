// ---------------------------------------------------------------------------
// Settings: Jira Connection Form
//
// Manages Jira ticket provider configurations. Each provider has a base URL,
// email, API token, and optional project prefix filters.
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';
import type { OttoSettings } from '@/types/settings';
import type { TicketProvider } from '@/types/ticket';
import { sendMessage } from '@/lib/messaging';
import { generateId } from '@/lib/utils';
import {
  formSectionStyle,
  sectionTitleStyle,
  descriptionStyle,
  fieldStyle,
  labelStyle,
  inputStyle,
  hintStyle,
  testButtonStyle,
} from './AiProviderForm';

type JiraConnectionFormProps = {
  settings: OttoSettings;
  onUpdate: (settings: OttoSettings) => Promise<void>;
};

export function JiraConnectionForm({ settings, onUpdate }: JiraConnectionFormProps) {
  const providers = settings.tickets?.providers ?? [];
  const [editing, setEditing] = useState<TicketProvider | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
  const [testMessages, setTestMessages] = useState<Record<string, string>>({});
  const [prefixInput, setPrefixInput] = useState('');

  const handleAdd = useCallback(() => {
    const newProvider: TicketProvider = {
      id: generateId(),
      type: 'jira',
      label: '',
      baseUrl: '',
      email: '',
      apiToken: '',
      projectPrefixes: [],
    };
    setEditing(newProvider);
    setPrefixInput('');
  }, []);

  const handleSave = useCallback(async () => {
    if (!editing) return;
    if (!editing.baseUrl || !editing.email || !editing.apiToken) return;

    const normalized = {
      ...editing,
      baseUrl: editing.baseUrl.replace(/\/+$/, ''),
      projectPrefixes: prefixInput
        .split(',')
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean),
    };

    if (!normalized.label) {
      try {
        normalized.label = new URL(normalized.baseUrl).hostname;
      } catch {
        normalized.label = normalized.baseUrl;
      }
    }

    const existingIndex = providers.findIndex((p) => p.id === normalized.id);
    const newProviders = [...providers];
    if (existingIndex >= 0) {
      newProviders[existingIndex] = normalized;
    } else {
      newProviders.push(normalized);
    }

    await onUpdate({
      ...settings,
      tickets: { ...settings.tickets, providers: newProviders },
    });
    setEditing(null);
    setPrefixInput('');
  }, [editing, prefixInput, providers, settings, onUpdate]);

  const handleRemove = useCallback(async (id: string) => {
    const newProviders = providers.filter((p) => p.id !== id);
    await onUpdate({
      ...settings,
      tickets: { ...settings.tickets, providers: newProviders },
    });
  }, [providers, settings, onUpdate]);

  const handleTest = useCallback(async (provider: TicketProvider) => {
    setTestStatus((prev) => ({ ...prev, [provider.id]: 'testing' }));
    setTestMessages((prev) => ({ ...prev, [provider.id]: '' }));

    const result = await sendMessage({
      type: 'TEST_JIRA_CONNECTION',
      payload: { provider },
    });

    if (result.ok) {
      setTestStatus((prev) => ({ ...prev, [provider.id]: 'success' }));
      setTestMessages((prev) => ({ ...prev, [provider.id]: `Connected as ${result.data.displayName}` }));
    } else {
      setTestStatus((prev) => ({ ...prev, [provider.id]: 'error' }));
      setTestMessages((prev) => ({ ...prev, [provider.id]: result.error }));
    }
  }, []);

  const handleEdit = useCallback((provider: TicketProvider) => {
    setEditing({ ...provider });
    setPrefixInput(provider.projectPrefixes.join(', '));
  }, []);

  return (
    <div style={formSectionStyle}>
      <h3 style={sectionTitleStyle}>Jira Integration</h3>
      <p style={descriptionStyle}>
        Connect to Jira to automatically pull ticket context (title, description, acceptance criteria) into AI reviews.
        Otto detects ticket references in MR titles, descriptions, and branch names.
      </p>

      {/* Existing providers */}
      {providers.map((provider) => (
        <div key={provider.id} style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px' }}>{provider.label}</div>
              <div style={{ fontSize: '12px', color: '#6b7280', fontFamily: 'monospace' }}>{provider.baseUrl}</div>
              {provider.projectPrefixes.length > 0 && (
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                  Prefixes: {provider.projectPrefixes.join(', ')}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                onClick={() => handleTest(provider)}
                style={testButtonStyle}
                disabled={testStatus[provider.id] === 'testing'}
              >
                {testStatus[provider.id] === 'testing' ? 'Testing...' : 'Test'}
              </button>
              <button onClick={() => handleEdit(provider)} style={testButtonStyle}>
                Edit
              </button>
              <button
                onClick={() => handleRemove(provider.id)}
                style={{ ...testButtonStyle, color: '#dc2626', borderColor: '#fca5a5' }}
              >
                Remove
              </button>
            </div>
          </div>
          {testMessages[provider.id] && (
            <div style={{
              marginTop: '6px',
              fontSize: '12px',
              color: testStatus[provider.id] === 'success' ? '#16a34a' : '#dc2626',
            }}>
              {testMessages[provider.id]}
            </div>
          )}
        </div>
      ))}

      {/* Add/Edit form */}
      {editing ? (
        <div style={{ ...cardStyle, border: '1px solid #0c93e7' }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Jira URL</label>
            <input
              type="url"
              value={editing.baseUrl}
              onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
              placeholder="https://mycompany.atlassian.net"
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={editing.email}
              onChange={(e) => setEditing({ ...editing, email: e.target.value })}
              placeholder="you@company.com"
              style={inputStyle}
            />
            <span style={hintStyle}>The email associated with your Jira account</span>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>API Token</label>
            <input
              type="password"
              value={editing.apiToken}
              onChange={(e) => setEditing({ ...editing, apiToken: e.target.value })}
              placeholder="your-jira-api-token"
              style={inputStyle}
            />
            <span style={hintStyle}>
              Generate at id.atlassian.com/manage-profile/security/api-tokens
            </span>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Project Prefixes (optional)</label>
            <input
              type="text"
              value={prefixInput}
              onChange={(e) => setPrefixInput(e.target.value)}
              placeholder="ONCO, INFRA, TEAM"
              style={inputStyle}
            />
            <span style={hintStyle}>
              Comma-separated Jira project keys. Leave empty to match any PROJ-1234 pattern.
            </span>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Label (optional)</label>
            <input
              type="text"
              value={editing.label}
              onChange={(e) => setEditing({ ...editing, label: e.target.value })}
              placeholder="Work Jira"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} style={saveButtonStyle}>
              Save
            </button>
            <button onClick={() => { setEditing(null); setPrefixInput(''); }} style={testButtonStyle}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={handleAdd} style={addButtonStyle}>
          + Add Jira Connection
        </button>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: '12px',
  marginBottom: '8px',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  background: '#f9fafb',
};

const saveButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '6px',
  background: '#0c93e7',
  color: '#ffffff',
  border: 'none',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
};

const addButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '6px',
  background: '#f3f4f6',
  color: '#374151',
  border: '1px dashed #d1d5db',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  width: '100%',
};
