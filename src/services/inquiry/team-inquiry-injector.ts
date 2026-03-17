// ---------------------------------------------------------------------------
// Team Inquiry Injector — places gutter dots in the diff line number cells
// for team inquiries shared via Botto.
//
// Design decisions:
// - Follows the same pattern as risk-injector.ts: subscribes to the store,
//   queries DOM for line number cells, injects plain DOM elements.
// - No shadow DOM needed — dots are tiny inline elements (7px circles).
// - MutationObserver watches for new diff-file elements (virtual scrolling).
// - Periodic rescan with auto-stop after 3 idle ticks (same as risk-injector).
// - All DOM writes go through guardedMutation().
// - Dots are keyed by inquiry ID to avoid duplicates.
// ---------------------------------------------------------------------------

import { useInquiryStore } from './inquiry-store';
import { openInquiryAt } from './selection-manager';
import { useReviewStore } from '@/services/review/review-store';
import { createGutterDot } from '@/components/inquiry/InquiryGutterDot';
import { isOttoMutating, guardedMutation, isInjectionCooldown } from '@/lib/dom-guard';
import { getInjectorColors, type InjectorColors } from '@/lib/palette';
import type { TeamInquiryIndicator } from '@/types/inquiry';

const TEAM_DOT_ATTR = 'data-otto-team-inquiry';

/** Track mounted dots for cleanup */
const mountedDots = new Map<string, HTMLElement>();

/**
 * Start injecting team inquiry gutter dots.
 * Subscribes to the inquiry store's teamIndicators and injects dots
 * into the line number gutter for each indicator.
 *
 * Returns a cleanup function.
 */
export function startTeamInquiryInjection(
  isDarkMode: boolean,
  brandHue: number,
  signal?: AbortSignal,
): () => void {
  const colors = getInjectorColors(brandHue, isDarkMode);

  // Subscribe to team indicators
  let prevIndicators: TeamInquiryIndicator[] = [];

  const unsubscribe = useInquiryStore.subscribe((state) => {
    if (state.teamIndicators === prevIndicators) return;
    prevIndicators = state.teamIndicators;
    injectAllDots(state.teamIndicators, colors);
  });

  // Initial injection if indicators are already loaded
  const initialState = useInquiryStore.getState();
  if (initialState.teamIndicators.length > 0) {
    injectAllDots(initialState.teamIndicators, colors);
  }

  // MutationObserver for new diff-file elements
  let idleTicks = 0;
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
      idleTicks = 0;
      const indicators = useInquiryStore.getState().teamIndicators;
      if (indicators.length > 0) {
        injectAllDots(indicators, colors);
      }
    }
  });

  const container = document.querySelector('.diff-files-holder') || document.body;
  domObserver.observe(container, { childList: true, subtree: true });

  // Periodic rescan — staggered at 5.5s to avoid collision with other injectors
  const rescanInterval = setInterval(() => {
    if (isInjectionCooldown()) return;

    const indicators = useInquiryStore.getState().teamIndicators;
    if (indicators.length === 0) return;

    // Prune detached dots
    pruneDetachedDots();

    // Check if any dots need injection
    const needsWork = indicators.some((ind) => !mountedDots.has(ind.inquiryId));
    if (needsWork) {
      idleTicks = 0;
      injectAllDots(indicators, colors);
    } else {
      idleTicks++;
      if (idleTicks >= 3) {
        clearInterval(rescanInterval);
      }
    }
  }, 5500);

  function cleanup() {
    unsubscribe();
    domObserver.disconnect();
    clearInterval(rescanInterval);
    // Remove all dots
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
// Injection logic
// ---------------------------------------------------------------------------

function injectAllDots(indicators: TeamInquiryIndicator[], colors: InjectorColors): void {
  for (const indicator of indicators) {
    if (mountedDots.has(indicator.inquiryId)) continue;
    injectDot(indicator, colors);
  }
}

function injectDot(indicator: TeamInquiryIndicator, colors: InjectorColors): void {
  const fileElement = document.querySelector(
    `.diff-file[data-path="${CSS.escape(indicator.filePath)}"]`,
  );
  if (!fileElement) return;

  // Find the line number cell for the start line
  const lineNumCell = findLineNumCell(fileElement, indicator.startLine);
  if (!lineNumCell) return;

  // Check if a dot already exists in this cell
  if (lineNumCell.querySelector(`[${TEAM_DOT_ATTR}]`)) return;

  const dot = createGutterDot(indicator, colors, (ind) => {
    const mrContext = useReviewStore.getState().mrContext;
    if (!mrContext) return;
    openInquiryAt(ind.filePath, ind.startLine, ind.endLine, mrContext.mrIid);
  });

  guardedMutation(() => {
    lineNumCell.appendChild(dot);
  });

  mountedDots.set(indicator.inquiryId, dot);
}

function findLineNumCell(fileElement: Element, lineNumber: number): Element | null {
  // Strategy 1: data-linenumber attribute
  const cells = fileElement.querySelectorAll(`[data-linenumber="${lineNumber}"]`);
  for (const cell of cells) {
    // Prefer new-file side in parallel view
    const isOldSideOnly = cell.closest('.diff-grid-left, .left-side') !== null
      && cell.closest('.diff-grid-right, .right-side') === null;
    if (!isOldSideOnly) return cell;
  }
  if (cells.length > 0) return cells[0];

  // Strategy 2: Line number links
  const links = fileElement.querySelectorAll('.diff-line-num a, td.diff-line-num a');
  for (const link of links) {
    if (link.textContent?.trim() === String(lineNumber)) {
      return link.closest('.diff-line-num, td.diff-line-num') || link.parentElement;
    }
  }

  return null;
}

function pruneDetachedDots(): void {
  for (const [id, el] of mountedDots) {
    if (!el.isConnected) {
      mountedDots.delete(id);
    }
  }
}
