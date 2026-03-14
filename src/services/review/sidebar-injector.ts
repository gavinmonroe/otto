// ---------------------------------------------------------------------------
// RelatedFilesSidebar — injects an "Otto: Related Files" section into
// GitLab's MR file tree sidebar (left panel on the Changes tab).
//
// Subscribes to the review store and renders related files as clickable
// entries below GitLab's own changed file list. Each entry links to the
// file on GitLab and supports inline preview via GitLabFileLink.
//
// Design decisions:
// - Injected into GitLab's sidebar DOM, not as a floating panel.
// - Uses shadow DOM for CSS isolation.
// - Subscribes to store — appears automatically when related files arrive.
// - Styled to blend with GitLab's native file tree entries.
// ---------------------------------------------------------------------------

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemeProvider } from '@/components/ThemeContext';
import { OttoErrorBoundary } from '@/components/OttoErrorBoundary';
import { useReviewStore } from '@/services/review/review-store';
import { RelatedFilesSidebarPanel } from '@/components/review/RelatedFilesSidebarPanel';
import { ReviewQueuePanel } from '@/components/review/ReviewQueuePanel';

const SIDEBAR_ATTR = 'data-otto-related-sidebar';

let sidebarRoot: Root | null = null;
let sidebarContainer: HTMLElement | null = null;

/**
 * Known GitLab sidebar selectors across versions.
 * We try each in order until one matches.
 */
const SIDEBAR_SELECTORS = [
  '.mr-tree-list',           // GitLab 15+
  '.diff-tree-list',         // Older GitLab
  '[data-testid="file-tree-container"]', // Modern testid-based
  '.file-browser',           // Some self-hosted versions
];

/**
 * Start watching for the sidebar to appear and inject related files.
 * Returns an unsubscribe/cleanup function.
 */
export function startRelatedFilesSidebar(isDarkMode: boolean, signal?: AbortSignal): () => void {
  let injected = false;

  // Track previous references to skip unrelated store updates.
  // Without this, every streaming delta triggers a full sidebar re-render.
  let prevRelatedFiles = useReviewStore.getState().relatedFiles;
  let prevFileReviews = useReviewStore.getState().fileReviews;

  const unsubscribe = useReviewStore.subscribe((state) => {
    // Only act when relatedFiles or fileReviews references change
    if (state.relatedFiles === prevRelatedFiles && state.fileReviews === prevFileReviews) return;
    prevRelatedFiles = state.relatedFiles;
    prevFileReviews = state.fileReviews;

    const hasContent = state.relatedFiles.length > 0 || state.fileReviews.length > 0;
    if (!hasContent) return;
    if (injected) {
      // Re-render with updated data
      renderSidebar(isDarkMode);
      return;
    }

    // Try to find and inject into the sidebar
    const sidebarEl = findSidebar();
    if (sidebarEl) {
      injectSidebar(sidebarEl, isDarkMode);
      injected = true;
    }
  });

  // Also observe DOM for sidebar appearing (GitLab lazy-loads it)
  let sidebarScanTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    if (injected) return;
    if (sidebarScanTimer) return;
    sidebarScanTimer = setTimeout(() => {
      sidebarScanTimer = null;
      const state = useReviewStore.getState();
      const hasContent = state.relatedFiles.length > 0 || state.fileReviews.length > 0;
      if (!hasContent) return;

      const sidebarEl = findSidebar();
      if (sidebarEl) {
        injectSidebar(sidebarEl, isDarkMode);
        injected = true;
        observer.disconnect();
      }
    }, 200);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  function cleanup() {
    unsubscribe();
    observer.disconnect();
    if (sidebarScanTimer) clearTimeout(sidebarScanTimer);
    if (sidebarRoot) {
      sidebarRoot.unmount();
      sidebarRoot = null;
    }
    if (sidebarContainer) {
      sidebarContainer.remove();
      sidebarContainer = null;
    }
    injected = false;
  }

  if (signal) {
    signal.addEventListener('abort', cleanup, { once: true });
  }

  return cleanup;
}

function findSidebar(): Element | null {
  for (const selector of SIDEBAR_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function injectSidebar(sidebarEl: Element, isDarkMode: boolean): void {
  if (sidebarEl.querySelector(`[${SIDEBAR_ATTR}]`)) return;

  sidebarContainer = document.createElement('div');
  sidebarContainer.setAttribute(SIDEBAR_ATTR, 'true');
  sidebarEl.appendChild(sidebarContainer);

  const shadow = sidebarContainer.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = getSidebarStyles();
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  sidebarRoot = createRoot(mountPoint);
  renderSidebar(isDarkMode);
}

function renderSidebar(isDarkMode: boolean): void {
  if (!sidebarRoot) return;
  sidebarRoot.render(
    createElement(ThemeProvider, {
      isDark: isDarkMode,
      children: createElement('div', null,
        createElement(OttoErrorBoundary, { name: 'ReviewQueue' },
          createElement(ReviewQueuePanel),
        ),
        createElement(OttoErrorBoundary, { name: 'RelatedFiles' },
          createElement(RelatedFilesSidebarPanel),
        ),
      ),
    }),
  );
}

function getSidebarStyles(): string {
  return `
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    button { font-family: inherit; }
    a { text-decoration: none; }
  `;
}
