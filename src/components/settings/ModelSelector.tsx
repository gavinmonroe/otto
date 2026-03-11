// ---------------------------------------------------------------------------
// Settings: Model Selector
//
// A reusable component for selecting an AI model. Supports both dropdown
// (when models are fetched from the API) and free-text input (fallback).
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { sendMessage } from '@/lib/messaging';
import { inputStyle, labelStyle } from './AiProviderForm';

type ModelSelectorProps = {
  label: string;
  value: string;
  onChange: (model: string) => void;
};

export function ModelSelector({ label, value, onChange }: ModelSelectorProps) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    sendMessage({ type: 'FETCH_AI_MODELS' }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setModels(result.data);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  if (models.length > 0) {
    return (
      <div>
        <label style={labelStyle}>{label}</label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        >
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
          {!models.includes(value) && (
            <option value={value}>{value} (custom)</option>
          )}
        </select>
      </div>
    );
  }

  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={loading ? 'Loading models...' : 'Enter model name'}
        style={inputStyle}
        disabled={loading}
      />
    </div>
  );
}
