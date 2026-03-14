// ---------------------------------------------------------------------------
// CollapsibleDiff — renders a raw unified diff with syntax highlighting.
//
// Parses the unified diff format from GitLab's API (DiffFileData.diff),
// renders with line numbers, +/- markers, and Shiki syntax highlighting.
// Collapsible by default — shows a summary line, expands on click.
//
// Optionally highlights a specific line range to draw attention to the
// area relevant to a comment, edge case, or thread.
//
// Reuses the same highlighting pipeline as SuggestionDiff (Shiki via SW).
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { highlightLines, extToLang, resolveEffectiveLang } from '@/services/syntax/highlight-client';
import { ChevronRight, ChevronDown } from 'lucide-react';

type Props = {
  /** Raw unified diff text (from DiffFileData.diff) */
  diff: string;
  /** File path — used for language detection + display */
  filePath: string;
  /** Optional line range to highlight (e.g., the lines a comment refers to) */
  highlightRange?: { start: number; end: number } | null;
  /** Label shown in the collapsed header (default: "File Diff") */
  label?: string;
  /** Start expanded? (default: false) */
  defaultExpanded?: boolean;
  /** Max lines to show before truncating with "Show more" (default: 100) */
  maxLines?: number;
};

type ParsedDiffLine = {
  type: 'context' | 'added' | 'removed' | 'header';
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
};

export function CollapsibleDiff({
  diff,
  filePath,
  highlightRange,
  label = 'File Diff',
  defaultExpanded = false,
  maxLines = 100,
}: Props) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAll, setShowAll] = useState(false);

  const lines = useMemo(() => parseDiffLines(diff), [diff]);

  // Syntax highlighting (async)
  // For multi-language files (Vue, Svelte), detect the sub-language from
  // the diff content since fragments lack the full file structure.
  const [highlightedHtml, setHighlightedHtml] = useState<string[] | null>(null);
  const plainLines = useMemo(() => lines.map((l) => l.content), [lines]);
  const lang = useMemo(
    () => resolveEffectiveLang(filePath, plainLines),
    [filePath, plainLines],
  );

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    highlightLines(plainLines, lang, theme.isDark).then((html) => {
      if (!cancelled) setHighlightedHtml(html);
    });
    return () => { cancelled = true; };
  }, [plainLines, lang, theme.isDark, expanded]);

  if (lines.length === 0) return null;

  const addedCount = lines.filter((l) => l.type === 'added').length;
  const removedCount = lines.filter((l) => l.type === 'removed').length;
  const displayLines = showAll ? lines : lines.slice(0, maxLines);
  const truncated = !showAll && lines.length > maxLines;

  const s = styles(theme);

  return (
    <div style={s.container}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={s.header}
        onMouseEnter={(e) => { e.currentTarget.style.background = theme.bgMuted; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = theme.bgSubtle; }}
      >
        {expanded
          ? <ChevronDown size={12} style={{ color: theme.textMuted, flexShrink: 0 }} />
          : <ChevronRight size={12} style={{ color: theme.textMuted, flexShrink: 0 }} />
        }
        <span style={s.headerLabel}>{label}</span>
        <span style={{ ...s.stat, color: theme.success }}>+{addedCount}</span>
        <span style={{ ...s.stat, color: theme.error }}>-{removedCount}</span>
      </button>

      {expanded && (
        <div style={s.body}>
          {displayLines.map((line, i) => {
            const isHighlighted = highlightRange
              && line.newLineNo !== null
              && line.newLineNo >= highlightRange.start
              && line.newLineNo <= highlightRange.end;

            return (
              <div
                key={i}
                style={{
                  ...getLineStyle(line.type, theme),
                  ...(isHighlighted ? s.highlightedLine : {}),
                }}
              >
                <span style={s.gutter}>
                  {line.oldLineNo !== null ? String(line.oldLineNo) : ''}
                </span>
                <span style={s.gutter}>
                  {line.newLineNo !== null ? String(line.newLineNo) : ''}
                </span>
                <span style={s.marker}>
                  {line.type === 'removed' ? '-' : line.type === 'added' ? '+' : line.type === 'header' ? '@' : ' '}
                </span>
                {highlightedHtml ? (
                  <span
                    style={s.code}
                    dangerouslySetInnerHTML={{ __html: highlightedHtml[i] }}
                  />
                ) : (
                  <span style={s.code}>{line.content}</span>
                )}
              </div>
            );
          })}
          {truncated && (
            <button
              onClick={() => setShowAll(true)}
              style={s.showMore}
            >
              Show {lines.length - maxLines} more lines
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff parser — converts raw unified diff text to structured lines
// ---------------------------------------------------------------------------

function parseDiffLines(diff: string): ParsedDiffLine[] {
  if (!diff) return [];

  const rawLines = diff.split('\n');
  const result: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of rawLines) {
    if (raw.startsWith('@@')) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: 'header', content: raw, oldLineNo: null, newLineNo: null });
    } else if (raw.startsWith('-')) {
      result.push({ type: 'removed', content: raw.slice(1), oldLineNo: oldLine, newLineNo: null });
      oldLine++;
    } else if (raw.startsWith('+')) {
      result.push({ type: 'added', content: raw.slice(1), oldLineNo: null, newLineNo: newLine });
      newLine++;
    } else if (raw.startsWith(' ')) {
      result.push({ type: 'context', content: raw.slice(1), oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
    } else if (raw === '\\ No newline at end of file') {
      // Skip this marker
    }
    // Skip other lines (e.g., diff --git headers that shouldn't be in DiffFileData.diff)
  }

  return result;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function getLineStyle(type: ParsedDiffLine['type'], theme: OttoTheme): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    minHeight: '18px',
    lineHeight: '18px',
    fontSize: '11px',
    fontFamily: 'monospace',
  };

  switch (type) {
    case 'added':
      return { ...base, background: theme.isDark ? 'rgba(46, 160, 67, 0.15)' : 'rgba(46, 160, 67, 0.1)' };
    case 'removed':
      return { ...base, background: theme.isDark ? 'rgba(248, 81, 73, 0.15)' : 'rgba(248, 81, 73, 0.1)' };
    case 'header':
      return { ...base, background: theme.isDark ? 'rgba(56, 139, 253, 0.1)' : 'rgba(56, 139, 253, 0.08)', color: theme.textMuted, fontStyle: 'italic' };
    default:
      return base;
  }
}

function styles(theme: OttoTheme) {
  return {
    container: {
      borderRadius: '6px',
      border: `1px solid ${theme.borderSubtle}`,
      overflow: 'hidden',
    } as React.CSSProperties,
    header: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      width: '100%',
      padding: '6px 10px',
      background: theme.bgSubtle,
      border: 'none',
      borderRadius: 0,
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: 600,
      fontFamily: 'inherit',
      textAlign: 'left' as const,
      color: theme.textSecondary,
      transition: 'background 150ms ease',
    } as React.CSSProperties,
    headerLabel: {
      flex: 1,
      color: theme.textSecondary,
    } as React.CSSProperties,
    stat: {
      fontSize: '10px',
      fontWeight: 600,
      fontFamily: 'monospace',
    } as React.CSSProperties,
    body: {
      overflowX: 'auto' as const,
      maxHeight: '400px',
      overflowY: 'auto' as const,
    } as React.CSSProperties,
    gutter: {
      display: 'inline-block',
      width: '32px',
      textAlign: 'right' as const,
      paddingRight: '4px',
      color: theme.textMuted,
      fontSize: '10px',
      opacity: 0.6,
      flexShrink: 0,
      userSelect: 'none' as const,
    } as React.CSSProperties,
    marker: {
      display: 'inline-block',
      width: '12px',
      textAlign: 'center' as const,
      color: theme.textMuted,
      flexShrink: 0,
      userSelect: 'none' as const,
    } as React.CSSProperties,
    code: {
      flex: 1,
      whiteSpace: 'pre' as const,
      tabSize: 4,
      minWidth: 0,
    } as React.CSSProperties,
    highlightedLine: {
      outline: `1px solid ${theme.isDark ? 'rgba(250, 204, 21, 0.3)' : 'rgba(234, 179, 8, 0.3)'}`,
      background: theme.isDark ? 'rgba(250, 204, 21, 0.08)' : 'rgba(234, 179, 8, 0.06)',
    } as React.CSSProperties,
    showMore: {
      display: 'block',
      width: '100%',
      padding: '4px',
      background: theme.bgSubtle,
      border: 'none',
      borderTop: `1px solid ${theme.borderSubtle}`,
      color: theme.brand,
      fontSize: '11px',
      fontWeight: 500,
      cursor: 'pointer',
      fontFamily: 'inherit',
      textAlign: 'center' as const,
    } as React.CSSProperties,
  };
}
