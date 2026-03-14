// ---------------------------------------------------------------------------
// DOM Observer utilities for GitLab MR pages.
//
// GitLab is a Vue SPA that lazy-loads diff files in batches and may use
// virtual scrolling. We need robust observation to:
// 1. Detect when the diffs tab becomes active (SPA navigation)
// 2. Detect when new .diff-file elements are added (lazy loading)
// 3. Re-inject UI when virtual scrolling destroys and recreates elements
// 4. Clean up observers when the content script context is invalidated
//
// Design decisions:
// - All observers accept an AbortSignal for cleanup. This integrates with
//   WXT's ContentScriptContext which provides an abort signal when the
//   extension is updated or the content script is invalidated.
// - Callbacks are debounced to avoid excessive re-renders during batch loads.
// - We observe specific containers (not document.body) to minimize overhead.
// ---------------------------------------------------------------------------

import { getHealthLevel } from '@/services/review/health-monitor';

/**
 * Watch for new .diff-file elements appearing in the DOM.
 * Calls `onFile` for each new file, including files already present when
 * observation starts.
 *
 * Returns a cleanup function.
 */
export function observeDiffFiles(
  onFile: (fileElement: Element, filePath: string) => void,
  signal?: AbortSignal,
): () => void {
  const processed = new Set<string>();

  function processDiffFile(el: Element) {
    const filePath = el.getAttribute('data-path');
    const fileHash = el.id;
    const key = fileHash || filePath || '';
    if (!key || processed.has(key)) return;

    // Also check if Otto is already injected (handles re-created elements
    // that got a new hash but same path)
    if (filePath && el.querySelector('[data-otto-file-review], [data-otto-file-footer]')) {
      processed.add(key);
      return;
    }

    processed.add(key);
    if (filePath) {
      onFile(el, filePath);
    }
  }

  function scanExisting() {
    const files = document.querySelectorAll('.diff-file.file-holder');
    files.forEach(processDiffFile);
  }

  /**
   * Rescan for diff files that are missing Otto injections.
   * Handles virtual scrolling re-creation and tab visibility changes
   * where elements are destroyed and recreated without triggering mutations.
   */
  function rescanForMissing() {
    const files = document.querySelectorAll('.diff-file.file-holder');
    for (const el of files) {
      const filePath = el.getAttribute('data-path');
      if (!filePath) continue;

      // Check if this element has Otto injections
      const hasCard = el.querySelector('[data-otto-file-review]');
      const hasFooter = el.querySelector('[data-otto-file-footer]');

      if (!hasCard || !hasFooter) {
        // Remove from processed so it gets re-injected
        const key = el.id || filePath;
        processed.delete(key);
        processDiffFile(el);
      }
    }
  }

  // Process files already in the DOM
  scanExisting();

  // Watch for new files (lazy loading, virtual scrolling re-creation)
  // and handle removals (virtual scrolling destroys elements).
  // Single observer handles both — avoids two observers on the same container
  // with identical options, which doubles mutation processing overhead.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.diff-file.file-holder')) {
          processDiffFile(node);
        }
        const nested = node.querySelectorAll('.diff-file.file-holder');
        nested.forEach(processDiffFile);
      }
      for (const node of mutation.removedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.diff-file.file-holder')) {
          const key = node.id || node.getAttribute('data-path') || '';
          processed.delete(key);
        }
      }
    }
  });

  const container = document.querySelector('.diff-files-holder') || document.body;
  observer.observe(container, { childList: true, subtree: true });

  // Periodic rescan — catches virtual scrolling edge cases where
  // elements are recreated without triggering mutation observers.
  // Skipped in critical health to reduce main thread pressure.
  const rescanInterval = setInterval(() => {
    if (getHealthLevel() === 'critical') return;
    rescanForMissing();
  }, 3000);

  // Rescan when tab becomes visible again — GitLab may re-render
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      // Small delay to let GitLab finish re-rendering
      setTimeout(rescanForMissing, 500);
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);

  function cleanup() {
    observer.disconnect();
    clearInterval(rescanInterval);
    document.removeEventListener('visibilitychange', handleVisibility);
    processed.clear();
  }

  if (signal) {
    signal.addEventListener('abort', cleanup, { once: true });
  }

  return cleanup;
}

/**
 * Wait for the diffs tab to become active.
 * Resolves immediately if already active, otherwise waits for it.
 *
 * Returns a cleanup function that cancels the wait.
 */
export function waitForDiffsTab(signal?: AbortSignal): Promise<Element | null> {
  return new Promise((resolve) => {
    // Check if already active
    const existing = document.querySelector('#diffs.active, #diffs .diff-files-holder');
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector('#diffs.active, #diffs .diff-files-holder');
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    if (signal) {
      signal.addEventListener('abort', () => {
        observer.disconnect();
        resolve(null);
      }, { once: true });
    }
  });
}

/**
 * Extract the MR URL components from the current page URL.
 * Returns null if the current page is not a GitLab MR diffs page.
 */
export function parseMrUrl(url: string): { hostUrl: string; projectPath: string; mrIid: number } | null {
  // Match: https://host/namespace/project/-/merge_requests/123/diffs
  // Also match nested groups: https://host/group/subgroup/project/-/merge_requests/123/diffs
  const match = url.match(/^(https?:\/\/[^/]+)\/(.+)\/-\/merge_requests\/(\d+)(?:\/diffs)?/);
  if (!match) return null;
  return {
    hostUrl: match[1],
    projectPath: match[2],
    mrIid: parseInt(match[3], 10),
  };
}

/**
 * Check if the current page is on the diffs/changes tab.
 * Handles both URL-based detection and SPA tab state.
 */
export function isDiffsTabActive(): boolean {
  // URL-based: path ends with /diffs
  if (window.location.pathname.endsWith('/diffs')) return true;
  // SPA-based: the #diffs element has the active class
  const diffsTab = document.querySelector('#diffs');
  if (diffsTab?.classList.contains('active')) return true;
  return false;
}
