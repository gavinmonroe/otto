// ---------------------------------------------------------------------------
// FixTerminal — inline terminal panel showing live container output during
// a sandbox fix. Rendered below the fix status in ReviewActions and
// FollowUpPanel.
//
// Design:
//   - Monospace, dark background, auto-scrolls to bottom
//   - stderr lines in muted red/orange
//   - Collapsible via header click
//   - Max height 200px with overflow scroll
//   - Inline styles (shadow DOM compatible)
//   - 500-line cap enforced by the store
// ---------------------------------------------------------------------------

import { useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Terminal } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import type { FixOutputLine } from '@/services/review/review-store';

type FixTerminalProps = {
  lines: FixOutputLine[];
  expanded: boolean;
  onToggle: () => void;
};

export function FixTerminal({ lines, expanded, onToggle }: FixTerminalProps) {
  const theme = useTheme();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length, expanded]);

  if (lines.length === 0) return null;

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '3px 6px',
    fontSize: '10px',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    color: theme.textMuted,
    cursor: 'pointer',
    userSelect: 'none',
    borderRadius: expanded ? '4px 4px 0 0' : '4px',
    background: theme.isDark ? '#1a1a2e' : '#1e1e1e',
    border: `1px solid ${theme.isDark ? '#2a2a3e' : '#333'}`,
    borderBottom: expanded ? 'none' : undefined,
  };

  const bodyStyle: React.CSSProperties = {
    maxHeight: '200px',
    overflowY: 'auto',
    overflowX: 'auto',
    padding: '6px 8px',
    fontSize: '11px',
    lineHeight: '1.5',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    background: theme.isDark ? '#1a1a2e' : '#1e1e1e',
    color: theme.isDark ? '#d4d4d8' : '#d4d4d4',
    borderRadius: '0 0 4px 4px',
    border: `1px solid ${theme.isDark ? '#2a2a3e' : '#333'}`,
    borderTop: 'none',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  };

  const stderrColor = theme.isDark ? '#f87171' : '#ef9a9a';

  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div style={{ marginTop: '4px' }}>
      <div style={headerStyle} onClick={onToggle}>
        <Chevron size={10} />
        <Terminal size={10} />
        <span>Terminal output ({lines.length} lines)</span>
      </div>
      {expanded && (
        <div ref={scrollRef} style={bodyStyle}>
          {lines.map((line, i) => (
            <div
              key={i}
              style={{
                color: line.stream === 'stderr' ? stderrColor : undefined,
                minHeight: '1em',
              }}
            >
              {line.text || '\u00A0'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
