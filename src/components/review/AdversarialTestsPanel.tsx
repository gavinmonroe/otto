// ---------------------------------------------------------------------------
// AdversarialTestsPanel — displays AI-generated property-based tests and
// their results. Shows per-file test groups with status badges.
//
// Follows the same collapsible item pattern as EdgeCaseAnalysis.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { Markdown } from '@/components/Markdown';
import type { AdversarialTestData, FileTestData, PropertyTest, PropertyTestResult } from '@/types/verification';
import { TrustBadge } from './TrustBadge';
import type { TrustAssessment } from '@/types/verification';

type AdversarialTestsPanelProps = {
  data: AdversarialTestData;
  trust: TrustAssessment | null;
};

export function AdversarialTestsPanel({ data, trust }: AdversarialTestsPanelProps) {
  const theme = useTheme();

  if (data.files.length === 0) {
    return (
      <div style={{ marginTop: '8px', fontSize: '12px', color: theme.textMuted, fontStyle: 'italic' }}>
        No testable functions found in the changed code.
      </div>
    );
  }

  return (
    <div style={{ marginTop: '8px' }}>
      {/* Summary stats */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '8px',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <StatPill label="tests" count={data.totalTests} color={theme.textSecondary} bg={theme.bgMuted} />
        {data.totalHeld > 0 && (
          <StatPill label="held" count={data.totalHeld} color={theme.success} bg={theme.successBg} />
        )}
        {data.totalCounterexamples > 0 && (
          <StatPill label="counterexamples" count={data.totalCounterexamples} color={theme.error} bg={theme.errorBg} />
        )}
        {trust && <TrustBadge trust={trust} compact />}
      </div>

      {/* Per-file test groups */}
      {data.files.map((fileData) => (
        <FileTestGroup key={fileData.filePath} fileData={fileData} />
      ))}
    </div>
  );
}

function FileTestGroup({ fileData }: { fileData: FileTestData }) {
  const [expanded, setExpanded] = useState(false);
  const theme = useTheme();

  const resultMap = new Map(fileData.results.map((r) => [r.testId, r]));

  return (
    <div style={{ marginBottom: '6px' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={{
          background: 'none',
          border: 'none',
          padding: '4px 0',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          fontSize: '12px',
          color: theme.text,
          fontFamily: 'monospace',
        }}
      >
        <span style={{ color: theme.textMuted }}>{expanded ? '▾' : '▸'}</span>
        <span>{fileData.filePath.split('/').pop()}</span>
        <span style={{ color: theme.textMuted, fontFamily: 'sans-serif', fontSize: '11px' }}>
          {fileData.tests.length} test{fileData.tests.length !== 1 ? 's' : ''}
        </span>
      </button>

      {expanded && (
        <div style={{ paddingLeft: '16px' }}>
          {fileData.tests.map((test) => (
            <TestItem key={test.id} test={test} result={resultMap.get(test.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function TestItem({ test, result }: { test: PropertyTest; result?: PropertyTestResult }) {
  const [showCode, setShowCode] = useState(false);
  const theme = useTheme();

  const statusConfig: Record<string, { icon: string; color: string; bg: string; label: string }> = {
    held: { icon: '✓', color: theme.success, bg: theme.successBg, label: 'Held' },
    counterexample: { icon: '✕', color: theme.error, bg: theme.errorBg, label: 'Counterexample found' },
    error: { icon: '!', color: theme.warning, bg: theme.warningBg, label: 'Error' },
    'not-run': { icon: '○', color: theme.textMuted, bg: theme.bgMuted, label: 'Not run' },
  };

  const status = result?.status ?? 'not-run';
  const config = statusConfig[status] || statusConfig['not-run'];

  return (
    <div style={{ padding: '6px 0', borderBottom: `1px solid ${theme.borderSubtle}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
        <span
          role="img"
          aria-label={config.label}
          style={{
            fontSize: '11px',
            padding: '1px 5px',
            borderRadius: '3px',
            background: config.bg,
            color: config.color,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {config.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
            {test.property}
          </div>
          <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '2px' }}>
            {test.targetFunction}()
            {result?.iterations != null && ` · ${result.iterations} iterations`}
            {result?.aiReasoned && ' · AI-reasoned'}
          </div>

          {result?.counterexample && (
            <div style={{
              marginTop: '4px',
              padding: '4px 8px',
              background: theme.errorBg,
              borderRadius: '3px',
              fontSize: '11px',
              fontFamily: 'monospace',
              color: theme.error,
            }}>
              Counterexample: {result.counterexample}
            </div>
          )}

          <button
            onClick={() => setShowCode(!showCode)}
            aria-expanded={showCode}
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
            {showCode ? 'Hide test code' : 'Show test code'}
          </button>

          {showCode && (
            <div style={{ marginTop: '4px' }}>
              <Markdown content={`\`\`\`typescript\n${test.testCode}\n\`\`\``} compact />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatPill({ label, count, color, bg }: {
  label: string;
  count: number;
  color: string;
  bg: string;
}) {
  return (
    <span style={{
      fontSize: '10px',
      padding: '1px 5px',
      borderRadius: '3px',
      background: bg,
      color,
      fontWeight: 600,
    }}>
      {count} {label}
    </span>
  );
}
