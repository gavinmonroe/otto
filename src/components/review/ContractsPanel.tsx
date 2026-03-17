// ---------------------------------------------------------------------------
// ContractsPanel — displays inferred function contracts with verification
// status. Shows preconditions, postconditions, invariants per function.
//
// Follows the same item pattern as EdgeCaseAnalysis.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { Markdown } from '@/components/Markdown';
import { GitLabFileLink } from '@/components/GitLabFileLink';
import type { ContractData, FunctionContract, ContractStatement } from '@/types/verification';

type ContractsPanelProps = {
  data: ContractData;
};

export function ContractsPanel({ data }: ContractsPanelProps) {
  const theme = useTheme();

  if (data.contracts.length === 0) {
    return (
      <div style={{ marginTop: '8px', fontSize: '12px', color: theme.textMuted, fontStyle: 'italic' }}>
        No contractable functions found in the changed code.
      </div>
    );
  }

  return (
    <div style={{ marginTop: '8px' }}>
      {/* Summary pills */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
        {data.totalVerified > 0 && (
          <span style={{
            fontSize: '10px', padding: '1px 5px', borderRadius: '6px',
            background: theme.successBg, color: theme.success, fontWeight: 600,
          }}>
            {data.totalVerified} verified
          </span>
        )}
        {data.totalViolations > 0 && (
          <span style={{
            fontSize: '10px', padding: '1px 5px', borderRadius: '6px',
            background: theme.errorBg, color: theme.error, fontWeight: 600,
          }}>
            {data.totalViolations} violation{data.totalViolations !== 1 ? 's' : ''} possible
          </span>
        )}
        {data.totalUnknown > 0 && (
          <span style={{
            fontSize: '10px', padding: '1px 5px', borderRadius: '6px',
            background: theme.warningBg, color: theme.warning, fontWeight: 600,
          }}>
            {data.totalUnknown} unknown
          </span>
        )}
      </div>

      {data.contracts.map((contract) => (
        <ContractItem key={contract.id} contract={contract} />
      ))}
    </div>
  );
}

function ContractItem({ contract }: { contract: FunctionContract }) {
  const [expanded, setExpanded] = useState(contract.verificationStatus === 'violation-possible');
  const theme = useTheme();

  const statusConfig: Record<string, { icon: string; color: string; bg: string; borderColor: string; label: string }> = {
    verified: {
      icon: '✓', color: theme.success, bg: theme.successBg,
      borderColor: theme.success, label: 'Verified',
    },
    'violation-possible': {
      icon: '✕', color: theme.error, bg: theme.errorBg,
      borderColor: theme.error, label: 'Violation possible',
    },
    unknown: {
      icon: '?', color: theme.warning, bg: theme.warningBg,
      borderColor: theme.warning, label: 'Unknown',
    },
  };

  const config = statusConfig[contract.verificationStatus] || statusConfig.unknown;

  return (
    <div style={{
      padding: '8px',
      marginBottom: '6px',
      background: config.bg,
      borderRadius: '6px',
      borderLeft: `3px solid ${config.borderColor}`,
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
          textAlign: 'left',
          color: theme.text,
        }}
      >
        <span role="img" aria-label={config.label} style={{ fontWeight: 700, color: config.color, fontSize: '13px', flexShrink: 0 }}>
          {expanded ? '▾' : '▸'} {config.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, fontFamily: 'monospace' }}>
            {contract.functionName}()
          </span>
        </div>
        {contract.filePath && (
          <GitLabFileLink
            filePath={contract.filePath}
            line={contract.lineRange?.start ?? null}
            lineEnd={contract.lineRange?.end ?? null}
            variant="inline"
          />
        )}
      </button>

      {expanded && (
        <div style={{ marginTop: '8px', paddingLeft: '20px' }}>
          {contract.preconditions.length > 0 && (
            <ContractSection label="PRE" statements={contract.preconditions} theme={theme} />
          )}
          {contract.postconditions.length > 0 && (
            <ContractSection label="POST" statements={contract.postconditions} theme={theme} />
          )}
          {contract.invariants.length > 0 && (
            <ContractSection label="INV" statements={contract.invariants} theme={theme} />
          )}

          {contract.violationPath && (
            <div style={{
              marginTop: '6px',
              padding: '4px 8px',
              background: theme.bgInset,
              borderRadius: '6px',
              fontSize: '11px',
            }}>
              <span style={{ fontWeight: 600, color: config.color }}>Violation path: </span>
              <span style={{ color: theme.textSecondary }}>{contract.violationPath}</span>
            </div>
          )}

          {contract.aiReasoned && (
            <div style={{ fontSize: '10px', color: theme.textMuted, marginTop: '4px', fontStyle: 'italic' }}>
              Verified by AI reasoning (no execution)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContractSection({ label, statements, theme }: {
  label: string;
  statements: ContractStatement[];
  theme: OttoTheme;
}) {
  const [showCode, setShowCode] = useState(false);

  const labelColors: Record<string, string> = {
    PRE: theme.info,
    POST: theme.info,
    INV: theme.brand,
  };

  return (
    <div style={{ marginBottom: '4px' }}>
      {statements.map((stmt, i) => (
        <div key={`${label}-${i}`} style={{ display: 'flex', gap: '6px', marginBottom: '2px', fontSize: '11px' }}>
          <span style={{
            fontWeight: 700,
            color: labelColors[label] || theme.textSecondary,
            fontSize: '10px',
            flexShrink: 0,
            width: '32px',
          }}>
            {label}
          </span>
          <span style={{ color: theme.text }}>{stmt.human}</span>
        </div>
      ))}
      {statements.some((s) => s.code) && (
        <>
          <button
            onClick={() => setShowCode(!showCode)}
            aria-expanded={showCode}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: '10px',
              color: theme.brand,
              marginTop: '2px',
              marginLeft: '38px',
            }}
          >
            {showCode ? 'Hide assertions' : 'Show assertions'}
          </button>
          {showCode && (
            <div style={{ marginLeft: '38px', marginTop: '4px' }}>
              {statements.filter((s) => s.code).map((stmt, i) => (
                <div key={`code-${i}`} style={{ marginBottom: '2px' }}>
                  <Markdown content={`\`${stmt.code}\``} compact />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
