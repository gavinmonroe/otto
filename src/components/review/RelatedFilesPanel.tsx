// ---------------------------------------------------------------------------
// RelatedFilesPanel — displays files not in the diff that are relevant
// to the review.
//
// Shows each related file with its relationship type, reason for relevance,
// and optionally the file content in a collapsible code block.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { RelatedFile } from '@/types/review';

type RelatedFilesPanelProps = {
  files: RelatedFile[];
};

export function RelatedFilesPanel({ files }: RelatedFilesPanelProps) {
  if (files.length === 0) return null;

  return (
    <div style={{ marginTop: '8px' }}>
      {files.map((file, index) => (
        <RelatedFileItem key={file.filePath} file={file} />
      ))}
    </div>
  );
}

function RelatedFileItem({ file }: { file: RelatedFile }) {
  const [showContent, setShowContent] = useState(false);

  const relationshipLabel: Record<string, string> = {
    'imports': 'Imports from changed file',
    'imported-by': 'Imported by changed file',
    'shared-type': 'Shares types/interfaces',
    'test': 'Test file',
    'config': 'Configuration',
    'other': 'Related',
  };

  return (
    <div style={{
      padding: '8px 0',
      borderBottom: '1px solid #f3f4f6',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span style={{
          fontSize: '11px',
          padding: '1px 6px',
          borderRadius: '3px',
          background: '#e0e7ff',
          color: '#3730a3',
          fontWeight: 500,
        }}>
          {relationshipLabel[file.relationship] || file.relationship}
        </span>
        <span style={{ fontSize: '13px', fontWeight: 500, fontFamily: 'monospace' }}>
          {file.filePath}
        </span>
      </div>
      <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#6b7280' }}>
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
            color: '#0c93e7',
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
          background: '#f9fafb',
          borderRadius: '4px',
          overflow: 'auto',
          maxHeight: '300px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          border: '1px solid #e5e7eb',
        }}>
          {file.content}
        </pre>
      )}
    </div>
  );
}
