// ---------------------------------------------------------------------------
// Review Queue Panel — risk-ordered file list with progress tracking.
//
// Injected into GitLab's sidebar alongside RelatedFilesSidebarPanel.
// Shows files ordered by priority score (severity counts + risk level).
// Tracks which files the reviewer has acted on.
//
// Design: matches RelatedFilesSidebarPanel styling exactly — same chevrons,
// OttoLogo, theme tokens, hover patterns, padding, and font sizes.
// ---------------------------------------------------------------------------

import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { useReviewStore } from '@/services/review/review-store';
import { OttoLogo } from '@/components/OttoLogo';
import type { FileReview } from '@/types/review';

type FileQueueItem = {
  filePath: string;
  fileName: string;
  dirPath: string;
  riskLevel: 'low' | 'medium' | 'high';
  priorityScore: number;
  criticalCount: number;
  warningCount: number;
  suggestionCount: number;
  infoCount: number;
  totalComments: number;
  reviewedComments: number;
  isReviewed: boolean;
};

function computeQueueItems(fileReviews: FileReview[]): FileQueueItem[] {
  const riskMultiplier = { high: 15, medium: 8, low: 0 };

  return fileReviews
    .map((fr) => {
      const parts = fr.filePath.split('/');
      const fileName = parts.pop() || fr.filePath;
      const dirPath = parts.join('/');

      let criticalCount = 0;
      let warningCount = 0;
      let suggestionCount = 0;
      let infoCount = 0;
      let reviewedComments = 0;

      for (const c of fr.comments) {
        if (c.severity === 'critical') criticalCount++;
        else if (c.severity === 'warning') warningCount++;
        else if (c.severity === 'suggestion') suggestionCount++;
        else infoCount++;

        if (c.status === 'accepted' || c.status === 'dismissed' || c.status === 'edited') {
          reviewedComments++;
        }
      }

      const priorityScore =
        criticalCount * 10 +
        warningCount * 5 +
        suggestionCount * 2 +
        infoCount +
        riskMultiplier[fr.riskLevel];

      const totalComments = fr.comments.length;
      const isReviewed = totalComments > 0 && reviewedComments === totalComments;

      return {
        filePath: fr.filePath,
        fileName,
        dirPath,
        riskLevel: fr.riskLevel,
        priorityScore,
        criticalCount,
        warningCount,
        suggestionCount,
        infoCount,
        totalComments,
        reviewedComments,
        isReviewed,
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

function scrollToFile(filePath: string): void {
  const diffFile = document.querySelector(
    `.diff-file[data-path="${CSS.escape(filePath)}"]`,
  ) as HTMLElement | null;

  if (diffFile) {
    diffFile.scrollIntoView({ behavior: 'smooth', block: 'start' });
    diffFile.style.outline = '2px solid #40C4F5';
    diffFile.style.outlineOffset = '-2px';
    setTimeout(() => {
      diffFile.style.outline = '';
      diffFile.style.outlineOffset = '';
    }, 2000);
    return;
  }

  // Fallback: find by filename in headers
  const headers = document.querySelectorAll('.diff-file-header, .file-header-content');
  for (const header of headers) {
    if (header.textContent?.includes(filePath.split('/').pop() || '')) {
      const fileEl = header.closest('.diff-file') as HTMLElement | null;
      if (fileEl) {
        fileEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
  }
}

// File extension → icon color (same palette as RelatedFilesSidebarPanel)
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
    kt: ['#A97BFF', '#A97BFF'],
    cs: ['#178600', '#68b723'],
    css: ['#563d7c', '#a78bfa'],
    scss: ['#c6538c', '#f472b6'],
    html: ['#e34c26', '#f87171'],
    vue: ['#41b883', '#41b883'],
    json: ['#6b7280', '#9ca3af'],
    yaml: ['#6b7280', '#9ca3af'],
    yml: ['#6b7280', '#9ca3af'],
    md: ['#6b7280', '#9ca3af'],
    sql: ['#e38c00', '#fbbf24'],
  };
  const pair = colors[ext];
  return pair ? (isDark ? pair[1] : pair[0]) : (isDark ? '#9ca3af' : '#6b7280');
}

export function ReviewQueuePanel() {
  const theme = useTheme();
  const fileReviews = useReviewStore((s) => s.fileReviews);
  const status = useReviewStore((s) => s.status);
  const [expanded, setExpanded] = useState(true);

  const items = useMemo(() => computeQueueItems(fileReviews), [fileReviews]);

  const reviewedCount = items.filter((i) => i.isReviewed).length;
  const totalCount = items.length;

  if (status !== 'complete' && status !== 'streaming') return null;
  if (items.length === 0) return null;

  return (
    <div style={{
      borderTop: `1px solid ${theme.border}`,
      marginTop: '4px',
    }}>
      {/* Header — matches RelatedFilesSidebarPanel exactly */}
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
        <span style={{ flex: 1, textAlign: 'left' }}>Review Queue</span>

        {/* Progress pill */}
        <span style={{
          fontSize: '11px',
          minWidth: '18px',
          height: '18px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '9px',
          padding: '0 5px',
          background: reviewedCount === totalCount
            ? (theme.isDark ? '#065f46' : '#d1fae5')
            : (theme.isDark ? '#374151' : '#e5e7eb'),
          color: reviewedCount === totalCount
            ? (theme.isDark ? '#6ee7b7' : '#059669')
            : theme.textSecondary,
          fontWeight: 600,
        }}>
          {reviewedCount}/{totalCount}
        </span>
      </button>

      {/* Progress bar */}
      {expanded && totalCount > 0 && (
        <div style={{
          margin: '0 10px 6px 28px',
          height: '2px',
          borderRadius: '1px',
          background: theme.isDark ? '#374151' : '#e5e7eb',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${(reviewedCount / totalCount) * 100}%`,
            borderRadius: '1px',
            background: reviewedCount === totalCount ? theme.success : theme.brand,
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}

      {/* File list */}
      {expanded && (
        <div style={{ overflowY: 'auto', maxHeight: '400px' }}>
          {items.map((item) => (
            <QueueFileRow key={item.filePath} item={item} theme={theme} />
          ))}
        </div>
      )}
    </div>
  );
}

function QueueFileRow({ item, theme }: { item: FileQueueItem; theme: OttoTheme }) {
  const [hovered, setHovered] = useState(false);
  const iconColor = getFileIconColor(item.filePath, theme.isDark);

  return (
    <button
      onClick={() => scrollToFile(item.filePath)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '5px 10px 5px 24px',
        background: hovered ? (theme.isDark ? '#2d333b' : '#f3f4f6') : 'transparent',
        border: 'none',
        borderBottom: `1px solid ${theme.borderSubtle}`,
        cursor: 'pointer',
        textAlign: 'left',
        opacity: item.isReviewed ? 0.5 : 1,
        transition: 'background 0.1s, opacity 0.2s',
      }}
    >
      {/* File icon — same SVG as RelatedFilesSidebarPanel */}
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

      {/* Risk badge */}
      <RiskBadge riskLevel={item.riskLevel} isDark={theme.isDark} />

      {/* File name + dir */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{
          fontSize: '13px',
          fontWeight: 400,
          color: theme.text,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textDecoration: item.isReviewed ? 'line-through' : 'none',
        }}>
          {item.fileName}
        </div>
        {item.dirPath && (
          <div style={{
            fontSize: '11px',
            color: theme.textMuted,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {item.dirPath}
          </div>
        )}
      </div>

      {/* Severity counts */}
      <div style={{
        display: 'flex',
        gap: '4px',
        flexShrink: 0,
      }}>
        {item.criticalCount > 0 && (
          <SeverityPill count={item.criticalCount} color="#dc2626" bgColor={theme.isDark ? '#450a0a' : '#fef2f2'} />
        )}
        {item.warningCount > 0 && (
          <SeverityPill count={item.warningCount} color="#d97706" bgColor={theme.isDark ? '#451a03' : '#fffbeb'} />
        )}
        {item.suggestionCount > 0 && (
          <SeverityPill count={item.suggestionCount} color="#2563eb" bgColor={theme.isDark ? '#1e1b4b' : '#eff6ff'} />
        )}
      </div>

      {/* Reviewed checkmark */}
      {item.isReviewed && (
        <span style={{ fontSize: '11px', color: theme.success, flexShrink: 0 }}>
          ✓
        </span>
      )}
    </button>
  );
}

function RiskBadge({ riskLevel, isDark }: { riskLevel: 'low' | 'medium' | 'high'; isDark: boolean }) {
  const config = {
    high: {
      label: 'H',
      color: isDark ? '#fca5a5' : '#dc2626',
      bg: isDark ? '#450a0a' : '#fef2f2',
      border: isDark ? '#7f1d1d' : '#fca5a5',
    },
    medium: {
      label: 'M',
      color: isDark ? '#fcd34d' : '#d97706',
      bg: isDark ? '#451a03' : '#fffbeb',
      border: isDark ? '#78350f' : '#fcd34d',
    },
    low: {
      label: 'L',
      color: isDark ? '#86efac' : '#16a34a',
      bg: isDark ? '#052e16' : '#f0fdf4',
      border: isDark ? '#14532d' : '#86efac',
    },
  };
  const c = config[riskLevel];

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '15px',
      height: '15px',
      fontSize: '9px',
      fontWeight: 700,
      borderRadius: '3px',
      background: c.bg,
      color: c.color,
      border: `1px solid ${c.border}`,
      flexShrink: 0,
    }}>
      {c.label}
    </span>
  );
}

function SeverityPill({ count, color, bgColor }: { count: number; color: string; bgColor: string }) {
  return (
    <span style={{
      fontSize: '10px',
      fontWeight: 600,
      padding: '0 4px',
      borderRadius: '3px',
      background: bgColor,
      color,
      lineHeight: '16px',
    }}>
      {count}
    </span>
  );
}
