// ---------------------------------------------------------------------------
// LanguageBar — multi-segment progress bar showing language breakdown.
//
// Renders a horizontal bar where each segment represents a language's
// proportion of total lines changed. Follows the GitHub repo language bar
// pattern but uses Otto's design language (inline styles + ThemeContext).
//
// Design decisions:
// - Minimum segment width of 3px so tiny languages are still visible.
// - Tooltip on hover shows language name + percentage.
// - Empty state (no languages) renders nothing — the parent handles this.
// - Uses CSS transitions for smooth appearance on load.
// - Border radius matches the existing pill pattern (3px).
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useTheme } from '@/components/ThemeContext';
import type { LanguageBreakdown } from '@/types/mr-preview';

type Props = {
  languages: LanguageBreakdown[];
};

export function LanguageBar({ languages }: Props) {
  const theme = useTheme();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (languages.length === 0) return null;

  return (
    <div style={containerStyle}>
      {/* Tooltip renders outside the overflow:hidden bar to avoid clipping */}
      {hoveredIndex !== null && languages[hoveredIndex] && (
        <div style={{
          ...tooltipStyle,
          background: theme.bg,
          color: theme.text,
          border: `1px solid ${theme.border}`,
          boxShadow: theme.isDark
            ? '0 2px 8px rgba(0,0,0,0.4)'
            : '0 2px 8px rgba(0,0,0,0.1)',
        }}>
          <span style={{ ...tooltipDotStyle, background: languages[hoveredIndex].color }} />
          {languages[hoveredIndex].language} {languages[hoveredIndex].percentage}%
        </div>
      )}
      <div style={{ ...barStyle, background: theme.bgMuted }}>
        {languages.map((lang, i) => (
          <div
            key={lang.language}
            style={{
              ...segmentStyle,
              background: lang.color,
              // Use flex-grow proportional to percentage so the bar fills naturally.
              // minWidth ensures tiny segments remain visible.
              flexGrow: lang.percentage,
              minWidth: '3px',
            }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  minWidth: '80px',
  maxWidth: '160px',
  flex: '1 1 80px',
  position: 'relative',
};

const barStyle: React.CSSProperties = {
  display: 'flex',
  width: '100%',
  height: '6px',
  borderRadius: '3px',
  overflow: 'hidden',
  gap: '1px',
};

const segmentStyle: React.CSSProperties = {
  position: 'relative',
  height: '100%',
  cursor: 'default',
  transition: 'opacity 0.15s',
};

const tooltipStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: '50%',
  transform: 'translateX(-50%)',
  marginBottom: '4px',
  padding: '3px 8px',
  borderRadius: '4px',
  fontSize: '10px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  zIndex: 10,
  pointerEvents: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
};

const tooltipDotStyle: React.CSSProperties = {
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  flexShrink: 0,
};
