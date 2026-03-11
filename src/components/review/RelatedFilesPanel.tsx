// ---------------------------------------------------------------------------
// RelatedFilesPanel — displays files not in the diff that are relevant.
// Theme-aware via useTheme().
// ---------------------------------------------------------------------------

import type { RelatedFile } from '@/types/review';
import { useTheme } from '@/components/ThemeContext';
import { GitLabFileLink } from '@/components/GitLabFileLink';

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
        <span style={{
          fontSize: '11px',
          padding: '1px 6px',
          borderRadius: '3px',
          background: theme.isDark ? '#1e3a5f' : '#e0e7ff',
          color: theme.isDark ? '#93c5fd' : '#3730a3',
          fontWeight: 500,
          flexShrink: 0,
        }}>
          {relationshipLabel[file.relationship] || file.relationship}
        </span>
      </div>
      <GitLabFileLink
        filePath={file.filePath}
        variant="block"
        showPreview
        content={file.content}
      />
      <p style={{ margin: '2px 0 0', fontSize: '12px', color: theme.textSecondary }}>
        {file.reason}
      </p>
    </div>
  );
}
