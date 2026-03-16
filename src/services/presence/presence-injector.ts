// ---------------------------------------------------------------------------
// Presence Injector — renders avatar dots + line-range bars showing who's
// viewing each file and where they're looking.
//
// Design decisions:
// - Follows the risk-injector pattern: plain DOM elements, no React, no
//   shadow DOM. This is the lightest possible injection.
// - Subscribes to the presence store (NOT the review store) so it only
//   fires on presence changes, not on every streaming delta.
// - Reference equality check on the viewers Map before any DOM work.
// - 200ms debounce on updates (matches risk-injector).
// - No periodic rescan needed — presence updates are push-driven from
//   Botto, not DOM-driven. MutationObserver handles file tree changes.
// - Prunes detached elements on each update cycle.
// - Health-aware: skips updates when degraded/critical.
// - Avatar dots use GitLab profile images when available, with colored
//   initials as fallback. Initials are derived from display name if
//   available (e.g. "Gavin Smith" → "GS"), otherwise from username.
// - Line-range gutter bars show a subtle colored stripe in the diff
//   gutter for the lines another viewer is currently looking at.
// ---------------------------------------------------------------------------

import { usePresenceStore, getViewersForFile } from '@/services/presence/presence-store';
import type { ViewerPresence } from '@/services/presence/presence-store';
import { getHealthLevel } from '@/services/review/health-monitor';
import { guardedMutation } from '@/lib/dom-guard';
import { DEFAULT_HUE, hslToHex } from '@/lib/palette';

const DEBUG = false;
function dbg(msg: string, ...args: any[]) {
  if (DEBUG) console.log(`[Otto:presence-injector] ${msg}`, ...args);
}

const INJECTED_ATTR = 'data-otto-presence';
const GUTTER_ATTR = 'data-otto-presence-gutter';

/** Track injected containers for cleanup and updates */
const injectedContainers = new Map<string, HTMLElement>();
/** Track injected gutter bars for cleanup */
const injectedGutterBars = new Map<string, HTMLElement[]>();

// ---------------------------------------------------------------------------
// Avatar rendering
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6', // teal
  '#84cc16', // lime
  '#f43f5e', // rose
  '#06b6d4', // cyan
];

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Derive initials from a display name or username.
 * - "Gavin Smith" → "GS"
 * - "Jean-Pierre Dupont" → "JD"
 * - "gavin.smith" → "GS"
 * - "gavin" → "GA" (first two chars)
 */
function initialsFor(displayName: string | undefined, userId: string): string {
  const source = displayName || userId;

  // Split on spaces, dots, hyphens, underscores
  const parts = source.split(/[\s.\-_]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // Single word — take first two characters
  return source.slice(0, 2).toUpperCase();
}

/**
 * Build the tooltip text: "Display Name (username)" or just "username".
 */
function tooltipFor(viewer: ViewerPresence): string {
  if (viewer.displayName && viewer.displayName !== viewer.userId) {
    return `${viewer.displayName} (${viewer.userId})`;
  }
  return viewer.userId;
}

function createAvatarDot(viewer: ViewerPresence, isDark: boolean, brandHue: number = DEFAULT_HUE): HTMLElement {
  const color = colorForUser(viewer.userId);
  const borderColor = isDark ? hslToHex(brandHue, 20, 17) : '#ffffff';

  if (viewer.avatarUrl) {
    // Real GitLab avatar
    const img = document.createElement('img');
    img.src = viewer.avatarUrl;
    img.alt = initialsFor(viewer.displayName, viewer.userId);
    img.title = tooltipFor(viewer);
    img.style.cssText = `
      width: 20px;
      height: 20px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-left: 2px;
      border: 2px solid ${borderColor};
      box-shadow: 0 0 0 1px ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'};
      object-fit: cover;
    `;
    // Fallback to initials if image fails to load
    img.onerror = () => {
      const fallback = createInitialsDot(viewer, isDark, brandHue);
      img.replaceWith(fallback);
    };
    return img;
  }

  return createInitialsDot(viewer, isDark, brandHue);
}

function createInitialsDot(viewer: ViewerPresence, isDark: boolean, brandHue: number = DEFAULT_HUE): HTMLElement {
  const dot = document.createElement('span');
  const color = colorForUser(viewer.userId);
  const textColor = isDark ? hslToHex(brandHue, 30, 11) : '#ffffff';
  const borderColor = isDark ? hslToHex(brandHue, 20, 17) : '#ffffff';

  dot.textContent = initialsFor(viewer.displayName, viewer.userId);
  dot.title = tooltipFor(viewer);
  dot.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: ${color};
    color: ${textColor};
    font-size: 9px;
    font-weight: 600;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    flex-shrink: 0;
    margin-left: 2px;
    line-height: 1;
    letter-spacing: -0.5px;
    border: 2px solid ${borderColor};
    box-shadow: 0 0 0 1px ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'};
  `;

  return dot;
}

function createPresenceContainer(viewers: ViewerPresence[], filePath: string, isDark: boolean, brandHue: number = DEFAULT_HUE): HTMLElement {
  const container = document.createElement('span');
  container.setAttribute(INJECTED_ATTR, filePath);
  container.style.cssText = `
    display: inline-flex;
    align-items: center;
    margin-left: 8px;
    flex-shrink: 0;
  `;

  // Stack avatars with negative margin for overlap (like GitHub)
  for (let i = 0; i < viewers.length; i++) {
    const dot = createAvatarDot(viewers[i], isDark, brandHue);
    if (i > 0) {
      dot.style.marginLeft = '-6px';
    }
    container.appendChild(dot);
  }

  return container;
}

// ---------------------------------------------------------------------------
// Line-range gutter bars — subtle colored stripe in the diff gutter
// showing where another viewer is currently looking.
// ---------------------------------------------------------------------------

function injectGutterBars(isDark: boolean, brandHue: number = DEFAULT_HUE): void {
  const files = document.querySelectorAll('.diff-file.file-holder');

  for (const file of files) {
    const filePath = file.getAttribute('data-path');
    if (!filePath) continue;

    // Remove old gutter bars for this file
    removeGutterBarsForFile(filePath);

    const viewers = getViewersForFile(filePath);
    if (viewers.length === 0) continue;

    const bars: HTMLElement[] = [];

    for (const viewer of viewers) {
      const viewerFile = viewer.files.find((f) => f.path === filePath);
      if (!viewerFile?.firstLine || !viewerFile?.lastLine) continue;

      const color = colorForUser(viewer.userId);
      let isFirstRow = true;

      // Find all line number cells in the visible range and add a bar
      const lineEls = file.querySelectorAll(
        '[data-linenumber], .diff-line-num:not(.empty-cell)',
      );

      for (const el of lineEls) {
        const lineNum = parseInt(
          el.getAttribute('data-linenumber') || el.textContent?.trim() || '',
          10,
        );
        if (isNaN(lineNum) || lineNum < viewerFile.firstLine || lineNum > viewerFile.lastLine) {
          continue;
        }

        // Find the parent row (tr or diff-line wrapper)
        const row = el.closest('tr, .diff-tr, .line_holder');
        if (!row) continue;
        // Don't double-mark the same row for the same viewer
        if (row.querySelector(`[${GUTTER_ATTR}="${viewer.userId}"]`)) continue;

        const bar = document.createElement('span');
        bar.setAttribute(GUTTER_ATTR, viewer.userId);
        bar.style.cssText = `
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 2px;
          background: ${color};
          opacity: 0.4;
          pointer-events: none;
          z-index: 1;
        `;

        // The row needs relative positioning for the absolute bar
        const rowEl = row as HTMLElement;
        if (getComputedStyle(rowEl).position === 'static') {
          rowEl.style.position = 'relative';
        }
        rowEl.appendChild(bar);
        bars.push(bar);

        // Pin a mini avatar bubble to the first row of this viewer's range
        if (isFirstRow) {
          isFirstRow = false;
          const bubble = createGutterBubble(viewer, color, isDark, brandHue);
          rowEl.appendChild(bubble);
          bars.push(bubble);
        }
      }
    }

    if (bars.length > 0) {
      injectedGutterBars.set(filePath, bars);
    }
  }
}

/**
 * Create a small avatar bubble pinned to the left gutter at the start
 * of a viewer's line range. Shows who is looking at this section.
 */
function createGutterBubble(viewer: ViewerPresence, color: string, isDark: boolean, brandHue: number = DEFAULT_HUE): HTMLElement {
  const bubble = document.createElement('span');
  bubble.setAttribute(GUTTER_ATTR, `${viewer.userId}-bubble`);
  bubble.title = `${tooltipFor(viewer)} is viewing here`;

  bubble.style.cssText = `
    position: absolute;
    left: 4px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px 1px 1px;
    border-radius: 10px;
    background: ${isDark ? '#21262d' : '#f6f8fa'};
    border: 1px solid ${isDark ? '#30363d' : '#d0d7de'};
    box-shadow: 0 1px 3px ${isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.1)'};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    white-space: nowrap;
    pointer-events: auto;
    cursor: default;
  `;

  // Mini avatar (14px)
  if (viewer.avatarUrl) {
    const img = document.createElement('img');
    img.src = viewer.avatarUrl;
    img.alt = initialsFor(viewer.displayName, viewer.userId);
    img.style.cssText = `
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 1.5px solid ${color};
      object-fit: cover;
      flex-shrink: 0;
    `;
    img.onerror = () => {
      const fallback = createMiniBubbleInitials(viewer, color, isDark, brandHue);
      img.replaceWith(fallback);
    };
    bubble.appendChild(img);
  } else {
    bubble.appendChild(createMiniBubbleInitials(viewer, color, isDark, brandHue));
  }

  // Name label
  const label = document.createElement('span');
  label.textContent = viewer.displayName
    ? viewer.displayName.split(/\s+/)[0] // First name only to keep it compact
    : viewer.userId;
  label.style.cssText = `
    font-size: 10px;
    font-weight: 500;
    color: ${isDark ? '#c9d1d9' : '#24292f'};
    line-height: 1;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
  `;
  bubble.appendChild(label);

  return bubble;
}

function createMiniBubbleInitials(viewer: ViewerPresence, color: string, isDark: boolean, brandHue: number = DEFAULT_HUE): HTMLElement {
  const dot = document.createElement('span');
  dot.textContent = initialsFor(viewer.displayName, viewer.userId);
  dot.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${color};
    color: ${isDark ? hslToHex(brandHue, 30, 11) : '#ffffff'};
    font-size: 7px;
    font-weight: 600;
    line-height: 1;
    flex-shrink: 0;
    border: 1.5px solid ${color};
  `;
  return dot;
}

function removeGutterBarsForFile(filePath: string): void {
  const bars = injectedGutterBars.get(filePath);
  if (bars) {
    for (const bar of bars) {
      if (bar.isConnected) bar.remove();
    }
    injectedGutterBars.delete(filePath);
  }
}

function removeAllGutterBars(): void {
  for (const [filePath] of injectedGutterBars) {
    removeGutterBarsForFile(filePath);
  }
}

// ---------------------------------------------------------------------------
// Injection logic
// ---------------------------------------------------------------------------

function findDiffFileHeaders(): Array<{ el: Element; filePath: string }> {
  const results: Array<{ el: Element; filePath: string }> = [];
  const files = document.querySelectorAll('.diff-file.file-holder');

  for (const file of files) {
    const filePath = file.getAttribute('data-path');
    if (!filePath) continue;

    // Inject into the file header — look for the file title area
    const header = file.querySelector(
      '.file-header-content, .file-title-name, .diff-file-header .file-header-content',
    );
    if (header) {
      results.push({ el: header, filePath });
    }
  }

  return results;
}

function injectPresence(isDark: boolean, brandHue: number = DEFAULT_HUE): void {
  guardedMutation(() => {
    const headers = findDiffFileHeaders();

    for (const { el, filePath } of headers) {
      const viewers = getViewersForFile(filePath);

      const existing = injectedContainers.get(filePath);

      if (viewers.length === 0) {
        // No viewers — remove container if it exists
        if (existing?.isConnected) {
          existing.remove();
        }
        injectedContainers.delete(filePath);
        continue;
      }

      // Build the new container
      const newContainer = createPresenceContainer(viewers, filePath, isDark, brandHue);

      if (existing?.isConnected) {
        // Replace existing
        existing.replaceWith(newContainer);
      } else {
        // Inject new — append to the header element
        el.appendChild(newContainer);
      }
      injectedContainers.set(filePath, newContainer);
    }

    // Gutter bars for line-range visualization
    injectGutterBars(isDark, brandHue);
  });
}

function pruneDetached(): void {
  for (const [filePath, container] of injectedContainers) {
    if (!container.isConnected) {
      injectedContainers.delete(filePath);
    }
  }
  // Prune gutter bars whose parent rows were detached (virtual scrolling)
  for (const [filePath, bars] of injectedGutterBars) {
    const live = bars.filter((b) => b.isConnected);
    if (live.length === 0) {
      injectedGutterBars.delete(filePath);
    } else if (live.length !== bars.length) {
      injectedGutterBars.set(filePath, live);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start injecting presence avatars into diff file headers.
 * Returns a cleanup function.
 */
export function startPresenceInjection(isDarkMode: boolean, signal?: AbortSignal, brandHue: number = DEFAULT_HUE): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function update() {
    const health = getHealthLevel();
    if (health === 'degraded' || health === 'critical') return;

    pruneDetached();
    injectPresence(isDarkMode, brandHue);
  }

  function debouncedUpdate() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(update, 200);
  }

  // Track previous viewers reference to skip unrelated store updates
  let prevViewers = usePresenceStore.getState().viewers;

  // Initial injection
  if (prevViewers.size > 0) {
    update();
  }

  // Subscribe to presence store — only fires on presence changes
  const unsubscribe = usePresenceStore.subscribe((state) => {
    if (state.viewers === prevViewers) return;
    dbg(`presence changed: ${prevViewers.size} → ${state.viewers.size} viewers`);
    prevViewers = state.viewers;
    debouncedUpdate();
  });

  // MutationObserver for new diff files (lazy loading / virtual scrolling).
  // When new .diff-file elements appear, re-inject presence for them.
  const observer = new MutationObserver((mutations) => {
    // Only react if new diff files were added
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
    if (!hasNewFiles) return;

    // Only re-inject if we have presence data
    if (usePresenceStore.getState().viewers.size > 0) {
      debouncedUpdate();
    }
  });

  const container = document.querySelector('.diff-files-holder') || document.body;
  observer.observe(container, { childList: true, subtree: true });

  // Visibility change handler
  const visibilityHandler = () => {
    if (document.visibilityState === 'visible' && usePresenceStore.getState().viewers.size > 0) {
      update();
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  function cleanup() {
    unsubscribe();
    observer.disconnect();
    document.removeEventListener('visibilitychange', visibilityHandler);
    if (debounceTimer) clearTimeout(debounceTimer);

    // Remove all injected containers
    for (const [, el] of injectedContainers) {
      if (el.isConnected) el.remove();
    }
    injectedContainers.clear();

    // Remove all gutter bars
    removeAllGutterBars();
  }

  if (signal) {
    signal.addEventListener('abort', cleanup, { once: true });
  }

  return cleanup;
}
