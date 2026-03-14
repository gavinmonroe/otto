// ---------------------------------------------------------------------------
// Settings: Feature Toggles Form
//
// Allows users to enable/disable individual LLM-powered features.
// Each feature has a checkbox, label, and short description explaining
// what it does and that it uses AI/LLM calls.
//
// Features are grouped into Review (run during MR review) and Interactive
// (always-available UI elements).
// ---------------------------------------------------------------------------

import { useCallback } from 'react';
import type { OttoSettings, ToggleableFeature, ReviewMode } from '@/types/settings';
import {
  formSectionStyle,
  sectionTitleStyle,
  descriptionStyle,
  hintStyle,
} from './AiProviderForm';

type Props = {
  settings: OttoSettings;
  onUpdate: (updates: Partial<OttoSettings['preferences']>) => Promise<void>;
};

type FeatureInfo = {
  key: ToggleableFeature;
  label: string;
  description: string;
};

const REVIEW_FEATURES: FeatureInfo[] = [
  {
    key: 'summary',
    label: 'MR Summary',
    description: 'Generates an overview, key changes, affected areas, and risk assessment for the merge request.',
  },
  {
    key: 'codeReview',
    label: 'Code Review',
    description: 'Reviews each changed file and produces inline comments with suggestions, warnings, and fixes.',
  },
  {
    key: 'edgeCases',
    label: 'Edge Case Analysis',
    description: 'Identifies potential edge cases, race conditions, and untested scenarios in the changes.',
  },
  {
    key: 'relatedFiles',
    label: 'Related Files Discovery',
    description: 'Uses AI-driven repo exploration to find files that may need changes alongside this MR. Requires a GitLab PAT.',
  },
  {
    key: 'acValidation',
    label: 'Acceptance Criteria Validation',
    description: 'Validates linked ticket acceptance criteria against the diff. Requires a Jira connection with linked tickets.',
  },
];

const INTERACTIVE_FEATURES: FeatureInfo[] = [
  {
    key: 'followUp',
    label: 'Comment Follow-Up',
    description: 'Adds an "Analyze" button to GitLab comment threads to get AI perspective on reviewer feedback.',
  },
  {
    key: 'chat',
    label: 'MR Chat Q&A',
    description: 'Floating chat panel for asking questions about the MR, its changes, and review findings.',
  },
];

const LIST_PAGE_FEATURES: FeatureInfo[] = [
  {
    key: 'mrListPreview',
    label: 'MR List Preview',
    description: 'Shows change stats, language breakdown, and risk level under each merge request on listing pages.',
  },
  {
    key: 'mrReviewQueue',
    label: 'MR Review Queue',
    description: 'Queue, prioritize, and batch-review MRs from the list page. Groups related MRs by ticket and shows live progress.',
  },
];

const VERIFICATION_FEATURES: FeatureInfo[] = [
  {
    key: 'adversarialTests',
    label: 'Adversarial / Stress Tests',
    description: 'Generates property-based stress tests that probe edge cases and failure modes in the changed code.',
  },
  {
    key: 'contracts',
    label: 'Contract Inference',
    description: 'Infers preconditions, postconditions, and invariants for changed functions to surface implicit assumptions.',
  },
  {
    key: 'behavioralDelta',
    label: 'Behavioral Delta',
    description: 'Analyzes what observable behaviors changed, were preserved, or emerged unexpectedly from the diff.',
  },
];

export function FeatureTogglesForm({ settings, onUpdate }: Props) {
  const features = settings.preferences.enabledFeatures;
  const reviewMode = settings.preferences.reviewMode ?? 'default';

  const handleToggle = useCallback((key: ToggleableFeature, enabled: boolean) => {
    onUpdate({
      enabledFeatures: { ...features, [key]: enabled },
    });
  }, [features, onUpdate]);

  const handleReviewModeChange = useCallback((mode: ReviewMode) => {
    onUpdate({ reviewMode: mode });
  }, [onUpdate]);

  return (
    <div style={formSectionStyle}>
      <h3 style={sectionTitleStyle}>Feature Toggles</h3>
      <p style={descriptionStyle}>
        Control which AI-powered features are active. Disabled features won't make LLM calls
        or inject UI into GitLab pages. You can still run disabled review features on-demand
        from the overview panel.
      </p>

      <div style={groupStyle}>
        <h4 style={groupTitleStyle}>Review Mode</h4>
        <p style={hintStyle}>Choose how review findings are presented on MR pages.</p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
          <ReviewModeOption
            label="Default"
            description="Standard GitLab diff view with inline comments and collapsible sections."
            selected={reviewMode === 'default'}
            onSelect={() => handleReviewModeChange('default')}
          />
          <ReviewModeOption
            label="Guided Review"
            description="Curated slide-by-slide walkthrough ordered by priority. Navigate with arrow keys."
            selected={reviewMode === 'guided'}
            onSelect={() => handleReviewModeChange('guided')}
          />
        </div>
      </div>

      <div style={groupStyle}>
        <h4 style={groupTitleStyle}>Review Features</h4>
        <p style={hintStyle}>Run during MR review (manual or auto-review).</p>
        {REVIEW_FEATURES.map((f) => (
          <FeatureToggle
            key={f.key}
            feature={f}
            enabled={features[f.key] ?? true}
            onToggle={handleToggle}
          />
        ))}
      </div>

      <div style={{ ...groupStyle, marginBottom: 0 }}>
        <h4 style={groupTitleStyle}>Interactive Features</h4>
        <p style={hintStyle}>Always-available UI elements on MR pages.</p>
        {INTERACTIVE_FEATURES.map((f) => (
          <FeatureToggle
            key={f.key}
            feature={f}
            enabled={features[f.key] ?? true}
            onToggle={handleToggle}
          />
        ))}
      </div>

      <div style={{ ...groupStyle, marginBottom: 0 }}>
        <h4 style={groupTitleStyle}>List Page</h4>
        <p style={hintStyle}>Enhancements for the merge requests listing page.</p>
        {LIST_PAGE_FEATURES.map((f) => (
          <FeatureToggle
            key={f.key}
            feature={f}
            enabled={features[f.key] ?? true}
            onToggle={handleToggle}
          />
        ))}
      </div>

      <div style={{ ...groupStyle, marginBottom: 0 }}>
        <h4 style={groupTitleStyle}>Verification Features</h4>
        <p style={hintStyle}>Deep analysis tasks that run alongside the review. Disabled by default — higher LLM cost.</p>
        {VERIFICATION_FEATURES.map((f) => (
          <FeatureToggle
            key={f.key}
            feature={f}
            enabled={features[f.key] ?? false}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FeatureToggle({
  feature,
  enabled,
  onToggle,
}: {
  feature: FeatureInfo;
  enabled: boolean;
  onToggle: (key: ToggleableFeature, enabled: boolean) => void;
}) {
  return (
    <label style={toggleRowStyle}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onToggle(feature.key, e.target.checked)}
        style={{ marginRight: '10px', flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={toggleLabelStyle}>{feature.label}</div>
        <div style={toggleDescStyle}>{feature.description}</div>
      </div>
    </label>
  );
}

function ReviewModeOption({
  label,
  description,
  selected,
  onSelect,
}: {
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        flex: 1,
        padding: '10px 12px',
        borderRadius: '6px',
        border: selected ? '2px solid #2563eb' : '1px solid #e5e7eb',
        background: selected ? '#eff6ff' : '#fafafa',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div style={{
        fontSize: '13px',
        fontWeight: 600,
        color: selected ? '#1d4ed8' : '#374151',
        marginBottom: '2px',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '11px',
        color: selected ? '#3b82f6' : '#6b7280',
        lineHeight: '1.4',
      }}>
        {description}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const groupStyle: React.CSSProperties = {
  marginBottom: '16px',
};

const groupTitleStyle: React.CSSProperties = {
  margin: '0 0 2px',
  fontSize: '13px',
  fontWeight: 600,
  color: '#374151',
};

const toggleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  padding: '8px 10px',
  marginBottom: '4px',
  borderRadius: '6px',
  cursor: 'pointer',
  border: '1px solid #f3f4f6',
  background: '#fafafa',
};

const toggleLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 500,
  color: '#111827',
  lineHeight: '1.4',
};

const toggleDescStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#6b7280',
  lineHeight: '1.4',
  marginTop: '1px',
};
