// ---------------------------------------------------------------------------
// Settings: Botto Server Config Form
//
// Reads and writes Botto's server-side cluster and conflict config via the
// HTTP admin API. Only renders when Botto is enabled and configured.
//
// This complements the per-user feature toggles in FeatureTogglesForm —
// those control what Otto displays, while these control how Botto detects
// clusters and conflicts for the whole team.
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect } from 'react';
import type { OttoSettings } from '@/types/settings';
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

type BottoServerConfigFormProps = {
  settings: OttoSettings;
};

type ClusterConfig = {
  enabled: boolean;
  max_cluster_size: number;
  file_overlap_threshold: number;
  summary_ttl_days: number;
};

type ConflictConfig = {
  enabled: boolean;
  semantic_analysis: boolean;
  semantic_cache_ttl_days: number;
};

type ServerConfig = {
  cluster: ClusterConfig;
  conflict: ConflictConfig;
};

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Convert the Botto WS URL to an HTTP base URL for the admin API. */
function toHttpBase(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/ws\/?$/, '');
}

export function BottoServerConfigForm({ settings }: BottoServerConfigFormProps) {
  const botto = settings.botto;
  if (!botto?.enabled || !botto.serverUrl || !botto.apiKey) return null;

  const httpBase = toHttpBase(botto.serverUrl);
  const headers = {
    'Authorization': `Bearer ${botto.apiKey}`,
    'Content-Type': 'application/json',
  };

  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const [cluster, setCluster] = useState<ClusterConfig>({
    enabled: true,
    max_cluster_size: 8,
    file_overlap_threshold: 0.15,
    summary_ttl_days: 7,
  });

  const [conflict, setConflict] = useState<ConflictConfig>({
    enabled: true,
    semantic_analysis: false,
    semantic_cache_ttl_days: 3,
  });

  const fetchConfig = useCallback(async () => {
    setLoadState('loading');
    setErrorMsg('');
    try {
      const resp = await fetch(`${httpBase}/api/admin/config`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.cluster) setCluster(data.cluster);
      if (data.conflict) setConflict(data.conflict);
      setLoadState('loaded');
    } catch (e) {
      setLoadState('error');
      setErrorMsg(e instanceof Error ? e.message : 'failed to load config');
    }
  }, [httpBase, botto.apiKey]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = useCallback(async () => {
    setSaveState('saving');
    setErrorMsg('');
    try {
      const resp = await fetch(`${httpBase}/api/admin/config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ cluster, conflict }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.config?.cluster) setCluster(data.config.cluster);
      if (data.config?.conflict) setConflict(data.config.conflict);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (e) {
      setSaveState('error');
      setErrorMsg(e instanceof Error ? e.message : 'failed to save config');
    }
  }, [httpBase, botto.apiKey, cluster, conflict]);

  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div style={formSectionStyle}>
        <h3 style={sectionTitleStyle}>Botto Server Config</h3>
        <p style={descriptionStyle}>Loading server configuration...</p>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div style={formSectionStyle}>
        <h3 style={sectionTitleStyle}>Botto Server Config</h3>
        <p style={{ color: '#ef4444', fontSize: 13, margin: '0 0 8px' }}>{errorMsg}</p>
        <button onClick={fetchConfig} style={testButtonStyle}>Retry</button>
      </div>
    );
  }

  const checkboxLabelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 500,
    color: '#374151',
    cursor: 'pointer',
  };

  const groupStyle: React.CSSProperties = {
    marginBottom: 16,
    padding: '12px 14px',
    borderRadius: 6,
    background: '#fafafa',
    border: '1px solid #f3f4f6',
  };

  const groupTitleStyle: React.CSSProperties = {
    margin: '0 0 8px',
    fontSize: 13,
    fontWeight: 600,
    color: '#111827',
  };

  return (
    <div style={formSectionStyle}>
      <h3 style={sectionTitleStyle}>Botto Server Config</h3>
      <p style={descriptionStyle}>
        Team-wide detection settings. Changes apply to all connected Otto instances.
      </p>

      {/* Cluster Config */}
      <div style={groupStyle}>
        <h4 style={groupTitleStyle}>Cross-MR Clusters</h4>

        <div style={fieldStyle}>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={cluster.enabled}
              onChange={(e) => setCluster({ ...cluster, enabled: e.target.checked })}
            />
            Enable cluster detection
          </label>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Max cluster size</label>
          <input
            type="number"
            min={2}
            max={20}
            value={cluster.max_cluster_size}
            onChange={(e) => setCluster({ ...cluster, max_cluster_size: parseInt(e.target.value) || 8 })}
            style={{ ...inputStyle, width: 80 }}
          />
          <span style={hintStyle}>Maximum MRs per cluster (2–20)</span>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>
            File overlap threshold: {(cluster.file_overlap_threshold * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min={5}
            max={80}
            value={Math.round(cluster.file_overlap_threshold * 100)}
            onChange={(e) => setCluster({ ...cluster, file_overlap_threshold: parseInt(e.target.value) / 100 })}
            style={{ width: '100%' }}
          />
          <span style={hintStyle}>Minimum Jaccard similarity to group MRs by file overlap</span>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Summary TTL (days)</label>
          <input
            type="number"
            min={1}
            max={30}
            value={cluster.summary_ttl_days}
            onChange={(e) => setCluster({ ...cluster, summary_ttl_days: parseInt(e.target.value) || 7 })}
            style={{ ...inputStyle, width: 80 }}
          />
          <span style={hintStyle}>How long cluster entries are cached before expiring</span>
        </div>
      </div>

      {/* Conflict Config */}
      <div style={groupStyle}>
        <h4 style={groupTitleStyle}>Conflict Radar</h4>

        <div style={fieldStyle}>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={conflict.enabled}
              onChange={(e) => setConflict({ ...conflict, enabled: e.target.checked })}
            />
            Enable conflict detection
          </label>
        </div>

        <div style={fieldStyle}>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={conflict.semantic_analysis}
              onChange={(e) => setConflict({ ...conflict, semantic_analysis: e.target.checked })}
            />
            Semantic conflict analysis (AI-powered)
          </label>
          <span style={hintStyle}>Uses AI to detect logical conflicts beyond line overlap. Expensive — disabled by default.</span>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Semantic cache TTL (days)</label>
          <input
            type="number"
            min={1}
            max={14}
            value={conflict.semantic_cache_ttl_days}
            onChange={(e) => setConflict({ ...conflict, semantic_cache_ttl_days: parseInt(e.target.value) || 3 })}
            style={{ ...inputStyle, width: 80 }}
          />
          <span style={hintStyle}>How long semantic analysis results are cached</span>
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saveState === 'saving'}
          style={{
            ...testButtonStyle,
            background: '#6366f1',
            color: '#fff',
            border: 'none',
            opacity: saveState === 'saving' ? 0.6 : 1,
          }}
        >
          {saveState === 'saving' ? 'Saving...' : 'Save Server Config'}
        </button>
        {saveState === 'saved' && (
          <span style={{ color: '#22c55e', fontSize: 13 }}>Saved</span>
        )}
        {saveState === 'error' && (
          <span style={{ color: '#ef4444', fontSize: 13 }}>{errorMsg}</span>
        )}
      </div>
    </div>
  );
}
