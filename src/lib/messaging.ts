// ---------------------------------------------------------------------------
// Typed message passing — type-safe communication between content script
// and service worker.
//
// Design decisions:
// - `sendMessage` is generic over the message type, so the return type is
//   automatically inferred from the message's `type` field.
// - The service worker side uses `handleMessage` which takes a handler map,
//   ensuring every message type is handled (TypeScript enforces exhaustiveness).
// - Streaming uses a separate port-based system (see `openStream`).
// - All errors are caught and returned as Result.ok=false, never thrown.
//   This prevents unhandled promise rejections in the content script.
// ---------------------------------------------------------------------------

import type {
  RequestMessage,
  MessageResponseMap,
  StreamRequest,
  StreamChunk,
  Result,
} from '@/types/messages';

// ---------------------------------------------------------------------------
// Content script side — sending messages to the service worker.
// ---------------------------------------------------------------------------

/**
 * Send a typed message to the service worker and get a typed response.
 *
 * Usage:
 *   const result = await sendMessage({ type: 'GET_SETTINGS' });
 *   // result is Result<OttoSettings>
 */
export async function sendMessage<T extends RequestMessage>(
  message: T,
): Promise<MessageResponseMap[T['type']]> {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response as MessageResponseMap[T['type']];
  } catch (error) {
    // If the service worker is not running or the extension context is invalid,
    // return a generic error result. This handles the case where the extension
    // was updated while the content script is still running on a page.
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
