// ---------------------------------------------------------------------------
// GitLabFileLink — clickable file path that links to GitLab's blob view
// with an optional inline preview toggle.
//
// When the user clicks the file path, it opens in a new tab on GitLab.
// The preview button fetches and displays the file content inline without
// leaving the MR page.
//
// Uses the MR context from the store to build the correct GitLab URL.
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect } from 'react';
import { ExternalLink, Eye, EyeOff, FileCode } from 'lucide-react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { useReviewStore } from '@/services/review/review-store';
import { sendMessage } from '@/lib/messaging';
import { highlight, extToLang } from '@/services/syntax/highlighter';

type GitLabFileLinkProps = {
  filePath: string;
  /** Optional line number to link to */
  line?: number | null;
  /** Optional line range end */
  lineEnd?: number | null;
  /** Show the preview toggle button */
  showPreview?: boolean;
  /** Pre-loaded content (skip fetch if provided) */
  content?: string | null;
  /** Display style */
  variant?: 'inline' | 'block';
};

export function GitLabFileLink({
  filePath,
  line,
  lineEnd,
  showPreview = false,
  content: preloadedContent,
  variant = 'inline',
}: GitLabFileLinkProps) {
  const theme = useTheme();
  const mrContext = useReviewStore((s) => s.mrContext);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(preloadedContent ?? null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Build the GitLab blob URL
  const gitlabUrl = buildGitLabFileUrl(mrContext, filePath, line, lineEnd);

  const handlePreviewToggle = useCallback(async () => {
    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }

    setPreviewOpen(true);

    // Already have content
    if (previewContent) return;

    // Need to fetch
    if (!mrContext) {
      setPreviewError('No MR context available');
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);

    const hostResult = await sendMessage({
      type: 'RESOLVE_GITLAB_HOST',
      payload: { pageUrl: mrContext.hostUrl },
    });

    if (!hostResult.ok || !hostResult.data || !mrContext.projectId) {
      setPreviewError('GitLab PAT required for file preview');
      setPreviewLoading(false);
      return;
    }

    const fileResult = await sendMessage({
      type: 'FETCH_FILE_CONTENT',
      payload: {
        hostId: hostResult.data.id,
        projectId: mrContext.projectId,
        filePath,
        ref: mrContext.targetBranch || 'main',
      },
    });

    if (fileResult.ok) {
      setPreviewContent(fileResult.data);
    } else {
      setPreviewError(fileResult.error);
    }
    setPreviewLoading(false);
  }, [previewOpen, previewContent, mrContext, filePath]);

  if (variant === 'block') {
    return (
      <div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 0',
        }}>
          <FileCode size={14} style={{ color: theme.textMuted, flexShrink: 0 }} />
          <a
            href={gitlabUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: theme.brand,
              textDecoration: 'none',
              fontFamily: 'monospace',
              fontSize: '13px',
              fontWeight: 500,
            }}
            title={`Open ${filePath} on GitLab`}
          >
            {filePath}
            {line && <span style={{ color: theme.textMuted }}>:{line}{lineEnd && lineEnd !== line ? `-${lineEnd}` : ''}</span>}
          </a>
          <ExternalLink size={11} style={{ color: theme.textMuted }} />
          {showPreview && (
            <button
              onClick={handlePreviewToggle}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: theme.brand,
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11px',
                padding: '2px 4px',
                borderRadius: '3px',
              }}
              title={previewOpen ? 'Hide preview' : 'Preview file'}
            >
              {previewOpen ? <EyeOff size={12} /> : <Eye size={12} />}
              {previewOpen ? 'Hide' : 'Preview'}
            </button>
          )}
        </div>

        {previewOpen && (
          <FilePreviewPanel
            content={previewContent}
            loading={previewLoading}
            error={previewError}
            filePath={filePath}
            theme={theme}
          />
        )}
      </div>
    );
  }

  // Inline variant — just the link
  return (
    <a
      href={gitlabUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: theme.brand,
        textDecoration: 'none',
        fontFamily: 'monospace',
        fontSize: '0.9em',
      }}
      title={`Open ${filePath} on GitLab`}
    >
      {filePath}
      {line && <span style={{ color: theme.textMuted }}>:{line}{lineEnd && lineEnd !== line ? `-${lineEnd}` : ''}</span>}
      <ExternalLink size={10} style={{ marginLeft: '3px', verticalAlign: 'middle', color: theme.textMuted }} />
    </a>
  );
}

// ---------------------------------------------------------------------------
// FilePreviewPanel — inline file content viewer
// ---------------------------------------------------------------------------

function FilePreviewPanel({
  content,
  loading,
  error,
  filePath,
  theme,
}: {
  content: string | null;
  loading: boolean;
  error: string | null;
  filePath: string;
  theme: OttoTheme;
}) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  const lang = extToLang(filePath);

  // Truncate very large files
  const lines = content?.split('\n') ?? [];
  const truncated = lines.length > 500;
  const displayContent = truncated
    ? lines.slice(0, 500).join('\n') + '\n// ... (truncated, showing first 500 lines)'
    : content;

  useEffect(() => {
    if (!displayContent) return;
    let cancelled = false;

    highlight(displayContent, lang, theme.isDark).then((html) => {
      if (!cancelled) setHighlightedHtml(html);
    });

    return () => { cancelled = true; };
  }, [displayContent, lang, theme.isDark]);

  if (loading) {
    return (
      <div style={{
        padding: '12px',
        fontSize: '12px',
        color: theme.textMuted,
        background: theme.bgSubtle,
        borderRadius: '6px',
        border: `1px solid ${theme.border}`,
        marginBottom: '8px',
      }}>
        Loading file...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: '12px',
        fontSize: '12px',
        color: theme.error,
        background: theme.errorBg,
        borderRadius: '6px',
        border: `1px solid ${theme.errorBorder}`,
        marginBottom: '8px',
      }}>
        {error}
      </div>
    );
  }

  if (!content) return null;

  return (
    <div style={{
      marginBottom: '8px',
      borderRadius: '6px',
      border: `1px solid ${theme.border}`,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '4px 10px',
        fontSize: '11px',
        color: theme.textSecondary,
        background: theme.bgMuted,
        borderBottom: `1px solid ${theme.border}`,
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>{lines.length} lines</span>
        {truncated && <span style={{ color: theme.warning }}>Showing first 500 lines</span>}
      </div>
      <div style={{ maxHeight: '400px', overflow: 'auto', fontSize: '12px' }}>
        {highlightedHtml ? (
          <div dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        ) : (
          <pre style={{
            margin: 0,
            padding: '8px',
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            fontSize: '12px',
            color: theme.text,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {displayContent}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

function buildGitLabFileUrl(
  mrContext: { hostUrl: string; projectPath: string; targetBranch: string } | null,
  filePath: string,
  line?: number | null,
  lineEnd?: number | null,
): string {
  if (!mrContext) return '#';

  const base = `${mrContext.hostUrl}/${mrContext.projectPath}/-/blob/${mrContext.targetBranch}/${filePath}`;
  if (line) {
    const lineHash = lineEnd && lineEnd !== line ? `#L${line}-${lineEnd}` : `#L${line}`;
    return base + lineHash;
  }
  return base;
}
