// ---------------------------------------------------------------------------
// General utilities — pure functions with no side effects.
// ---------------------------------------------------------------------------

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes with conflict resolution.
 * Standard shadcn pattern — used by every component.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate a unique ID. Uses crypto.randomUUID when available (all modern
 * browsers + service workers), falls back to a simple random string.
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Truncate a string to a max length, appending ellipsis if truncated.
 * Used for display purposes (file paths, summaries).
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '\u2026';
}

/**
 * Sleep for a given number of milliseconds.
 * Used for retry backoff in services.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff.
 * Used by AI and GitLab clients for transient failures.
 *
 * @param fn - The async function to retry
 * @param maxRetries - Maximum number of retry attempts (default 3)
 * @param baseDelay - Base delay in ms, doubled each retry (default 1000)
 * @param shouldRetry - Optional predicate to decide if a specific error is retryable
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
  shouldRetry?: (error: unknown) => boolean,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      if (shouldRetry && !shouldRetry(error)) break;
      await sleep(baseDelay * Math.pow(2, attempt));
    }
  }
  throw lastError;
}

/**
 * URL-encode a GitLab project path for use in API URLs.
 * GitLab requires path separators to be encoded: "namespace/project" → "namespace%2Fproject"
 */
export function encodeProjectPath(path: string): string {
  return encodeURIComponent(path);
}

/**
 * Strip trailing slash from a URL.
 */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}
