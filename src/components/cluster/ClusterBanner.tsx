// ---------------------------------------------------------------------------
// ClusterBanner — shows related MRs sharing a ticket or overlapping files.
//
// Rendered inside MrOverviewPanel, after the conflict banner. Shows cluster
// members as linked pills with signals explaining why they're grouped.
// "View unified summary" button triggers cluster summary generation if not cached.
//
// Uses inline styles (shadow DOM compatible) and ThemeContext for colors.
// ---------------------------------------------------------------------------

import { useState, useMemo } from 'react';
import { GitMerge, ChevronDown, ChevronRight, Tag, FileCode } from 'lucide-react';
import { useClusterStore } from '@/services/cluster/cluster-store';
import { useTheme } from '@/components/ThemeContext';
import type { MrCluster, ClusterSignal, ClusterMember } from '@/types/cluster';

export function ClusterBanner({ showSummary = true }: { showSummary?: boolean }) {
  const theme = useTheme();
  const clusters = useClusterStore((s) => s.clusters);
  const status = useClusterStore((s) => s.status);

  if (status !== 'loaded' || clusters.length === 0) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      {clusters.map((cluster) => (
        <ClusterCard key={cluster.id} cluster={cluster} showSummary={showSummary} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClusterCard — one card per cluster
// ---------------------------------------------------------------------------

function ClusterCard({ cluster, showSummary }: { cluster: MrCluster; showSummary: boolean }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const signalLabel = useMemo(() => {
    const parts: string[] = [];
    for (const signal of cluster.signals) {
      if (signal.type === 'shared_ticket') {
        parts.push(`Ticket: ${signal.ticketKey}`);
      } else if (signal.type === 'file_overlap') {
        parts.push(`${signal.sharedFiles.length} shared files`);
      }
    }
    return parts.join(' · ');
  }, [cluster.signals]);

  return (
    <div
      style={{
        border: `1px solid ${theme.borderSubtle}`,
        borderRadius: 8,
        background: theme.bgSubtle,
        padding: '10px 14px',
      }}
    >
      {/* Header row */}
      <button
        type="button"
        aria-expanded={expanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          userSelect: 'none',
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          font: 'inherit',
          textAlign: 'left',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <GitMerge size={15} color={theme.brand} />
        <span style={{ color: theme.text, fontWeight: 600, fontSize: 13 }}>
          Related MRs
        </span>
        <span style={{ color: theme.textMuted, fontSize: 12 }}>
          {signalLabel}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Member pills (always visible) */}
          {cluster.memberMrs.map((member) => (
            <MemberPill key={member.mrIid} member={member} />
          ))}
          {expanded
            ? <ChevronDown size={14} color={theme.textMuted} />
            : <ChevronRight size={14} color={theme.textMuted} />}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div style={{ marginTop: 10 }}>
          {/* Signal details */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
            {cluster.signals.map((signal, i) => (
              <SignalRow key={i} signal={signal} />
            ))}
          </div>

          {/* Member details */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {cluster.memberMrs.map((member) => (
              <MemberRow key={member.mrIid} member={member} />
            ))}
          </div>

          {/* Summary (if available and enabled via clusterSummary toggle) */}
          {showSummary && cluster.summary && (
            <div
              style={{
                marginTop: 10,
                padding: '8px 12px',
                background: theme.bgInset,
                borderRadius: 6,
                fontSize: 12,
                color: theme.textSecondary,
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 600, color: theme.text, marginBottom: 4, fontSize: 12 }}>
                Unified Summary
              </div>
              {cluster.summary.narrative}
              {cluster.summary.integrationConcerns.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <span style={{ fontWeight: 600, color: theme.warning }}>Integration concerns: </span>
                  {cluster.summary.integrationConcerns.join('; ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MemberPill({ member }: { member: ClusterMember }) {
  const theme = useTheme();

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '1px 7px',
        borderRadius: 10,
        background: theme.bgMuted,
        border: `1px solid ${theme.borderSubtle}`,
        fontSize: 11,
        color: theme.brand,
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      !{member.mrIid}
    </span>
  );
}

function MemberRow({ member }: { member: ClusterMember }) {
  const theme = useTheme();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <span style={{ color: theme.brand, fontWeight: 600 }}>!{member.mrIid}</span>
      <span style={{ color: theme.text }}>{member.mrTitle}</span>
      <span style={{ color: theme.textMuted }}>by {member.author}</span>
      {member.role && (
        <span
          style={{
            padding: '0 5px',
            borderRadius: 6,
            background: theme.infoBg,
            border: `1px solid ${theme.infoBorder}`,
            color: theme.info,
            fontSize: 10,
            fontWeight: 500,
          }}
        >
          {member.role}
        </span>
      )}
    </div>
  );
}

function SignalRow({ signal }: { signal: ClusterSignal }) {
  const theme = useTheme();

  if (signal.type === 'shared_ticket') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: theme.textSecondary }}>
        <Tag size={11} color={theme.textMuted} />
        Shared ticket: <span style={{ fontWeight: 600, color: theme.text }}>{signal.ticketKey}</span>
      </div>
    );
  }

  if (signal.type === 'file_overlap') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: theme.textSecondary }}>
        <FileCode size={11} color={theme.textMuted} />
        {signal.sharedFiles.length} shared {signal.sharedFiles.length === 1 ? 'file' : 'files'}
        <span style={{ color: theme.textMuted }}>(Jaccard: {(signal.jaccard * 100).toFixed(0)}%)</span>
      </div>
    );
  }

  return null;
}
