// ---------------------------------------------------------------------------
// Settings: GitLab Connection Form
//
// Manages multiple GitLab host configurations (gitlab.com + self-hosted).
// Each host has a URL, PAT, and user-friendly label.
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';
import type { OttoSettings, GitLabHost } from '@/types/settings';
import { sendMessage } from '@/lib/messaging';
import { generateId } from '@/lib/utils';
import {
  formSectionStyle,
  sectionTitleStyle,
  descriptionStyle,
  fieldStyle,
  labelStyle,
  inputStyle,
  testButtonStyle,
} from './AiProviderForm';

type GitLabConnectionFormProps = {
  settings: OttoSettings;
  onUpdate: (settings: OttoSettings) => Promise<void>;
};

export function GitLabConnectionForm({ settings, onUpdate }: GitLabConnectionFormProps) {
  const [editingHost, setEditingHost] = useState<GitLabHost | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
  const [testMessages, setTestMessages] = useState<Record<string, string>>({});

  const handleAddHost = useCallback(() => {
    setEditingHost({
      id: generateId(),
      url: '',
      pat: '',
      label: '',
    });
  }, []);

  const handleSaveHost = useCallback(async () => {
    if (!editingHost) return;
    if (!editingHost.url || !editingHost.pat) return;

    // Normalize URL
    const normalizedUrl = editingHost.url.replace(/\/+$/, '');
    const host = { ...editingHost, url: normalizedUrl };

    // Auto-generate label if empty
    if (!host.label) {
      try {
        const urlObj = new URL(normalizedUrl);
        host.label = urlObj.hostname;
      } catch {
        host.label = normalizedUrl;
      }
    }

    const existingIndex = settings.gitlab.hosts.findIndex((h) => h.id === host.id);
    const newHosts = [...settings.gitlab.hosts];
    if (existingIndex >= 0) {
      newHosts[existingIndex] = host;
    } else {
      newHosts.push(host);
    }

    await onUpdate({
      ...settings,
      gitlab: { ...settings.gitlab, hosts: newHosts },
    });
    setEditingHost(null);
  }, [editingHost, settings, onUpdate]);

  const handleRemoveHost = useCallback(async (hostId: string) => {
    const newHosts = settings.gitlab.hosts.filter((h) => h.id !== hostId);
    await onUpdate({
      ...settings,
      gitlab: { ...settings.gitlab, hosts: newHosts },
    });
  }, [settings, onUpdate]);

  const handleTestHost = useCallback(async (host: GitLabHost) => {
    setTestStatus((prev) => ({ ...prev, [host.id]: 'testing' }));
    setTestMessages((prev) => ({ ...prev, [host.id]: '' }));

    const result = await sendMessage({
      type: 'TEST_GITLAB_CONNECTION',
      payload: { host },
    });

    if (result.ok) {
      setTestStatus((prev) => ({ ...prev, [host.id]: 'success' }));
      setTestMessages((prev) => ({ ...prev, [host.id]: `Connected as ${result.data.username}` }));
    } else {
      setTestStatus((prev) => ({ ...prev, [host.id]: 'error' }));
      setTestMessages((prev) => ({ ...prev, [host.id]: result.error }));
    }
  }, []);

  return (
    <div style={formSectionStyle}>
      <h3 style={sectionTitleStyle}>GitLab Connections</h3>
      <p style={descriptionStyle}>
        Add your GitLab instances. Otto needs a Personal Access Token with <code>read_api</code> scope to fetch repository context.
      </p>

      {/* Existing hosts */}
      {settings.gitlab.hosts.map((host) => (
        <div key={host.id} style={hostCardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px' }}>{host.label}</div>
              <div style={{ fontSize: '12px', color: '#6b7280', fontFamily: 'monospace' }}>{host.url}</div>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                onClick={() => handleTestHost(host)}
                style={testButtonStyle}
                disabled={testStatus[host.id] === 'testing'}
              >
                {testStatus[host.id] === 'testing' ? 'Testing...' : 'Test'}
              </button>
              <button
                onClick={() => setEditingHost({ ...host })}
                style={testButtonStyle}
              >
                Edit
              </button>
              <button
                onClick={() => handleRemoveHost(host.id)}
                style={{ ...testButtonStyle, color: '#dc2626', borderColor: '#fca5a5' }}
              >
                Remove
              </button>
            </div>
          </div>
          {testMessages[host.id] && (
            <div style={{
              marginTop: '6px',
              fontSize: '12px',
              color: testStatus[host.id] === 'success' ? '#16a34a' : '#dc2626',
            }}>
              {testMessages[host.id]}
            </div>
          )}
        </div>
      ))}

      {/* Add/Edit form */}
      {editingHost ? (
        <div style={{ ...hostCardStyle, border: '1px solid #0c93e7' }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>GitLab URL</label>
            <input
              type="url"
              value={editingHost.url}
              onChange={(e) => setEditingHost({ ...editingHost, url: e.target.value })}
              placeholder="https://gitlab.com"
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Personal Access Token</label>
            <input
              type="password"
              value={editingHost.pat}
              onChange={(e) => setEditingHost({ ...editingHost, pat: e.target.value })}
              placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
              style={inputStyle}
            />
            <span style={{ display: 'block', marginTop: '2px', fontSize: '11px', color: '#9ca3af' }}>
              Requires <code>read_api</code> scope at minimum
            </span>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Label (optional)</label>
            <input
              type="text"
              value={editingHost.label}
              onChange={(e) => setEditingHost({ ...editingHost, label: e.target.value })}
              placeholder="Work GitLab"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSaveHost} style={saveButtonStyle}>
              Save
            </button>
            <button onClick={() => setEditingHost(null)} style={testButtonStyle}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={handleAddHost} style={addButtonStyle}>
          + Add GitLab Host
        </button>
      )}
    </div>
  );
}

const hostCardStyle: React.CSSProperties = {
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
