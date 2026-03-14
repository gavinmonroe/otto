// ---------------------------------------------------------------------------
// Risk Injector — adds colored risk dots to GitLab's native file tree rows.
//
// Design decisions:
// - Injects a small colored dot (high=red, medium=amber, low=green) next to
//   each file name in GitLab's MR file tree sidebar.
// - Adds a checkmark when all comments in that file are resolved.
// - Uses plain DOM manipulation (no React/shadow DOM needed — just a dot).
// - Subscribes to the review store and updates when file reviews change.
// - MutationObserver handles lazy-loaded file tree rows.
// - Same resilience patterns as inline-injector: debounced observer,
//   periodic rescan, visibility change handler, detached element pruning.
// ---------------------------------------------------------------------------

import { useReviewStore } from '@/services/review/review-store';
import type { FileReview } from '@/types/review';
import { getHealthLevel } from '@/services/review/health-monitor';

const INJECTED_ATTR = 'data-otto-risk-dot';

type RiskInfo = {
  riskLevel: 'low' | 'medium' | 'high';
  isReviewed: boolean;
};

function computeRiskMap(fileReviews: FileReview[]): Map<string, RiskInfo> {
  const map = new Map<string, RiskInfo>();
  for (const fr of fileReviews) {
    const totalComments = fr.comments.length;
    const reviewedComments = fr.comments.filter(
      (c) => c.status === 'accepted' || c.status === 'dismissed' || c.status === 'edited',
    ).length;
    map.set(fr.filePath, {
      riskLevel: fr.riskLevel,
      isReviewed: totalComments > 0 && reviewedComments === totalComments,
    });
  }
  return map;
}

const RISK_COLORS = {
  high: '#dc2626',
  medium: '#d97706',
  low: '#16a34a',
};

const RISK_COLORS_DARK = {
  high: '#f87171',
  medium: '#fbbf24',
  low: '#4ade80',
};

/** Track injected dots for cleanup and updates */
const injectedDots = new Map<string, HTMLElement>();

function createDot(risk: RiskInfo, isDark: boolean): HTMLElement {
  const dot = document.createElement('span');
  dot.setAttribute(INJECTED_ATTR, 'true');

  const colors = isDark ? RISK_COLORS_DARK : RISK_COLORS;

  if (risk.isReviewed) {
    dot.textContent = '✓';
    dot.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      font-size: 10px;
      color: ${colors.low};
      flex-shrink: 0;
      margin-left: 4px;
      font-weight: 700;
    `;
  } else {
    dot.style.cssText = `
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: ${colors[risk.riskLevel]};
      flex-shrink: 0;
      margin-left: 4px;
    `;
  }

  return dot;
}

function findFileTreeRows(): NodeListOf<Element> {
  // GitLab's file tree uses different selectors across versions
  return document.querySelectorAll([
    '.file-row',                                    // GitLab 15+
    '.diff-tree-list .file-row',                    // Older
    '[data-testid="file-tree-container"] .file-row', // Modern testid
    '.mr-tree-list .file-row',                      // MR-specific
  ].join(', '));
}

function getFilePathFromRow(row: Element): string | null {
  // Try data attribute first
  const path = row.getAttribute('data-path');
  if (path) return path;

  // Try finding the file name link/span
  const link = row.querySelector('.file-row-name, .file-row-name-container a, [data-testid="file-name"]');
  if (link) {
    const title = link.getAttribute('title') || link.textContent?.trim();
    if (title) return title;
  }

  return null;
}

function injectDots(riskMap: Map<string, RiskInfo>, isDark: boolean): void {
  const rows = findFileTreeRows();

  for (const row of rows) {
    const filePath = getFilePathFromRow(row);
    if (!filePath) continue;

    const risk = riskMap.get(filePath);
    if (!risk) continue;

    const existing = injectedDots.get(filePath);

    if (existing) {
      // Update existing dot if risk changed
      if (existing.isConnected) {
        existing.replaceWith(createDot(risk, isDark));
        const newDot = row.querySelector(`[${INJECTED_ATTR}]`) as HTMLElement;
        if (newDot) injectedDots.set(filePath, newDot);
      } else {
        // Detached — re-inject
        injectedDots.delete(filePath);
      }
    }

    if (!injectedDots.has(filePath)) {
      // Find the name container to append the dot
      const nameEl = row.querySelector('.file-row-name, .file-row-name-container, [data-testid="file-name"]');
      if (nameEl && !nameEl.querySelector(`[${INJECTED_ATTR}]`)) {
        const dot = createDot(risk, isDark);
        nameEl.appendChild(dot);
        injectedDots.set(filePath, dot);
      }
    }
  }
}

function pruneDetached(): void {
  for (const [filePath, dot] of injectedDots) {
    if (!dot.isConnected) {
      injectedDots.delete(filePath);
    }
  }
}

/**
 * Start injecting risk dots into GitLab's file tree.
 * Returns a cleanup function.
 */
export function startRiskInjection(isDarkMode: boolean, signal?: AbortSignal): () => void {
  let currentRiskMap = new Map<string, RiskInfo>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function update() {
    pruneDetached();
    injectDots(currentRiskMap, isDarkMode);
  }

  function debouncedUpdate() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(update, 200);
  }

  // Initial injection from current state
  const initialState = useReviewStore.getState();
  if (initialState.fileReviews.length > 0) {
    currentRiskMap = computeRiskMap(initialState.fileReviews);
    update();
  }

  // Track previous fileReviews reference to skip unrelated store updates.
  // Without this, every streaming delta (summaryDelta, edgeCasesDelta, etc.)
  // triggers a full risk map recomputation + DOM scan ~60 times/sec.
  let prevFileReviews = initialState.fileReviews;

  // Subscribe to store — update only when fileReviews reference changes
  const unsubscribe = useReviewStore.subscribe((state) => {
    if (state.fileReviews === prevFileReviews) return;
    prevFileReviews = state.fileReviews;

    const newMap = computeRiskMap(state.fileReviews);
    currentRiskMap = newMap;
    debouncedUpdate();
  });

  // MutationObserver for lazy-loaded file tree rows
  const observer = new MutationObserver(debouncedUpdate);
  const treeContainer = document.querySelector('.mr-tree-list, .diff-tree-list, [data-testid="file-tree-container"]');
  if (treeContainer) {
    observer.observe(treeContainer, { childList: true, subtree: true });
  } else {
    // Tree not yet loaded — observe body until it appears
    const bodyObserver = new MutationObserver(() => {
      const container = document.querySelector('.mr-tree-list, .diff-tree-list, [data-testid="file-tree-container"]');
      if (container) {
        bodyObserver.disconnect();
        observer.observe(container, { childList: true, subtree: true });
        update();
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });

    // Clean up body observer on abort
    if (signal) {
      signal.addEventListener('abort', () => bodyObserver.disconnect(), { once: true });
    }
  }

  // Periodic rescan for virtual scrolling — skipped in critical health
  const rescanInterval = setInterval(() => {
    if (getHealthLevel() === 'critical') return;
    update();
  }, 3000);

  // Visibility change handler
  const visibilityHandler = () => {
    if (document.visibilityState === 'visible') update();
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  // Abort signal support
  if (signal) {
    signal.addEventListener('abort', () => cleanup(), { once: true });
  }

  function cleanup() {
    unsubscribe();
    observer.disconnect();
    clearInterval(rescanInterval);
    document.removeEventListener('visibilitychange', visibilityHandler);
    if (debounceTimer) clearTimeout(debounceTimer);

    // Remove all injected dots
    for (const [, dot] of injectedDots) {
      if (dot.isConnected) dot.remove();
    }
    injectedDots.clear();
  }

  return cleanup;
}
