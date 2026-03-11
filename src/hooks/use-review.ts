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
    summary: store.summary,
    summaryDelta: store.summaryDelta,
    fileReviews: store.fileReviews,
    fileReviewDeltas: store.fileReviewDeltas,
    relatedFiles: store.relatedFiles,
    edgeCases: store.edgeCases,
    edgeCasesDelta: store.edgeCasesDelta,
    startReview,
    cancelReview,
    updateCommentStatus: store.updateCommentStatus,
  };
}
