// ---------------------------------------------------------------------------
// EdgeCaseAnalysis — displays potential failure modes and edge cases
// identified by the AI.
//
// Shows each edge case with severity, category, description, and
// optional hypothetical stack trace in a collapsible format.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { EdgeCase } from '@/types/review';

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

  const severityColors: Record<string, { bg: string; text: string }> = {
    critical: { bg: '#fecaca', text: '#991b1b' },
    moderate: { bg: '#fef3c7', text: '#92400e' },
    minor: { bg: '#dbeafe', text: '#1e40af' },
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
    <div style={{
      padding: '8px 0',
      borderBottom: '1px solid #f3f4f6',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '11px',
          padding: '1px 6px',
          borderRadius: '3px',
          background: colors.bg,
          color: colors.text,
          fontWeight: 600,
        }}>
          {edgeCase.severity}
        </span>
        <span style={{ fontSize: '11px', color: '#6b7280' }}>
          {categoryLabels[edgeCase.category] || edgeCase.category}
        </span>
        {edgeCase.filePath && (
          <span style={{ fontSize: '11px', color: '#6b7280', fontFamily: 'monospace' }}>
            {edgeCase.filePath}
            {edgeCase.lineRange && `:${edgeCase.lineRange.start}-${edgeCase.lineRange.end}`}
          </span>
        )}
      </div>
      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
        {edgeCase.title}
      </div>
      <div style={{ fontSize: '12px', lineHeight: '1.5', color: '#374151', whiteSpace: 'pre-wrap' }}>
        {edgeCase.description}
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
              color: '#0c93e7',
              marginTop: '4px',
            }}
          >
            {showTrace ? 'Hide stack trace' : 'Show hypothetical stack trace'}
          </button>
          {showTrace && (
            <pre style={{
              margin: '6px 0 0',
              padding: '8px',
              fontSize: '11px',
              fontFamily: 'monospace',
              background: '#1f2937',
              color: '#f87171',
              borderRadius: '4px',
              overflow: 'auto',
              maxHeight: '200px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {edgeCase.hypotheticalTrace}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
