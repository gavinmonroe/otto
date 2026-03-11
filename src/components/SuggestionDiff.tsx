// ---------------------------------------------------------------------------
// SuggestionDiff — lightweight unified diff view for code suggestions.
//
// Renders original vs suggested code side-by-side in a single unified view
// with red (removed) and green (added) line highlighting, matching the
// familiar git diff / GitLab MR diff style.
//
// No external dependencies — just inline styles + ThemeContext.
// ---------------------------------------------------------------------------

import { useTheme, type OttoTheme } from '@/components/ThemeContext';

type SuggestionDiffProps = {
  originalCode: string;
  suggestion: string;
  /** Starting line number for the original code (for gutter display) */
  startLine?: number | null;
};

type DiffLine = {
  type: 'context' | 'removed' | 'added';
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
};

export function SuggestionDiff({ originalCode, suggestion, startLine }: SuggestionDiffProps) {
  const theme = useTheme();
  const diffLines = computeUnifiedDiff(originalCode, suggestion, startLine ?? 1);

  if (diffLines.length === 0) return null;

  const s = buildStyles(theme);
  const gutterWidth = Math.max(
    ...diffLines.map((l) => l.oldLineNo ?? 0),
    ...diffLines.map((l) => l.newLineNo ?? 0),
  ).toString().length;

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
            <span style={s.code}>{line.content}</span>
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

  // Simple LCS to find matching lines
  const lcs = computeLCS(oldLines, newLines);
  const result: DiffLine[] = [];

  let oldIdx = 0;
  let newIdx = 0;
  let oldLineNo = baseLineNo;
  let newLineNo = baseLineNo;

  for (const match of lcs) {
    // Lines removed before this match
    while (oldIdx < match.oldIdx) {
      result.push({
        type: 'removed',
        content: oldLines[oldIdx],
        oldLineNo: oldLineNo,
        newLineNo: null,
      });
      oldIdx++;
      oldLineNo++;
    }
    // Lines added before this match
    while (newIdx < match.newIdx) {
      result.push({
        type: 'added',
        content: newLines[newIdx],
        oldLineNo: null,
        newLineNo: newLineNo,
      });
      newIdx++;
      newLineNo++;
    }
    // Context line (matching)
    result.push({
      type: 'context',
      content: oldLines[oldIdx],
      oldLineNo: oldLineNo,
      newLineNo: newLineNo,
    });
    oldIdx++;
    newIdx++;
    oldLineNo++;
    newLineNo++;
  }

  // Remaining removed lines
  while (oldIdx < oldLines.length) {
    result.push({
      type: 'removed',
      content: oldLines[oldIdx],
      oldLineNo: oldLineNo,
      newLineNo: null,
    });
    oldIdx++;
    oldLineNo++;
  }

  // Remaining added lines
  while (newIdx < newLines.length) {
    result.push({
      type: 'added',
      content: newLines[newIdx],
      oldLineNo: null,
      newLineNo: newLineNo,
    });
    newIdx++;
    newLineNo++;
  }

  return result;
}

type LCSMatch = { oldIdx: number; newIdx: number };

function computeLCS(oldLines: string[], newLines: string[]): LCSMatch[] {
  const m = oldLines.length;
  const n = newLines.length;

  // DP table
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

  // Backtrack to find matches
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
      color: theme.isDark ? '#fca5a5' : '#82071e',
    };
  }
  if (type === 'added') {
    return {
      ...base,
      background: theme.isDark ? 'rgba(63, 185, 80, 0.15)' : 'rgba(46, 160, 67, 0.15)',
      color: theme.isDark ? '#7ee787' : '#116329',
    };
  }
  return {
    ...base,
    color: theme.text,
  };
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
    } as React.CSSProperties,

    code: {
      flex: 1,
      paddingRight: '10px',
    } as React.CSSProperties,
  };
}
