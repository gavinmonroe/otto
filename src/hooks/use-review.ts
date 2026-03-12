// ---------------------------------------------------------------------------
// useReview hook — connects React components to the review store and
// provides actions for triggering reviews via the streaming protocol.
//
// Uses the shared stream dispatcher so the chunk→store mapping is
// defined in one place (stream-dispatcher.ts).
// ---------------------------------------------------------------------------

import { useCallback, useRef, useEffect } from 'react';
import { useReviewStore } from '@/services/review/review-store';
import { startReviewStream } from '@/services/review/stream-dispatcher';
import { deleteCachedReview, computeDiffHash } from '@/services/review/review-cache';
import type { ReviewTask } from '@/services/review/review-types';

export function useReview() {
  const store = useReviewStore();
  const disconnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      disconnectRef.current?.();
    };
  }, []);

  const startReview = useCallback((tasks: ReviewTask[] = ['summary', 'codeReview', 'edgeCases', 'relatedFiles']) => {
    const mrContext = useReviewStore.getState().mrContext;
    if (!mrContext) return;

    disconnectRef.current?.();

    const disconnect = startReviewStream(mrContext, tasks, () => {
      disconnectRef.current = null;
    });

    disconnectRef.current = disconnect;
  }, []);

  /** Force regeneration — clears cache then starts a fresh review. */
  const regenerateReview = useCallback(async (tasks: ReviewTask[] = ['summary', 'codeReview', 'edgeCases', 'relatedFiles']) => {
    const mrContext = useReviewStore.getState().mrContext;
    if (!mrContext) return;

    // Delete cached review so the new one replaces it
    const diffHash = computeDiffHash(mrContext.diffFiles);
    await deleteCachedReview(mrContext.projectPath, mrContext.mrIid, diffHash);

    disconnectRef.current?.();

    const disconnect = startReviewStream(mrContext, tasks, () => {
      disconnectRef.current = null;
    }, true);

    disconnectRef.current = disconnect;
  }, []);

  const cancelReview = useCallback(() => {
    disconnectRef.current?.();
    disconnectRef.current = null;
    useReviewStore.getState().setError('Review cancelled');
  }, []);

  return {
    mrContext: store.mrContext,
    status: store.status,
    error: store.error,
    progress: store.progress,
    progressMessage: store.progressMessage,
    summary: store.summary,
    summaryDelta: store.summaryDelta,
    fileReviews: store.fileReviews,
    fileReviewDeltas: store.fileReviewDeltas,
    relatedFiles: store.relatedFiles,
    edgeCases: store.edgeCases,
    edgeCasesDelta: store.edgeCasesDelta,
    ticketContext: store.ticketContext,
    ticketKeys: store.ticketKeys,
    fileActivity: store.fileActivity,
    acValidation: store.acValidation,
    startReview,
    regenerateReview,
    cancelReview,
    updateCommentStatus: store.updateCommentStatus,
  };
}
