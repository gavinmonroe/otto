// ---------------------------------------------------------------------------
// Inquiry Stream Dispatcher — connects the inquiry UI to the background
// service worker via port-based streaming.
//
// Design decisions:
// - Follows the exact same pattern as chat-stream-dispatcher.ts: Botto-first
//   transport with chrome.runtime fallback, 60fps delta batching.
// - Builds InquiryContext from the review store + inquiry store at submit time.
// - Only one inquiry stream can be active at a time. Starting a new one
//   cancels the previous (the user submitted a new question).
// - On completion, persists the inquiry to cache and updates the store.
// ---------------------------------------------------------------------------

import { useInquiryStore } from './inquiry-store';
import { useReviewStore } from '@/services/review/review-store';
import { openStream } from '@/lib/messaging';
import { saveCachedInquiry } from './inquiry-cache';
import type { StreamChunk } from '@/types/messages';
import type { InquiryContext } from '@/types/inquiry';
import { getBottoClient } from '@/lib/botto-client';

// ---------------------------------------------------------------------------
// Delta batching — same 60fps pattern as chat-stream-dispatcher.ts
// ---------------------------------------------------------------------------

let pendingDelta = '';
let flushScheduled = false;
let activeInquiryId: string | null = null;

function scheduleDeltaFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(flushDelta);
}

function flushDelta(): void {
  flushScheduled = false;
  if (pendingDelta && activeInquiryId) {
    useInquiryStore.getState().appendDelta(activeInquiryId, pendingDelta);
    pendingDelta = '';
  }
}

// ---------------------------------------------------------------------------
// Active stream tracking
// ---------------------------------------------------------------------------

let activeDisconnect: (() => void) | null = null;

/**
 * Cancel any in-progress inquiry stream.
 * Safe to call even if no stream is active.
 *
 * @param discard - If true, discard partial response. Used by retry.
 */
export function cancelInquiryStream(discard = false): void {
  if (activeDisconnect) {
    activeDisconnect();
    activeDisconnect = null;
  }

  if (!activeInquiryId) return;

  if (discard) {
    pendingDelta = '';
    flushScheduled = false;
    const state = useInquiryStore.getState();
    const inquiry = state.inquiries[activeInquiryId];
    if (inquiry?.status === 'streaming') {
      state.setStatus(activeInquiryId, 'idle');
    }
    activeInquiryId = null;
    return;
  }

  // Flush remaining delta so partial response is visible
  if (pendingDelta) {
    flushDelta();
  }

  const state = useInquiryStore.getState();
  const inquiry = state.inquiries[activeInquiryId];
  if (inquiry?.status === 'streaming') {
    if (inquiry.currentDelta.trim()) {
      // Partial content — save it as a completed slide
      state.completeSlide(activeInquiryId, inquiry.currentDelta);
    } else {
      state.setStatus(activeInquiryId, 'idle');
    }
  }

  activeInquiryId = null;
}

// ---------------------------------------------------------------------------
// Context building
// ---------------------------------------------------------------------------

/**
 * Build an InquiryContext from the current store state.
 * Returns null if MR context isn't available.
 */
function buildInquiryContext(inquiryId: string): InquiryContext | null {
  const reviewState = useReviewStore.getState();
  const inquiryState = useInquiryStore.getState();

  if (!reviewState.mrContext) return null;

  const inquiry = inquiryState.inquiries[inquiryId];
  if (!inquiry) return null;

  // Find the full file diff for broader context
  const fileDiff = reviewState.mrContext.diffFiles.find(
    (f) => f.filePath === inquiry.filePath,
  );

  return {
    mrContext: reviewState.mrContext,
    filePath: inquiry.filePath,
    startLine: inquiry.startLine,
    endLine: inquiry.endLine,
    diffSnippet: inquiry.diffSnippet,
    codeContent: inquiry.codeContent,
    fullFileDiff: fileDiff?.diff ?? '',
    // Include all completed slides (not the in-flight one) for follow-up context
    previousSlides: inquiry.slides.filter((s) => s.answer !== ''),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Submit a question for an inquiry and stream the AI response.
 *
 * Flow:
 * 1. Builds InquiryContext from stores
 * 2. Adds a new slide to the inquiry (via store.submitQuestion)
 * 3. Opens a streaming connection (Botto or chrome.runtime)
 * 4. Dispatches delta/complete/error to the inquiry store
 *
 * Returns false if context isn't available.
 */
export function sendInquiryQuestion(inquiryId: string, question: string): boolean {
  const context = buildInquiryContext(inquiryId);
  if (!context) {
    useInquiryStore.getState().setError(inquiryId, 'No MR context available.');
    return false;
  }

  // Cancel any in-progress stream
  cancelInquiryStream();

  // Add the question as a new slide in streaming state
  useInquiryStore.getState().submitQuestion(inquiryId, question);
  activeInquiryId = inquiryId;

  startInquiryStream(inquiryId, question, context);
  return true;
}

/**
 * Retry the last failed question on an inquiry.
 * Re-sends without adding a duplicate slide.
 */
export function retryInquiryQuestion(inquiryId: string): boolean {
  const inquiry = useInquiryStore.getState().inquiries[inquiryId];
  if (!inquiry || inquiry.slides.length === 0) return false;

  const lastSlide = inquiry.slides[inquiry.slides.length - 1];
  if (!lastSlide) return false;

  const context = buildInquiryContext(inquiryId);
  if (!context) {
    useInquiryStore.getState().setError(inquiryId, 'No MR context available.');
    return false;
  }

  // Cancel any in-progress stream — discard partial
  cancelInquiryStream(true);

  // Reset the last slide's answer so the new stream renders cleanly
  useInquiryStore.getState().resetSlideForRetry(inquiryId);
  activeInquiryId = inquiryId;

  startInquiryStream(inquiryId, lastSlide.question, context);
  return true;
}

// ---------------------------------------------------------------------------
// Internal: stream wiring
// ---------------------------------------------------------------------------

function startInquiryStream(
  inquiryId: string,
  question: string,
  context: InquiryContext,
): void {
  const inquiryPayload = {
    inquiryContext: context,
    question,
  };

  const onChunkHandler = (chunk: StreamChunk) => {
    switch (chunk.type) {
      case 'STREAM_INQUIRY_DELTA':
        pendingDelta += chunk.payload.content;
        scheduleDeltaFlush();
        break;

      case 'STREAM_INQUIRY_COMPLETE':
        if (pendingDelta) {
          flushDelta();
        }
        useInquiryStore.getState().completeSlide(inquiryId, chunk.payload.content);
        activeDisconnect = null;
        activeInquiryId = null;
        persistInquiryToCache(inquiryId);
        break;

      case 'STREAM_INQUIRY_ERROR':
        if (pendingDelta) {
          flushDelta();
        }
        useInquiryStore.getState().setError(inquiryId, chunk.payload.error);
        activeDisconnect = null;
        activeInquiryId = null;
        break;

      default:
        break;
    }
  };

  const onDisconnectHandler = () => {
    const state = useInquiryStore.getState();
    const inquiry = state.inquiries[inquiryId];
    if (inquiry?.status === 'streaming') {
      if (pendingDelta) {
        flushDelta();
      }
      state.setError(inquiryId, 'Connection lost. Try again.');
    }
    activeDisconnect = null;
    activeInquiryId = null;
  };

  // --- Botto transport: route through WebSocket if connected ---
  try {
    const bottoClient = getBottoClient((globalThis as any).__ottoSettings);
    if (bottoClient?.isConnected()) {
      const { cancel } = bottoClient.openStream(
        { type: 'STREAM_INQUIRY', ...inquiryPayload },
        (chunk) => onChunkHandler(chunk as StreamChunk),
        () => {},
        () => onDisconnectHandler(),
      );
      activeDisconnect = cancel;
      return;
    }
  } catch {
    // Botto not available — fall through to local transport
  }

  // --- Local transport: chrome.runtime port ---
  activeDisconnect = openStream(
    {
      type: 'STREAM_INQUIRY',
      payload: inquiryPayload,
    },
    {
      onChunk: onChunkHandler,
      onDisconnect: onDisconnectHandler,
    },
  );
}

// ---------------------------------------------------------------------------
// Cache persistence
// ---------------------------------------------------------------------------

/**
 * Save the current inquiry state to cache.
 * Called after each completed slide.
 */
function persistInquiryToCache(inquiryId: string): void {
  const reviewState = useReviewStore.getState();
  const inquiryState = useInquiryStore.getState();

  if (!reviewState.mrContext) return;

  const inquiry = inquiryState.inquiries[inquiryId];
  if (!inquiry || inquiry.slides.length === 0) return;

  // Find the file's diff for the hash
  const fileDiff = reviewState.mrContext.diffFiles.find(
    (f) => f.filePath === inquiry.filePath,
  );

  saveCachedInquiry(
    reviewState.mrContext.projectPath,
    reviewState.mrContext.mrIid,
    inquiry,
    fileDiff?.diff ?? '',
  );
}

// ---------------------------------------------------------------------------
// Cache loading
// ---------------------------------------------------------------------------

/**
 * Try to load cached inquiries and hydrate the store.
 * Called once when the content script initializes on the diffs tab.
 * Returns the number of inquiries loaded.
 */
export async function tryLoadCachedInquiries(
  projectPath: string,
  mrIid: number,
): Promise<number> {
  const { loadAllCachedInquiries } = await import('./inquiry-cache');
  const cached = await loadAllCachedInquiries(projectPath, mrIid);
  if (cached.length > 0) {
    useInquiryStore.getState().hydrateFromCache(cached);
  }
  return cached.length;
}
