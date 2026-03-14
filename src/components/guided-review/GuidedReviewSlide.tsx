// ---------------------------------------------------------------------------
// GuidedReviewSlide — renders a single slide in the guided review mode.
//
// Switches on `slide.kind` to render the appropriate layout:
// - comment: severity badge, title, body, code suggestion, actions
// - edgeCase: severity, description, hypothetical trace
// - thread: GitLab discussion notes with file context
//
// Each slide also shows:
// - File context header (path, risk level, file summary)
// - Related files relevant to this slide's file
// - Code suggestion diff (for comments with suggestions)
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { Markdown } from '@/components/Markdown';
import { SuggestionDiff } from '@/components/SuggestionDiff';
import { ReviewActions } from '@/components/review/ReviewActions';
import { useReviewStore } from '@/services/review/review-store';
import type { ReviewSlide } from '@/types/guided-review';
import type { ReviewCommentStatus, RelatedFile, FileReview } from '@/types/review';
import type { GitLabNote } from '@/types/gitlab';
import {
  FileText, AlertTriangle, AlertCircle, Lightbulb, Info,
  MessageSquare, GitBranch, Link2,
} from 'lucide-react';

type Props = {
  slide: ReviewSlide;
  onUpdateCommentStatus: (commentId: string, status: ReviewCommentStatus, editedBody?: string) => void;
};

export function GuidedReviewSlide({ slide, onUpdateCommentStatus }: Props) {
  const theme = useTheme();

  // Get the set of file paths changed in this MR — used to mark related files
  // that are also part of the diff (important context for the reviewer).
  // Select the raw array (stable reference from Zustand) and derive the Set in useMemo.
  const fileReviews = useReviewStore((st) => st.fileReviews);
  const changedPaths = useMemo(
    () => new Set(fileReviews.map((fr) => fr.filePath)),
    [fileReviews],
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      minHeight: 0,
      flex: 1,
      overflow: 'auto',
      padding: '16px 20px',
    }}>
      {/* File context header */}
      {slide.kind !== 'thread' || slide.filePath ? (
        <FileContextHeader
          filePath={getSlideFilePath(slide)}
          fileReview={slide.fileReview}
          theme={theme}
        />
      ) : null}

      {/* Main content — switches on slide kind */}
      {slide.kind === 'comment' && (
        <CommentSlideContent
          slide={slide}
          theme={theme}
          onUpdateStatus={onUpdateCommentStatus}
        />
      )}
      {slide.kind === 'edgeCase' && (
        <EdgeCaseSlideContent slide={slide} theme={theme} />
      )}
      {slide.kind === 'thread' && (
        <ThreadSlideContent slide={slide} theme={theme} />
      )}

      {/* Related files */}
      {slide.relatedFiles.length > 0 && (
        <RelatedFilesSection files={slide.relatedFiles} changedPaths={changedPaths} theme={theme} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File context header
// ---------------------------------------------------------------------------

function FileContextHeader({
  filePath,
  fileReview,
  theme,
}: {
  filePath: string | null;
  fileReview: FileReview | null;
  theme: OttoTheme;
}) {
  if (!filePath) return null;

  const fileName = filePath.split('/').pop() ?? filePath;
  const dirPath = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      background: theme.bgSubtle,
      borderRadius: '6px',
      border: `1px solid ${theme.borderSubtle}`,
    }}>
      <FileText size={14} style={{ color: theme.textMuted, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          fontSize: '13px',
          fontWeight: 600,
          color: theme.text,
          fontFamily: 'monospace',
        }}>
          {fileName}
        </span>
        {dirPath && (
          <span style={{
            fontSize: '11px',
            color: theme.textMuted,
            marginLeft: '6px',
            fontFamily: 'monospace',
          }}>
            {dirPath}
          </span>
        )}
      </div>
      {fileReview && (
        <RiskBadge riskLevel={fileReview.riskLevel} theme={theme} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comment slide content
// ---------------------------------------------------------------------------

function CommentSlideContent({
  slide,
  theme,
  onUpdateStatus,
}: {
  slide: Extract<ReviewSlide, { kind: 'comment' }>;
  theme: OttoTheme;
  onUpdateStatus: (commentId: string, status: ReviewCommentStatus, editedBody?: string) => void;
}) {
  const { comment } = slide;
  const SeverityIcon = SEVERITY_ICONS[comment.severity] ?? Info;
  const colors = SEVERITY_COLORS(theme)[comment.severity];

  return (
    <>
      {/* Severity + category header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
      }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 600,
          background: colors.bg,
          color: colors.text,
        }}>
          <SeverityIcon size={12} />
          {comment.severity}
        </span>
        <span style={{
          fontSize: '11px',
          padding: '2px 6px',
          borderRadius: '3px',
          background: theme.bgMuted,
          color: theme.textSecondary,
          fontWeight: 500,
        }}>
          {comment.category}
        </span>
        {comment.startLine && (
          <span style={{ fontSize: '11px', color: theme.textMuted, fontFamily: 'monospace' }}>
            L{comment.startLine}{comment.endLine && comment.endLine !== comment.startLine ? `–${comment.endLine}` : ''}
          </span>
        )}
      </div>

      {/* Title */}
      <div style={{
        fontSize: '16px',
        fontWeight: 600,
        color: theme.text,
        lineHeight: '1.4',
      }}>
        {comment.title}
      </div>

      {/* Body */}
      <div style={{
        fontSize: '13px',
        color: theme.text,
        lineHeight: '1.6',
      }}>
        <Markdown content={comment.editedBody || comment.body} compact />
      </div>

      {/* Code suggestion */}
      {comment.suggestion && (
        <div style={{
          borderRadius: '6px',
          border: `1px solid ${theme.borderSubtle}`,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '6px 10px',
            fontSize: '11px',
            fontWeight: 600,
            color: theme.textSecondary,
            background: theme.bgSubtle,
            borderBottom: `1px solid ${theme.borderSubtle}`,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Suggested Fix
          </div>
          <div style={{ fontSize: '12px' }}>
            {comment.originalCode ? (
              <SuggestionDiff
                originalCode={comment.originalCode}
                suggestion={comment.suggestion}
                filePath={comment.filePath}
                startLine={comment.startLine}
              />
            ) : (
              <div style={{ padding: '8px 12px' }}>
                <Markdown content={`\`\`\`\n${comment.suggestion}\n\`\`\``} compact />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <ReviewActions comment={comment} onUpdateStatus={onUpdateStatus} />

      {/* File summary context */}
      {slide.fileReview.summary && (
        <div style={{
          padding: '8px 12px',
          background: theme.bgSubtle,
          borderRadius: '6px',
          borderLeft: `3px solid ${theme.borderSubtle}`,
        }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: theme.textMuted,
            marginBottom: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            File Summary
          </div>
          <div style={{ fontSize: '12px', color: theme.textSecondary, lineHeight: '1.5' }}>
            <Markdown content={slide.fileReview.summary} compact />
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Edge case slide content
// ---------------------------------------------------------------------------

function EdgeCaseSlideContent({
  slide,
  theme,
}: {
  slide: Extract<ReviewSlide, { kind: 'edgeCase' }>;
  theme: OttoTheme;
}) {
  const { edgeCase } = slide;
  const severityConfig = EDGE_SEVERITY_COLORS(theme)[edgeCase.severity];

  return (
    <>
      {/* Severity + category */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 600,
          background: severityConfig.bg,
          color: severityConfig.text,
        }}>
          <AlertTriangle size={12} />
          {edgeCase.severity}
        </span>
        <span style={{
          fontSize: '11px',
          padding: '2px 6px',
          borderRadius: '3px',
          background: theme.bgMuted,
          color: theme.textSecondary,
          fontWeight: 500,
        }}>
          {edgeCase.category}
        </span>
        {edgeCase.lineRange && (
          <span style={{ fontSize: '11px', color: theme.textMuted, fontFamily: 'monospace' }}>
            L{edgeCase.lineRange.start}–{edgeCase.lineRange.end}
          </span>
        )}
      </div>

      {/* Title */}
      <div style={{ fontSize: '16px', fontWeight: 600, color: theme.text, lineHeight: '1.4' }}>
        {edgeCase.title}
      </div>

      {/* Description */}
      <div style={{ fontSize: '13px', color: theme.text, lineHeight: '1.6' }}>
        <Markdown content={edgeCase.description} compact />
      </div>

      {/* Hypothetical trace */}
      {edgeCase.hypotheticalTrace && (
        <div style={{
          borderRadius: '6px',
          border: `1px solid ${theme.borderSubtle}`,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '6px 10px',
            fontSize: '11px',
            fontWeight: 600,
            color: theme.textSecondary,
            background: theme.bgSubtle,
            borderBottom: `1px solid ${theme.borderSubtle}`,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Hypothetical Trace
          </div>
          <div style={{ padding: '8px 12px', fontSize: '12px' }}>
            <Markdown content={edgeCase.hypotheticalTrace} compact />
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Thread slide content
// ---------------------------------------------------------------------------

function ThreadSlideContent({
  slide,
  theme,
}: {
  slide: Extract<ReviewSlide, { kind: 'thread' }>;
  theme: OttoTheme;
}) {
  const notes = slide.discussion.notes.filter((n) => !n.system);

  return (
    <>
      {/* Thread header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 600,
          background: theme.isDark ? '#451a03' : '#fffbeb',
          color: theme.isDark ? '#fbbf24' : '#d97706',
        }}>
          <MessageSquare size={12} />
          Unresolved Thread
        </span>
        {slide.lineRange && (
          <span style={{ fontSize: '11px', color: theme.textMuted, fontFamily: 'monospace' }}>
            L{slide.lineRange.start}{slide.lineRange.end !== slide.lineRange.start ? `–${slide.lineRange.end}` : ''}
          </span>
        )}
        <span style={{ fontSize: '11px', color: theme.textMuted }}>
          {notes.length} note{notes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Notes */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
        {notes.map((note) => (
          <NoteCard key={note.id} note={note} theme={theme} />
        ))}
      </div>
    </>
  );
}

function NoteCard({ note, theme }: { note: GitLabNote; theme: OttoTheme }) {
  const timeAgo = formatTimeAgo(note.created_at);

  return (
    <div style={{
      padding: '10px 12px',
      background: theme.bgSubtle,
      borderRadius: '6px',
      border: `1px solid ${theme.borderSubtle}`,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '6px',
      }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
          @{note.author.username}
        </span>
        <span style={{ fontSize: '11px', color: theme.textMuted }}>{timeAgo}</span>
        {note.resolved && (
          <span style={{
            fontSize: '10px',
            padding: '1px 5px',
            borderRadius: '3px',
            background: theme.successBg,
            color: theme.success,
            fontWeight: 600,
          }}>
            resolved
          </span>
        )}
      </div>
      <div style={{ fontSize: '13px', color: theme.text, lineHeight: '1.5' }}>
        <Markdown content={note.body} compact />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Related files section
// ---------------------------------------------------------------------------

function RelatedFilesSection({ files, changedPaths, theme }: { files: RelatedFile[]; changedPaths: Set<string>; theme: OttoTheme }) {
  return (
    <div style={{
      padding: '8px 12px',
      background: theme.bgSubtle,
      borderRadius: '6px',
      border: `1px solid ${theme.borderSubtle}`,
    }}>
      <div style={{
        fontSize: '11px',
        fontWeight: 600,
        color: theme.textMuted,
        marginBottom: '6px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}>
        <Link2 size={11} />
        Related Files
      </div>
      {files.map((rf) => {
        const isAlsoChanged = changedPaths.has(rf.filePath);
        return (
          <div key={rf.filePath} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 0',
          }}>
            <RelationshipBadge relationship={rf.relationship} theme={theme} />
            {isAlsoChanged && (
              <span title="Also changed in this MR" style={{ display: 'inline-flex', flexShrink: 0 }}>
                <GitBranch size={11} style={{ color: theme.warning }} />
              </span>
            )}
            <span style={{
              fontSize: '12px',
              fontFamily: 'monospace',
              color: isAlsoChanged ? theme.warning : theme.brand,
            }}>
              {rf.filePath.split('/').pop()}
            </span>
            <span style={{
              fontSize: '11px',
              color: theme.textMuted,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {isAlsoChanged ? 'also changed in this MR' : rf.reason}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RelationshipBadge({ relationship, theme }: { relationship: string; theme: OttoTheme }) {
  const labels: Record<string, string> = {
    imports: 'imports',
    'imported-by': 'imported by',
    'shared-type': 'shared type',
    test: 'test',
    config: 'config',
    other: 'related',
  };

  return (
    <span style={{
      fontSize: '10px',
      padding: '1px 5px',
      borderRadius: '3px',
      background: theme.bgMuted,
      color: theme.textSecondary,
      fontWeight: 500,
      flexShrink: 0,
    }}>
      {labels[relationship] ?? relationship}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function RiskBadge({ riskLevel, theme }: { riskLevel: 'low' | 'medium' | 'high'; theme: OttoTheme }) {
  const config = {
    high: {
      label: 'HIGH',
      color: theme.isDark ? '#fca5a5' : '#dc2626',
      bg: theme.isDark ? '#450a0a' : '#fef2f2',
      border: theme.isDark ? '#7f1d1d' : '#fca5a5',
    },
    medium: {
      label: 'MED',
      color: theme.isDark ? '#fcd34d' : '#d97706',
      bg: theme.isDark ? '#451a03' : '#fffbeb',
      border: theme.isDark ? '#78350f' : '#fcd34d',
    },
    low: {
      label: 'LOW',
      color: theme.isDark ? '#86efac' : '#16a34a',
      bg: theme.isDark ? '#052e16' : '#f0fdf4',
      border: theme.isDark ? '#14532d' : '#86efac',
    },
  };
  const c = config[riskLevel];

  return (
    <span style={{
      fontSize: '10px',
      fontWeight: 600,
      padding: '1px 6px',
      borderRadius: '3px',
      background: c.bg,
      color: c.color,
      border: `1px solid ${c.border}`,
      flexShrink: 0,
    }}>
      {c.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSlideFilePath(slide: ReviewSlide): string | null {
  switch (slide.kind) {
    case 'comment': return slide.comment.filePath;
    case 'edgeCase': return slide.edgeCase.filePath;
    case 'thread': return slide.filePath;
  }
}

const SEVERITY_ICONS: Record<string, typeof AlertCircle> = {
  critical: AlertCircle,
  warning: AlertTriangle,
  suggestion: Lightbulb,
  info: Info,
};

function SEVERITY_COLORS(theme: OttoTheme): Record<string, { bg: string; text: string }> {
  return {
    critical: { bg: theme.isDark ? '#450a0a' : '#fecaca', text: theme.isDark ? '#fca5a5' : '#991b1b' },
    warning: { bg: theme.isDark ? '#451a03' : '#fef3c7', text: theme.isDark ? '#fbbf24' : '#92400e' },
    suggestion: { bg: theme.isDark ? '#1e3a5f' : '#dbeafe', text: theme.isDark ? '#93c5fd' : '#1e40af' },
    info: { bg: theme.isDark ? '#1e1b4b' : '#e0e7ff', text: theme.isDark ? '#a5b4fc' : '#3730a3' },
  };
}

function EDGE_SEVERITY_COLORS(theme: OttoTheme): Record<string, { bg: string; text: string }> {
  return {
    critical: { bg: theme.isDark ? '#450a0a' : '#fecaca', text: theme.isDark ? '#fca5a5' : '#991b1b' },
    moderate: { bg: theme.isDark ? '#451a03' : '#fef3c7', text: theme.isDark ? '#fbbf24' : '#92400e' },
    minor: { bg: theme.isDark ? '#1e3a5f' : '#dbeafe', text: theme.isDark ? '#93c5fd' : '#1e40af' },
  };
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
