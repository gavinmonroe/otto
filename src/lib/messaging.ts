// ---------------------------------------------------------------------------
// Typed message passing — type-safe communication between content script
// and service worker, with optional Botto server routing.
//
// When Botto is connected, one-shot messages and streams are routed through
// the WebSocket instead of chrome.runtime. This centralizes all AI/GitLab
// calls through the shared server. Falls back to local (chrome.runtime)
// when Botto is not available.
//
// Design decisions:
// - `sendMessage` is generic over the message type, so the return type is
//   automatically inferred from the message's `type` field.
// - The service worker side uses `handleMessage` which takes a handler map,
//   ensuring every message type is handled (TypeScript enforces exhaustiveness).
// - Streaming uses a separate port-based system (see `openStream`).
// - All errors are caught and returned as Result.ok=false, never thrown.
// ---------------------------------------------------------------------------

import type {
  RequestMessage,
  MessageResponseMap,
  StreamRequest,
  StreamChunk,
  Result,
} from '@/types/messages';

// ---------------------------------------------------------------------------
// Botto transport detection
// ---------------------------------------------------------------------------

/**
 * Registered Botto client getter — set by the content script on init.
 * This avoids importing botto-client.ts directly (which would pull it
 * into the service worker bundle where it can't run).
 */
let bottoClientGetter: (() => any) | null = null;

/**
 * Register a function that returns the connected Botto client.
 * Called once by the content script after initializing the Botto connection.
 */
export function registerBottoTransport(getter: () => any): void {
  bottoClientGetter = getter;
}

/**
 * Check if a Botto client is connected and available for routing.
 * Returns the client instance or null.
 */
function getConnectedBottoClient(): any | null {
  try {
    if (!bottoClientGetter) return null;
    const client = bottoClientGetter();
    return client?.isConnected() ? client : null;
  } catch {
    return null;
  }
}

/**
 * Message types that should ALWAYS go through chrome.runtime (local-only).
 * These are either client-side operations, settings management, or features
 * that must stay local to the extension (no server-side equivalent).
 *
 * GitLab API calls stay local because:
 *   - They use the user's own PAT (not Botto's bot PAT)
 *   - The service worker returns a specific response shape that callers depend on
 *   - Botto's handlers return different shapes (raw GitLab API responses)
 */
const LOCAL_ONLY_MESSAGES = new Set([
  'GET_SETTINGS',
  'SAVE_SETTINGS',
  'RESOLVE_GITLAB_HOST',
  'HIGHLIGHT_CODE',
  'HIGHLIGHT_LINES',
  'OPEN_OPTIONS',
  'FETCH_AI_MODELS',
  'TEST_AI_CONNECTION',
  'TEST_JIRA_CONNECTION',
  'FETCH_MR_PREVIEW',
  'FETCH_MR_PREVIEWS_BATCH',
  'ANALYZE_COMMENT',
  // Ticket fetching requires Jira credentials from extension settings.
  'FETCH_TICKET',
  'FETCH_TICKET_BATCH',
  // GitLab API calls — use user's PAT, service worker shapes differ from Botto.
  'FETCH_PROJECT',
  'FETCH_MR_METADATA',
  'FETCH_MR_CHANGES',
  'FETCH_FILE_CONTENT',
  'FETCH_FILE_TREE',
  'FETCH_MR_DISCUSSIONS',
  'TEST_GITLAB_CONNECTION',
]);

// ---------------------------------------------------------------------------
// Content script side — sending messages to the service worker or Botto.
// ---------------------------------------------------------------------------

/**
 * Send a typed message to the service worker (or Botto if connected).
 *
 * Routing logic:
 * - Local-only messages always go through chrome.runtime
 * - When Botto is connected, other messages route through WebSocket
 * - Falls back to chrome.runtime if Botto send fails
 */
export async function sendMessage<T extends RequestMessage>(
  message: T,
): Promise<MessageResponseMap[T['type']]> {
  // Check if this message should be routed through Botto
  if (!LOCAL_ONLY_MESSAGES.has(message.type)) {
    const botto = getConnectedBottoClient();
    if (botto) {
      try {
        const response = await botto.sendRequest(message as Record<string, unknown>);
        return response as MessageResponseMap[T['type']];
      } catch {
        // Fall through to local transport
      }
    }
  }

  // Local transport: chrome.runtime
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response as MessageResponseMap[T['type']];
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Message send failed',
    } as MessageResponseMap[T['type']];
  }
}

// ---------------------------------------------------------------------------
// Content script side — streaming via ports.
// ---------------------------------------------------------------------------

export type StreamCallbacks = {
  onChunk: (chunk: StreamChunk) => void;
  onDisconnect?: () => void;
};

/**
 * Open a streaming connection to the service worker.
 * Returns a disconnect function to clean up the port.
 *
 * Usage:
 *   const disconnect = openStream(
 *     { type: 'STREAM_REVIEW', payload: { mrContext, tasks: ['summary', 'codeReview'] } },
 *     {
 *       onChunk: (chunk) => { ... },
 *       onDisconnect: () => { ... },
 *     }
 *   );
 *   // Later: disconnect();
 */
export function openStream(
  request: StreamRequest,
  callbacks: StreamCallbacks,
): () => void {
  const port = chrome.runtime.connect({ name: 'otto-stream' });

  port.onMessage.addListener((message: StreamChunk) => {
    callbacks.onChunk(message);
  });

  port.onDisconnect.addListener(() => {
    callbacks.onDisconnect?.();
  });

  // Send the initial request after listeners are attached
  port.postMessage(request);

  return () => {
    try {
      port.disconnect();
    } catch {
      // Port may already be disconnected
    }
  };
}

// ---------------------------------------------------------------------------
// Service worker side — handling messages.
// ---------------------------------------------------------------------------

/**
 * Type for the handler map used by the service worker.
 * Each key is a message type, each value is an async handler function.
 */
export type MessageHandlerMap = {
  [K in RequestMessage['type']]: (
    payload: Extract<RequestMessage, { type: K }> extends { payload: infer P } ? P : undefined,
  ) => Promise<MessageResponseMap[K]>;
};

/**
 * Register the message handler in the service worker.
 * Takes a handler map and wires it up to chrome.runtime.onMessage.
 *
 * The handler map must handle every message type (TypeScript enforces this).
 * Each handler receives the payload (if any) and returns a typed response.
 */
export function registerMessageHandler(handlers: MessageHandlerMap): void {
  chrome.runtime.onMessage.addListener(
    (message: RequestMessage, _sender, sendResponse) => {
      const handler = handlers[message.type] as (payload: unknown) => Promise<unknown>;
      if (!handler) {
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
        return true; // Keep the message channel open
      }

      const payload = 'payload' in message ? message.payload : undefined;
      handler(payload)
        .then((result) => sendResponse(result))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Handler failed',
          });
        });

      return true; // Required: tells Chrome we'll call sendResponse asynchronously
    },
  );
}

/**
 * Type for the stream handler used by the service worker.
 */
export type StreamHandler = (
  request: StreamRequest,
  send: (chunk: StreamChunk) => void,
) => Promise<void>;

/**
 * Register the stream handler in the service worker.
 * Listens for port connections named 'otto-stream'.
 */
export function registerStreamHandler(handler: StreamHandler): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'otto-stream') return;

    port.onMessage.addListener(async (request: StreamRequest) => {
      // Keep the service worker alive while the stream is active.
      // Chrome terminates service workers after ~30s of inactivity.
      // Sending periodic no-op messages prevents port disconnection
      // during long-running tasks (e.g., related files tool-calling).
      const keepalive = setInterval(() => {
        try {
          port.postMessage({
            type: 'STREAM_PROGRESS',
            payload: { message: '' },
          } satisfies StreamChunk);
        } catch {
          clearInterval(keepalive);
        }
      }, 20_000); // Every 20 seconds — well within Chrome's ~30s timeout

      try {
        await handler(request, (chunk) => {
          try {
            port.postMessage(chunk);
          } catch {
            // Port disconnected mid-stream — client navigated away
            clearInterval(keepalive);
          }
        });
      } catch (error) {
        try {
          port.postMessage({
            type: 'STREAM_TASK_ERROR',
            payload: {
              task: 'review',
              error: error instanceof Error ? error.message : 'Stream handler failed',
            },
          } satisfies StreamChunk);
        } catch {
          // Port already disconnected
        }
      } finally {
        clearInterval(keepalive);
      }
    });
  });
}
