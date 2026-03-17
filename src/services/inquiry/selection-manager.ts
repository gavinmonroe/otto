// ---------------------------------------------------------------------------
// Inquiry Selection Manager — handles the click+drag line range selection
// interaction on GitLab diff pages for the line inquiry composer.
//
// Design decisions:
// - Injects a small Otto icon into line number gutter cells on hover.
//   Clicking/dragging from this icon triggers inquiry mode. This avoids
//   any conflict with GitLab's native "+" comment button.
// - Selection state is tracked by line number (not DOM reference) so it
//   survives virtual scrolling.
// - Highlight overlay is applied via inline styles on diff rows (not a
//   separate overlay element) for simplicity and z-index safety.
// - All DOM writes go through guardedMutation() to prevent observer loops.
// - The composer/carousel is injected after the last selected row using
//   the same shadow DOM pattern as inline-injector.ts.
// - Only one selection/composer can be active at a time.
// ---------------------------------------------------------------------------

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemeProvider } from '@/components/ThemeContext';
import { OttoErrorBoundary } from '@/components/OttoErrorBoundary';
import { InquiryComposer } from '@/components/inquiry/InquiryComposer';
import { InquiryCarousel } from '@/components/inquiry/InquiryCarousel';
import { useInquiryStore, buildInquiryId } from './inquiry-store';
import { useReviewStore } from '@/services/review/review-store';
import { isOttoMutating, guardedMutation } from '@/lib/dom-guard';
import { getInjectorColors, type InjectorColors } from '@/lib/palette';

const DEBUG = false;
function dbg(msg: string, ...args: any[]) {
  if (DEBUG) console.log(`[Otto:inquiry-selection] ${msg}`, ...args);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GUTTER_ICON_ATTR = 'data-otto-inquiry-trigger';
const HIGHLIGHT_ATTR = 'data-otto-inquiry-highlight';
const COMPOSER_ATTR = 'data-otto-inquiry-composer';
const HIGHLIGHT_COLOR_LIGHT = 'rgba(59, 130, 246, 0.08)';
const HIGHLIGHT_COLOR_DARK = 'rgba(96, 165, 250, 0.12)';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

type SelectionState = {
  filePath: string;
  fileElement: Element;
  anchorLine: number;       // the line where the drag started
  currentLine: number;      // the line where the pointer currently is
  isDragging: boolean;
};

let selection: SelectionState | null = null;
let composerMount: { root: Root; container: HTMLElement; inquiryId: string; filePath: string; endLine: number } | null = null;
let isDarkMode = false;
let brandHue = 207;
let colors: InjectorColors;
let hoveredGutterCell: Element | null = null;
let gutterIcon: HTMLElement | null = null;

// Store subscription for re-rendering the composer when inquiry state changes
let storeUnsubscribe: (() => void) | null = null;

// Detachment check interval — detects when virtual scrolling destroys the composer
let detachCheckInterval: ReturnType<typeof setInterval> | null = null;

// Tracks whether the current composer mount has slides — used by the store
// subscription to detect composer↔carousel transitions. Module-level so
// mountComposer can reset it when a new inquiry opens.
let lastHadSlides = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the inquiry selection manager. Attaches event listeners to the
 * diff container for gutter icon hover and click+drag selection.
 *
 * Returns a cleanup function.
 */
export function startInquirySelection(
  dark: boolean,
  hue: number,
  signal?: AbortSignal,
): () => void {
  isDarkMode = dark;
  brandHue = hue;
  colors = getInjectorColors(hue, dark);

  const container = document.querySelector('.diff-files-holder') || document.body;

  // --- Gutter icon: show on hover over line number cells ---
  container.addEventListener('pointerover', onPointerOver, { passive: true });
  container.addEventListener('pointerout', onPointerOut, { passive: true });

  // --- Selection: click+drag from gutter icon ---
  // We listen on document for move/up so the drag works even if the pointer
  // leaves the diff area.
  container.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerup', onPointerUp);

  // --- Escape to cancel ---
  document.addEventListener('keydown', onKeyDown);

  // --- Store subscription: handle composer↔carousel transition + teardown ---
  // IMPORTANT: Do NOT re-render on every state change. The React components
  // subscribe to the store themselves via useInquiryStore hooks and handle
  // their own updates. We only need to:
  // 1. Switch from composer to carousel when the first slide arrives
  // 2. Tear down when the inquiry is closed

  storeUnsubscribe = useInquiryStore.subscribe((state, prevState) => {
    if (!composerMount) return;

    // If the active inquiry was closed, tear down the composer
    if (state.activeInquiryId !== composerMount.inquiryId) {
      teardownComposer();
      return;
    }

    const inquiry = state.inquiries[composerMount.inquiryId];
    if (!inquiry) {
      teardownComposer();
      return;
    }

    // Only re-render when transitioning between composer and carousel
    // (slides went from 0 to >0). This is the one structural change
    // that requires swapping the root component.
    const hasSlides = inquiry.slides.length > 0;
    if (hasSlides !== lastHadSlides) {
      lastHadSlides = hasSlides;
      renderComposerOrCarousel(composerMount.inquiryId);
    }
  });

  // --- Detachment check: recover from virtual scrolling ---
  // GitLab's virtual scrolling can destroy diff rows, taking our composer
  // container with them. Poll every 2s to detect and re-mount.
  detachCheckInterval = setInterval(() => {
    if (!composerMount) return;
    if (composerMount.container.isConnected) return;

    // Container was detached — re-mount at the same location
    const { inquiryId, filePath, endLine } = composerMount;
    const fileElement = findDiffFileElement(filePath);
    if (!fileElement) return; // File not visible yet, will retry next tick

    // Unmount the old root (it's already detached, but clean up React)
    try { composerMount.root.unmount(); } catch {}
    composerMount = null;

    // Re-mount
    mountComposer(fileElement, endLine, inquiryId);
  }, 2000);

  function cleanup() {
    container.removeEventListener('pointerover', onPointerOver);
    container.removeEventListener('pointerout', onPointerOut);
    container.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('keydown', onKeyDown);
    storeUnsubscribe?.();
    storeUnsubscribe = null;
    if (detachCheckInterval) {
      clearInterval(detachCheckInterval);
      detachCheckInterval = null;
    }
    removeGutterIcon();
    clearHighlight();
    teardownComposer();
    selection = null;
  }

  if (signal) {
    signal.addEventListener('abort', cleanup, { once: true });
  }

  return cleanup;
}

/**
 * Open an inquiry at a specific location. Used by team inquiry gutter dots
 * and cache hydration to open an existing inquiry without a drag interaction.
 */
export function openInquiryAt(
  filePath: string,
  startLine: number,
  endLine: number,
  mrIid: number,
): void {
  const fileElement = findDiffFileElement(filePath);
  if (!fileElement) return;

  const reviewState = useReviewStore.getState();
  const diffFile = reviewState.mrContext?.diffFiles.find((f) => f.filePath === filePath);

  const { diffSnippet, codeContent } = extractRangeContent(fileElement, startLine, endLine);

  const inquiryId = useInquiryStore.getState().startComposing({
    filePath,
    startLine,
    endLine,
    diffSnippet: diffSnippet || diffFile?.diff?.slice(0, 500) || '',
    codeContent: codeContent || '',
    mrIid,
  });

  // Apply line highlight so the user sees which lines the inquiry covers
  applyHighlight(fileElement, startLine, endLine);

  mountComposer(fileElement, endLine, inquiryId);
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function onPointerOver(e: Event): void {
  const pe = e as PointerEvent;
  const target = pe.target as Element;

  // Only show gutter icon on line number cells
  const lineNumCell = target.closest('.diff-line-num, [data-linenumber], td.diff-line-num');
  if (!lineNumCell) return;

  // Don't show on the "+" button area (GitLab's native comment trigger)
  if (target.closest('.add-diff-note, .js-add-diff-note-button')) return;

  // Don't show if we're inside an Otto element
  if (target.closest(`[${COMPOSER_ATTR}], [${GUTTER_ICON_ATTR}]`)) return;

  // Don't show on cells that already have an inquiry dot (local or team)
  if (lineNumCell.querySelector('[data-otto-local-inquiry], [data-otto-team-inquiry]')) return;

  // Don't show during an active drag
  if (selection?.isDragging) return;

  // Extract line number
  const lineNum = getLineNumber(lineNumCell);
  if (!lineNum) return;

  if (hoveredGutterCell === lineNumCell) return;
  hoveredGutterCell = lineNumCell;

  showGutterIcon(lineNumCell);
}

function onPointerOut(e: Event): void {
  const pe = e as PointerEvent;
  const relatedTarget = pe.relatedTarget as Element | null;

  // Don't hide if moving to the gutter icon itself
  if (relatedTarget && gutterIcon?.contains(relatedTarget)) return;

  // Don't hide during drag
  if (selection?.isDragging) return;

  hoveredGutterCell = null;
  removeGutterIcon();
}

function onPointerDown(e: Event): void {
  const pe = e as PointerEvent;
  const target = pe.target as Element;

  // Only start selection from the gutter icon
  if (!target.closest(`[${GUTTER_ICON_ATTR}]`)) return;

  // Find the line number cell and file element
  const lineNumCell = hoveredGutterCell;
  if (!lineNumCell) return;

  const fileElement = lineNumCell.closest('.diff-file[data-path]');
  if (!fileElement) return;

  const lineNum = getLineNumber(lineNumCell);
  if (!lineNum) return;

  const filePath = fileElement.getAttribute('data-path');
  if (!filePath) return;

  pe.preventDefault();
  pe.stopPropagation();

  // Close any existing composer
  teardownComposer();
  clearHighlight();

  selection = {
    filePath,
    fileElement,
    anchorLine: lineNum,
    currentLine: lineNum,
    isDragging: true,
  };

  // Highlight the initial line
  applyHighlight(fileElement, lineNum, lineNum);

  dbg(`drag start: ${filePath}:${lineNum}`);
}

function onPointerMove(e: Event): void {
  if (!selection?.isDragging) return;

  const pe = e as PointerEvent;
  const elementUnderPointer = document.elementFromPoint(pe.clientX, pe.clientY);
  if (!elementUnderPointer) return;

  // Must be within the same file
  const fileElement = elementUnderPointer.closest('.diff-file[data-path]');
  if (!fileElement || fileElement !== selection.fileElement) return;

  // Find the line number under the pointer
  const lineNumCell = elementUnderPointer.closest('.diff-line-num, [data-linenumber], td.diff-line-num');
  if (!lineNumCell) {
    // Try to find the nearest line row
    const row = elementUnderPointer.closest('.diff-grid-row, .diff-tr, .line_holder, tr');
    if (row) {
      const cell = row.querySelector('[data-linenumber]') || row.querySelector('.diff-line-num');
      if (cell) {
        const lineNum = getLineNumber(cell);
        if (lineNum && lineNum !== selection.currentLine) {
          selection.currentLine = lineNum;
          const start = Math.min(selection.anchorLine, selection.currentLine);
          const end = Math.max(selection.anchorLine, selection.currentLine);
          applyHighlight(selection.fileElement, start, end);
        }
      }
    }
    return;
  }

  const lineNum = getLineNumber(lineNumCell);
  if (!lineNum || lineNum === selection.currentLine) return;

  selection.currentLine = lineNum;
  const start = Math.min(selection.anchorLine, selection.currentLine);
  const end = Math.max(selection.anchorLine, selection.currentLine);
  applyHighlight(selection.fileElement, start, end);
}

function onPointerUp(e: Event): void {
  if (!selection?.isDragging) return;

  selection.isDragging = false;

  const startLine = Math.min(selection.anchorLine, selection.currentLine);
  const endLine = Math.max(selection.anchorLine, selection.currentLine);
  const filePath = selection.filePath;
  const fileElement = selection.fileElement;

  dbg(`drag end: ${filePath}:${startLine}-${endLine}`);

  // Extract content from the selected range
  const { diffSnippet, codeContent } = extractRangeContent(fileElement, startLine, endLine);

  // Get MR IID for the inquiry ID
  const mrContext = useReviewStore.getState().mrContext;
  if (!mrContext) {
    clearHighlight();
    selection = null;
    return;
  }

  // Create or reopen the inquiry in the store
  const inquiryId = useInquiryStore.getState().startComposing({
    filePath,
    startLine,
    endLine,
    diffSnippet: diffSnippet || '',
    codeContent: codeContent || '',
    mrIid: mrContext.mrIid,
  });

  // Mount the composer/carousel after the last selected row
  mountComposer(fileElement, endLine, inquiryId);

  // Keep the highlight visible while the composer is open
  removeGutterIcon();
}

function onKeyDown(e: Event): void {
  const ke = e as KeyboardEvent;
  if (ke.key !== 'Escape') return;

  if (selection?.isDragging) {
    selection.isDragging = false;
    selection = null;
    clearHighlight();
    removeGutterIcon();
    return;
  }

  // Close the active inquiry
  const activeId = useInquiryStore.getState().activeInquiryId;
  if (activeId) {
    useInquiryStore.getState().closeInquiry();
    teardownComposer();
    clearHighlight();
  }
}

// ---------------------------------------------------------------------------
// Gutter icon
// ---------------------------------------------------------------------------

function showGutterIcon(cell: Element): void {
  removeGutterIcon();

  const icon = document.createElement('div');
  icon.setAttribute(GUTTER_ICON_ATTR, '');
  icon.style.cssText = `
    position: absolute;
    top: 50%;
    left: -4px;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    border-radius: 4px;
    background: ${colors.brand};
    border: none;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    opacity: 0.85;
    transition: opacity 0.15s, transform 0.15s;
  `;

  // Official Otto logo SVG — all 4 paths from OttoLogo.tsx, white fill on brand bg.
  // Paths 1-2: outer shape (brand in normal logo), paths 3-4: lightning bolt (currentColor in normal logo).
  icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 200 200" fill="#fff" xmlns="http://www.w3.org/2000/svg">
    <path d="m114.4 8.5h-3.61c-33.58 0-60.65 17.18-70.29 46.1-0.67 2.14 0.48 3.01 2.15 3.01h9.58c2.04 0 3.4-1.12 4.28-3.01 9.8-20.64 27.68-30.64 54.28-30.64h3.44c34.71 0 59.65 26.15 59.65 59.01 0 18.7-8.75 32.29-18.67 44.21-9.23 11.1-18.46 20.13-18.46 34.65v26.84c0 1.53 1.04 2.42 2.46 2.42h10.86c1.26 0 1.93-1.21 1.93-2.34v-28.05c0-8.79 7.84-15.71 15.85-25.28 11.09-13.11 21.64-27.95 21.64-52.29 0-39.99-30.64-74.63-75.09-74.63z"/>
    <path d="m92.74 158.2h-30.02c-6.07 0-9.35-5.3-9.35-9.54v-12.78c0-1.33-1.08-2.04-2.21-2.04h-10.78c-1.34 0-2.17 1.12-2.17 2.16v12.75c0 12.13 10 24.66 24.1 24.66h15c1.34 0 2.01 0.88 2.01 2.01v13.06c0 1.24 0.96 2.22 2.09 2.22h11.17c1.13 0 1.88-1.05 1.88-2.1v-28.33c0-1.13-0.88-2.07-1.72-2.07z"/>
    <path d="m119.9 57.61h-37.29c-1.51 0-2.31 1.23-2.31 2.45v11.18c0 1.48 1.05 2.37 2.31 2.37h14.53c1.42 0 1.67 1.23 1 2.45l-14.14 25.73c-0.88 1.69-0.21 3.03 1.46 3.03h12.68c1.17 0 1.83-1.05 2.59-2.46l21.86-38.23c1.67-3.11 0.17-5.82-2.69-6.52z"/>
    <path d="m51.41 104.8h-14.53c-1.42 0-2.17-1.21-1.25-3.03l14.14-24.71c1.14-2.04 0.47-3.47-1.36-3.47h-12.99c-1.59 0-2.55 0.7-3.21 2.12l-22.54 39.65c-1.04 2.34 0.61 4.89 3.05 4.89h38.69c1.42 0 1.96-1.22 1.96-2.35v-11.18c0-1.23-0.96-1.92-1.96-1.92z"/>
  </svg>`;

  icon.addEventListener('pointerenter', () => {
    icon.style.opacity = '1';
    icon.style.transform = 'translateY(-50%) scale(1.1)';
  });
  icon.addEventListener('pointerleave', () => {
    icon.style.opacity = '0.85';
    icon.style.transform = 'translateY(-50%)';
  });

  // Position relative to the cell
  const cellStyle = getComputedStyle(cell);
  if (cellStyle.position === 'static') {
    (cell as HTMLElement).style.position = 'relative';
  }

  guardedMutation(() => {
    cell.appendChild(icon);
  });

  gutterIcon = icon;
}

function removeGutterIcon(): void {
  if (gutterIcon) {
    guardedMutation(() => {
      gutterIcon?.remove();
    });
    gutterIcon = null;
  }
}

// ---------------------------------------------------------------------------
// Line highlight
// ---------------------------------------------------------------------------

function applyHighlight(fileElement: Element, startLine: number, endLine: number): void {
  clearHighlight();

  const highlightColor = isDarkMode ? HIGHLIGHT_COLOR_DARK : HIGHLIGHT_COLOR_LIGHT;

  guardedMutation(() => {
    for (let line = startLine; line <= endLine; line++) {
      const row = findLineRow(fileElement, line);
      if (row) {
        (row as HTMLElement).setAttribute(HIGHLIGHT_ATTR, '');
        (row as HTMLElement).style.backgroundColor = highlightColor;
      }
    }
  });
}

function clearHighlight(): void {
  guardedMutation(() => {
    const highlighted = document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`);
    for (const el of highlighted) {
      (el as HTMLElement).removeAttribute(HIGHLIGHT_ATTR);
      (el as HTMLElement).style.backgroundColor = '';
    }
  });
}

// ---------------------------------------------------------------------------
// Composer / Carousel mounting
// ---------------------------------------------------------------------------

function mountComposer(fileElement: Element, endLine: number, inquiryId: string): void {
  teardownComposer();

  const lineRow = findLineRow(fileElement, endLine);
  if (!lineRow) return;

  // Resolve filePath for detachment recovery
  const filePath = fileElement.getAttribute('data-path') || '';

  // Sync lastHadSlides to the actual inquiry state so the store subscription
  // correctly detects the composer→carousel transition. Without this, reopening
  // a fresh composer after closing a carousel would leave lastHadSlides=true,
  // causing the first slide arrival to be missed (hasSlides===lastHadSlides).
  const inquiry = useInquiryStore.getState().inquiries[inquiryId];
  lastHadSlides = inquiry ? inquiry.slides.length > 0 : false;

  guardedMutation(() => {
    const container = document.createElement('div');
    container.setAttribute(COMPOSER_ATTR, inquiryId);
    container.style.cssText = 'width: 100%; grid-column: 1 / -1;';

    lineRow.insertAdjacentElement('afterend', container);

    const shadow = container.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = getComposerStyles();
    shadow.appendChild(styleEl);

    const mountPoint = document.createElement('div');
    shadow.appendChild(mountPoint);

    const root = createRoot(mountPoint);
    composerMount = { root, container, inquiryId, filePath, endLine };

    renderComposerOrCarousel(inquiryId);
  });
}

function renderComposerOrCarousel(inquiryId: string): void {
  if (!composerMount || composerMount.inquiryId !== inquiryId) return;

  const inquiry = useInquiryStore.getState().inquiries[inquiryId];
  if (!inquiry) return;

  // If the inquiry has slides, show the carousel. Otherwise show the composer.
  const hasSlides = inquiry.slides.length > 0;

  const component = hasSlides
    ? createElement(InquiryCarousel, { inquiryId })
    : createElement(InquiryComposer, { inquiryId });

  composerMount.root.render(
    createElement(ThemeProvider, {
      isDark: isDarkMode,
      hue: brandHue,
      children: createElement(OttoErrorBoundary, { name: 'InquiryComposer' }, component),
    }),
  );
}

function teardownComposer(): void {
  if (!composerMount) return;

  composerMount.root.unmount();
  guardedMutation(() => {
    composerMount?.container.remove();
  });
  composerMount = null;
  clearHighlight();
}

// ---------------------------------------------------------------------------
// DOM helpers — reuse the same multi-strategy approach as inline-injector.ts
// ---------------------------------------------------------------------------

function findDiffFileElement(filePath: string): Element | null {
  return document.querySelector(`.diff-file[data-path="${CSS.escape(filePath)}"]`);
}

function findLineRow(fileElement: Element, lineNumber: number): Element | null {
  // Strategy 1: data-linenumber attribute
  const lineNumCells = fileElement.querySelectorAll(`[data-linenumber="${lineNumber}"]`);
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

  // Strategy 4: ID-based
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
 * Extract the line number from a line number cell element.
 * Tries data-linenumber attribute first, then text content.
 */
function getLineNumber(cell: Element): number | null {
  // data-linenumber attribute (most reliable)
  const attr = cell.getAttribute('data-linenumber');
  if (attr) {
    const num = parseInt(attr, 10);
    if (!isNaN(num) && num > 0) return num;
  }

  // Text content of the cell or its link child
  const link = cell.querySelector('a');
  const text = (link || cell).textContent?.trim();
  if (text) {
    const num = parseInt(text, 10);
    if (!isNaN(num) && num > 0) return num;
  }

  return null;
}

/**
 * Extract diff snippet and code content from a range of lines in a diff file.
 * Reads from the DOM — the actual rendered diff content.
 */
function extractRangeContent(
  fileElement: Element,
  startLine: number,
  endLine: number,
): { diffSnippet: string; codeContent: string } {
  const diffLines: string[] = [];
  const codeLines: string[] = [];

  for (let line = startLine; line <= endLine; line++) {
    const row = findLineRow(fileElement, line);
    if (!row) continue;

    // Extract the code content from the line_content cell
    const contentCell = row.querySelector('.line_content, .diff-td:last-child, td:last-child');
    if (contentCell) {
      const text = contentCell.textContent || '';
      codeLines.push(text);

      // Determine if this is an added, removed, or context line
      const isAdded = contentCell.classList.contains('new') ||
        contentCell.classList.contains('line_content-new') ||
        row.classList.contains('line_holder-new');
      const isRemoved = contentCell.classList.contains('old') ||
        contentCell.classList.contains('line_content-old') ||
        row.classList.contains('line_holder-old');

      if (isAdded) {
        diffLines.push(`+${text}`);
      } else if (isRemoved) {
        diffLines.push(`-${text}`);
      } else {
        diffLines.push(` ${text}`);
      }
    }
  }

  return {
    diffSnippet: diffLines.join('\n'),
    codeContent: codeLines.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Shadow DOM styles
// ---------------------------------------------------------------------------

function getComposerStyles(): string {
  return `
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    button { font-family: inherit; }
    textarea { font-family: inherit; }
    pre, code { font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace; }

    /* Cursor blink animation — matches ChatMessage otto-chat-cursor */
    @keyframes otto-inquiry-cursor {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    /* Scrollbar styling for the carousel body */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.3); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(128, 128, 128, 0.5); }
  `;
}
