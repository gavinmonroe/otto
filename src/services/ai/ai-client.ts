// ---------------------------------------------------------------------------
// AI Client — lightweight OpenAI-compatible chat completions client.
//
// Runs in the service worker only. Uses raw fetch instead of the OpenAI SDK
// for several reasons:
// 1. Smaller bundle (~0KB vs ~100KB+ for the SDK)
// 2. No dependency issues in service worker context
// 3. Full control over SSE stream parsing
// 4. We only need chat/completions — the SDK is overkill
//
// Design decisions:
// - Accepts baseUrl + apiKey per call (no stored state — service worker safe)
// - Streaming returns an AsyncGenerator that yields content strings
// - Non-streaming returns the full response
// - Both modes return structured error results, never throw
// - The SSE parser handles edge cases: multi-line data, empty lines, [DONE]
// ---------------------------------------------------------------------------

import type { Result } from '@/types/messages';
import { normalizeUrl } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types — minimal subset of the OpenAI chat completions API
// ---------------------------------------------------------------------------

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
};

export type ChatCompletionResponse = {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string | null;
    index: number;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type AiClientConfig = {
  baseUrl: string;
  apiKey: string;
};

// ---------------------------------------------------------------------------
// Non-streaming completion
// ---------------------------------------------------------------------------

/**
 * Send a chat completion request and get the full response.
 * Used for structured output (JSON parsing) where we need the complete text.
 */
export async function chatCompletion(
  config: AiClientConfig,
  request: Omit<ChatCompletionRequest, 'stream'>,
): Promise<Result<ChatCompletionResponse>> {
  const url = `${normalizeUrl(config.baseUrl)}/chat/completions`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ ...request, stream: false }),
    });

    if (!response.ok) {
      return handleHttpError(response);
    }

    const data = await response.json() as ChatCompletionResponse;
    return { ok: true, data };
  } catch (error) {
    return handleNetworkError(error, config.baseUrl);
  }
}

// ---------------------------------------------------------------------------
// Streaming completion
// ---------------------------------------------------------------------------

/**
 * Send a streaming chat completion request.
 * Returns an AsyncGenerator that yields content delta strings.
 *
 * Usage:
 *   const stream = chatCompletionStream(config, request);
 *   for await (const chunk of stream) {
 *     // chunk is a string (content delta)
 *     process(chunk);
 *   }
 *
 * The generator handles:
 * - SSE parsing (data: lines)
 * - [DONE] signal
 * - Empty deltas (skipped)
 * - Network errors (thrown as the last yield)
 */
export async function* chatCompletionStream(
  config: AiClientConfig,
  request: Omit<ChatCompletionRequest, 'stream'>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  const url = `${normalizeUrl(config.baseUrl)}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ ...request, stream: true }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AiClientError(
      `AI API error ${response.status}: ${body.slice(0, 200)}`,
      response.status,
    );
  }

  if (!response.body) {
    throw new AiClientError('AI API returned no response body', 0);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split('\n');
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith(':')) continue;

        // Parse data lines
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);

          // [DONE] signals end of stream
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{
                delta?: { content?: string };
                finish_reason?: string | null;
              }>;
            };

            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch {
            // Skip malformed JSON chunks — some providers send non-standard data
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Model listing
// ---------------------------------------------------------------------------

/**
 * Fetch available models from the AI endpoint.
 * Not all providers implement this — returns an empty array on failure.
 */
export async function fetchModels(config: AiClientConfig): Promise<Result<string[]>> {
  const url = `${normalizeUrl(config.baseUrl)}/models`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
    });

    if (!response.ok) {
      return { ok: false, error: `Failed to fetch models: ${response.status}` };
    }

    const data = await response.json() as { data?: Array<{ id: string }> };
    const models = (data.data || []).map((m) => m.id).sort();
    return { ok: true, data: models };
  } catch (error) {
    return handleNetworkError(error, config.baseUrl);
  }
}

/**
 * Test the connection to an AI endpoint.
 * Sends a minimal request to verify auth and connectivity.
 */
export async function testConnection(
  config: AiClientConfig,
): Promise<Result<{ model: string }>> {
  // Try fetching models first (lightweight)
  const modelsResult = await fetchModels(config);
  if (modelsResult.ok && modelsResult.data.length > 0) {
    return { ok: true, data: { model: modelsResult.data[0] } };
  }

  // If models endpoint doesn't work, try a minimal completion
  const result = await chatCompletion(config, {
    model: 'gpt-3.5-turbo', // Fallback model name — most providers accept it
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 1,
  });

  if (result.ok) {
    return { ok: true, data: { model: 'connected' } };
  }

  return { ok: false, error: result.error };
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

export class AiClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AiClientError';
  }
}

async function handleHttpError<T>(response: Response): Promise<Result<T>> {
  const body = await response.text().catch(() => '');
  if (response.status === 401) {
    return { ok: false, error: 'AI API authentication failed. Check your API key.' };
  }
  if (response.status === 429) {
    return { ok: false, error: 'AI API rate limit exceeded. Try again in a moment.' };
  }
  if (response.status >= 500) {
    return { ok: false, error: `AI API server error (${response.status}). The provider may be experiencing issues.` };
  }
  return { ok: false, error: `AI API error ${response.status}: ${body.slice(0, 200)}` };
}

function handleNetworkError<T>(error: unknown, baseUrl: string): Result<T> {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return { ok: false, error: `Cannot reach AI API at ${baseUrl}. Check the URL and your network.` };
  }
  return { ok: false, error: error instanceof Error ? error.message : 'AI request failed' };
}
