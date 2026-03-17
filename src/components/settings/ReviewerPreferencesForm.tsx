// ---------------------------------------------------------------------------
// Settings: Reviewer Preferences Form
//
// Shows learned review preferences per GitLab host, allows reset,
// and manages per-repo custom facts.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback } from 'react';
import type { OttoSettings } from '@/types/settings';
import {
  loadPreferences,
  resetPreferences,
  setRepoFact,
  getPreferencesSummary,
  type ReviewerPreferences,
} from '@/services/review/reviewer-prefs';
import {
  formSectionStyle,
  sectionTitleStyle,
  descriptionStyle,
  fieldStyle,
  labelStyle,
  inputStyle,
  hintStyle,
} from './AiProviderForm';

type Props = {
  settings: OttoSettings;
};

export function ReviewerPreferencesForm({ settings }: Props) {
  const hosts = settings.gitlab.hosts;
  const [selectedHostUrl, setSelectedHostUrl] = useState<string>(hosts[0]?.url ?? '');
  const [prefs, setPrefs] = useState<ReviewerPreferences | null>(null);
  const [loading, setLoading] = useState(false);

  // Repo facts editing
  const [editingRepo, setEditingRepo] = useState<string | null>(null);
  const [newRepoPath, setNewRepoPath] = useState('');
  const [newRepoFacts, setNewRepoFacts] = useState('');

  const loadHostPrefs = useCallback(async (hostUrl: string) => {
    if (!hostUrl) return;
    setLoading(true);
    try {
      const p = await loadPreferences(hostUrl);
      setPrefs(p);
    } catch {
      setPrefs(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedHostUrl) loadHostPrefs(selectedHostUrl);
  }, [selectedHostUrl, loadHostPrefs]);

  // Auto-select first host
  useEffect(() => {
    if (!selectedHostUrl && hosts.length > 0) {
      setSelectedHostUrl(hosts[0].url);
    }
  }, [hosts, selectedHostUrl]);

  const handleReset = useCallback(async () => {
    if (!selectedHostUrl) return;
    if (!confirm('Reset all learned preferences for this host? This cannot be undone.')) return;
    await resetPreferences(selectedHostUrl);
    await loadHostPrefs(selectedHostUrl);
  }, [selectedHostUrl, loadHostPrefs]);

  const handleSaveRepoFact = useCallback(async (projectPath: string, facts: string) => {
    if (!selectedHostUrl) return;
    await setRepoFact(selectedHostUrl, projectPath, facts);
    await loadHostPrefs(selectedHostUrl);
    setEditingRepo(null);
  }, [selectedHostUrl, loadHostPrefs]);

  const handleAddRepoFact = useCallback(async () => {
    if (!selectedHostUrl || !newRepoPath.trim()) return;
    await setRepoFact(selectedHostUrl, newRepoPath.trim(), newRepoFacts.trim());
    await loadHostPrefs(selectedHostUrl);
    setNewRepoPath('');
    setNewRepoFacts('');
  }, [selectedHostUrl, newRepoPath, newRepoFacts, loadHostPrefs]);

  const handleDeleteRepoFact = useCallback(async (projectPath: string) => {
    if (!selectedHostUrl) return;
    await setRepoFact(selectedHostUrl, projectPath, '');
    await loadHostPrefs(selectedHostUrl);
  }, [selectedHostUrl, loadHostPrefs]);

  if (hosts.length === 0) {
    return (
      <div style={formSectionStyle}>
        <h3 style={sectionTitleStyle}>Reviewer Preferences</h3>
        <p style={descriptionStyle}>
          Configure a GitLab connection first. Preferences are learned per host.
        </p>
      </div>
    );
  }

  const summary = prefs ? getPreferencesSummary(prefs) : null;

  return (
    <div style={formSectionStyle}>
      <h3 style={sectionTitleStyle}>Reviewer Preferences</h3>
      <p style={descriptionStyle}>
        Otto learns from your accept/dismiss patterns and adapts its review style over time.
        You can also add custom context per repository.
      </p>

      {/* Host selector */}
      {hosts.length > 1 && (
        <div style={fieldStyle}>
          <label style={labelStyle}>GitLab Host</label>
          <select
            value={selectedHostUrl}
            onChange={(e) => setSelectedHostUrl(e.target.value)}
            style={inputStyle}
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.url}>{h.label || h.url}</option>
            ))}
          </select>
        </div>
      )}

      {loading && <p style={{ fontSize: '13px', color: '#6b7280' }}>Loading...</p>}

      {!loading && summary && (
        <>
          {/* Stats */}
          <div style={{
            display: 'flex',
            gap: '16px',
            marginBottom: '16px',
            padding: '10px 14px',
            background: '#f9fafb',
            borderRadius: '6px',
            fontSize: '13px',
          }}>
            <div>
              <span style={{ color: '#6b7280' }}>Reviews: </span>
              <span style={{ fontWeight: 600 }}>{summary.totalReviews}</span>
            </div>
            <div>
              <span style={{ color: '#6b7280' }}>Signals: </span>
              <span style={{ fontWeight: 600 }}>{summary.totalSignals}</span>
            </div>
          </div>

          {/* Learned preferences */}
          {(summary.highPriority.length > 0 || summary.lowPriority.length > 0) && (
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Learned Preferences</label>

              {summary.highPriority.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', color: '#059669', fontWeight: 500 }}>
                    High priority (you usually accept these):
                  </span>
                  {summary.highPriority.map((p) => (
                    <div key={p.label} style={{
                      fontSize: '12px',
                      padding: '3px 0',
                      color: '#374151',
                    }}>
                      {p.label} — accepted {Math.round(p.acceptRate * 100)}% ({p.total} reviews)
                    </div>
                  ))}
                </div>
              )}

              {summary.lowPriority.length > 0 && (
                <div>
                  <span style={{ fontSize: '12px', color: '#d97706', fontWeight: 500 }}>
                    Low priority (you usually dismiss these):
                  </span>
                  {summary.lowPriority.map((p) => (
                    <div key={p.label} style={{
                      fontSize: '12px',
                      padding: '3px 0',
                      color: '#374151',
                    }}>
                      {p.label} — dismissed {Math.round(p.dismissRate * 100)}% ({p.total} reviews)
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {summary.totalSignals === 0 && (
            <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '16px' }}>
              No preferences learned yet. Accept or dismiss review comments to start learning.
            </p>
          )}

          {/* Reset button */}
          <button
            onClick={handleReset}
            style={{
              padding: '5px 12px',
              fontSize: '12px',
              border: '1px solid #fca5a5',
              borderRadius: '6px',
              background: '#fff',
              color: '#dc2626',
              cursor: 'pointer',
              marginBottom: '20px',
            }}
          >
            Reset Learned Preferences
          </button>

          {/* Repo facts */}
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '16px' }}>
            <label style={labelStyle}>Repository Context</label>
            <p style={hintStyle}>
              Add custom facts per repository. These are injected into the AI prompt to give
              project-specific context (e.g. architecture patterns, coding standards, tech stack).
            </p>

            {/* Existing repo facts */}
            {prefs!.repoFacts.map((rf) => (
              <div key={rf.projectPath} style={{
                marginBottom: '10px',
                padding: '10px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                background: '#f9fafb',
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: editingRepo === rf.projectPath ? '8px' : '0',
                }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, fontFamily: 'monospace' }}>
                    {rf.projectPath}
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => {
                        setEditingRepo(rf.projectPath);
                        setNewRepoFacts(rf.facts);
                      }}
                      style={smallBtnStyle}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteRepoFact(rf.projectPath)}
                      style={{ ...smallBtnStyle, color: '#dc2626', borderColor: '#fca5a5' }}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {editingRepo === rf.projectPath ? (
                  <div>
                    <textarea
                      value={newRepoFacts}
                      onChange={(e) => setNewRepoFacts(e.target.value)}
                      rows={3}
                      style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px', minHeight: '60px', resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <button
                        onClick={() => handleSaveRepoFact(rf.projectPath, newRepoFacts)}
                        style={{ ...smallBtnStyle, background: '#2563eb', color: '#fff', borderColor: '#2563eb' }}
                      >
                        Save
                      </button>
                      <button onClick={() => setEditingRepo(null)} style={smallBtnStyle}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
                    {rf.facts}
                  </p>
                )}
              </div>
            ))}

            {/* Add new repo fact */}
            <div style={{
              marginTop: '10px',
              padding: '10px',
              border: '1px dashed #d1d5db',
              borderRadius: '6px',
            }}>
              <div style={fieldStyle}>
                <label style={{ ...labelStyle, fontSize: '12px' }}>Project Path</label>
                <input
                  type="text"
                  value={newRepoPath}
                  onChange={(e) => setNewRepoPath(e.target.value)}
                  placeholder="e.g. my-org/my-group/my-project"
                  style={{ ...inputStyle, fontSize: '12px', fontFamily: 'monospace' }}
                />
              </div>
              <div style={fieldStyle}>
                <label style={{ ...labelStyle, fontSize: '12px' }}>Context / Facts</label>
                <textarea
                  value={newRepoFacts}
                  onChange={(e) => setNewRepoFacts(e.target.value)}
                  placeholder="e.g. .NET 8 project using Clean Architecture. Domain layer has no external dependencies. All API endpoints require authentication."
                  rows={3}
                  style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px', minHeight: '60px', resize: 'vertical' }}
                />
              </div>
              <button
                onClick={handleAddRepoFact}
                disabled={!newRepoPath.trim()}
                style={{
                  padding: '5px 12px',
                  fontSize: '12px',
                  border: '1px solid #2563eb',
                  borderRadius: '6px',
                  background: newRepoPath.trim() ? '#2563eb' : '#e5e7eb',
                  color: newRepoPath.trim() ? '#fff' : '#9ca3af',
                  cursor: newRepoPath.trim() ? 'pointer' : 'default',
                }}
              >
                Add Repository Context
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const smallBtnStyle: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: '11px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  background: '#fff',
  color: '#374151',
  cursor: 'pointer',
};
