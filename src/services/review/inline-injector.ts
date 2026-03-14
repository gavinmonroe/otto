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
// ---------------------------------------------------------------------------

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemeProvider } from '@/components/ThemeContext';
import { OttoErrorBoundary } from '@/components/OttoErrorBoundary';
import { InlineCommentThread } from '@/components/review/InlineCommentThread';
import { useReviewStore } from '@/services/review/review-store';
import type { ReviewComment, ReviewCommentStatus } from '@/types/review';
import { getHealthLevel } from '@/services/review/health-monitor';

const INJECTED_ATTR = 'data-otto-inline-comment';

/** Track mounted inline comments for cleanup */
const mountedComments = new Map<string, { root: Root; container: HTMLElement; lastStatus: ReviewCommentStatus }>();

/** Track comments that failed to inject because the DOM wasn't ready */
const pendingComments = new Map<string, ReviewComment>();

/**
 * Start watching the review store for completed file reviews and inject
 * inline comments into the diff DOM as they arrive.
 *
 * Returns an unsubscribe function.
 */
export function startInlineCommentInjection(isDarkMode: boolean, signal?: AbortSignal): () => void {
  let lastFileReviewCount = 0;

  // Process any reviews already in the store (e.g., from cache hydration)
  const initialState = useReviewStore.getState();
  if (initialState.fileReviews.length > 0) {
    lastFileReviewCount = initialState.fileReviews.length;
    for (const fileReview of initialState.fileReviews) {
      for (const comment of fileReview.comments) {
        if (comment.startLine) {
          injectInlineComment(comment, isDarkMode);
        }
      }
    }
  }

  // Track previous fileReviews reference to skip unrelated store updates.
  // Without this, every streaming delta (summaryDelta, edgeCasesDelta, etc.)
  // would trigger these callbacks ~60 times/sec and crash the tab on large MRs.
  let prevFileReviews = initialState.fileReviews;

  const unsubscribe = useReviewStore.subscribe((state) => {
    // Only act when the fileReviews array reference changes
    if (state.fileReviews === prevFileReviews) return;
    prevFileReviews = state.fileReviews;

    if (state.fileReviews.length === lastFileReviewCount) return;

    const newReviews = state.fileReviews.slice(lastFileReviewCount);
    lastFileReviewCount = state.fileReviews.length;

    for (const fileReview of newReviews) {
      for (const comment of fileReview.comments) {
        if (comment.startLine) {
          injectInlineComment(comment, isDarkMode);
        }
      }
    }
  });

  // Subscribe to comment status changes ONLY — skip re-renders unless
  // a comment's status actually changed. This prevents the O(n*m) re-render
  // storm that was crashing tabs on large MRs.
  //
  // Uses reference equality on fileReviews to skip streaming delta updates.
  let prevFileReviewsForStatus = initialState.fileReviews;

  const statusUnsubscribe = useReviewStore.subscribe((state) => {
    if (state.fileReviews === prevFileReviewsForStatus) return;
    prevFileReviewsForStatus = state.fileReviews;

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
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const domObserver = new MutationObserver(() => {
    if (retryTimer) return; // Already scheduled
    if (getHealthLevel() === 'critical') return; // Skip DOM work under heavy load
    retryTimer = setTimeout(() => {
      retryTimer = null;
      pruneDetachedComments();
      retryPendingComments(isDarkMode);
    }, 150);
  });

  const container = document.querySelector('.diff-files-holder') || document.body;
  domObserver.observe(container, { childList: true, subtree: true });

  // Periodic rescan — catches virtual scrolling edge cases where GitLab
  // destroys and recreates diff rows without triggering useful mutations.
  // Skipped in critical health to reduce main thread pressure.
  const rescanInterval = setInterval(() => {
    if (getHealthLevel() === 'critical') return;
    pruneDetachedComments();
    retryPendingComments(isDarkMode);
  }, 3000);

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
    statusUnsubscribe();
    domObserver.disconnect();
    clearInterval(rescanInterval);
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
          pendingComments.set(id, comment);
          break;
        }
      }
    }
  }
}

/**
 * Retry injecting comments that previously failed because the DOM wasn't ready.
 */
function retryPendingComments(isDarkMode: boolean): void {
  for (const [id, comment] of pendingComments) {
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
    // Line row not found — queue for retry (virtual scrolling may load it later)
    pendingComments.set(comment.id, comment);
    return;
  }

  // Remove from pending if it was queued
  pendingComments.delete(comment.id);

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
