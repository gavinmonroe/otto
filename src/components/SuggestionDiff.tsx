// ---------------------------------------------------------------------------
// SuggestionDiff — unified diff view with Shiki syntax highlighting.
//
// Renders original vs suggested code in a unified view with red (removed)
// and green (added) line backgrounds, plus proper syntax coloring via Shiki.
//
// The diff computation (LCS) is synchronous. Syntax highlighting is async
// and renders progressively — plain text first, then colored once Shiki loads.
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { highlightLines, extToLang } from '@/services/syntax/highlight-client';

type SuggestionDiffProps = {
  originalCode: string;
  suggestion: string;
  /** File path — used to detect language for syntax highlighting */
  filePath?: string;
  /** Starting line number for the original code (for gutter display) */
  startLine?: number | null;
};

type DiffLine = {
  type: 'context' | 'removed' | 'added';
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
};

export function SuggestionDiff({ originalCode, suggestion, filePath, startLine }: SuggestionDiffProps) {
  const theme = useTheme();
  const diffLines = useMemo(
    () => computeUnifiedDiff(originalCode, suggestion, startLine ?? 1),
    [originalCode, suggestion, startLine],
  );

  // Async syntax highlighting
  const [highlightedHtml, setHighlightedHtml] = useState<string[] | null>(null);
  const lang = filePath ? extToLang(filePath) : null;

  useEffect(() => {
    let cancelled = false;
    const plainLines = diffLines.map((l) => l.content);

    highlightLines(plainLines, lang, theme.isDark).then((html) => {
      if (!cancelled) setHighlightedHtml(html);
    });

    return () => { cancelled = true; };
  }, [diffLines, lang, theme.isDark]);

  if (diffLines.length === 0) return null;

  const s = buildStyles(theme);
  const maxLineNo = Math.max(
    ...diffLines.map((l) => l.oldLineNo ?? 0),
    ...diffLines.map((l) => l.newLineNo ?? 0),
  );
  const gutterWidth = maxLineNo.toString().length;

  return (
    <div style={s.container}>
      <div style={s.header}>
        <span style={s.headerRemoved}>- Original</span>
        <span style={s.headerAdded}>+ Suggested</span>
      </div>
      <div style={s.body}>
        {diffLines.map((line, i) => (
          <div key={i} style={getLineStyle(line.type, theme)}>
            <span style={s.gutter}>
              {line.oldLineNo !== null ? String(line.oldLineNo).padStart(gutterWidth, ' ') : ' '.repeat(gutterWidth)}
            </span>
            <span style={s.gutter}>
              {line.newLineNo !== null ? String(line.newLineNo).padStart(gutterWidth, ' ') : ' '.repeat(gutterWidth)}
            </span>
            <span style={s.marker}>
              {line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' '}
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
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff computation — simple LCS-based unified diff
// ---------------------------------------------------------------------------

function computeUnifiedDiff(
  original: string,
  suggested: string,
  baseLineNo: number,
): DiffLine[] {
  const oldLines = original.split('\n');
  const newLines = suggested.split('\n');

  const lcs = computeLCS(oldLines, newLines);
  const result: DiffLine[] = [];

  let oldIdx = 0;
  let newIdx = 0;
  let oldLineNo = baseLineNo;
  let newLineNo = baseLineNo;

  for (const match of lcs) {
    while (oldIdx < match.oldIdx) {
      result.push({ type: 'removed', content: oldLines[oldIdx], oldLineNo, newLineNo: null });
      oldIdx++;
      oldLineNo++;
    }
    while (newIdx < match.newIdx) {
      result.push({ type: 'added', content: newLines[newIdx], oldLineNo: null, newLineNo });
      newIdx++;
      newLineNo++;
    }
    result.push({ type: 'context', content: oldLines[oldIdx], oldLineNo, newLineNo });
    oldIdx++;
    newIdx++;
    oldLineNo++;
    newLineNo++;
  }

  while (oldIdx < oldLines.length) {
    result.push({ type: 'removed', content: oldLines[oldIdx], oldLineNo, newLineNo: null });
    oldIdx++;
    oldLineNo++;
  }

  while (newIdx < newLines.length) {
    result.push({ type: 'added', content: newLines[newIdx], oldLineNo: null, newLineNo });
    newIdx++;
    newLineNo++;
  }

  return result;
}

type LCSMatch = { oldIdx: number; newIdx: number };

function computeLCS(oldLines: string[], newLines: string[]): LCSMatch[] {
  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const matches: LCSMatch[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      matches.unshift({ oldIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function getLineStyle(type: DiffLine['type'], theme: OttoTheme): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'flex',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: '12px',
    lineHeight: '20px',
    whiteSpace: 'pre',
  };

  if (type === 'removed') {
    return {
      ...base,
      background: theme.isDark ? 'rgba(248, 81, 73, 0.15)' : 'rgba(255, 129, 130, 0.15)',
    };
  }
  if (type === 'added') {
    return {
      ...base,
      background: theme.isDark ? 'rgba(63, 185, 80, 0.15)' : 'rgba(46, 160, 67, 0.15)',
    };
  }
  return base;
}

function buildStyles(theme: OttoTheme) {
  return {
    container: {
      borderRadius: '6px',
      border: `1px solid ${theme.border}`,
      overflow: 'hidden',
      marginTop: '6px',
    } as React.CSSProperties,

    header: {
      display: 'flex',
      gap: '16px',
      padding: '4px 10px',
      fontSize: '11px',
      fontWeight: 600,
      background: theme.bgMuted,
      borderBottom: `1px solid ${theme.border}`,
    } as React.CSSProperties,

    headerRemoved: {
      color: theme.isDark ? '#fca5a5' : '#82071e',
    } as React.CSSProperties,

    headerAdded: {
      color: theme.isDark ? '#7ee787' : '#116329',
    } as React.CSSProperties,

    body: {
      overflowX: 'auto',
      maxHeight: '400px',
      overflowY: 'auto',
    } as React.CSSProperties,

    gutter: {
      display: 'inline-block',
      width: '32px',
      textAlign: 'right' as const,
      paddingRight: '8px',
      color: theme.textMuted,
      userSelect: 'none' as const,
      flexShrink: 0,
    } as React.CSSProperties,

    marker: {
      display: 'inline-block',
      width: '16px',
      textAlign: 'center' as const,
      userSelect: 'none' as const,
      flexShrink: 0,
      fontWeight: 700,
      color: theme.textMuted,
    } as React.CSSProperties,

    code: {
      flex: 1,
      paddingRight: '10px',
    } as React.CSSProperties,
  };
}
