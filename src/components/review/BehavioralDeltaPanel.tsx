// ---------------------------------------------------------------------------
// BehavioralDeltaPanel — displays what behaviors changed, what was preserved,
// and what changed unexpectedly.
//
// The most reviewer-facing component: answers "what does this MR actually do?"
// in terms of observable behavior, not syntax.
//
// Follows the same section/item pattern as MrOverviewPanel sections.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { Markdown } from '@/components/Markdown';
import { GitLabFileLink } from '@/components/GitLabFileLink';
import type { BehavioralDeltaData, BehaviorEntry } from '@/types/verification';

type BehavioralDeltaPanelProps = {
  data: BehavioralDeltaData;
};

export function BehavioralDeltaPanel({ data }: BehavioralDeltaPanelProps) {
  const theme = useTheme();

  const totalChanged = data.changed.length;
  const totalPreserved = data.preserved.length;
  const totalUnexpected = data.unexpected.length;

  if (totalChanged === 0 && totalPreserved === 0 && totalUnexpected === 0) {
    return (
      <div style={{ marginTop: '8px', fontSize: '12px', color: theme.textMuted, fontStyle: 'italic' }}>
        No behavioral changes identified.
      </div>
    );
  }

  return (
    <div style={{ marginTop: '8px' }}>
      {/* Summary line */}
      {data.summary && (
        <div style={{
          fontSize: '12px',
          color: theme.textSecondary,
          marginBottom: '8px',
          fontStyle: 'italic',
        }}>
          {data.summary}
        </div>
      )}

      {/* Unexpected changes first — most important */}
      {totalUnexpected > 0 && (
        <BehaviorSection
          label="Unexpected Changes"
          entries={data.unexpected}
          icon="!"
          color={theme.error}
          bg={theme.errorBg}
          theme={theme}
          defaultExpanded
        />
      )}

      {/* Changed behaviors */}
      {totalChanged > 0 && (
        <BehaviorSection
          label="Changed Behaviors"
          entries={data.changed}
          icon="+"
          color={theme.info}
          bg={theme.infoBg}
          theme={theme}
          defaultExpanded
        />
      )}

      {/* Preserved behaviors — collapsed by default (least actionable) */}
      {totalPreserved > 0 && (
        <BehaviorSection
          label="Preserved Behaviors"
          entries={data.preserved}
          icon="="
          color={theme.success}
          bg={theme.successBg}
          theme={theme}
          defaultExpanded={false}
        />
      )}
    </div>
  );
}

function BehaviorSection({ label, entries, icon, color, bg, theme, defaultExpanded = true }: {
  label: string;
  entries: BehaviorEntry[];
  icon: string;
  color: string;
  bg: string;
  theme: OttoTheme;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div style={{ marginBottom: '8px' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontSize: '11px',
          fontWeight: 600,
          color: theme.textSecondary,
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          marginBottom: '4px',
        }}
      >
        {expanded ? '▾' : '▸'} {label} ({entries.length})
      </button>

      {expanded && entries.map((entry) => (
        <BehaviorItem key={entry.id} entry={entry} icon={icon} color={color} bg={bg} theme={theme} />
      ))}
    </div>
  );
}

function BehaviorItem({ entry, icon, color, bg, theme }: {
  entry: BehaviorEntry;
  icon: string;
  color: string;
  bg: string;
  theme: OttoTheme;
}) {
  const [showScenario, setShowScenario] = useState(false);

  return (
    <div style={{
      padding: '6px 8px',
      marginBottom: '4px',
      background: bg,
      borderRadius: '4px',
      borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
        <span style={{
          fontWeight: 700,
          color,
          fontSize: '13px',
          lineHeight: '1.4',
          flexShrink: 0,
          width: '14px',
          textAlign: 'center',
        }}>
          {icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text, lineHeight: '1.4' }}>
            {entry.description}
          </div>

          {entry.filePaths.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', marginTop: '2px', flexWrap: 'wrap' }}>
              {entry.filePaths.map((fp) => (
                <GitLabFileLink key={fp} filePath={fp} line={null} lineEnd={null} variant="inline" />
              ))}
            </div>
          )}

          {entry.verified && (
            <span style={{
              fontSize: '10px',
              padding: '0 4px',
              borderRadius: '2px',
              background: theme.successBg,
              color: theme.success,
              fontWeight: 500,
              marginTop: '2px',
              display: 'inline-block',
            }}>
              verified
            </span>
          )}

          <button
            onClick={() => setShowScenario(!showScenario)}
            aria-expanded={showScenario}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: '10px',
              color: theme.brand,
              marginTop: '3px',
              display: 'block',
            }}
          >
            {showScenario ? 'Hide scenario' : 'Show test scenario'}
          </button>

          {showScenario && (
            <div style={{
              marginTop: '4px',
              padding: '4px 8px',
              background: theme.bgInset,
              borderRadius: '3px',
              fontSize: '11px',
            }}>
              <div style={{ color: theme.textSecondary }}>
                <Markdown content={entry.testScenario} compact />
              </div>
              <div style={{ color: theme.text, marginTop: '2px' }}>
                <span style={{ fontWeight: 500 }}>Expected: </span>
                {entry.expectedOutcome}
              </div>
              {entry.actualOutcome && (
                <div style={{ color, marginTop: '2px' }}>
                  <span style={{ fontWeight: 500 }}>Actual: </span>
                  {entry.actualOutcome}
                </div>
              )}
              {entry.aiReasoned && (
                <div style={{ fontSize: '10px', color: theme.textMuted, marginTop: '2px', fontStyle: 'italic' }}>
                  AI-reasoned (not executed)
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
