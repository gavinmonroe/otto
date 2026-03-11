// ---------------------------------------------------------------------------
// useReview hook — connects React components to the review store and
// provides actions for triggering reviews via the streaming protocol.
//
// This hook is the primary interface between the UI and the review system.
// Components call `startReview()` and the hook handles:
// 1. Opening a streaming port to the service worker
// 2. Dispatching stream chunks to the Zustand store
// 3. Cleaning up the port on unmount or completion
//
// Design decisions:
// - The hook manages the port lifecycle (open/close) tied to React's
//   useEffect cleanup. This prevents orphaned ports.
// - Stream chunks are dispatched to the store, not held in local state.
//   This means any component can subscribe to review progress.
// - The disconnect function is stored in a ref so startReview can be
//   called multiple times without stale closures.
// ---------------------------------------------------------------------------

import { useCallback, useRef, useEffect } from 'react';
import { useReviewStore } from '@/services/review/review-store';
import { openStream } from '@/lib/messaging';
import type { StreamChunk } from '@/types/messages';
import type { ReviewTask } from '@/services/review/review-types';

export function useReview() {
  const store = useReviewStore();
  const disconnectRef = useRef<(() => void) | null>(null);

  // Clean up port on unmount
  useEffect(() => {
    return () => {
      disconnectRef.current?.();
    };
  }, []);

  const startReview = useCallback((tasks: ReviewTask[] = ['summary', 'codeReview', 'edgeCases', 'relatedFiles']) => {
    const mrContext = useReviewStore.getState().mrContext;
    if (!mrContext) return;

    // Disconnect any existing stream
    disconnectRef.current?.();

    // Reset and start
    useReviewStore.getState().reset();
    useReviewStore.getState().startReview(tasks);
    useReviewStore.getState().setFileReviewsTotal(mrContext.diffFiles.length);

    // Open streaming connection
    const disconnect = openStream(
      {
        type: 'STREAM_REVIEW',
        payload: { mrContext, tasks },
      },
      {
        onChunk: (chunk: StreamChunk) => {
          const state = useReviewStore.getState();

          switch (chunk.type) {
            case 'STREAM_SUMMARY_DELTA':
              state.appendSummaryDelta(chunk.payload.content);
              break;
            case 'STREAM_SUMMARY_COMPLETE':
              state.setSummary(chunk.payload.summary);
              break;
            case 'STREAM_FILE_REVIEW_DELTA':
              state.appendFileReviewDelta(chunk.payload.filePath, chunk.payload.content);
              break;
            case 'STREAM_FILE_REVIEW_COMPLETE':
              state.addFileReview(chunk.payload.fileReview);
              break;
            case 'STREAM_RELATED_FILES_COMPLETE':
              state.setRelatedFiles(chunk.payload.files);
              break;
            case 'STREAM_EDGE_CASES_DELTA':
              state.appendEdgeCasesDelta(chunk.payload.content);
              break;
            case 'STREAM_EDGE_CASES_COMPLETE':
              state.setEdgeCases(chunk.payload.edgeCases);
              break;
            case 'STREAM_TASK_ERROR': {
              const task = chunk.payload.task;
              if (task.startsWith('codeReview:')) {
                // Per-file error — don't fail the whole task
                console.warn(`[Otto] File review error: ${chunk.payload.error}`);
              } else {
                state.setTaskStatus(task as ReviewTask, 'error', chunk.payload.error);
              }
              break;
            }
            case 'STREAM_ALL_COMPLETE':
              state.completeReview();
              disconnectRef.current = null;
              break;
          }
        },
        onDisconnect: () => {
          // Port disconnected unexpectedly (service worker terminated)
          const state = useReviewStore.getState();
          if (state.status === 'loading' || state.status === 'streaming') {
            state.setError('Connection to Otto lost. The service worker may have been terminated. Try again.');
          }
          disconnectRef.current = null;
        },
      },
    );

    disconnectRef.current = disconnect;
  }, []);

  const cancelReview = useCallback(() => {
    disconnectRef.current?.();
    disconnectRef.current = null;
    useReviewStore.getState().setError('Review cancelled');
  }, []);

  return {
    // State (subscribe to specific slices)
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

    // Actions
    startReview,
    cancelReview,
    updateCommentStatus: store.updateCommentStatus,
  };
}
