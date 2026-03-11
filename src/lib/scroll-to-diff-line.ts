// ---------------------------------------------------------------------------
// Scroll to Diff Line — navigates to a specific file + line in GitLab's
// diff view on the current page.
//
// Reuses the same line-finding strategies as inline-injector.ts (4 strategies
// for different GitLab DOM versions), but instead of injecting a component,
// it scrolls the element into view and applies a brief highlight animation.
//
// Design decisions:
// - Extracted as a standalone utility (not coupled to inline-injector) so
//   it can be used by the chat UI, edge case links, or any future feature.
// - The highlight is done via inline styles + requestAnimationFrame to avoid
//   needing CSS classes inside shadow DOM.
// - Falls back gracefully: if the file is collapsed or the line is outside
//   the virtual scroll viewport, we try to expand the file first.
// - Returns a boolean so callers can show a fallback (e.g., open in new tab)
//   if scrolling fails.
// ---------------------------------------------------------------------------

const HIGHLIGHT_DURATION_MS = 1500;

/**
 * Scroll to a specific line in a file's diff on the current page.
 * Returns true if the line was found and scrolled to, false otherwise.
 *
 * @param filePath - The file path as it appears in the diff (new_path)
 * @param line - The line number to scroll to (new file side)
 */
export function scrollToDiffLine(filePath: string, line?: number): boolean {
  const fileElement = findDiffFileElement(filePath);
  if (!fileElement) return false;

  // If no specific line, just scroll to the file header
  if (!line) {
    fileElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    highlightElement(fileElement as HTMLElement);
    return true;
  }

  // Try to expand the file if it's collapsed
  expandFileIfCollapsed(fileElement);

  const lineRow = findLineRow(fileElement, line);
  if (!lineRow) {
    // Line not found — at least scroll to the file
    fileElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    highlightElement(fileElement as HTMLElement);
    return false;
  }

  lineRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightElement(lineRow as HTMLElement);
  return true;
}

/**
 * Build a GitLab blob URL for opening a file in a new tab.
 * Used as a fallback when scrolling to the diff line fails, or as
 * a secondary action (external link icon).
 */
export function buildGitLabBlobUrl(
  hostUrl: string,
  projectPath: string,
  sourceBranch: string,
  filePath: string,
  line?: number,
  lineEnd?: number,
): string {
  const base = `${hostUrl}/${projectPath}/-/blob/${encodeURIComponent(sourceBranch)}/${filePath}`;
  if (line && lineEnd && lineEnd !== line) {
    return `${base}#L${line}-${lineEnd}`;
  }
  if (line) {
    return `${base}#L${line}`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// DOM helpers — same strategies as inline-injector.ts
// ---------------------------------------------------------------------------

function findDiffFileElement(filePath: string): Element | null {
  return document.querySelector(`.diff-file[data-path="${CSS.escape(filePath)}"]`);
}

/**
 * Try to expand a collapsed diff file.
 * GitLab collapses large files and files the user has manually collapsed.
 */
function expandFileIfCollapsed(fileElement: Element): void {
  // GitLab uses a "click to expand" button or a collapsed class
  if (fileElement.classList.contains('is-collapsed')) {
    const expandBtn = fileElement.querySelector<HTMLElement>(
      '.js-file-title, .click-to-expand, [data-click-to-expand]',
    );
    if (expandBtn) {
      expandBtn.click();
    }
  }
}

/**
 * Find the diff row for a specific line number (new file side).
 * Mirrors the logic in inline-injector.ts — 4 strategies for different
 * GitLab DOM versions.
 */
function findLineRow(fileElement: Element, lineNumber: number): Element | null {
  // Strategy 1: data-linenumber attribute (modern GitLab)
  const lineNumCells = fileElement.querySelectorAll(
    `[data-linenumber="${lineNumber}"]`,
  );

  for (const cell of lineNumCells) {
    const row = cell.closest('.diff-grid-row, .diff-tr, .line_holder, tr');
    if (row) {
      const isOldSideOnly = cell.closest('.diff-grid-left, .left-side') !== null
        && cell.closest('.diff-grid-right, .right-side') === null;
      if (!isOldSideOnly) return row;
    }
  }
  if (lineNumCells.length > 0) {
    const row = lineNumCells[0].closest('.diff-grid-row, .diff-tr, .line_holder, tr');
    if (row) return row;
  }

  // Strategy 2: Line number links
  const allLinks = fileElement.querySelectorAll('.diff-line-num a, td.diff-line-num a, .line-numbers a');
  for (const link of allLinks) {
    if (link.textContent?.trim() === String(lineNumber)) {
      const row = link.closest('.diff-grid-row, .diff-tr, .line_holder, tr');
      if (row) return row;
    }
  }

  // Strategy 3: Line number cells by text content
  const allLineNumCells = fileElement.querySelectorAll('.diff-line-num, td.line_content');
  for (const cell of allLineNumCells) {
    if (cell.textContent?.trim() === String(lineNumber)) {
      const row = cell.closest('.diff-grid-row, .diff-tr, .line_holder, tr');
      if (row) return row;
    }
  }

  // Strategy 4: ID-based patterns
  const fileHash = fileElement.id;
  if (fileHash) {
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

/**
 * Apply a brief highlight animation to an element.
 * Uses a yellow flash that fades out — visible in both light and dark themes.
 */
function highlightElement(element: HTMLElement): void {
  const originalBg = element.style.backgroundColor;
  const originalTransition = element.style.transition;

  element.style.transition = 'background-color 0.3s ease-in-out';
  element.style.backgroundColor = 'rgba(255, 213, 79, 0.4)'; // warm yellow, semi-transparent

  setTimeout(() => {
    element.style.backgroundColor = 'rgba(255, 213, 79, 0)';

    setTimeout(() => {
      element.style.backgroundColor = originalBg;
      element.style.transition = originalTransition;
    }, 300);
  }, HIGHLIGHT_DURATION_MS);
}
