// ---------------------------------------------------------------------------
// ConflictBanner — top-of-MR warning about overlapping in-flight MRs.
//
// Rendered inside MrOverviewPanel, after the summary section. Shows a count
// of conflicts grouped by severity, with expandable details per file.
// Collapsed by default if all conflicts are medium severity.
//
// Uses inline styles (shadow DOM compatible) and ThemeContext for colors.
// ---------------------------------------------------------------------------

import { useState, useMemo } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useConflictStore } from '@/services/conflict/conflict-store';
import { useTheme } from '@/components/ThemeContext';
import type { FileConflict, ConflictingMr } from '@/types/conflict';

export function ConflictBanner({ hideSemanticNotes = false }: { hideSemanticNotes?: boolean }) {
  const theme = useTheme();
  const report = useConflictStore((s) => s.report);
  const status = useConflictStore((s) => s.status);

  const [expanded, setExpanded] = useState(false);

  const { highCount, mediumCount, totalFiles } = useMemo(() => {
    if (!report) return { highCount: 0, mediumCount: 0, totalFiles: 0 };
    let high = 0;
    let medium = 0;
    for (const fc of report.conflicts) {
      for (const cm of fc.conflictingMrs) {
        if (cm.severity === 'high') high++;
        else medium++;
      }
    }
    return { highCount: high, mediumCount: medium, totalFiles: report.conflicts.length };
  }, [report]);

  // Don't render if no conflicts or still loading
  if (status !== 'loaded' || !report || report.conflicts.length === 0) {
    return null;
  }

  const hasHigh = highCount > 0;
  const borderColor = hasHigh ? theme.error : theme.warning;
  const bgColor = hasHigh ? theme.errorBg : theme.warningBg;
  const iconColor = hasHigh ? theme.error : theme.warning;

  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        background: bgColor,
        padding: '10px 14px',
        marginBottom: 12,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <AlertTriangle size={16} color={iconColor} />
        <span style={{ color: theme.text, fontWeight: 600, fontSize: 13 }}>
          Conflict Radar
        </span>
        <span style={{ color: theme.textSecondary, fontSize: 12 }}>
          {totalFiles} {totalFiles === 1 ? 'file' : 'files'} overlap with other open MRs
          {highCount > 0 && (
            <span style={{ color: theme.error, fontWeight: 600 }}>
              {' '}({highCount} line-level)
            </span>
          )}
          {mediumCount > 0 && (
            <span style={{ color: theme.warning }}>
              {highCount > 0 ? ', ' : ' ('}{mediumCount} same-file{highCount === 0 ? ')' : ')'}
            </span>
          )}
        </span>
        <div style={{ marginLeft: 'auto' }}>
          {expanded
            ? <ChevronDown size={14} color={theme.textMuted} />
            : <ChevronRight size={14} color={theme.textMuted} />}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ marginTop: 10 }}>
          {report.conflicts.map((fc) => (
            <FileConflictRow key={fc.filePath} fileConflict={fc} hideSemanticNotes={hideSemanticNotes} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileConflictRow — one row per conflicting file
// ---------------------------------------------------------------------------

function FileConflictRow({ fileConflict, hideSemanticNotes }: { fileConflict: FileConflict; hideSemanticNotes: boolean }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const maxSeverity = fileConflict.conflictingMrs.some((cm) => cm.severity === 'high')
    ? 'high'
    : 'medium';

  return (
    <div
      style={{
        borderTop: `1px solid ${theme.borderSubtle}`,
        paddingTop: 8,
        marginTop: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setOpen(!open)}
      >
        {open
          ? <ChevronDown size={12} color={theme.textMuted} />
          : <ChevronRight size={12} color={theme.textMuted} />}
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: maxSeverity === 'high' ? theme.error : theme.warning,
            flexShrink: 0,
          }}
        />
        <code style={{ color: theme.text, fontSize: 12 }}>
          {fileConflict.filePath}
        </code>
        <span style={{ color: theme.textMuted, fontSize: 11 }}>
          ({fileConflict.conflictingMrs.length} {fileConflict.conflictingMrs.length === 1 ? 'MR' : 'MRs'})
        </span>
      </div>

      {open && (
        <div style={{ marginLeft: 26, marginTop: 6 }}>
          {fileConflict.conflictingMrs.map((cm) => (
            <ConflictingMrRow key={cm.mrIid} cm={cm} hideSemanticNotes={hideSemanticNotes} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConflictingMrRow — details about one conflicting MR on a file
// ---------------------------------------------------------------------------

function ConflictingMrRow({ cm, hideSemanticNotes }: { cm: ConflictingMr; hideSemanticNotes: boolean }) {
  const theme = useTheme();

  const lineInfo = cm.overlapType === 'line_range'
    ? formatLineRange(cm.theirHunks)
    : 'different regions';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        marginBottom: 6,
        fontSize: 12,
      }}
    >
      <span
        style={{
          color: cm.severity === 'high' ? theme.error : theme.warning,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {cm.severity === 'high' ? 'Lines overlap' : 'Same file'}
      </span>
      <span style={{ color: theme.textSecondary }}>
        <a
          href={cm.webUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: theme.brand, textDecoration: 'none' }}
        >
          !{cm.mrIid}
        </a>
        {' '}{cm.mrTitle}
        {' '}
        <span style={{ color: theme.textMuted }}>
          by {cm.author} · {lineInfo}
        </span>
      </span>
      {cm.webUrl && (
        <a
          href={cm.webUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: theme.textMuted, flexShrink: 0 }}
        >
          <ExternalLink size={11} />
        </a>
      )}
      {!hideSemanticNotes && cm.semanticNote && (
        <div
          style={{
            marginTop: 4,
            padding: '4px 8px',
            background: theme.bgSubtle,
            borderRadius: 4,
            color: theme.textSecondary,
            fontSize: 11,
            lineHeight: 1.4,
          }}
        >
          {cm.semanticNote}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLineRange(hunks: { oldStart: number; oldCount: number }[]): string {
  if (hunks.length === 0) return '';
  if (hunks.length === 1) {
    const h = hunks[0];
    return `lines ${h.oldStart}-${h.oldStart + h.oldCount}`;
  }
  return `${hunks.length} regions`;
}
