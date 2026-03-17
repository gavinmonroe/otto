// ---------------------------------------------------------------------------
// DiffReference — clickable inline chip that references a file + line in
// the MR diff. Primary click scrolls to the line in GitLab's diff view.
// Secondary action (external link icon) opens in a new tab.
//
// Used inside chat messages wherever the AI outputs [[filePath:line]] syntax.
// ---------------------------------------------------------------------------

import { useCallback } from 'react';
import { ExternalLink } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { useReviewStore } from '@/services/review/review-store';
import { scrollToDiffLine, buildGitLabBlobUrl } from '@/lib/scroll-to-diff-line';
import type { FileReference } from '@/types/chat';

type DiffReferenceProps = {
  reference: FileReference;
};

export function DiffReference({ reference }: DiffReferenceProps) {
  const theme = useTheme();
  const mrContext = useReviewStore((s) => s.mrContext);

  const { filePath, line, lineEnd } = reference;

  // Build display text: "filename.ts:42" or "filename.ts:42-58"
  const fileName = filePath.split('/').pop() || filePath;
  let displayText = fileName;
  if (line && lineEnd && lineEnd !== line) {
    displayText += `:${line}-${lineEnd}`;
  } else if (line) {
    displayText += `:${line}`;
  }

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    scrollToDiffLine(filePath, line);
  }, [filePath, line]);

  const handleExternalClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!mrContext) return;

    const url = buildGitLabBlobUrl(
      mrContext.hostUrl,
      mrContext.projectPath,
      mrContext.sourceBranch,
      filePath,
      line,
      lineEnd,
    );
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [mrContext, filePath, line, lineEnd]);

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        padding: '1px 6px',
        borderRadius: '6px',
        fontSize: '12px',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        background: theme.bgMuted,
        border: `1px solid ${theme.border}`,
        color: theme.brand,
        cursor: 'pointer',
        lineHeight: '1.4',
        verticalAlign: 'baseline',
        whiteSpace: 'nowrap',
      }}
      title={`${filePath}${line ? `:${line}` : ''} — click to scroll to diff`}
    >
      <span
        onClick={handleClick}
        style={{
          cursor: 'pointer',
          textDecoration: 'none',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.textDecoration = 'underline';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.textDecoration = 'none';
        }}
      >
        {displayText}
      </span>
      <span
        onClick={handleExternalClick}
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          opacity: 0.6,
          marginLeft: '1px',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = '0.6';
        }}
        title="Open in new tab"
      >
        <ExternalLink size={10} />
      </span>
    </span>
  );
}
