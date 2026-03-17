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

import { useMemo, useState } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { Markdown } from '@/components/Markdown';
import { SuggestionDiff } from '@/components/SuggestionDiff';
import { CollapsibleDiff } from '@/components/guided-review/CollapsibleDiff';
import { ReviewActions } from '@/components/review/ReviewActions';
import { useReviewStore } from '@/services/review/review-store';
import type { ReviewSlide } from '@/types/guided-review';
import type { ReviewCommentStatus, RelatedFile, FileReview, DiffFileData, FileActivityData } from '@/types/review';
import type { GitLabNote } from '@/types/gitlab';
import { highlightLines, resolveEffectiveLang } from '@/services/syntax/highlight-client';
import {
  FileText, AlertTriangle, AlertCircle, Lightbulb, Info,
  MessageSquare, GitBranch, Link2, Clock, ExternalLink, ChevronRight, ChevronDown, Code,
} from 'lucide-react';

type Props = {
  slide: ReviewSlide;
  onUpdateCommentStatus: (commentId: string, status: ReviewCommentStatus, editedBody?: string) => void;
};

export function GuidedReviewSlide({ slide, onUpdateCommentStatus }: Props) {
  const theme = useTheme();

  // Get the set of file paths changed in this MR — used to mark related files
  // that are also part of the diff (important context for the reviewer).
  const fileReviews = useReviewStore((st) => st.fileReviews);
  const changedPaths = useMemo(
    () => new Set(fileReviews.map((fr) => fr.filePath)),
    [fileReviews],
  );

  // Get raw diff data for this slide's file — used to show the actual diff
  const diffFiles = useReviewStore((st) => st.mrContext?.diffFiles ?? []);
  const slideFilePath = getSlideFilePath(slide);
  const fileDiff = useMemo(
    () => diffFiles.find((f) => f.filePath === slideFilePath),
    [diffFiles, slideFilePath],
  );

  // Get file activity data — recent MRs that touched this file
  const fileActivity = useReviewStore((st) => st.fileActivity);
  const fileActivityForSlide = useMemo(() => {
    if (!fileActivity || !slideFilePath) return null;
    return fileActivity.fileActivities.find((a) => a.filePath === slideFilePath) ?? null;
  }, [fileActivity, slideFilePath]);

  // Get diff data for related files that are also changed in this MR
  const relatedDiffs = useMemo(() => {
    const map = new Map<string, DiffFileData>();
    for (const rf of slide.relatedFiles) {
      const d = diffFiles.find((f) => f.filePath === rf.filePath);
      if (d) map.set(rf.filePath, d);
    }
    return map;
  }, [slide.relatedFiles, diffFiles]);

  // Compute highlight range for the current slide
  const highlightRange = useMemo(() => {
    if (slide.kind === 'comment' && slide.comment.startLine) {
      return { start: slide.comment.startLine, end: slide.comment.endLine ?? slide.comment.startLine };
    }
    if (slide.kind === 'edgeCase' && slide.edgeCase.lineRange) {
      return slide.edgeCase.lineRange;
    }
    if (slide.kind === 'thread' && slide.lineRange) {
      return slide.lineRange;
    }
    return null;
  }, [slide]);

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

      {/* File diff — shows the actual diff for this file with the relevant lines highlighted */}
      {fileDiff && fileDiff.diff && (
        <CollapsibleDiff
          diff={fileDiff.diff}
          filePath={fileDiff.filePath}
          highlightRange={highlightRange}
          label={`Diff: ${fileDiff.filePath.split('/').pop()}`}
        />
      )}

      {/* File activity — recent MRs that touched this file */}
      {fileActivityForSlide && fileActivityForSlide.recentMrs.length > 0 && (
        <FileActivitySection activity={fileActivityForSlide} theme={theme} />
      )}

      {/* Related files — with collapsible diffs for files also changed in this MR */}
      {slide.relatedFiles.length > 0 && (
        <RelatedFilesSection
          files={slide.relatedFiles}
          changedPaths={changedPaths}
          relatedDiffs={relatedDiffs}
          theme={theme}
        />
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
          borderRadius: '6px',
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
          borderRadius: '6px',
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
          borderRadius: '6px',
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
          borderRadius: '6px',
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
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: 600,
          background: theme.warningBg,
          color: theme.warning,
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
            borderRadius: '6px',
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

function RelatedFilesSection({ files, changedPaths, relatedDiffs, theme }: { files: RelatedFile[]; changedPaths: Set<string>; relatedDiffs: Map<string, DiffFileData>; theme: OttoTheme }) {
  // Get MR context for building GitLab blob URLs
  const mrContext = useReviewStore((st) => st.mrContext);
  const hostUrl = mrContext?.hostUrl;
  const projectPath = mrContext?.projectPath;
  const branch = mrContext?.sourceBranch;

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
      {files.map((rf) => (
        <RelatedFileRow
          key={rf.filePath}
          file={rf}
          isAlsoChanged={changedPaths.has(rf.filePath)}
          diff={relatedDiffs.get(rf.filePath) ?? null}
          hostUrl={hostUrl}
          projectPath={projectPath}
          branch={branch}
          theme={theme}
        />
      ))}
    </div>
  );
}

/**
 * Individual related file row — clickable link + collapsible content preview + diff.
 */
function RelatedFileRow({
  file,
  isAlsoChanged,
  diff,
  hostUrl,
  projectPath,
  branch,
  theme,
}: {
  file: RelatedFile;
  isAlsoChanged: boolean;
  diff: DiffFileData | null;
  hostUrl?: string;
  projectPath?: string;
  branch?: string;
  theme: OttoTheme;
}) {
  const [showContent, setShowContent] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string[] | null>(null);

  const fileName = file.filePath.split('/').pop() ?? file.filePath;
  const blobUrl = hostUrl && projectPath && branch
    ? `${hostUrl}/${projectPath}/-/blob/${branch}/${file.filePath}`
    : null;

  // Highlight content when expanded
  const contentLines = file.content?.split('\n') ?? [];
  const truncatedLines = contentLines.slice(0, 80);
  const isTruncated = contentLines.length > 80;

  const lang = resolveEffectiveLang(file.filePath, truncatedLines);

  // Lazy highlight on expand
  if (showContent && !highlightedHtml && file.content) {
    highlightLines(truncatedLines, lang, theme.isDark).then((html) => {
      setHighlightedHtml(html);
    });
  }

  return (
    <div style={{ marginBottom: '4px' }}>
      {/* File row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 0',
      }}>
        <RelationshipBadge relationship={file.relationship} theme={theme} />
        {isAlsoChanged && (
          <span title="Also changed in this MR" style={{ display: 'inline-flex', flexShrink: 0 }}>
            <GitBranch size={11} style={{ color: theme.warning }} />
          </span>
        )}

        {/* Clickable file name — opens in new tab */}
        {blobUrl ? (
          <a
            href={blobUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${file.filePath} in GitLab`}
            style={{
              fontSize: '12px',
              fontFamily: 'monospace',
              color: isAlsoChanged ? theme.warning : theme.brand,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            {fileName}
            <ExternalLink size={9} style={{ opacity: 0.6 }} />
          </a>
        ) : (
          <span style={{
            fontSize: '12px',
            fontFamily: 'monospace',
            color: isAlsoChanged ? theme.warning : theme.brand,
          }}>
            {fileName}
          </span>
        )}

        <span style={{
          fontSize: '11px',
          color: theme.textMuted,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {isAlsoChanged ? 'also changed in this MR' : file.reason}
        </span>

        {/* Preview toggle — only if content is available */}
        {file.content && (
          <button
            onClick={() => setShowContent(!showContent)}
            title={showContent ? 'Hide preview' : 'Preview file content'}
            aria-expanded={showContent}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px',
              padding: '1px 5px',
              borderRadius: '6px',
              border: `1px solid ${theme.borderSubtle}`,
              background: showContent ? theme.bgMuted : 'transparent',
              color: theme.textMuted,
              fontSize: '10px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            <Code size={9} />
            {showContent ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          </button>
        )}
      </div>

      {/* Collapsible content preview */}
      {showContent && file.content && (
        <div style={{
          marginTop: '4px',
          marginLeft: '8px',
          borderRadius: '6px',
          border: `1px solid ${theme.borderSubtle}`,
          overflow: 'hidden',
          maxHeight: '300px',
          overflowY: 'auto',
        }}>
          <div style={{
            padding: '4px 8px',
            fontSize: '10px',
            fontWeight: 600,
            color: theme.textMuted,
            background: theme.bgSubtle,
            borderBottom: `1px solid ${theme.borderSubtle}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>{file.filePath}</span>
            <span>{contentLines.length} lines</span>
          </div>
          <div style={{ fontSize: '11px', fontFamily: 'monospace', lineHeight: '18px' }}>
            {truncatedLines.map((line, i) => (
              <div key={i} style={{
                display: 'flex',
                minHeight: '18px',
                padding: '0 4px',
              }}>
                <span style={{
                  display: 'inline-block',
                  width: '32px',
                  textAlign: 'right',
                  paddingRight: '8px',
                  color: theme.textMuted,
                  fontSize: '10px',
                  opacity: 0.5,
                  userSelect: 'none',
                  flexShrink: 0,
                }}>
                  {i + 1}
                </span>
                {highlightedHtml ? (
                  <span
                    style={{ whiteSpace: 'pre', tabSize: 4, flex: 1, minWidth: 0 }}
                    dangerouslySetInnerHTML={{ __html: highlightedHtml[i] }}
                  />
                ) : (
                  <span style={{ whiteSpace: 'pre', tabSize: 4, flex: 1, minWidth: 0, color: theme.text }}>
                    {line}
                  </span>
                )}
              </div>
            ))}
            {isTruncated && (
              <div style={{
                padding: '4px 8px',
                fontSize: '10px',
                color: theme.textMuted,
                fontStyle: 'italic',
                borderTop: `1px solid ${theme.borderSubtle}`,
                background: theme.bgSubtle,
              }}>
                ... {contentLines.length - 80} more lines (open in GitLab to see full file)
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collapsible diff for related files also changed in this MR */}
      {diff && diff.diff && (
        <div style={{ marginTop: '4px', marginLeft: '8px' }}>
          <CollapsibleDiff
            diff={diff.diff}
            filePath={diff.filePath}
            label={`Diff: ${fileName}`}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File activity section — recent MRs that touched this file
// ---------------------------------------------------------------------------

function FileActivitySection({
  activity,
  theme,
}: {
  activity: { filePath: string; recentMrs: Array<{ iid: number; title: string; author: string; mergedAt: string; webUrl: string }> };
  theme: OttoTheme;
}) {
  return (
    <div style={{
      padding: '8px 12px',
      background: theme.bgSubtle,
      borderRadius: '6px',
      border: `1px solid ${theme.borderSubtle}`,
      borderLeft: `3px solid ${theme.warning}`,
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
        <Clock size={11} />
        Recent Activity ({activity.recentMrs.length} recent MR{activity.recentMrs.length !== 1 ? 's' : ''})
      </div>
      {activity.recentMrs.map((mr) => {
        const daysAgo = Math.round(
          (Date.now() - new Date(mr.mergedAt).getTime()) / (24 * 60 * 60 * 1000),
        );
        return (
          <div key={mr.iid} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '2px 0',
            fontSize: '12px',
          }}>
            <a
              href={mr.webUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: theme.brand, textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}
            >
              !{mr.iid}
            </a>
            <span style={{ color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {mr.title}
            </span>
            <span style={{ color: theme.textMuted, fontSize: '11px', flexShrink: 0 }}>
              @{mr.author} · {daysAgo}d ago
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relationship badge
// ---------------------------------------------------------------------------

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
      borderRadius: '6px',
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
      color: theme.error,
      bg: theme.errorBg,
      border: theme.errorBorder,
    },
    medium: {
      label: 'MED',
      color: theme.warning,
      bg: theme.warningBg,
      border: theme.warningBorder,
    },
    low: {
      label: 'LOW',
      color: theme.success,
      bg: theme.successBg,
      border: theme.successBorder,
    },
  };
  const c = config[riskLevel];

  return (
    <span style={{
      fontSize: '10px',
      fontWeight: 600,
      padding: '1px 6px',
      borderRadius: '6px',
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
    critical: { bg: theme.errorBg, text: theme.error },
    warning: { bg: theme.warningBg, text: theme.warning },
    suggestion: { bg: theme.infoBg, text: theme.info },
    info: { bg: theme.infoBg, text: theme.info },
  };
}

function EDGE_SEVERITY_COLORS(theme: OttoTheme): Record<string, { bg: string; text: string }> {
  return {
    critical: { bg: theme.errorBg, text: theme.error },
    moderate: { bg: theme.warningBg, text: theme.warning },
    minor: { bg: theme.infoBg, text: theme.info },
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
