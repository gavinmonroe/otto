// ---------------------------------------------------------------------------
// Settings: AI Provider Form
//
// Configures the OpenAI-compatible API endpoint (base URL, API key)
// and per-task model selection with temperature controls.
// ---------------------------------------------------------------------------

import { useState, useCallback, useMemo } from 'react';
import type { OttoSettings, AiTaskType } from '@/types/settings';
import { sendMessage } from '@/lib/messaging';

type AiProviderFormProps = {
  settings: OttoSettings;
  onUpdate: (updates: Partial<OttoSettings['ai']>) => Promise<void>;
};

const TASK_LABELS: Record<AiTaskType, string> = {
  summary: 'MR Summary',
  codeReview: 'Code Review',
  edgeCases: 'Edge Cases',
  relatedFiles: 'Related Files',
  followUp: 'Comment Follow-Up',
  chat: 'MR Chat Q&A',
  acValidation: 'AC Validation',
  adversarialTests: 'Adversarial Tests',
  contracts: 'Contract Inference',
  behavioralDelta: 'Behavioral Delta',
  inquiry: 'Line Inquiry',
};

export function AiProviderForm({ settings, onUpdate }: AiProviderFormProps) {
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const handleTestConnection = useCallback(async () => {
    setTestStatus('testing');
    setTestMessage('');

    const result = await sendMessage({
      type: 'TEST_AI_CONNECTION',
      payload: { baseUrl: settings.ai.baseUrl, apiKey: settings.ai.apiKey },
    });

    if (result.ok) {
      setTestStatus('success');
      setTestMessage(`Connected successfully`);
      // Try to fetch models
      const modelsResult = await sendMessage({ type: 'FETCH_AI_MODELS' });
      if (modelsResult.ok) {
        setAvailableModels(modelsResult.data);
      }
    } else {
      setTestStatus('error');
      setTestMessage(result.error);
    }
  }, [settings.ai.baseUrl, settings.ai.apiKey]);

  return (
    <div style={formSectionStyle}>
      <h3 style={sectionTitleStyle}>AI Provider</h3>
      <p style={descriptionStyle}>
        Connect to any OpenAI-compatible API endpoint (kiro-gateway, OpenRouter, Ollama, etc.)
      </p>

      <div style={fieldStyle}>
        <label style={labelStyle}>Base URL</label>
        <input
          type="url"
          value={settings.ai.baseUrl}
          onChange={(e) => onUpdate({ baseUrl: e.target.value })}
          placeholder="http://localhost:8000/v1"
          style={inputStyle}
        />
        <span style={hintStyle}>The /v1 endpoint of your OpenAI-compatible server</span>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>API Key</label>
        <input
          type="password"
          value={settings.ai.apiKey}
          onChange={(e) => onUpdate({ apiKey: e.target.value })}
          placeholder="your-api-key"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <button onClick={handleTestConnection} style={testButtonStyle} disabled={testStatus === 'testing'}>
          {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
        </button>
        {testMessage && (
          <span style={{
            marginLeft: '8px',
            fontSize: '12px',
            color: testStatus === 'success' ? '#16a34a' : '#dc2626',
          }}>
            {testMessage}
          </span>
        )}
      </div>

      <h4 style={{ ...sectionTitleStyle, fontSize: '13px', marginTop: '20px' }}>Model Configuration</h4>
      <p style={descriptionStyle}>
        Choose which model to use for each task. Different tasks benefit from different cost/quality tradeoffs.
      </p>

      {(Object.keys(TASK_LABELS) as AiTaskType[]).map((task) => (
        <div key={task} style={{ ...fieldStyle, display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: '180px' }}>
            <label style={labelStyle}>{TASK_LABELS[task]} — Model</label>
            {availableModels.length > 0 ? (
              <select
                value={settings.ai.models[task]}
                onChange={(e) => onUpdate({
                  models: { ...settings.ai.models, [task]: e.target.value },
                })}
                style={inputStyle}
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                {!availableModels.includes(settings.ai.models[task]) && (
                  <option value={settings.ai.models[task]}>{settings.ai.models[task]} (custom)</option>
                )}
              </select>
            ) : (
              <input
                type="text"
                value={settings.ai.models[task]}
                onChange={(e) => onUpdate({
                  models: { ...settings.ai.models, [task]: e.target.value },
                })}
                placeholder="claude-sonnet-4-5"
                style={inputStyle}
              />
            )}
          </div>
          <div style={{ flex: 1, minWidth: '80px' }}>
            <label style={labelStyle}>Temperature</label>
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={settings.ai.temperatures[task]}
              onChange={(e) => onUpdate({
                temperatures: { ...settings.ai.temperatures, [task]: parseFloat(e.target.value) || 0 },
              })}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1, minWidth: '140px' }}>
            <MaxTokensSlider
              value={settings.ai.maxTokens?.[task] ?? 0}
              onChange={(value) => onUpdate({
                maxTokens: { ...settings.ai.maxTokens, [task]: value },
              })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// Shared inline styles for settings forms
export const formSectionStyle: React.CSSProperties = {
  marginBottom: '24px',
  padding: '16px',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  background: '#ffffff',
};

export const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: '15px',
  fontWeight: 600,
  color: '#111827',
};

export const descriptionStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: '13px',
  color: '#6b7280',
};

export const fieldStyle: React.CSSProperties = {
  marginBottom: '12px',
};

export const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '4px',
  fontSize: '13px',
  fontWeight: 500,
  color: '#374151',
};

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: '13px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  background: '#ffffff',
  color: '#111827',
  outline: 'none',
  boxSizing: 'border-box',
};

export const hintStyle: React.CSSProperties = {
  display: 'block',
  marginTop: '2px',
  fontSize: '11px',
  color: '#9ca3af',
};

export const testButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '6px',
  background: '#f3f4f6',
  color: '#374151',
  border: '1px solid #d1d5db',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
};

// ---------------------------------------------------------------------------
// MaxTokensSlider — range slider from 0 (none) to 256k
// ---------------------------------------------------------------------------

const MAX_TOKENS_STEPS = [
  0, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144,
];

function formatTokens(value: number): string {
  if (value === 0) return 'None';
  if (value >= 1024) return `${Math.round(value / 1024)}k`;
  return String(value);
}

function MaxTokensSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  // Find the closest step index for the current value
  const stepIndex = useMemo(() => {
    let closest = 0;
    let minDist = Math.abs(MAX_TOKENS_STEPS[0] - value);
    for (let i = 1; i < MAX_TOKENS_STEPS.length; i++) {
      const dist = Math.abs(MAX_TOKENS_STEPS[i] - value);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    return closest;
  }, [value]);

  return (
    <div>
      <label style={labelStyle}>
        Max Tokens: <span style={{ fontWeight: 600 }}>{formatTokens(value)}</span>
      </label>
      <input
        type="range"
        min={0}
        max={MAX_TOKENS_STEPS.length - 1}
        step={1}
        value={stepIndex}
        onChange={(e) => onChange(MAX_TOKENS_STEPS[parseInt(e.target.value, 10)])}
        style={{ width: '100%', cursor: 'pointer' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#9ca3af' }}>
        <span>None</span>
        <span>256k</span>
      </div>
    </div>
  );
}
