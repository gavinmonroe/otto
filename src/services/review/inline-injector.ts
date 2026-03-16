// ---------------------------------------------------------------------------
// Inline Comment Injector — mounts InlineCommentThread components directly
// into GitLab's diff view, after the line each comment references.
//
// Design decisions:
// - Each inline comment gets its own shadow DOM container for CSS isolation.
// - The container is a full-width div inserted after the diff row.
// - We track injected comments by ID to avoid duplicates and to clean up
//   dismissed comments.
// - Subscribes to the review store and reacts to new file reviews.
// - Handles both inline (unified) and parallel diff views.
// - Retries failed injections when new DOM elements appear (handles cache
//   hydration where reviews arrive before diff elements are rendered).
// - MutationObserver is debounced to prevent cascading DOM thrashing.
// - Status subscription only re-renders comments whose status changed.
// - Uses a single merged subscription (not two) to halve per-update cost.
// - Initial cache hydration uses requestIdleCallback to batch inject.
// ---------------------------------------------------------------------------

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemeProvider } from '@/components/ThemeContext';
import { OttoErrorBoundary } from '@/components/OttoErrorBoundary';
import { InlineCommentThread } from '@/components/review/InlineCommentThread';
import { useReviewStore } from '@/services/review/review-store';
import type { ReviewComment, ReviewCommentStatus } from '@/types/review';
import { getHealthLevel } from '@/services/review/health-monitor';
import { isOttoMutating, guardedMutation, startInjectionCooldown } from '@/lib/dom-guard';

const DEBUG = true;
function dbg(msg: string, ...args: any[]) {
  if (DEBUG) console.log(`[Otto:inline-injector] ${msg}`, ...args);
}

const INJECTED_ATTR = 'data-otto-inline-comment';

/** Track mounted inline comments for cleanup */
const mountedComments = new Map<string, { root: Root; container: HTMLElement; lastStatus: ReviewCommentStatus }>();

/** Track comments that failed to inject because the DOM wasn't ready */
const pendingComments = new Map<string, ReviewComment>();

/** Track comments that failed to inject because the line row doesn't exist.
 *  Prevents infinite retry loops when the file is visible but the specific
 *  line isn't rendered (collapsed diff, virtual scrolling within a file). */
const failedComments = new Set<string>();

/** Batch size for requestIdleCallback injection during cache hydration */
const BATCH_INJECT_SIZE = 5;

/**
 * Batch inject comments using requestIdleCallback to prevent 20+ shadow DOM
 * mounts from locking the main thread during cache hydration on large MRs.
 * Falls back to setTimeout if requestIdleCallback is not available.
 */
function batchInject(comments: ReviewComment[], isDarkMode: boolean): void {
  if (comments.length === 0) return;

  // Suppress redundant rescans while the initial injection is settling
  startInjectionCooldown(6000);

  let index = 0;

  function processNextBatch(deadline?: IdleDeadline) {
    const batchEnd = Math.min(index + BATCH_INJECT_SIZE, comments.length);

    while (index < batchEnd) {
      injectInlineComment(comments[index], isDarkMode);
      index++;
    }

    if (index < comments.length) {
      // More to process — schedule next batch
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(processNextBatch);
      } else {
        setTimeout(() => processNextBatch(), 0);
      }
    }
  }

  // Start the first batch
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(processNextBatch);
  } else {
    setTimeout(() => processNextBatch(), 0);
  }
}

/**
 * Start watching the review store for completed file reviews and inject
 * inline comments into the diff DOM as they arrive.
 *
 * Returns an unsubscribe function.
 */
export function startInlineCommentInjection(isDarkMode: boolean, signal?: AbortSignal): () => void {
  let lastFileReviewCount = 0;

  // Process any reviews already in the store (e.g., from cache hydration).
  // Uses requestIdleCallback to batch inject in groups — prevents 20+
  // shadow DOM mounts from locking the main thread on large MRs.
  const initialState = useReviewStore.getState();
  if (initialState.fileReviews.length > 0) {
    lastFileReviewCount = initialState.fileReviews.length;
    const allComments: ReviewComment[] = [];
    for (const fileReview of initialState.fileReviews) {
      for (const comment of fileReview.comments) {
        if (comment.startLine) allComments.push(comment);
      }
    }
    batchInject(allComments, isDarkMode);
  }

  // Single unified subscription — handles both new reviews AND status changes.
  // Previously these were two separate subscriptions, each iterating all files
  // × comments per store update. Merging halves the per-update cost.
  //
  // Uses reference equality on fileReviews to skip streaming delta updates
  // (summaryDelta, edgeCasesDelta, etc. don't change fileReviews reference).
  let prevFileReviews = initialState.fileReviews;

  const unsubscribe = useReviewStore.subscribe((state) => {
    // Only act when the fileReviews array reference changes
    if (state.fileReviews === prevFileReviews) return;
    dbg(`store subscription: fileReviews changed (${prevFileReviews.length} → ${state.fileReviews.length})`);
    prevFileReviews = state.fileReviews;

    // --- New reviews: inject inline comments for newly arrived file reviews ---
    if (state.fileReviews.length > lastFileReviewCount) {
      const newReviews = state.fileReviews.slice(lastFileReviewCount);
      lastFileReviewCount = state.fileReviews.length;

      for (const fileReview of newReviews) {
        for (const comment of fileReview.comments) {
          if (comment.startLine) {
            injectInlineComment(comment, isDarkMode);
          }
        }
      }
    } else {
      lastFileReviewCount = state.fileReviews.length;
    }

    // --- Status changes: re-render only comments whose status actually changed ---
    for (const fileReview of state.fileReviews) {
      for (const comment of fileReview.comments) {
        const mounted = mountedComments.get(comment.id);
        if (!mounted) continue;

        // Only re-render if the status actually changed
        if (mounted.lastStatus === comment.status) continue;
        mounted.lastStatus = comment.status;

        mounted.root.render(
          createElement(ThemeProvider, {
            isDark: isDarkMode,
            children: createElement(OttoErrorBoundary, { name: 'InlineComment' },
              createElement(InlineCommentThread, {
                comment,
                onUpdateStatus: handleUpdateStatus,
              }),
            ),
          }),
        );
      }
    }
  });

  // Watch for new diff file elements appearing in the DOM.
  // Debounced to prevent cascading mutation storms when GitLab renders
  // many diff files at once (e.g., scrolling through a 19-file MR).
  // Extracts file paths from mutations to scope retries — avoids iterating
  // all 60 pending comments on every mutation batch.
  // Track scroll state — don't schedule retries during scroll
  let scrolling = false;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  function onScroll() {
    scrolling = true;
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrolling = false;

      // Clear failedComments for visible files — the line rows may exist
      // now (diff expanded, virtual scroll re-rendered lines).
      const files = document.querySelectorAll('.diff-file.file-holder');
      for (const el of files) {
        const rect = el.getBoundingClientRect();
        const margin = window.innerHeight;
        if (rect.bottom <= -margin || rect.top >= window.innerHeight + margin) continue;

        const filePath = el.getAttribute('data-path');
        if (filePath) {
          clearFailedForFile(filePath);
        }
      }

      // Retry pending comments
      if (pendingComments.size > 0) {
        dbg(`scroll stopped → ${pendingComments.size} pending comments, starting batched retry`);
        pruneDetachedComments();
        batchRetryPending(isDarkMode);
      }
    }, 500);
  }
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });

  // Batched retry — process one pending comment at a time with gaps,
  // same pattern as dom-observer's processBatch. Prevents 17+ shadow DOM
  // mounts from firing simultaneously when scrolling stops.
  let retryBatchTimer: ReturnType<typeof setTimeout> | null = null;

  function batchRetryPending(isDark: boolean) {
    if (scrolling) return;
    if (getHealthLevel() !== 'normal') return;

    // Find all pending comments whose file element is visible in/near viewport
    // and inject them all at once per file. The expensive part is the file-level
    // shadow DOM + React root (handled by dom-observer), not the inline comments
    // which just insert a div after a line row.
    const visibleByFile = new Map<string, Array<[string, ReviewComment]>>();

    for (const [id, comment] of pendingComments) {
      const fileElement = findDiffFileElement(comment.filePath);
      if (!fileElement) continue;

      const rect = fileElement.getBoundingClientRect();
      const margin = window.innerHeight;
      if (rect.bottom > -margin && rect.top < window.innerHeight + margin) {
        if (!visibleByFile.has(comment.filePath)) {
          visibleByFile.set(comment.filePath, []);
        }
        visibleByFile.get(comment.filePath)!.push([id, comment]);
      }
    }

    if (visibleByFile.size === 0) {
      if (pendingComments.size > 0) {
        dbg(`batchRetry: ${pendingComments.size} pending but none visible, waiting`);
      }
      return;
    }

    // Process one file's worth of comments, then schedule next file
    const [filePath, comments] = visibleByFile.entries().next().value!;
    dbg(`batchRetry: injecting ${comments.length} comments for ${filePath}`);
    for (const [id, comment] of comments) {
      pendingComments.delete(id);
      injectInlineComment(comment, isDark);
    }

    // More visible files? Schedule with a gap between files
    if (visibleByFile.size > 1 || pendingComments.size > 0) {
      retryBatchTimer = setTimeout(() => {
        retryBatchTimer = null;
        batchRetryPending(isDark);
      }, 200);
    }
  }

  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFilePaths = new Set<string>();

  const domObserver = new MutationObserver((mutations) => {
    if (isOttoMutating()) return;
    if (scrolling) return; // Don't do any work during scroll

    const health = getHealthLevel();
    if (health === 'critical' || health === 'degraded') return;

    // Collect file paths from newly added diff-file elements
    // and clear failedComments for those files so they get another chance
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.diff-file.file-holder')) {
          const path = node.getAttribute('data-path');
          if (path) {
            pendingFilePaths.add(path);
            clearFailedForFile(path);
          }
        }
        for (const nested of node.querySelectorAll('.diff-file.file-holder')) {
          const path = nested.getAttribute('data-path');
          if (path) {
            pendingFilePaths.add(path);
            clearFailedForFile(path);
          }
        }
      }
    }

    if (pendingFilePaths.size === 0) return;
    if (retryTimer) return; // Already scheduled

    dbg(`MutationObserver: ${pendingFilePaths.size} new diff-files, scheduling retry`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      pruneDetachedComments();
      pendingFilePaths.clear();
      // Use batched retry instead of retrying all at once
      batchRetryPending(isDarkMode);
    }, 150);
  });

  const container = document.querySelector('.diff-files-holder') || document.body;
  domObserver.observe(container, { childList: true, subtree: true });

  // Rescan when tab becomes visible — GitLab may re-render diffs
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      setTimeout(() => {
        pruneDetachedComments();
        retryPendingComments(isDarkMode);
      }, 500);
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);

  function cleanup() {
    unsubscribe();
    domObserver.disconnect();
    document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
    if (scrollTimer) clearTimeout(scrollTimer);
    if (retryBatchTimer) clearTimeout(retryBatchTimer);
    document.removeEventListener('visibilitychange', handleVisibility);
    if (retryTimer) clearTimeout(retryTimer);
    // Unmount all inline comments
    for (const [id, { root, container }] of mountedComments) {
      root.unmount();
      container.remove();
      mountedComments.delete(id);
    }
    pendingComments.clear();
  }

  if (signal) {
    signal.addEventListener('abort', cleanup, { once: true });
  }

  return cleanup;
}

function handleUpdateStatus(commentId: string, status: ReviewCommentStatus) {
  useReviewStore.getState().updateCommentStatus(commentId, status);
}

/**
 * Prune mounted comments whose DOM containers were destroyed by GitLab's
 * virtual scrolling. Re-queues them as pending so they get re-injected
 * when the diff row reappears.
 */
function pruneDetachedComments(): void {
  for (const [id, { root, container }] of mountedComments) {
    if (!container.isConnected) {
      root.unmount();
      mountedComments.delete(id);
      // Re-queue from the store so it gets re-injected
      const state = useReviewStore.getState();
      for (const fr of state.fileReviews) {
        const comment = fr.comments.find((c) => c.id === id);
        if (comment && comment.startLine) {
          pendingComments.set(id, comment); // Reset — fresh element from virtual scroll
          break;
        }
      }
    }
  }
}

/**
 * Clear failed comments for a specific file path — gives them another
 * chance when the file element is recreated by virtual scrolling.
 */
function clearFailedForFile(filePath: string): void {
  const state = useReviewStore.getState();
  for (const fr of state.fileReviews) {
    if (fr.filePath !== filePath) continue;
    for (const comment of fr.comments) {
      if (comment.startLine && failedComments.has(comment.id)) {
        failedComments.delete(comment.id);
        pendingComments.set(comment.id, comment);
      }
    }
  }
}

/**
 * Retry injecting comments that previously failed because the DOM wasn't ready.
 * When filePath is provided, only retries comments for that specific file —
 * this avoids O(pending × queries) on every diff-file mutation.
 */
function retryPendingComments(isDarkMode: boolean, filePath?: string): void {
  for (const [id, comment] of pendingComments) {
    // If scoped to a file, skip comments for other files
    if (filePath && comment.filePath !== filePath) continue;

    const fileElement = findDiffFileElement(comment.filePath);
    if (fileElement) {
      pendingComments.delete(id);
      injectInlineComment(comment, isDarkMode);
    }
  }
}

/**
 * Inject a single inline comment after the referenced line in the diff.
 */
function injectInlineComment(comment: ReviewComment, isDarkMode: boolean): void {
  if (!comment.startLine) return;
  if (mountedComments.has(comment.id)) return;
  if (failedComments.has(comment.id)) return;

  // Find the diff file element
  const fileElement = findDiffFileElement(comment.filePath);
  if (!fileElement) {
    // DOM not ready yet — queue for retry when the element appears
    pendingComments.set(comment.id, comment);
    return;
  }

  // Find the line row
  const lineRow = findLineRow(fileElement, comment.startLine);
  if (!lineRow) {
    // Line row not found — mark as failed so we don't retry in a loop.
    // The line may be in a collapsed diff or not rendered by virtual scrolling.
    // MutationObserver will clear failedComments for this file when new
    // diff-file elements appear, giving it another chance.
    failedComments.add(comment.id);
    return;
  }

  // Remove from pending if it was queued
  pendingComments.delete(comment.id);

  // Wrap in guardedMutation to prevent triggering other MutationObservers
  guardedMutation(() => {
    // Create the container — a full-width row inserted after the line
    const container = document.createElement('div');
    container.setAttribute(INJECTED_ATTR, comment.id);
    container.style.cssText = 'width: 100%; grid-column: 1 / -1;';

    // Insert after the line row
    lineRow.insertAdjacentElement('afterend', container);

    // Shadow DOM for isolation
    const shadow = container.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = getInlineCommentStyles();
    shadow.appendChild(styleEl);

    const mountPoint = document.createElement('div');
    shadow.appendChild(mountPoint);

    const root = createRoot(mountPoint);
    root.render(
      createElement(ThemeProvider, {
        isDark: isDarkMode,
        children: createElement(OttoErrorBoundary, { name: 'InlineComment' },
          createElement(InlineCommentThread, {
            comment,
            onUpdateStatus: handleUpdateStatus,
          }),
        ),
      }),
    );

    mountedComments.set(comment.id, { root, container, lastStatus: comment.status });
  });
}

/**
 * Find the .diff-file element for a given file path.
 */
function findDiffFileElement(filePath: string): Element | null {
  return document.querySelector(`.diff-file[data-path="${CSS.escape(filePath)}"]`);
}

/**
 * Find the diff row for a specific line number (new file side).
 *
 * GitLab uses different DOM structures across versions:
 * - CSS grid: `.diff-grid-row` with `.diff-td.diff-line-num`
 * - Table: `<tr>` with `<td>` line number cells
 * - data-linenumber attribute (modern GitLab)
 * - Line number links with text content (older GitLab)
 * - ID-based line references
 */
function findLineRow(fileElement: Element, lineNumber: number): Element | null {
  // Strategy 1: data-linenumber attribute (most reliable in modern GitLab)
  const lineNumCells = fileElement.querySelectorAll(
    `[data-linenumber="${lineNumber}"]`,
  );

  for (const cell of lineNumCells) {
    const row = cell.closest('.diff-grid-row, .diff-tr, .line_holder, tr');
    if (row) {
      // In parallel view, prefer the new-file side
      const isOldSideOnly = cell.closest('.diff-grid-left, .left-side') !== null
        && cell.closest('.diff-grid-right, .right-side') === null;
      if (!isOldSideOnly) return row;
    }
  }
  // If we only found old-side matches, still use the first one
  if (lineNumCells.length > 0) {
    const row = lineNumCells[0].closest('.diff-grid-row, .diff-tr, .line_holder, tr');
    if (row) return row;
  }

  // Strategy 2: Line number links — <a> tags with line number as text
  const allLinks = fileElement.querySelectorAll('.diff-line-num a, td.diff-line-num a, .line-numbers a');
  for (const link of allLinks) {
    if (link.textContent?.trim() === String(lineNumber)) {
      const row = link.closest('.diff-grid-row, .diff-tr, .line_holder, tr');
      if (row) return row;
    }
  }

  // Strategy 3: Line number cells by text content (no <a> wrapper)
  const allLineNumCells = fileElement.querySelectorAll('.diff-line-num, td.line_content');
  for (const cell of allLineNumCells) {
    // Check direct text content of the cell
    const text = cell.textContent?.trim();
    if (text === String(lineNumber)) {
      const row = cell.closest('.diff-grid-row, .diff-tr, .line_holder, tr');
      if (row) return row;
    }
  }

  // Strategy 4: ID-based — GitLab generates IDs like "<file_hash>_<old>_<new>"
  const fileHash = fileElement.id;
  if (fileHash) {
    // Try multiple ID patterns
    const patterns = [
      `${fileHash}_${lineNumber}_${lineNumber}`,
      `${fileHash}_${lineNumber}`,
      `LC_${lineNumber}`,
    ];
    for (const pattern of patterns) {
      const el = fileElement.querySelector(`[id="${CSS.escape(pattern)}"]`);
      if (el) {
        const row = el.closest('.diff-grid-row, .diff-tr, .line_holder, tr');
        if (row) return row;
      }
    }
  }

  return null;
}

function getInlineCommentStyles(): string {
  return `
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    button { font-family: inherit; }
  `;
}
