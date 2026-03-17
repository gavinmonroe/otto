// ---------------------------------------------------------------------------
// Local Inquiry Indicator Injector — places small dots in the line gutter
// for inquiries that exist in the local store (from cache or current session).
//
// This is separate from team-inquiry-injector.ts which handles Botto-shared
// inquiries. Local indicators let users reopen their own past inquiries
// without having to remember the exact line range.
//
// Design decisions:
// - Subscribes to the inquiry store's inquiries map.
// - Only shows dots for inquiries with at least one completed slide.
// - Uses a slightly different visual (filled brand dot with a subtle ring)
//   to distinguish from team inquiry dots.
// - Clicking opens the inquiry carousel at that location.
// - Same resilience patterns as other injectors: guardedMutation, prune
//   detached elements, MutationObserver for new diff files.
// ---------------------------------------------------------------------------

import { useInquiryStore } from './inquiry-store';
import { openInquiryAt } from './selection-manager';
import { useReviewStore } from '@/services/review/review-store';
import { isOttoMutating, guardedMutation, isInjectionCooldown } from '@/lib/dom-guard';
import { getInjectorColors, type InjectorColors } from '@/lib/palette';
import type { LineInquiry } from '@/types/inquiry';

const LOCAL_DOT_ATTR = 'data-otto-local-inquiry';

/** Track mounted dots for cleanup */
const mountedDots = new Map<string, HTMLElement>();

/**
 * Start injecting local inquiry gutter dots.
 * Returns a cleanup function.
 */
export function startLocalInquiryInjection(
  isDarkMode: boolean,
  brandHue: number,
  signal?: AbortSignal,
): () => void {
  const colors = getInjectorColors(brandHue, isDarkMode);

  // Subscribe to inquiries — inject/remove dots as inquiries change
  let prevInquiryKeys = '';

  const unsubscribe = useInquiryStore.subscribe((state) => {
    // Quick reference check: only act when the set of completed inquiries changes
    const completedIds = Object.values(state.inquiries)
      .filter((inq) => inq.slides.length > 0 && inq.slides.some((s) => s.answer))
      .map((inq) => inq.id)
      .sort()
      .join(',');

    if (completedIds === prevInquiryKeys) return;
    prevInquiryKeys = completedIds;

    syncDots(state.inquiries, colors);
  });

  // Initial injection from cache-hydrated state
  const initialState = useInquiryStore.getState();
  const hasCompleted = Object.values(initialState.inquiries).some(
    (inq) => inq.slides.length > 0 && inq.slides.some((s) => s.answer),
  );
  if (hasCompleted) {
    // Delay slightly to let diff DOM render after cache hydration
    setTimeout(() => syncDots(useInquiryStore.getState().inquiries, colors), 500);
  }

  // MutationObserver for new diff-file elements
  const domObserver = new MutationObserver((mutations) => {
    if (isOttoMutating()) return;
    if (isInjectionCooldown()) return;

    let hasNewFiles = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.diff-file.file-holder') || node.querySelector('.diff-file.file-holder')) {
          hasNewFiles = true;
          break;
        }
      }
      if (hasNewFiles) break;
    }

    if (hasNewFiles) {
      syncDots(useInquiryStore.getState().inquiries, colors);
    }
  });

  const container = document.querySelector('.diff-files-holder') || document.body;
  domObserver.observe(container, { childList: true, subtree: true });

  function cleanup() {
    unsubscribe();
    domObserver.disconnect();
    for (const [id, el] of mountedDots) {
      el.remove();
      mountedDots.delete(id);
    }
  }

  if (signal) {
    signal.addEventListener('abort', cleanup, { once: true });
  }

  return cleanup;
}

// ---------------------------------------------------------------------------
// Sync logic
// ---------------------------------------------------------------------------

function syncDots(
  inquiries: Record<string, LineInquiry>,
  colors: InjectorColors,
): void {
  // Prune detached dots first
  for (const [id, el] of mountedDots) {
    if (!el.isConnected) {
      mountedDots.delete(id);
    }
  }

  // Inject dots for completed inquiries that don't have one yet
  for (const inquiry of Object.values(inquiries)) {
    // Only show for inquiries with at least one completed answer
    if (inquiry.slides.length === 0 || !inquiry.slides.some((s) => s.answer)) continue;
    if (mountedDots.has(inquiry.id)) continue;

    injectLocalDot(inquiry, colors);
  }

  // Remove dots for inquiries that no longer exist or have no slides
  for (const [id, el] of mountedDots) {
    const inquiry = inquiries[id];
    if (!inquiry || inquiry.slides.length === 0) {
      el.remove();
      mountedDots.delete(id);
    }
  }
}

function injectLocalDot(inquiry: LineInquiry, colors: InjectorColors): void {
  const fileElement = document.querySelector(
    `.diff-file[data-path="${CSS.escape(inquiry.filePath)}"]`,
  );
  if (!fileElement) return;

  const lineNumCell = findLineNumCell(fileElement, inquiry.startLine);
  if (!lineNumCell) return;

  // Don't inject if a dot already exists in this cell
  if (lineNumCell.querySelector(`[${LOCAL_DOT_ATTR}]`)) return;

  const dot = document.createElement('span');
  dot.setAttribute(LOCAL_DOT_ATTR, inquiry.id);

  const slideCount = inquiry.slides.filter((s) => s.answer).length;
  const firstQuestion = inquiry.slides[0]?.question || '';
  const preview = firstQuestion.length > 50 ? firstQuestion.slice(0, 50) + '…' : firstQuestion;
  dot.title = `${slideCount} Q&A: "${preview}" — click to open`;

  dot.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    background: ${colors.brand};
    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    margin-left: 3px;
    vertical-align: middle;
    cursor: pointer;
    opacity: 0.75;
    transition: opacity 0.15s, transform 0.15s;
    flex-shrink: 0;
    position: relative;
    z-index: 20;
    pointer-events: auto;
  `;

  // Slide count number inside the dot
  dot.innerHTML = `<span style="font-size:10px;font-weight:700;color:#fff;line-height:1;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">${slideCount}</span>`;

  dot.addEventListener('mouseenter', () => {
    dot.style.opacity = '1';
    dot.style.transform = 'scale(1.15)';
  });

  dot.addEventListener('mouseleave', () => {
    dot.style.opacity = '0.75';
    dot.style.transform = 'scale(1)';
  });

  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const mrContext = useReviewStore.getState().mrContext;
    if (!mrContext) return;
    openInquiryAt(inquiry.filePath, inquiry.startLine, inquiry.endLine, mrContext.mrIid);
  });

  guardedMutation(() => {
    lineNumCell.appendChild(dot);
  });

  mountedDots.set(inquiry.id, dot);
}

function findLineNumCell(fileElement: Element, lineNumber: number): Element | null {
  const cells = fileElement.querySelectorAll(`[data-linenumber="${lineNumber}"]`);
  for (const cell of cells) {
    const isOldSideOnly = cell.closest('.diff-grid-left, .left-side') !== null
      && cell.closest('.diff-grid-right, .right-side') === null;
    if (!isOldSideOnly) return cell;
  }
  if (cells.length > 0) return cells[0];

  const links = fileElement.querySelectorAll('.diff-line-num a, td.diff-line-num a');
  for (const link of links) {
    if (link.textContent?.trim() === String(lineNumber)) {
      return link.closest('.diff-line-num, td.diff-line-num') || link.parentElement;
    }
  }

  return null;
}
