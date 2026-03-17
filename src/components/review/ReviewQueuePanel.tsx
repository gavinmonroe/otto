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
    // Web core
    ts: ['#3178c6', '#3178c6'], tsx: ['#3178c6', '#3178c6'],
    js: ['#f7df1e', '#b8a200'], jsx: ['#f7df1e', '#b8a200'],
    html: ['#e34c26', '#f87171'], css: ['#563d7c', '#a78bfa'],
    json: ['#6b7280', '#9ca3af'], yaml: ['#6b7280', '#9ca3af'], yml: ['#6b7280', '#9ca3af'],
    // Frontend frameworks
    vue: ['#41b883', '#41b883'], svelte: ['#ff3e00', '#ff6b3d'],
    scss: ['#c6538c', '#f472b6'], sass: ['#c6538c', '#f472b6'], less: ['#1d365d', '#6b8ab8'],
    // Backend / scripting
    py: ['#3776ab', '#5ba0d0'], rb: ['#cc342d', '#e05050'],
    go: ['#00add8', '#00add8'], rs: ['#dea584', '#dea584'],
    java: ['#b07219', '#e0943a'], cs: ['#178600', '#68b723'],
    php: ['#4f5d95', '#8892bf'], pl: ['#0298c3', '#39b5e0'],
    lua: ['#000080', '#5b5bff'], r: ['#198ce7', '#4da6ff'],
    ex: ['#6e4a7e', '#b07cc7'], exs: ['#6e4a7e', '#b07cc7'],
    scala: ['#c22d40', '#e05565'], clj: ['#63b132', '#8fd460'],
    hs: ['#5e5086', '#8b7fb8'], erl: ['#b83998', '#d06cb8'],
    // Systems / native
    c: ['#555555', '#a0a0a0'], h: ['#555555', '#a0a0a0'],
    cpp: ['#f34b7d', '#f472b6'], cc: ['#f34b7d', '#f472b6'],
    swift: ['#f05138', '#f47b6b'], kt: ['#A97BFF', '#A97BFF'],
    dart: ['#00b4ab', '#40d4cc'], m: ['#438eff', '#6ba5ff'],
    // Config / infra
    sh: ['#89e051', '#89e051'], bash: ['#89e051', '#89e051'],
    sql: ['#e38c00', '#fbbf24'], md: ['#6b7280', '#9ca3af'],
    toml: ['#9c4221', '#c4724e'], xml: ['#0060ac', '#4da6ff'],
    dockerfile: ['#384d54', '#6b8fa3'], graphql: ['#e10098', '#ff40b8'],
    tf: ['#5c4ee5', '#8b7ff5'], hcl: ['#5c4ee5', '#8b7ff5'],
    ps1: ['#012456', '#4070a0'],
    // Data / misc
    tex: ['#3d6117', '#6b9e3a'], diff: ['#e8d44d', '#f0e070'],
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
            ? theme.successBg
            : theme.bgMuted,
          color: reviewedCount === totalCount
            ? theme.success
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
          background: theme.bgMuted,
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
        background: hovered ? theme.bgMuted : 'transparent',
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
      <RiskBadge riskLevel={item.riskLevel} theme={theme} />

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
          <SeverityPill count={item.criticalCount} color={theme.error} bgColor={theme.errorBg} />
        )}
        {item.warningCount > 0 && (
          <SeverityPill count={item.warningCount} color={theme.warning} bgColor={theme.warningBg} />
        )}
        {item.suggestionCount > 0 && (
          <SeverityPill count={item.suggestionCount} color={theme.info} bgColor={theme.infoBg} />
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

function RiskBadge({ riskLevel, theme }: { riskLevel: 'low' | 'medium' | 'high'; theme: OttoTheme }) {
  const config = {
    high: {
      label: 'H',
      color: theme.error,
      bg: theme.errorBg,
      border: theme.errorBorder,
    },
    medium: {
      label: 'M',
      color: theme.warning,
      bg: theme.warningBg,
      border: theme.warningBorder,
    },
    low: {
      label: 'L',
      color: theme.success,
      bg: theme.successBg,
      border: theme.successBorder,
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
      borderRadius: '6px',
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
      borderRadius: '6px',
      background: bgColor,
      color,
      lineHeight: '16px',
    }}>
      {count}
    </span>
  );
}
