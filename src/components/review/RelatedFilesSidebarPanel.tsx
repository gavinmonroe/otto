// ---------------------------------------------------------------------------
// RelatedFilesSidebarPanel — renders related files in GitLab's sidebar.
//
// Styled to match GitLab's native file tree: filename prominent, directory
// path muted, compact rows with file type icons.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { useReviewStore } from '@/services/review/review-store';
import { OttoLogo } from '@/components/OttoLogo';
import type { RelatedFile } from '@/types/review';

export function RelatedFilesSidebarPanel() {
  const theme = useTheme();
  const relatedFiles = useReviewStore((s) => s.relatedFiles);
  const mrContext = useReviewStore((s) => s.mrContext);
  const [expanded, setExpanded] = useState(true);

  if (relatedFiles.length === 0) return null;

  return (
    <div style={{
      borderTop: `1px solid ${theme.border}`,
      marginTop: '4px',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          padding: '6px 10px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: theme.textSecondary,
          fontSize: '12px',
          fontWeight: 600,
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <OttoLogo size={12} />
        <span style={{ flex: 1, textAlign: 'left' }}>Related Files</span>
        <span style={{
          fontSize: '11px',
          minWidth: '18px',
          height: '18px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '9px',
          background: theme.isDark ? '#374151' : '#e5e7eb',
          color: theme.textSecondary,
          fontWeight: 600,
        }}>
          {relatedFiles.length}
        </span>
      </button>

      {expanded && (
        <div style={{ overflowY: 'auto', maxHeight: '300px' }}>
          {relatedFiles.map((file) => (
            <SidebarFileRow
              key={file.filePath}
              file={file}
              theme={theme}
              hostUrl={mrContext?.hostUrl}
              projectPath={mrContext?.projectPath}
              targetBranch={mrContext?.targetBranch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File extension → icon color (matches GitLab's file tree icon colors)
// ---------------------------------------------------------------------------

function getFileIconColor(filePath: string, isDark: boolean): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const colors: Record<string, [string, string]> = {
    ts: ['#3178c6', '#3178c6'],
    tsx: ['#3178c6', '#3178c6'],
    js: ['#f7df1e', '#b8a200'],
    jsx: ['#f7df1e', '#b8a200'],
    py: ['#3776ab', '#5ba0d0'],
    rb: ['#cc342d', '#e05050'],
    go: ['#00add8', '#00add8'],
    rs: ['#dea584', '#dea584'],
    java: ['#b07219', '#e0943a'],
    css: ['#563d7c', '#a78bfa'],
    scss: ['#c6538c', '#f472b6'],
    html: ['#e34c26', '#f87171'],
    json: ['#6b7280', '#9ca3af'],
    yaml: ['#6b7280', '#9ca3af'],
    yml: ['#6b7280', '#9ca3af'],
    md: ['#6b7280', '#9ca3af'],
    sql: ['#e38c00', '#fbbf24'],
  };
  const pair = colors[ext];
  return pair ? (isDark ? pair[1] : pair[0]) : (isDark ? '#9ca3af' : '#6b7280');
}

function SidebarFileRow({
  file,
  theme,
  hostUrl,
  projectPath,
  targetBranch,
}: {
  file: RelatedFile;
  theme: OttoTheme;
  hostUrl?: string;
  projectPath?: string;
  targetBranch?: string;
}) {
  const [hovered, setHovered] = useState(false);

  const fileName = file.filePath.split('/').pop() || file.filePath;
  const dirPath = file.filePath.includes('/')
    ? file.filePath.substring(0, file.filePath.lastIndexOf('/'))
    : '';

  const iconColor = getFileIconColor(file.filePath, theme.isDark);

  // Build GitLab blob URL
  const blobUrl = hostUrl && projectPath && targetBranch
    ? `${hostUrl}/${projectPath}/-/blob/${targetBranch}/${file.filePath}`
    : null;

  const relationshipLabel: Record<string, string> = {
    'imports': 'imports',
    'imported-by': 'imported by',
    'shared-type': 'shared type',
    'test': 'test',
    'config': 'config',
    'other': 'related',
  };

  return (
    <a
      href={blobUrl || '#'}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 10px 5px 24px',
        textDecoration: 'none',
        background: hovered ? (theme.isDark ? '#2d333b' : '#f3f4f6') : 'transparent',
        cursor: 'pointer',
        borderBottom: `1px solid ${theme.borderSubtle}`,
        transition: 'background 0.1s',
      }}
    >
      {/* File icon — simple colored dot like GitLab */}
      <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
        <path
          d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25V1.75z"
          fill={iconColor}
          opacity="0.2"
        />
        <path
          d="M3.75 1.5a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073H3.75z"
          fill="none"
          stroke={iconColor}
          strokeWidth="0.5"
        />
      </svg>

      {/* File name + dir */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{
          fontSize: '13px',
          fontWeight: 400,
          color: theme.text,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {fileName}
        </div>
        {dirPath && (
          <div style={{
            fontSize: '11px',
            color: theme.textMuted,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {dirPath}
          </div>
        )}
      </div>

      {/* Relationship tag */}
      <span style={{
        fontSize: '10px',
        padding: '1px 5px',
        borderRadius: '3px',
        background: theme.isDark ? '#1f2937' : '#f3f4f6',
        color: theme.textMuted,
        fontWeight: 500,
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}>
        {relationshipLabel[file.relationship] || 'related'}
      </span>
    </a>
  );
}
