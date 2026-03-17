// ---------------------------------------------------------------------------
// ConflictFileMarker — badge injected into diff file headers.
//
// Shows an orange (medium) or red (high) indicator when other in-flight MRs
// also modify this file. Tooltip shows which MRs and line ranges.
//
// Uses inline styles (shadow DOM compatible) and ThemeContext for colors.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getConflictsForFile } from '@/services/conflict/conflict-store';
import { useConflictStore } from '@/services/conflict/conflict-store';
import { useTheme } from '@/components/ThemeContext';

type ConflictFileMarkerProps = {
  filePath: string;
};

export function ConflictFileMarker({ filePath }: ConflictFileMarkerProps) {
  const theme = useTheme();
  const [showTooltip, setShowTooltip] = useState(false);

  // Subscribe to the store so we re-render when conflicts change
  const report = useConflictStore((s) => s.report);
  const conflicts = getConflictsForFile(filePath);

  if (conflicts.length === 0) return null;

  const hasHigh = conflicts.some((cm) => cm.severity === 'high');
  const color = hasHigh ? theme.error : theme.warning;

  const tooltipId = `otto-conflict-tooltip-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => setShowTooltip(true)}
      onBlur={() => setShowTooltip(false)}
      tabIndex={0}
      role="button"
      aria-describedby={showTooltip ? tooltipId : undefined}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '1px 6px',
          borderRadius: 10,
          background: hasHigh ? theme.errorBg : theme.warningBg,
          border: `1px solid ${hasHigh ? theme.errorBorder : theme.warningBorder}`,
          fontSize: 11,
          fontWeight: 600,
          color,
          cursor: 'default',
          lineHeight: 1.4,
        }}
      >
        <AlertTriangle size={10} />
        {conflicts.length}
      </span>

      {/* Tooltip */}
      {showTooltip && (
        <div
          id={tooltipId}
          role="tooltip"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            padding: '6px 10px',
            background: theme.bg,
            border: `1px solid ${theme.border}`,
            borderRadius: 6,
            boxShadow: `0 4px 12px rgba(0,0,0,${theme.isDark ? 0.4 : 0.08})`,
            zIndex: 1000,
            minWidth: 220,
            maxWidth: 360,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.text, marginBottom: 4 }}>
            {conflicts.length === 1 ? '1 other MR' : `${conflicts.length} other MRs`} also modify this file
          </div>
          {conflicts.map((cm) => (
            <div
              key={cm.mrIid}
              style={{
                fontSize: 11,
                color: theme.textSecondary,
                marginBottom: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: cm.severity === 'high' ? theme.error : theme.warning,
                  flexShrink: 0,
                }}
              />
              <a
                href={cm.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: theme.brand, textDecoration: 'none' }}
              >
                !{cm.mrIid}
              </a>
              <span style={{ color: theme.textMuted }}>
                {cm.overlapType === 'line_range' ? 'overlapping lines' : 'same file'}
              </span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
