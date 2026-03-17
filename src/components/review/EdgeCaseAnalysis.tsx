// ---------------------------------------------------------------------------
// EdgeCaseAnalysis — displays potential failure modes and edge cases.
// Theme-aware via useTheme().
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { EdgeCase } from '@/types/review';
import { useTheme } from '@/components/ThemeContext';
import { Markdown } from '@/components/Markdown';
import { GitLabFileLink } from '@/components/GitLabFileLink';

type EdgeCaseAnalysisProps = {
  edgeCases: EdgeCase[];
};

export function EdgeCaseAnalysis({ edgeCases }: EdgeCaseAnalysisProps) {
  if (edgeCases.length === 0) return null;

  return (
    <div style={{ marginTop: '8px' }}>
      {edgeCases.map((edgeCase) => (
        <EdgeCaseItem key={edgeCase.id} edgeCase={edgeCase} />
      ))}
    </div>
  );
}

function EdgeCaseItem({ edgeCase }: { edgeCase: EdgeCase }) {
  const [showTrace, setShowTrace] = useState(false);
  const theme = useTheme();

  const severityColors: Record<string, { bg: string; text: string }> = {
    critical: {
      bg: theme.errorBg,
      text: theme.error,
    },
    moderate: {
      bg: theme.warningBg,
      text: theme.warning,
    },
    minor: {
      bg: theme.infoBg,
      text: theme.info,
    },
  };

  const colors = severityColors[edgeCase.severity] || severityColors.minor;

  const categoryLabels: Record<string, string> = {
    'error-handling': 'Error Handling',
    'boundary-condition': 'Boundary Condition',
    'race-condition': 'Race Condition',
    'null-safety': 'Null Safety',
    'type-safety': 'Type Safety',
    'resource-leak': 'Resource Leak',
    'other': 'Other',
  };

  return (
    <div style={{ padding: '8px 0', borderBottom: `1px solid ${theme.borderSubtle}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '11px',
          padding: '1px 6px',
          borderRadius: '6px',
          background: colors.bg,
          color: colors.text,
          fontWeight: 600,
        }}>
          {edgeCase.severity}
        </span>
        <span style={{ fontSize: '11px', color: theme.textSecondary }}>
          {categoryLabels[edgeCase.category] || edgeCase.category}
        </span>
        {edgeCase.filePath && (
          <GitLabFileLink
            filePath={edgeCase.filePath}
            line={edgeCase.lineRange?.start ?? null}
            lineEnd={edgeCase.lineRange?.end ?? null}
            variant="inline"
          />
        )}
      </div>
      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px', color: theme.text }}>
        {edgeCase.title}
      </div>
      <div style={{ fontSize: '12px' }}>
        <Markdown content={edgeCase.description} compact />
      </div>
      {edgeCase.hypotheticalTrace && (
        <>
          <button
            onClick={() => setShowTrace(!showTrace)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: '11px',
              color: theme.brand,
              marginTop: '4px',
            }}
          >
            {showTrace ? 'Hide stack trace' : 'Show hypothetical stack trace'}
          </button>
          {showTrace && (
            <div style={{ marginTop: '6px' }}>
              <Markdown
                content={
                  edgeCase.hypotheticalTrace.includes('```')
                    ? edgeCase.hypotheticalTrace
                    : `\`\`\`\n${edgeCase.hypotheticalTrace}\n\`\`\``
                }
                compact
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
