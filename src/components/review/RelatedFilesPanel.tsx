// ---------------------------------------------------------------------------
// RelatedFilesPanel — displays files not in the diff that are relevant.
// Theme-aware via useTheme().
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { RelatedFile } from '@/types/review';
import { useTheme } from '@/components/ThemeContext';

type RelatedFilesPanelProps = {
  files: RelatedFile[];
};

export function RelatedFilesPanel({ files }: RelatedFilesPanelProps) {
  if (files.length === 0) return null;

  return (
    <div style={{ marginTop: '8px' }}>
      {files.map((file) => (
        <RelatedFileItem key={file.filePath} file={file} />
      ))}
    </div>
  );
}

function RelatedFileItem({ file }: { file: RelatedFile }) {
  const [showContent, setShowContent] = useState(false);
  const theme = useTheme();

  const relationshipLabel: Record<string, string> = {
    'imports': 'Imports from changed file',
    'imported-by': 'Imported by changed file',
    'shared-type': 'Shares types/interfaces',
    'test': 'Test file',
    'config': 'Configuration',
    'other': 'Related',
  };

  return (
    <div style={{ padding: '8px 0', borderBottom: `1px solid ${theme.borderSubtle}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span style={{
          fontSize: '11px',
          padding: '1px 6px',
          borderRadius: '3px',
          background: theme.isDark ? '#1e3a5f' : '#e0e7ff',
          color: theme.isDark ? '#93c5fd' : '#3730a3',
          fontWeight: 500,
        }}>
          {relationshipLabel[file.relationship] || file.relationship}
        </span>
        <span style={{ fontSize: '13px', fontWeight: 500, fontFamily: 'monospace', color: theme.text }}>
          {file.filePath}
        </span>
      </div>
      <p style={{ margin: '0 0 4px', fontSize: '12px', color: theme.textSecondary }}>
        {file.reason}
      </p>
      {file.content && (
        <button
          onClick={() => setShowContent(!showContent)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: '11px',
            color: theme.brand,
          }}
        >
          {showContent ? 'Hide content' : 'Show content'}
        </button>
      )}
      {showContent && file.content && (
        <pre style={{
          margin: '6px 0 0',
          padding: '8px',
          fontSize: '11px',
          fontFamily: 'monospace',
          background: theme.bgSubtle,
          color: theme.text,
          borderRadius: '4px',
          overflow: 'auto',
          maxHeight: '300px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          border: `1px solid ${theme.border}`,
        }}>
          {file.content}
        </pre>
      )}
    </div>
  );
}
