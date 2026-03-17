// ---------------------------------------------------------------------------
// TrustBadge — displays the trust calibration score for verification results.
//
// Shows a colored badge with confidence level (HIGH/MEDIUM/LOW), the numeric
// score, and expandable signal breakdown. Matches Otto's pill/badge pattern
// used in EdgeCaseAnalysis and AcStatusPills.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import type { TrustAssessment, TrustSignals } from '@/types/verification';

type TrustBadgeProps = {
  trust: TrustAssessment;
  compact?: boolean;  // Inline mode (no expand)
};

export function TrustBadge({ trust, compact = false }: TrustBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const theme = useTheme();

  const levelConfig: Record<string, { color: string; bg: string; label: string }> = {
    high: { color: theme.success, bg: theme.successBg, label: 'HIGH' },
    medium: { color: theme.warning, bg: theme.warningBg, label: 'MEDIUM' },
    low: { color: theme.error, bg: theme.errorBg, label: 'LOW' },
  };

  const config = levelConfig[trust.level] || levelConfig.low;

  if (compact) {
    return (
      <span style={{
        fontSize: '10px',
        padding: '1px 5px',
        borderRadius: '6px',
        background: config.bg,
        color: config.color,
        fontWeight: 600,
      }}>
        {config.label} {trust.score}%
      </span>
    );
  }

  return (
    <div style={{
      padding: '6px 8px',
      background: config.bg,
      borderRadius: '6px',
      borderLeft: `3px solid ${config.color}`,
      fontSize: '12px',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          color: theme.text,
          fontSize: '12px',
        }}
      >
        <span style={{ fontWeight: 600, color: config.color }}>
          {expanded ? '▾' : '▸'} Confidence: {config.label} ({trust.score}%)
        </span>
      </button>

      {expanded && (
        <div style={{ marginTop: '6px' }}>
          <SignalBreakdown signals={trust.signals} theme={theme} />
          <div style={{ marginTop: '4px', fontSize: '11px', color: theme.textSecondary }}>
            {trust.explanation}
          </div>
          {trust.survivingMutants.length > 0 && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: theme.textMuted }}>
              <span style={{ fontWeight: 500 }}>Gaps: </span>
              {trust.survivingMutants.slice(0, 3).join('; ')}
            </div>
          )}
          {trust.canStrengthen && (
            <div style={{
              marginTop: '4px',
              fontSize: '11px',
              color: config.color,
              fontStyle: 'italic',
            }}>
              Re-generating with harder constraints could improve this score.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SignalBreakdown({ signals, theme }: { signals: TrustSignals; theme: OttoTheme }) {
  const items: Array<{ label: string; value: string }> = [];

  if (signals.mutationScore != null) {
    items.push({ label: 'Mutation score', value: `${Math.round(signals.mutationScore * 100)}%` });
  }
  if (signals.coverageDelta != null) {
    items.push({ label: 'Coverage delta', value: `+${Math.round(signals.coverageDelta * 100)}%` });
  }
  items.push({ label: 'Counterexample quality', value: `${Math.round(signals.counterexampleQuality * 100)}%` });
  items.push({ label: 'Test independence', value: `${Math.round(signals.testIndependence * 100)}%` });
  items.push({ label: 'Non-tautological', value: `${Math.round(signals.nonTautological * 100)}%` });

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
      {items.map((item) => (
        <span key={item.label} style={{ fontSize: '11px', color: theme.textSecondary }}>
          {item.label}: <span style={{ fontWeight: 500, color: theme.text }}>{item.value}</span>
        </span>
      ))}
    </div>
  );
}
