// ---------------------------------------------------------------------------
// Settings: Custom System Prompts Form
//
// Allows users to override the system prompt for each AI task.
// Empty textarea = use the built-in default. Each task has a "Reset"
// button that clears the custom prompt back to default.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { OttoSettings, AiTaskType } from '@/types/settings';
import {
  formSectionStyle, sectionTitleStyle, descriptionStyle,
  fieldStyle, labelStyle, inputStyle, hintStyle,
} from './AiProviderForm';
import { DEFAULT_SUMMARY_PROMPT } from '@/services/ai/prompts/summary';
import { DEFAULT_CODE_REVIEW_PROMPT } from '@/services/ai/prompts/code-review';
import { DEFAULT_EDGE_CASES_PROMPT } from '@/services/ai/prompts/edge-cases';
import { DEFAULT_RELATED_FILES_PROMPT } from '@/services/ai/prompts/related-files';
import { DEFAULT_FOLLOW_UP_PROMPT } from '@/services/ai/prompts/followup';
import { DEFAULT_CHAT_PROMPT } from '@/services/ai/prompts/chat';
import { DEFAULT_INQUIRY_PROMPT } from '@/services/ai/prompts/inquiry';
import { DEFAULT_AC_VALIDATION_PROMPT } from '@/services/ai/prompts/ac-validation';
import { DEFAULT_ADVERSARIAL_TESTS_PROMPT } from '@/services/ai/prompts/adversarial-tests';
import { DEFAULT_CONTRACTS_PROMPT } from '@/services/ai/prompts/contracts';
import { DEFAULT_BEHAVIORAL_DELTA_PROMPT } from '@/services/ai/prompts/behavioral-delta';

type CustomPromptsFormProps = {
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

const DEFAULT_PROMPTS: Record<AiTaskType, string> = {
  summary: DEFAULT_SUMMARY_PROMPT,
  codeReview: DEFAULT_CODE_REVIEW_PROMPT,
  edgeCases: DEFAULT_EDGE_CASES_PROMPT,
  relatedFiles: DEFAULT_RELATED_FILES_PROMPT,
  followUp: DEFAULT_FOLLOW_UP_PROMPT,
  chat: DEFAULT_CHAT_PROMPT,
  acValidation: DEFAULT_AC_VALIDATION_PROMPT,
  adversarialTests: DEFAULT_ADVERSARIAL_TESTS_PROMPT,
  contracts: DEFAULT_CONTRACTS_PROMPT,
  behavioralDelta: DEFAULT_BEHAVIORAL_DELTA_PROMPT,
  inquiry: DEFAULT_INQUIRY_PROMPT,
};

export function CustomPromptsForm({ settings, onUpdate }: CustomPromptsFormProps) {
  const [expandedTask, setExpandedTask] = useState<AiTaskType | null>(null);

  const handlePromptChange = (task: AiTaskType, value: string) => {
    onUpdate({
      customPrompts: { ...settings.ai.customPrompts, [task]: value },
    });
  };

  const handleReset = (task: AiTaskType) => {
    onUpdate({
      customPrompts: { ...settings.ai.customPrompts, [task]: '' },
    });
  };

  return (
    <div style={formSectionStyle}>
      <h3 style={sectionTitleStyle}>Custom System Prompts</h3>
      <p style={descriptionStyle}>
        Override the system prompt for each AI task. Leave empty to use the built-in default.
      </p>

      {(Object.keys(TASK_LABELS) as AiTaskType[]).map((task) => {
        const isExpanded = expandedTask === task;
        const hasCustom = !!settings.ai.customPrompts?.[task]?.trim();

        return (
          <div key={task} style={{ ...fieldStyle, marginBottom: '8px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              padding: '6px 0',
            }}
              onClick={() => setExpandedTask(isExpanded ? null : task)}
            >
              <label style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>{isExpanded ? '\u25BC' : '\u25B6'}</span>
                {TASK_LABELS[task]}
                {hasCustom && (
                  <span style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '6px',
                    background: '#dbeafe',
                    color: '#1d4ed8',
                    fontWeight: 600,
                  }}>
                    Custom
                  </span>
                )}
              </label>
            </div>

            {isExpanded && (
              <div style={{ marginTop: '4px' }}>
                <textarea
                  value={settings.ai.customPrompts?.[task] || ''}
                  onChange={(e) => handlePromptChange(task, e.target.value)}
                  placeholder={DEFAULT_PROMPTS[task]}
                  rows={12}
                  style={{
                    ...inputStyle,
                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    fontSize: '12px',
                    lineHeight: '1.5',
                    resize: 'vertical',
                    minHeight: '120px',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <span style={hintStyle}>
                    {hasCustom ? 'Using custom prompt' : 'Using default prompt'}
                  </span>
                  {hasCustom && (
                    <button
                      onClick={() => handleReset(task)}
                      style={{
                        padding: '3px 10px',
                        borderRadius: '6px',
                        background: 'transparent',
                        color: '#6b7280',
                        border: '1px solid #d1d5db',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Reset to Default
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
