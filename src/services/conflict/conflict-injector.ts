// ---------------------------------------------------------------------------
// Conflict Injector — adds conflict warning badges to GitLab's diff file headers.
//
// Follows the same pattern as risk-injector.ts: plain DOM manipulation,
// subscribes to the conflict store, MutationObserver for lazy-loaded diffs.
//
// Injects a small badge (e.g., "⚠ 2") into each diff file header when other
// in-flight MRs also modify that file. Red for line-range overlaps, orange
// for same-file overlaps. Tooltip on hover shows which MRs conflict.
// ---------------------------------------------------------------------------

import { useConflictStore } from '@/services/conflict/conflict-store';
import type { ConflictingMr } from '@/types/conflict';
import { isOttoMutating, guardedMutation, isInjectionCooldown } from '@/lib/dom-guard';
import { getHealthLevel } from '@/services/review/health-monitor';
import { getInjectorColors, DEFAULT_HUE } from '@/lib/palette';

const INJECTED_ATTR = 'data-otto-conflict-badge';

const COLORS = {
  high: { bg: '#fef2f2', border: '#fecaca', text: '#dc2626', dot: '#dc2626' },
  medium: { bg: '#fffbeb', border: '#fde68a', text: '#d97706', dot: '#d97706' },
};

const COLORS_DARK = {
  high: { bg: '#450a0a', border: '#7f1d1d', text: '#f87171', dot: '#f87171' },
  medium: { bg: '#451a03', border: '#78350f', text: '#fbbf24', dot: '#fbbf24' },
};

type ConflictInfo = {
  conflicts: ConflictingMr[];
  maxSeverity: 'high' | 'medium';
};

/** Build a map of filePath → conflict info from the current store state. */
function buildConflictMap(): Map<string, ConflictInfo> {
  const map = new Map<string, ConflictInfo>();
  const report = useConflictStore.getState().report;
  if (!report) return map;

  for (const fc of report.conflicts) {
    const hasHigh = fc.conflictingMrs.some((cm) => cm.severity === 'high');
    map.set(fc.filePath, {
      conflicts: fc.conflictingMrs,
      maxSeverity: hasHigh ? 'high' : 'medium',
    });
  }
  return map;
}

/** Track injected badges for cleanup and updates. */
const injectedBadges = new Map<string, HTMLElement>();

function createBadge(info: ConflictInfo, isDark: boolean, brandHue: number): HTMLElement {
  const colors = isDark ? COLORS_DARK : COLORS;
  const palette = colors[info.maxSeverity];
  const brandColors = getInjectorColors(brandHue, isDark);

  const badge = document.createElement('span');
  badge.setAttribute(INJECTED_ATTR, 'true');
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px;
    border-radius: 10px;
    background: ${palette.bg};
    border: 1px solid ${palette.border};
    font-size: 11px;
    font-weight: 600;
    color: ${palette.text};
    cursor: default;
    line-height: 1.4;
    margin-left: 6px;
    flex-shrink: 0;
    position: relative;
  `;

  // Warning icon (⚠) + count
  badge.textContent = `⚠ ${info.conflicts.length}`;

  // Tooltip on hover — uses brand-aware surface colors so it respects the
  // user's hue setting, while severity dots stay fixed red/orange.
  const shadowOpacity = isDark ? 0.4 : 0.08;
  const tooltip = document.createElement('div');
  tooltip.style.cssText = `
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    padding: 6px 10px;
    background: ${isDark ? brandColors.surfaceDark : '#ffffff'};
    border: 1px solid ${isDark ? brandColors.surfaceDarkBorder : '#e5e7eb'};
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,${shadowOpacity});
    z-index: 1000;
    min-width: 200px;
    max-width: 340px;
    white-space: normal;
    font-weight: 400;
  `;

  const header = document.createElement('div');
  header.style.cssText = `font-size: 11px; font-weight: 600; color: ${isDark ? '#f3f4f6' : '#111827'}; margin-bottom: 4px;`;
  header.textContent = `${info.conflicts.length === 1 ? '1 other MR' : `${info.conflicts.length} other MRs`} also modify this file`;
  tooltip.appendChild(header);

  for (const cm of info.conflicts) {
    const row = document.createElement('div');
    row.style.cssText = `font-size: 11px; color: ${isDark ? '#9ca3af' : '#6b7280'}; margin-bottom: 2px; display: flex; align-items: center; gap: 4px;`;

    const dot = document.createElement('span');
    const dotPalette = colors[cm.severity];
    dot.style.cssText = `width: 6px; height: 6px; border-radius: 50%; background: ${dotPalette.dot}; flex-shrink: 0;`;
    row.appendChild(dot);

    const link = document.createElement('a');
    link.href = cm.webUrl || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.cssText = `color: ${brandColors.brand}; text-decoration: none;`;
    link.textContent = `!${cm.mrIid}`;
    row.appendChild(link);

    const detail = document.createElement('span');
    detail.style.cssText = `color: ${isDark ? '#6b7280' : '#9ca3af'};`;
    detail.textContent = cm.overlapType === 'line_range' ? 'overlapping lines' : 'same file';
    row.appendChild(detail);

    tooltip.appendChild(row);
  }

  badge.appendChild(tooltip);

  // Show/hide tooltip on hover and keyboard focus
  badge.setAttribute('tabindex', '0');
  badge.setAttribute('role', 'button');
  badge.setAttribute('aria-label', `${info.conflicts.length} conflicting MR${info.conflicts.length === 1 ? '' : 's'}`);
  badge.addEventListener('mouseenter', () => { tooltip.style.display = 'block'; });
  badge.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
  badge.addEventListener('focus', () => { tooltip.style.display = 'block'; });
  badge.addEventListener('blur', () => { tooltip.style.display = 'none'; });

  return badge;
}

/** Find all diff file header elements. */
function findDiffFileHeaders(): Array<{ element: Element; filePath: string }> {
  const results: Array<{ element: Element; filePath: string }> = [];

  // GitLab diff files have a data-path attribute on .diff-file or .file-holder
  const diffFiles = document.querySelectorAll('.diff-file[data-path], .file-holder[data-path]');
  for (const el of diffFiles) {
    const path = el.getAttribute('data-path');
    if (path) {
      // Find the header area within the diff file
      const header = el.querySelector('.file-header-content, .file-title-flex-parent, .diff-file-header');
      if (header) {
        results.push({ element: header, filePath: path });
      }
    }
  }

  return results;
}

function injectBadges(conflictMap: Map<string, ConflictInfo>, isDark: boolean, brandHue: number): void {
  guardedMutation(() => {
    const headers = findDiffFileHeaders();

    for (const { element, filePath } of headers) {
      const info = conflictMap.get(filePath);

      if (!info) {
        // No conflict — remove existing badge if any
        const existing = injectedBadges.get(filePath);
        if (existing?.isConnected) existing.remove();
        injectedBadges.delete(filePath);
        continue;
      }

      const existing = injectedBadges.get(filePath);

      if (existing) {
        if (existing.isConnected) {
          // Update: replace with new badge
          const newBadge = createBadge(info, isDark, brandHue);
          existing.replaceWith(newBadge);
          injectedBadges.set(filePath, newBadge);
        } else {
          // Detached — re-inject
          injectedBadges.delete(filePath);
        }
      }

      if (!injectedBadges.has(filePath)) {
        // Inject new badge
        if (!element.querySelector(`[${INJECTED_ATTR}]`)) {
          const badge = createBadge(info, isDark, brandHue);
          element.appendChild(badge);
          injectedBadges.set(filePath, badge);
        }
      }
    }
  });
}

function pruneDetached(): void {
  for (const [filePath, badge] of injectedBadges) {
    if (!badge.isConnected) {
      injectedBadges.delete(filePath);
    }
  }
}

/**
 * Start injecting conflict badges into GitLab's diff file headers.
 * Returns a cleanup function.
 */
export function startConflictInjection(isDarkMode: boolean, signal?: AbortSignal, brandHue: number = DEFAULT_HUE): () => void {
  let currentMap = new Map<string, ConflictInfo>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function update() {
    pruneDetached();
    injectBadges(currentMap, isDarkMode, brandHue);
  }

  function debouncedUpdate() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(update, 200);
  }

  // Initial injection from current state
  const initialReport = useConflictStore.getState().report;
  if (initialReport && initialReport.conflicts.length > 0) {
    currentMap = buildConflictMap();
    update();
  }

  // Track previous report reference to skip unrelated store updates
  let prevReport = initialReport;

  // Subscribe to conflict store
  const unsubscribe = useConflictStore.subscribe((state) => {
    if (state.report === prevReport) return;
    prevReport = state.report;
    currentMap = buildConflictMap();
    debouncedUpdate();
  });

  // MutationObserver for lazy-loaded diff files
  const observer = new MutationObserver((mutations) => {
    if (isOttoMutating()) return;

    let hasNewDiffs = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.diff-file') || node.querySelector('.diff-file')) {
          hasNewDiffs = true;
          break;
        }
      }
      if (hasNewDiffs) break;
    }
    if (!hasNewDiffs) return;

    debouncedUpdate();
  });

  const diffHolder = document.querySelector('.diff-files-holder');
  if (diffHolder) {
    observer.observe(diffHolder, { childList: true, subtree: true });
  } else {
    const bodyObserver = new MutationObserver(() => {
      const container = document.querySelector('.diff-files-holder');
      if (container) {
        bodyObserver.disconnect();
        observer.observe(container, { childList: true, subtree: true });
        update();
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    if (signal) {
      signal.addEventListener('abort', () => bodyObserver.disconnect(), { once: true });
    }
  }

  // Periodic rescan — staggered from other injectors
  let consecutiveIdle = 0;
  const rescanInterval = setInterval(() => {
    const health = getHealthLevel();
    if (health === 'critical' || health === 'degraded') return;
    if (isInjectionCooldown()) return;

    const before = injectedBadges.size;
    update();
    const after = injectedBadges.size;

    if (after === before) {
      consecutiveIdle++;
      if (consecutiveIdle >= 3) clearInterval(rescanInterval);
    } else {
      consecutiveIdle = 0;
    }
  }, 6000); // Staggered: 6s (after risk at 5.25s)

  // Visibility change handler
  const visibilityHandler = () => {
    if (document.visibilityState === 'visible') update();
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  if (signal) {
    signal.addEventListener('abort', () => cleanup(), { once: true });
  }

  function cleanup() {
    unsubscribe();
    observer.disconnect();
    clearInterval(rescanInterval);
    document.removeEventListener('visibilitychange', visibilityHandler);
    if (debounceTimer) clearTimeout(debounceTimer);

    for (const [, badge] of injectedBadges) {
      if (badge.isConnected) badge.remove();
    }
    injectedBadges.clear();
  }

  return cleanup;
}
