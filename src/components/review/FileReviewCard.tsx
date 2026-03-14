// ---------------------------------------------------------------------------
// FileReviewCard — compact button in the diff file header.
//
// Now only a trigger button + badge. Review results are displayed in
// FileReviewFooter which is mounted in the diff file's footer area.
// ---------------------------------------------------------------------------

import { useState, useCallback, useMemo } from 'react';
import { useReviewStore } from '@/services/review/review-store';
import { openStream } from '@/lib/messaging';
import { OttoLogo } from '@/components/OttoLogo';
import { OttoLogoAnimated } from '@/components/OttoLogoAnimated';
import { useTheme } from '@/components/ThemeContext';
import type { StreamChunk } from '@/types/messages';

type FileReviewCardProps = {
  filePath: string;
};

export function FileReviewCard({ filePath }: FileReviewCardProps) {
  const [singleFileLoading, setSingleFileLoading] = useState(false);
  const theme = useTheme();

  const fileReview = useReviewStore((s) =>
    s.fileReviews.find((fr) => fr.filePath === filePath),
  );
  const fileReviewDelta = useReviewStore((s) => s.fileReviewDeltas[filePath]);
  const overallStatus = useReviewStore((s) => s.status);

  const isStreaming = !!fileReviewDelta && !fileReview;
  const commentCount = fileReview?.comments.length ?? 0;
  const hasComments = commentCount > 0;

  const handleSingleFileReview = useCallback(() => {
    if (fileReview || singleFileLoading || isStreaming) return;

    const mrContext = useReviewStore.getState().mrContext;
    if (!mrContext) return;

    const file = mrContext.diffFiles.find((f) => f.filePath === filePath);
    if (!file) return;

    setSingleFileLoading(true);

    const singleFileContext = { ...mrContext, diffFiles: [file] };

    openStream(
      {
        type: 'STREAM_REVIEW',
        payload: { mrContext: singleFileContext, tasks: ['codeReview'] },
      },
      {
        onChunk: (chunk: StreamChunk) => {
          const state = useReviewStore.getState();
          switch (chunk.type) {
            case 'STREAM_FILE_REVIEW_DELTA':
              state.appendFileReviewDelta(chunk.payload.filePath, chunk.payload.content);
              break;
            case 'STREAM_FILE_REVIEW_COMPLETE':
              state.addFileReview(chunk.payload.fileReview);
              break;
            case 'STREAM_ALL_COMPLETE':
              setSingleFileLoading(false);
              break;
            case 'STREAM_TASK_ERROR':
              setSingleFileLoading(false);
              break;
          }
        },
        onDisconnect: () => {
          setSingleFileLoading(false);
        },
      },
    );
  }, [filePath, fileReview, singleFileLoading, isStreaming]);

  const buttonContent = useMemo(() => {
    if (singleFileLoading || isStreaming) {
      return (
        <>
          <OttoLogoAnimated size={14} />
          <span>Reviewing...</span>
        </>
      );
    }
    if (fileReview) {
      return (
        <>
          <OttoLogo size={14} />
          <span>Otto</span>
          {hasComments && (
            <span className="otto-badge otto-badge-count">{commentCount}</span>
          )}
        </>
      );
    }
    return (
      <>
        <OttoLogo size={14} />
        <span>Review</span>
      </>
    );
  }, [singleFileLoading, isStreaming, fileReview, hasComments, commentCount]);

  return (
    <button
      className="otto-file-btn"
      onClick={handleSingleFileReview}
      title={fileReview ? `${commentCount} suggestion${commentCount === 1 ? '' : 's'}` : 'Review this file with Otto'}
      disabled={!!fileReview || singleFileLoading || isStreaming}
      style={{ opacity: fileReview ? 0.85 : 1 }}
    >
      {buttonContent}
    </button>
  );
}
