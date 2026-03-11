// ---------------------------------------------------------------------------
// Chat Stream Dispatcher — connects the chat UI to the background service
// worker via port-based streaming.
//
// Design decisions:
// - Builds ChatReviewContext from the review store at the moment the user
//   sends a message. This snapshot approach means the AI sees whatever
//   review data is available at that point — even partial results.
// - Delta batching at ~60fps via requestAnimationFrame, same pattern as
//   the review stream dispatcher. Prevents store thrashing on fast streams.
// - Only one chat stream can be active at a time. Starting a new one
//   disconnects the previous (the user sent a new message).
// ---------------------------------------------------------------------------

import { useChatStore } from './chat-store';
import { useReviewStore } from '@/services/review/review-store';
import { openStream } from '@/lib/messaging';
import { saveCachedChat, loadCachedChat } from './chat-cache';
import type { StreamChunk, ChatReviewContext } from '@/types/messages';
import type { ReviewComment } from '@/types/review';

// ---------------------------------------------------------------------------
// Delta batching
// ---------------------------------------------------------------------------

let pendingChatDelta = '';
let flushScheduled = false;

function scheduleDeltaFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(flushChatDelta);
}

function flushChatDelta(): void {
  flushScheduled = false;
  if (pendingChatDelta) {
    useChatStore.getState().appendDelta(pendingChatDelta);
    pendingChatDelta = '';
  }
}

// ---------------------------------------------------------------------------
// Active stream tracking
// ---------------------------------------------------------------------------

let activeDisconnect: (() => void) | null = null;

/**
 * Cancel any in-progress chat stream.
 * Safe to call even if no stream is active.
 *
 * @param discard - If true, discard any partial response instead of committing it.
 *                  Used by retry to avoid saving a broken partial message.
 */
export function cancelChatStream(discard = false): void {
  if (activeDisconnect) {
    activeDisconnect();
    activeDisconnect = null;
  }

  if (discard) {
    // Throw away any buffered delta — don't commit it
    pendingChatDelta = '';
    flushScheduled = false;
    const state = useChatStore.getState();
    if (state.status === 'streaming') {
      state.setStatus('idle');
    }
    return;
  }

  // Flush any remaining delta so the partial response is visible
  if (pendingChatDelta) {
    flushChatDelta();
  }
  // If we were streaming, commit whatever partial response we have
  // as a completed message so it doesn't vanish
  const state = useChatStore.getState();
  if (state.status === 'streaming') {
    if (state.currentDelta.trim()) {
      // There's partial content — save it as a completed message
      state.completeAssistantMessage(state.currentDelta, []);
    } else {
      // No content yet — just reset status
      state.setStatus('idle');
    }
  }
}

/**
 * Build a ChatReviewContext snapshot from the current review store state.
 * Returns null if there's no MR context at all (page hasn't loaded).
 *
 * Note: This may return a context with empty diffFiles if the user hasn't
 * navigated to the diffs tab yet. The chat will still work — the AI just
 * won't have diff data to reference. The prompt builder handles this
 * gracefully (shows "0 files" in the diffs section).
 */
function buildReviewContextSnapshot(): ChatReviewContext | null {
  const state = useReviewStore.getState();
  if (!state.mrContext) return null;

  return {
    mrContext: state.mrContext,
    summary: state.summary,
    fileReviews: state.fileReviews,
    edgeCases: state.edgeCases,
    relatedFiles: state.relatedFiles,
  };
}

/**
 * Send a chat message and stream the AI response.
 *
 * Flow:
 * 1. Adds the user message to the chat store
 * 2. Builds a review context snapshot
 * 3. Opens a streaming port to the background
 * 4. Dispatches delta/complete/error chunks to the chat store
 *
 * Returns false if the review context isn't available (no MR loaded).
 */
export function sendChatMessage(question: string): boolean {
  const reviewContext = buildReviewContextSnapshot();
  if (!reviewContext) {
    useChatStore.getState().setError('No MR context available. Wait for the page to load.');
    return false;
  }

  // Cancel any in-progress stream
  cancelChatStream();

  const chatStore = useChatStore.getState();

  // Capture and clear focused comment before sending
  const focusedComment = chatStore.focusedComment;
  if (focusedComment) {
    chatStore.clearFocusedComment();
  }

  // Add user message and get conversation history (excluding the new message)
  // We need the history BEFORE adding the new message
  const history = [...chatStore.messages];
  chatStore.addUserMessage(question);

  startChatStream(question, history, reviewContext, focusedComment);
  return true;
}

/**
 * Retry the last failed chat message.
 * Re-sends the last user message WITHOUT adding a duplicate to the conversation.
 * Clears the error state before retrying.
 *
 * Returns false if there's no user message to retry or no review context.
 */
export function retryChatMessage(): boolean {
  const reviewContext = buildReviewContextSnapshot();
  if (!reviewContext) {
    useChatStore.getState().setError('No MR context available. Wait for the page to load.');
    return false;
  }

  const chatStore = useChatStore.getState();
  const messages = chatStore.messages;

  // Find the last user message
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) return false;

  // Cancel any in-progress stream — discard partial response for retry
  cancelChatStream(true);

  // Clear error and set streaming status — the user message is already in the list.
  // Important: set both in one logical step. Don't use setError() here because
  // it would override status back to 'error'.
  chatStore.setStatus('streaming');

  // History is everything before the last user message
  const lastUserIdx = messages.findIndex((m) => m.id === lastUserMsg.id);
  const history = messages.slice(0, lastUserIdx);

  startChatStream(lastUserMsg.content, history, reviewContext);
  return true;
}

/**
 * Internal: open the stream and wire up chunk dispatching.
 *
 * When a focusedComment is provided, the question sent to the AI is enriched
 * with the comment's context. The user's displayed message stays clean —
 * the enrichment only goes to the AI.
 */
function startChatStream(
  question: string,
  history: import('@/types/chat').ChatMessage[],
  reviewContext: ChatReviewContext,
  focusedComment?: ReviewComment | null,
): void {
  // Enrich the question with focused comment context for the AI
  let aiQuestion = question;
  if (focusedComment) {
    const parts = [
      `[Context: Otto review comment on ${focusedComment.filePath}`,
      focusedComment.startLine ? ` line ${focusedComment.startLine}` : '',
      ` — ${focusedComment.severity}/${focusedComment.category}]`,
      `\nTitle: ${focusedComment.title}`,
      `\nBody: ${focusedComment.body}`,
    ];
    if (focusedComment.suggestion) {
      parts.push(`\nSuggested code:\n\`\`\`\n${focusedComment.suggestion}\n\`\`\``);
    }
    if (focusedComment.suggestionSummary) {
      parts.push(`\nSuggestion summary: ${focusedComment.suggestionSummary}`);
    }
    if (focusedComment.originalCode) {
      parts.push(`\nOriginal code:\n\`\`\`\n${focusedComment.originalCode}\n\`\`\``);
    }
    aiQuestion = `${parts.join('')}\n\nUser question: ${question}`;
  }

  activeDisconnect = openStream(
    {
      type: 'STREAM_CHAT',
      payload: {
        question: aiQuestion,
        history,
        reviewContext,
      },
    },
    {
      onChunk: (chunk: StreamChunk) => {
        switch (chunk.type) {
          case 'STREAM_CHAT_DELTA':
            pendingChatDelta += chunk.payload.content;
            scheduleDeltaFlush();
            break;

          case 'STREAM_CHAT_COMPLETE':
            // Flush any pending delta first
            if (pendingChatDelta) {
              flushChatDelta();
            }
            useChatStore.getState().completeAssistantMessage(
              chunk.payload.content,
              chunk.payload.suggestedQuestions,
            );
            activeDisconnect = null;
            // Persist to cache
            persistChatToCache();
            break;

          case 'STREAM_CHAT_ERROR':
            if (pendingChatDelta) {
              flushChatDelta();
            }
            useChatStore.getState().setError(chunk.payload.error);
            activeDisconnect = null;
            break;

          // Ignore review-specific chunks (shouldn't arrive on a chat stream,
          // but defensive coding in case of protocol mismatch)
          default:
            break;
        }
      },
      onDisconnect: () => {
        const state = useChatStore.getState();
        if (state.status === 'streaming') {
          // Flush any remaining delta so partial response is visible
          if (pendingChatDelta) {
            flushChatDelta();
          }
          state.setError('Connection to Otto lost. Try again.');
        }
        activeDisconnect = null;
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Cache persistence
// ---------------------------------------------------------------------------

/**
 * Save current chat state to cache. Called after each completed assistant message.
 */
function persistChatToCache(): void {
  const reviewState = useReviewStore.getState();
  const chatState = useChatStore.getState();

  if (!reviewState.mrContext) return;
  if (chatState.messages.length === 0) return;

  saveCachedChat(
    reviewState.mrContext.projectPath,
    reviewState.mrContext.mrIid,
    chatState.messages,
    chatState.suggestedQuestions,
  );
}

/**
 * Try to load cached chat messages and hydrate the chat store.
 * Called once when the content script initializes.
 * Returns true if cache was found and loaded.
 */
export async function tryLoadCachedChat(
  projectPath: string,
  mrIid: number,
): Promise<boolean> {
  const cached = await loadCachedChat(projectPath, mrIid);
  if (cached && cached.messages.length > 0) {
    useChatStore.getState().hydrateFromCache(cached);
    return true;
  }
  return false;
}
