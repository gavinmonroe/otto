// ---------------------------------------------------------------------------
// Viewport Tracker — detects which diff files are visible and sends
// file-level presence updates to Botto.
//
// Design decisions:
// - Runs on a 2s setInterval, NOT on scroll events. Scroll listeners are
//   already used by dom-observer and inline-injector — adding another for
//   presence is unnecessary overhead. 2s is fast enough for "who's looking
//   at this file" without being chatty.
// - Uses getBoundingClientRect() (consistent with existing codebase — no
//   IntersectionObserver is used anywhere in Otto).
// - Skips entirely when health is degraded or critical — presence is
//   non-essential and must never contribute to tab stress.
// - Only emits when the visible file set actually changes. Most scroll
//   events within the same large file won't trigger a send.
// - Line range extraction from diff gutters is best-effort — if parsing
//   fails, we omit them. They're nice-to-have, not critical.
// ---------------------------------------------------------------------------

import { getHealthLevel } from '@/services/review/health-monitor';
import type { BottoClient } from '@/lib/botto-client';

const DEBUG = false;
function dbg(msg: string, ...args: any[]) {
  if (DEBUG) console.log(`[Otto:viewport-tracker] ${msg}`, ...args);
}

type VisibleFile = {
  path: string;
  first_line?: number;
  last_line?: number;
};

/**
 * Start tracking which diff files are visible in the viewport.
 * Sends VIEWING_FILES updates to Botto when the visible set changes.
 *
 * Returns a cleanup function. Also cleans up on abort signal.
 */
export function startViewportTracker(
  bottoClient: BottoClient,
  signal?: AbortSignal,
): () => void {
  let prevKey = ''; // Serialized previous visible file set for change detection

  function tick() {
    // Health gate — presence is non-essential
    const health = getHealthLevel();
    if (health === 'degraded' || health === 'critical') return;

    // Don't send if not connected
    if (!bottoClient.isConnected()) return;

    const visible = getVisibleDiffFiles();

    // Change detection: serialize paths + line ranges and compare
    const key = serializeVisibleFiles(visible);
    if (key === prevKey) return;
    prevKey = key;

    dbg(`visible files changed: ${visible.length} files`);
    bottoClient.viewingFiles(visible);
  }

  const intervalId = setInterval(tick, 2000);

  // Run once immediately so presence is sent on page load
  // (after a short delay to let diff files render)
  const initialTimer = setTimeout(tick, 500);

  function cleanup() {
    clearInterval(intervalId);
    clearTimeout(initialTimer);
  }

  if (signal) {
    signal.addEventListener('abort', cleanup, { once: true });
  }

  return cleanup;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Find all .diff-file elements whose bounding rect overlaps the viewport.
 * Uses a tight viewport check (no margin) — we want "actually visible",
 * not "near viewport" like dom-observer uses for preloading.
 */
function getVisibleDiffFiles(): VisibleFile[] {
  const files = document.querySelectorAll('.diff-file.file-holder');
  const result: VisibleFile[] = [];
  const vh = window.innerHeight;

  for (const el of files) {
    const rect = el.getBoundingClientRect();
    // File is visible if any part of it is in the viewport
    if (rect.bottom <= 0 || rect.top >= vh) continue;

    const path = el.getAttribute('data-path');
    if (!path) continue;

    const lineRange = extractVisibleLineRange(el, rect, vh);
    const entry: VisibleFile = { path };
    if (lineRange) {
      entry.first_line = lineRange.first;
      entry.last_line = lineRange.last;
    }
    result.push(entry);
  }

  return result;
}

/**
 * Best-effort extraction of the visible line range from diff gutter numbers.
 * Looks at the first and last visible line number elements in the diff table.
 * Returns null if parsing fails — this is supplementary data.
 */
function extractVisibleLineRange(
  fileEl: Element,
  fileRect: DOMRect,
  viewportHeight: number,
): { first: number; last: number } | null {
  try {
    // GitLab diff line numbers are in elements with data-linenumber attribute
    // or in .diff-line-num elements with text content
    const lineEls = fileEl.querySelectorAll(
      '[data-linenumber], .diff-line-num:not(.old_line):not(.empty-cell)',
    );
    if (lineEls.length === 0) return null;

    let firstLine: number | null = null;
    let lastLine: number | null = null;

    for (const el of lineEls) {
      const rect = el.getBoundingClientRect();
      // Skip elements outside the viewport
      if (rect.bottom <= 0 || rect.top >= viewportHeight) continue;

      const lineNum = parseInt(
        el.getAttribute('data-linenumber') || el.textContent?.trim() || '',
        10,
      );
      if (isNaN(lineNum) || lineNum <= 0) continue;

      if (firstLine === null || lineNum < firstLine) firstLine = lineNum;
      if (lastLine === null || lineNum > lastLine) lastLine = lineNum;
    }

    if (firstLine !== null && lastLine !== null) {
      return { first: firstLine, last: lastLine };
    }
  } catch {
    // Best-effort — don't let line parsing crash the tracker
  }
  return null;
}

/**
 * Serialize visible files into a stable string for change detection.
 * Sorted by path to ensure order-independent comparison.
 */
function serializeVisibleFiles(files: VisibleFile[]): string {
  if (files.length === 0) return '';
  return files
    .map((f) => `${f.path}:${f.first_line ?? ''}:${f.last_line ?? ''}`)
    .sort()
    .join('|');
}
