// ---------------------------------------------------------------------------
// FollowUpPanel — renders the AI analysis of a GitLab comment thread.
//
// Injected below the discussion container when the user clicks the Otto
// follow-up button. Shows three sections:
// 1. Perspective — where the commenter is coming from (with intent badge)
// 2. Interpretation — what the comment concretely means
// 3. Recommended Action — emoji, reply draft, or code change diffs
//
// Design decisions:
// - Reuses SuggestionDiff for code change previews (same component as
//   the review system uses for suggestions).
// - Reuses Markdown for rendering AI-generated text.
// - Intent badge is color-coded to quickly communicate the comment type.
// - Reply drafts include a "Copy" button for easy pasting into GitLab.
// - Inline styles + shadow DOM for CSS isolation, same as all Otto UI.
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect } from 'react';
import { MessageSquare, Code, Smile, Copy, Check, ChevronDown, ChevronRight, X, Wrench, Loader2 } from 'lucide-react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { Markdown } from '@/components/Markdown';
import { SuggestionDiff } from '@/components/SuggestionDiff';
import { OttoLogo } from '@/components/OttoLogo';
import { useReviewStore, FIX_STAGE_LABELS } from '@/services/review/review-store';
import { getBottoClient } from '@/lib/botto-client';
import type { FollowUpAnalysis, CommentIntent, FollowUpAction, FileChange } from '@/types/followup';

type FollowUpPanelProps = {
  analysis: FollowUpAnalysis;
  onDismiss: () => void;
};

export function FollowUpPanel({ analysis, onDismiss }: FollowUpPanelProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(true);
  const s = buildStyles(theme);

  const intentConfig = getIntentConfig(analysis.intent, theme);

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <button onClick={() => setExpanded(!expanded)} style={s.headerToggle}>
          <OttoLogo size={16} />
          {expanded ? <ChevronDown size={14} style={{ color: theme.textMuted }} /> : <ChevronRight size={14} style={{ color: theme.textMuted }} />}
          <span style={s.headerTitle}>Follow-Up Analysis</span>
          <span style={{
            ...s.intentBadge,
            background: intentConfig.bg,
            color: intentConfig.color,
            borderColor: intentConfig.border,
          }}>
            {intentConfig.label}
          </span>
        </button>
        <button onClick={onDismiss} style={s.dismissBtn} title="Dismiss" aria-label="Dismiss follow-up">
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      {expanded && (
        <div style={s.body}>
          {/* Perspective */}
          <Section
            icon={<MessageSquare size={14} style={{ color: theme.brand }} />}
            title="Where they're coming from"
            theme={theme}
          >
            <Markdown content={analysis.perspective} compact />
          </Section>

          {/* Interpretation */}
          <Section
            icon={<MessageSquare size={14} style={{ color: theme.warning }} />}
            title="What they're saying"
            theme={theme}
          >
            <Markdown content={analysis.interpretation} compact />
          </Section>

          {/* Recommended Action */}
          <ActionSection action={analysis.recommendedAction} commentId={analysis.commentId} theme={theme} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ icon, title, theme, children }: {
  icon: React.ReactNode;
  title: string;
  theme: OttoTheme;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '6px',
      }}>
        {icon}
        <span style={{
          fontSize: '12px',
          fontWeight: 600,
          color: theme.textSecondary,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
        }}>
          {title}
        </span>
      </div>
      <div style={{ fontSize: '13px', color: theme.text, paddingLeft: '20px' }}>
        {children}
      </div>
    </div>
  );
}

function ActionSection({ action, commentId, theme }: { action: FollowUpAction; commentId: string; theme: OttoTheme }) {
  if (action.type === 'emoji') {
    return (
      <Section
        icon={<Smile size={14} style={{ color: theme.success }} />}
        title="Recommended action"
        theme={theme}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 12px',
          background: theme.bgSubtle,
          borderRadius: '6px',
          border: `1px solid ${theme.border}`,
        }}>
          <span style={{ fontSize: '24px' }}>{action.emoji}</span>
          <span style={{ fontSize: '13px', color: theme.textSecondary }}>{action.reason}</span>
        </div>
      </Section>
    );
  }

  if (action.type === 'reply') {
    return (
      <Section
        icon={<MessageSquare size={14} style={{ color: theme.success }} />}
        title="Recommended reply"
        theme={theme}
      >
        <div style={{ marginBottom: '6px' }}>
          <span style={{
            fontSize: '11px',
            color: theme.textMuted,
            fontStyle: 'italic',
          }}>
            Tone: {action.tone}
          </span>
        </div>
        <ReplyDraft draft={action.draft} theme={theme} />
      </Section>
    );
  }

  if (action.type === 'code-change') {
    return (
      <Section
        icon={<Code size={14} style={{ color: theme.success }} />}
        title={`Recommended changes (${action.changes.length} file${action.changes.length > 1 ? 's' : ''})`}
        theme={theme}
      >
        <div style={{ fontSize: '13px', color: theme.textSecondary, marginBottom: '8px' }}>
          <Markdown content={action.summary} compact />
        </div>
        {action.changes.map((change, i) => (
          <div key={i} style={{ marginBottom: '10px' }}>
            <div style={{
              fontSize: '12px',
              fontWeight: 600,
              color: theme.brandText,
              marginBottom: '4px',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
            }}>
              {change.filePath}
              {change.startLine > 0 && (
                <span style={{ color: theme.textMuted, fontWeight: 400 }}>
                  :{change.startLine}–{change.endLine}
                </span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: theme.textSecondary, marginBottom: '4px' }}>
              {change.explanation}
            </div>
            <SuggestionDiff
              originalCode={change.originalCode}
              suggestion={change.suggestedCode}
              filePath={change.filePath}
              startLine={change.startLine}
            />
            <FollowUpFixButton
              change={change}
              commentId={commentId}
              changeIndex={i}
              theme={theme}
            />
          </div>
        ))}
      </Section>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// FollowUpFixButton — triggers a sandbox fix for a single FileChange.
// Same pattern as ReviewActions fix button, but scoped to follow-up changes.
// Uses a composite key (followup-{noteId}-{idx}) so fix job tracking
// doesn't collide with review comment fix jobs.
// ---------------------------------------------------------------------------

function FollowUpFixButton({ change, commentId, changeIndex, theme }: {
  change: FileChange;
  commentId: string;
  changeIndex: number;
  theme: OttoTheme;
}) {
  // Stable key for this specific change's fix job
  const fixKey = `followup-${commentId}-${changeIndex}`;

  const fixJob = useReviewStore((s) => s.fixJobs[fixKey]);
  const mrContext = useReviewStore((s) => s.mrContext);

  // Track Botto connection state reactively
  const [bottoConnected, setBottoConnected] = useState(() => {
    try {
      const settings = (globalThis as any).__ottoSettings;
      const client = getBottoClient(settings);
      return client?.isConnected() ?? false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      const settings = (globalThis as any).__ottoSettings;
      const client = getBottoClient(settings);
      if (!client) return;
      return client.onConnectionChange((state) => {
        setBottoConnected(state === 'connected');
      });
    } catch {
      // ignore
    }
  }, []);

  const canFix = (() => {
    if (!change.originalCode || !change.suggestedCode) return false;
    if (!bottoConnected) return false;
    try {
      const settings = (globalThis as any).__ottoSettings;
      const client = getBottoClient(settings);
      const caps = client?.getCapabilities();
      return caps?.sandbox_enabled ?? false;
    } catch {
      return false;
    }
  })();

  const handleFix = useCallback(() => {
    if (!mrContext) return;

    const settings = (globalThis as any).__ottoSettings;
    const bottoClient = getBottoClient(settings);
    if (!bottoClient?.isConnected()) return;

    // Start tracking in the store
    useReviewStore.getState().startFixJob(fixKey);

    // Parse the GitLab note ID from the commentId for reply threading
    const gitlabNoteId = parseInt(commentId, 10);

    bottoClient.requestFix(
      mrContext.projectPath,
      mrContext.mrIid,
      fixKey,                       // comment_id — used for fix job tracking
      change.suggestedCode,         // suggestion
      change.filePath,              // file_path
      change.originalCode,          // original_code
      mrContext.sourceBranch,
      change.explanation,           // comment_body — context for the AI
      `Follow-up fix: ${change.filePath}`, // comment_title
      undefined,                    // severity
      mrContext.targetBranch,
      change.startLine > 0 ? change.startLine : undefined,
      change.endLine > 0 ? change.endLine : undefined,
      isNaN(gitlabNoteId) ? undefined : gitlabNoteId,
    );
  }, [change, commentId, fixKey, mrContext]);

  const btnBase: React.CSSProperties = {
    padding: '2px 8px',
    borderRadius: '3px',
    fontSize: '11px',
    cursor: 'pointer',
    border: `1px solid ${theme.border}`,
    background: 'transparent',
    color: theme.brandText,
  };

  // Fix in progress or completed — show inline status
  if (fixJob) {
    const label = fixJob.detail || FIX_STAGE_LABELS[fixJob.status] || fixJob.status;

    if (fixJob.status === 'complete') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
          <span style={{ fontSize: '11px', color: theme.success, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Check size={12} />
            Fix applied
            {fixJob.commitSha && (
              <code style={{ fontSize: '10px', color: theme.textMuted, marginLeft: '4px' }}>
                {fixJob.commitSha.slice(0, 8)}
              </code>
            )}
          </span>
          <button
            style={{ ...btnBase, fontSize: '10px', padding: '1px 6px', alignSelf: 'flex-start' }}
            onClick={() => useReviewStore.getState().clearFixJob(fixKey)}
          >
            Dismiss
          </button>
        </div>
      );
    }

    if (fixJob.status === 'failed') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
          <span style={{ fontSize: '11px', color: theme.isDark ? '#fca5a5' : '#991b1b', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <X size={12} />
            {fixJob.error || 'Fix failed'}
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button style={{ ...btnBase, fontSize: '10px', padding: '1px 6px' }} onClick={handleFix}>
              Retry
            </button>
            <button
              style={{ ...btnBase, fontSize: '10px', padding: '1px 6px' }}
              onClick={() => useReviewStore.getState().clearFixJob(fixKey)}
            >
              Dismiss
            </button>
          </div>
        </div>
      );
    }

    // Active fix in progress
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
        <Loader2 size={12} style={{ animation: 'otto-spin 1s linear infinite', color: theme.brandText }} />
        <span style={{ fontSize: '11px', color: theme.textSecondary }}>{label}</span>
      </div>
    );
  }

  if (!canFix) return null;

  return (
    <div style={{ marginTop: '6px' }}>
      <button
        style={{
          ...btnBase,
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
          background: theme.isDark ? '#1e1b4b' : '#eef2ff',
          color: theme.isDark ? '#a5b4fc' : '#4338ca',
          borderColor: theme.isDark ? '#312e81' : '#a5b4fc',
        }}
        onClick={handleFix}
        title="Auto-fix: clone, apply, test, and push this change in a sandbox"
      >
        <Wrench size={11} />
        Fix
      </button>
    </div>
  );
}

function ReplyDraft({ draft, theme }: { draft: string; theme: OttoTheme }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in some contexts
    }
  }, [draft]);

  return (
    <div style={{
      position: 'relative' as const,
      padding: '10px 12px',
      background: theme.bgSubtle,
      borderRadius: '6px',
      border: `1px solid ${theme.border}`,
    }}>
      <div style={{ fontSize: '13px', paddingRight: '32px' }}>
        <Markdown content={draft} compact />
      </div>
      <button
        onClick={handleCopy}
        style={{
          position: 'absolute' as const,
          top: '8px',
          right: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '26px',
          height: '26px',
          borderRadius: '4px',
          border: `1px solid ${theme.border}`,
          background: theme.bg,
          cursor: 'pointer',
          color: copied ? theme.success : theme.textMuted,
        }}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
        aria-label="Copy reply to clipboard"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Intent configuration
// ---------------------------------------------------------------------------

function getIntentConfig(intent: CommentIntent, theme: OttoTheme): {
  label: string;
  color: string;
  bg: string;
  border: string;
} {
  const configs: Record<CommentIntent, { label: string; light: [string, string, string]; dark: [string, string, string] }> = {
    'question': { label: 'Question', light: ['#1d4ed8', '#eff6ff', '#bfdbfe'], dark: ['#93c5fd', '#1e3a5f', '#1e40af'] },
    'suggestion': { label: 'Suggestion', light: ['#7c3aed', '#f5f3ff', '#ddd6fe'], dark: ['#c4b5fd', '#2e1065', '#5b21b6'] },
    'nitpick': { label: 'Nitpick', light: ['#6b7280', '#f9fafb', '#e5e7eb'], dark: ['#9ca3af', '#1f2937', '#374151'] },
    'required-change': { label: 'Required', light: ['#dc2626', '#fef2f2', '#fecaca'], dark: ['#fca5a5', '#450a0a', '#7f1d1d'] },
    'praise': { label: 'Praise', light: ['#16a34a', '#f0fdf4', '#bbf7d0'], dark: ['#4ade80', '#052e16', '#166534'] },
    'discussion': { label: 'Discussion', light: ['#d97706', '#fffbeb', '#fde68a'], dark: ['#fbbf24', '#451a03', '#92400e'] },
    'emoji-reaction': { label: 'Reaction', light: ['#ec4899', '#fdf2f8', '#fbcfe8'], dark: ['#f9a8d4', '#500724', '#9d174d'] },
  };

  const config = configs[intent] || configs['discussion'];
  const [color, bg, border] = theme.isDark ? config.dark : config.light;
  return { label: config.label, color, bg, border };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function buildStyles(theme: OttoTheme) {
  return {
    container: {
      borderLeft: `3px solid ${theme.brand}`,
      background: theme.isDark ? '#1a1f2e' : '#f8faff',
      borderRadius: '0 6px 6px 0',
      marginTop: '8px',
      marginBottom: '8px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflow: 'hidden',
    } as React.CSSProperties,

    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 12px',
      borderBottom: `1px solid ${theme.border}`,
    } as React.CSSProperties,

    headerToggle: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      padding: 0,
      flex: 1,
    } as React.CSSProperties,

    headerTitle: {
      fontSize: '13px',
      fontWeight: 600,
      color: theme.text,
    } as React.CSSProperties,

    intentBadge: {
      fontSize: '11px',
      fontWeight: 600,
      padding: '1px 8px',
      borderRadius: '10px',
      border: '1px solid',
    } as React.CSSProperties,

    dismissBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '24px',
      height: '24px',
      borderRadius: '4px',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: theme.textMuted,
      flexShrink: 0,
    } as React.CSSProperties,

    body: {
      padding: '12px 14px',
    } as React.CSSProperties,
  };
}
