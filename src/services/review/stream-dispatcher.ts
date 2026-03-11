// ---------------------------------------------------------------------------
// Stream dispatcher — shared logic for dispatching stream chunks to the
// review store. Used by both the useReview hook (manual review) and the
// auto-review function in the content script.
//
// Extracted to avoid duplicating the chunk→store mapping in two places.
// ---------------------------------------------------------------------------

import { useReviewStore } from '@/services/review/review-store';
import { openStream } from '@/lib/messaging';
import type { StreamChunk, StreamRequest } from '@/types/messages';
import type { ReviewTask } from '@/services/review/review-types';
import type { MrContext } from '@/types/review';

/**
 * Dispatch a stream chunk to the review store.
 * Maps each chunk type to the appropriate store action.
 */
export function dispatchStreamChunk(chunk: StreamChunk): void {
  const s = useReviewStore.getState();

  switch (chunk.type) {
    case 'STREAM_SUMMARY_DELTA':
      s.appendSummaryDelta(chunk.payload.content);
      break;
    case 'STREAM_SUMMARY_COMPLETE':
      s.setSummary(chunk.payload.summary);
      break;
    case 'STREAM_FILE_REVIEW_DELTA':
      s.appendFileReviewDelta(chunk.payload.filePath, chunk.payload.content);
      break;
    case 'STREAM_FILE_REVIEW_COMPLETE':
      s.addFileReview(chunk.payload.fileReview);
      break;
    case 'STREAM_RELATED_FILES_COMPLETE':
      s.setRelatedFiles(chunk.payload.files);
      break;
    case 'STREAM_EDGE_CASES_DELTA':
      s.appendEdgeCasesDelta(chunk.payload.content);
      break;
    case 'STREAM_EDGE_CASES_COMPLETE':
      s.setEdgeCases(chunk.payload.edgeCases);
      break;
    case 'STREAM_TASK_ERROR': {
      const task = chunk.payload.task;
      if (!task.startsWith('codeReview:')) {
        s.setTaskStatus(task as ReviewTask, 'error', chunk.payload.error);
      }
      break;
    }
    case 'STREAM_ALL_COMPLETE':
      s.completeReview();
      break;
  }
}

/**
 * Start a review stream and dispatch all chunks to the store.
 * Returns a disconnect function to cancel the stream.
 *
 * Used by:
 * - useReview hook (manual "Review MR" button)
 * - Auto-review in the content script
 */
export function startReviewStream(
  mrContext: MrContext,
  tasks: ReviewTask[],
  onDisconnect?: () => void,
): () => void {
  const store = useReviewStore.getState();
  store.reset();
  store.startReview(tasks);
  store.setFileReviewsTotal(mrContext.diffFiles.length);

  return openStream(
    { type: 'STREAM_REVIEW', payload: { mrContext, tasks } },
    {
      onChunk: dispatchStreamChunk,
      onDisconnect: () => {
        const state = useReviewStore.getState();
        if (state.status === 'loading' || state.status === 'streaming') {
          state.setError('Connection to Otto lost. Try again.');
        }
        onDisconnect?.();
      },
    },
  );
}
