// ---------------------------------------------------------------------------
// Stream dispatcher — shared logic for dispatching stream chunks to the
// review store. Used by both the useReview hook (manual review) and the
// auto-review function in the content script.
//
// Extracted to avoid duplicating the chunk→store mapping in two places.
//
// Performance: streaming deltas are batched and flushed at ~60fps via
// requestAnimationFrame. This prevents hundreds of store updates per second
// from hammering subscriptions and crashing the tab on large MRs.
// ---------------------------------------------------------------------------

import { useReviewStore } from '@/services/review/review-store';
import { openStream } from '@/lib/messaging';
import type { StreamChunk, StreamRequest } from '@/types/messages';
import type { ReviewTask } from '@/services/review/review-types';
import type { MrContext } from '@/types/review';
import {
  loadCachedReview,
  saveCachedReview,
  computeDiffHash,
  computeFileDiffHashes,
  type CachedReview,
} from './review-cache';

// ---------------------------------------------------------------------------
// Delta batching — accumulates streaming deltas and flushes once per frame.
// ---------------------------------------------------------------------------

let pendingSummaryDelta = '';
const pendingFileDeltas = new Map<string, string>();
let pendingEdgeCasesDelta = '';
let flushScheduled = false;

function scheduleDeltaFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(flushDeltas);
}

function flushDeltas(): void {
  flushScheduled = false;
  const s = useReviewStore.getState();

  if (pendingSummaryDelta) {
    s.appendSummaryDelta(pendingSummaryDelta);
    pendingSummaryDelta = '';
  }

  if (pendingFileDeltas.size > 0) {
    for (const [filePath, content] of pendingFileDeltas) {
      s.appendFileReviewDelta(filePath, content);
    }
    pendingFileDeltas.clear();
  }

  if (pendingEdgeCasesDelta) {
    s.appendEdgeCasesDelta(pendingEdgeCasesDelta);
    pendingEdgeCasesDelta = '';
  }
}

/**
 * Dispatch a stream chunk to the review store.
 * Delta chunks are batched; completion/error chunks are dispatched immediately.
 */
export function dispatchStreamChunk(chunk: StreamChunk): void {
  const s = useReviewStore.getState();

  switch (chunk.type) {
    case 'STREAM_SUMMARY_DELTA':
      pendingSummaryDelta += chunk.payload.content;
      scheduleDeltaFlush();
      break;
    case 'STREAM_SUMMARY_COMPLETE':
      // Flush any pending summary delta first
      if (pendingSummaryDelta) {
        s.appendSummaryDelta(pendingSummaryDelta);
        pendingSummaryDelta = '';
      }
      s.setSummary(chunk.payload.summary);
      break;
    case 'STREAM_FILE_REVIEW_DELTA': {
      const existing = pendingFileDeltas.get(chunk.payload.filePath) || '';
      pendingFileDeltas.set(chunk.payload.filePath, existing + chunk.payload.content);
      scheduleDeltaFlush();
      break;
    }
    case 'STREAM_FILE_REVIEW_COMPLETE': {
      // Flush any pending delta for this file first
      const filePath = chunk.payload.fileReview.filePath;
      if (pendingFileDeltas.has(filePath)) {
        s.appendFileReviewDelta(filePath, pendingFileDeltas.get(filePath)!);
        pendingFileDeltas.delete(filePath);
      }
      s.addFileReview(chunk.payload.fileReview);
      break;
    }
    case 'STREAM_RELATED_FILES_COMPLETE':
      s.setRelatedFiles(chunk.payload.files);
      break;
    case 'STREAM_EDGE_CASES_DELTA':
      pendingEdgeCasesDelta += chunk.payload.content;
      scheduleDeltaFlush();
      break;
    case 'STREAM_EDGE_CASES_COMPLETE':
      // Flush any pending edge cases delta first
      if (pendingEdgeCasesDelta) {
        s.appendEdgeCasesDelta(pendingEdgeCasesDelta);
        pendingEdgeCasesDelta = '';
      }
      s.setEdgeCases(chunk.payload.edgeCases);
      break;
    case 'STREAM_TICKET_CONTEXT':
      s.setTicketContext(chunk.payload.ticketContext, chunk.payload.ticketKeys);
      break;
    case 'STREAM_PROGRESS':
      s.setProgressMessage(chunk.payload.message);
      break;
    case 'STREAM_TASK_ERROR': {
      const task = chunk.payload.task;
      if (!task.startsWith('codeReview:')) {
        s.setTaskStatus(task as ReviewTask, 'error', chunk.payload.error);
      }
      break;
    }
    case 'STREAM_ALL_COMPLETE':
      // Flush any remaining deltas before completing
      flushDeltas();
      s.completeReview();
      break;
  }
}

/**
 * Try to load a cached review and hydrate the store.
 * Returns true if cache was found and loaded, false otherwise.
 */
export async function tryLoadCachedReview(mrContext: MrContext): Promise<boolean> {
  const diffHash = computeDiffHash(mrContext.diffFiles);
  const cached = await loadCachedReview(mrContext.projectPath, mrContext.mrIid, diffHash);

  if (cached) {
    const store = useReviewStore.getState();
    store.hydrateFromCache(cached);
    return true;
  }

  return false;
}

/**
 * Start a review stream and dispatch all chunks to the store.
 * Returns a disconnect function to cancel the stream.
 *
 * Used by:
 * - useReview hook (manual "Review MR" button)
 * - Auto-review in the content script
 *
 * @param skipCache - If true, bypass cache (used for regeneration)
 */
export function startReviewStream(
  mrContext: MrContext,
  tasks: ReviewTask[],
  onDisconnect?: () => void,
  skipCache?: boolean,
): () => void {
  const store = useReviewStore.getState();
  store.reset();
  store.startReview(tasks);
  store.setFileReviewsTotal(mrContext.diffFiles.length);

  return openStream(
    { type: 'STREAM_REVIEW', payload: { mrContext, tasks } },
    {
      onChunk: (chunk) => {
        dispatchStreamChunk(chunk);

        // Save to cache when all tasks complete
        if (chunk.type === 'STREAM_ALL_COMPLETE') {
          const state = useReviewStore.getState();
          const diffHash = computeDiffHash(mrContext.diffFiles);
          const cached: CachedReview = {
            version: 1,
            projectPath: mrContext.projectPath,
            mrIid: mrContext.mrIid,
            diffHash,
            timestamp: Date.now(),
            summary: state.summary,
            fileReviews: state.fileReviews,
            relatedFiles: state.relatedFiles,
            edgeCases: state.edgeCases,
            fileDiffHashes: computeFileDiffHashes(mrContext.diffFiles),
          };
          saveCachedReview(cached);
        }
      },
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
