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
// ---------------------------------------------------------------------------

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemeProvider } from '@/components/ThemeContext';
import { InlineCommentThread } from '@/components/review/InlineCommentThread';
import { useReviewStore } from '@/services/review/review-store';
import type { ReviewComment, ReviewCommentStatus } from '@/types/review';

const INJECTED_ATTR = 'data-otto-inline-comment';

/** Track mounted inline comments for cleanup */
const mountedComments = new Map<string, { root: Root; container: HTMLElement }>();

/**
 * Start watching the review store for completed file reviews and inject
 * inline comments into the diff DOM as they arrive.
 *
 * Returns an unsubscribe function.
 */
export function startInlineCommentInjection(isDarkMode: boolean, signal?: AbortSignal): () => void {
  let lastFileReviewCount = 0;

  const unsubscribe = useReviewStore.subscribe((state) => {
    // Only act when new file reviews arrive
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

  // Also subscribe to comment status changes to update opacity / remove dismissed
  const statusUnsubscribe = useReviewStore.subscribe((state) => {
    for (const fileReview of state.fileReviews) {
      for (const comment of fileReview.comments) {
        const mounted = mountedComments.get(comment.id);
        if (mounted) {
          // Re-render with updated status
          mounted.root.render(
            createElement(ThemeProvider, {
              isDark: isDarkMode,
              children: createElement(InlineCommentThread, {
                comment,
                onUpdateStatus: handleUpdateStatus,
              }),
            }),
          );
        }
      }
    }
  });

  function cleanup() {
    unsubscribe();
    statusUnsubscribe();
    // Unmount all inline comments
    for (const [id, { root, container }] of mountedComments) {
      root.unmount();
      container.remove();
      mountedComments.delete(id);
    }
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
 * Inject a single inline comment after the referenced line in the diff.
 */
function injectInlineComment(comment: ReviewComment, isDarkMode: boolean): void {
  if (!comment.startLine) return;
  if (mountedComments.has(comment.id)) return;

  // Find the diff file element
  const fileElement = findDiffFileElement(comment.filePath);
  if (!fileElement) return;

  // Find the line row
  const lineRow = findLineRow(fileElement, comment.startLine);
  if (!lineRow) return;

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
      children: createElement(InlineCommentThread, {
        comment,
        onUpdateStatus: handleUpdateStatus,
      }),
    }),
  );

  mountedComments.set(comment.id, { root, container });
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
 * GitLab uses two diff view modes:
 * - Inline (unified): `.diff-grid-row` with line number cells
 * - Parallel: two sides, we target the right (new) side
 *
 * Line number cells have a `data-linenumber` attribute.
 */
function findLineRow(fileElement: Element, lineNumber: number): Element | null {
  // Strategy 1: Find by data-linenumber on the new-file side
  // In inline view, new line numbers are in cells with id pattern like "LC_<n>"
  // or have data-linenumber attribute
  const lineNumCells = fileElement.querySelectorAll(
    `.diff-td.diff-line-num[data-linenumber="${lineNumber}"]`,
  );

  for (const cell of lineNumCells) {
    // In inline view, we want the "new" line number (not the "old" one)
    // The new-side cell is typically the second line-num cell in the row,
    // or has a specific class. Check if it's on the new side.
    const row = cell.closest('.diff-grid-row, .diff-tr, .line_holder');
    if (row) {
      // Verify this is a new-file line number (not old-file)
      // In inline view: new line nums are in the second .diff-line-num cell
      // In parallel view: new line nums are in .diff-grid-right
      const isNewSide = cell.closest('.diff-grid-right, .right-side') !== null;
      const isInlineNew = !cell.closest('.diff-grid-right, .diff-grid-left');

      if (isNewSide || isInlineNew) {
        return row;
      }
    }
  }

  // Strategy 2: Fallback — search by line number link text
  // GitLab sometimes uses <a> tags with the line number as text
  const links = fileElement.querySelectorAll('.diff-td.diff-line-num a');
  for (const link of links) {
    if (link.textContent?.trim() === String(lineNumber)) {
      const row = link.closest('.diff-grid-row, .diff-tr, .line_holder');
      if (row) return row;
    }
  }

  // Strategy 3: Last resort — find by id pattern
  // GitLab generates line IDs like "<file_hash>_<old>_<new>"
  const fileHash = fileElement.id;
  if (fileHash) {
    // Try common ID patterns
    const row = fileElement.querySelector(`#${CSS.escape(fileHash)}_${lineNumber}_${lineNumber}`)
      ?.closest('.diff-grid-row, .diff-tr, .line_holder');
    if (row) return row;
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
