// ---------------------------------------------------------------------------
// RelatedFilesSidebarPanel — renders related files in GitLab's sidebar.
//
// Compact list styled to blend with GitLab's native file tree entries.
// Each file shows relationship badge, clickable path, and optional preview.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { FileCode, ChevronRight, ChevronDown } from 'lucide-react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { useReviewStore } from '@/services/review/review-store';
import { OttoLogo } from '@/components/OttoLogo';
import { GitLabFileLink } from '@/components/GitLabFileLink';
import type { RelatedFile } from '@/types/review';

export function RelatedFilesSidebarPanel() {
  const theme = useTheme();
  const relatedFiles = useReviewStore((s) => s.relatedFiles);
  const [expanded, setExpanded] = useState(true);

  if (relatedFiles.length === 0) return null;

  const s = buildStyles(theme);

  return (
    <div style={s.container}>
      <button onClick={() => setExpanded(!expanded)} style={s.header}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <OttoLogo size={14} />
        <span style={s.headerText}>Related Files</span>
        <span style={s.badge}>{relatedFiles.length}</span>
      </button>

      {expanded && (
        <div style={s.list}>
          {relatedFiles.map((file) => (
            <SidebarFileEntry key={file.filePath} file={file} theme={theme} />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarFileEntry({ file, theme }: { file: RelatedFile; theme: OttoTheme }) {
  const [showPreview, setShowPreview] = useState(false);

  const relationshipColors: Record<string, string> = {
    'imports': theme.isDark ? '#93c5fd' : '#3730a3',
    'imported-by': theme.isDark ? '#fbbf24' : '#92400e',
    'shared-type': theme.isDark ? '#a5b4fc' : '#4f46e5',
    'test': theme.isDark ? '#4ade80' : '#16a34a',
    'config': theme.isDark ? '#fb923c' : '#c2410c',
    'other': theme.textMuted,
  };

  const relationshipShort: Record<string, string> = {
    'imports': 'imp',
    'imported-by': 'dep',
    'shared-type': 'type',
    'test': 'test',
    'config': 'cfg',
    'other': '...',
  };

  const fileName = file.filePath.split('/').pop() || file.filePath;
  const dirPath = file.filePath.includes('/')
    ? file.filePath.substring(0, file.filePath.lastIndexOf('/'))
    : '';

  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 8px 4px 20px',
        cursor: 'pointer',
        fontSize: '12px',
        borderBottom: `1px solid ${theme.borderSubtle}`,
      }}>
        <FileCode size={13} style={{ color: theme.textMuted, flexShrink: 0 }} />
        <GitLabFileLink filePath={file.filePath} variant="inline" />
        <span style={{
          fontSize: '9px',
          padding: '0 4px',
          borderRadius: '3px',
          background: theme.bgMuted,
          color: relationshipColors[file.relationship] || theme.textMuted,
          fontWeight: 600,
          flexShrink: 0,
          marginLeft: 'auto',
        }}>
          {relationshipShort[file.relationship] || '...'}
        </span>
      </div>
    </div>
  );
}

function buildStyles(theme: OttoTheme) {
  return {
    container: {
      borderTop: `1px solid ${theme.border}`,
      marginTop: '4px',
    } as React.CSSProperties,

    header: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      width: '100%',
      padding: '8px 8px',
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      color: theme.textSecondary,
      fontSize: '12px',
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.03em',
    } as React.CSSProperties,

    headerText: {
      flex: 1,
      textAlign: 'left' as const,
    } as React.CSSProperties,

    badge: {
      fontSize: '10px',
      padding: '0 5px',
      borderRadius: '8px',
      background: theme.brand,
      color: '#fff',
      fontWeight: 600,
      lineHeight: '16px',
    } as React.CSSProperties,

    list: {
      maxHeight: '300px',
      overflowY: 'auto' as const,
    } as React.CSSProperties,
  };
}
