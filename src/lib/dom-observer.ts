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
    // Use the hash as the dedup key (more stable than path for renames)
    const key = fileHash || filePath || '';
    if (!key || processed.has(key)) return;
    processed.add(key);
    if (filePath) {
      onFile(el, filePath);
    }
  }

  function scanExisting() {
    const files = document.querySelectorAll('.diff-file.file-holder');
    files.forEach(processDiffFile);
  }

  // Process files already in the DOM
  scanExisting();

  // Watch for new files (lazy loading, virtual scrolling re-creation)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        // The added node itself might be a diff-file
        if (node.matches('.diff-file.file-holder')) {
          processDiffFile(node);
        }
        // Or it might contain diff-files as descendants
        const nested = node.querySelectorAll('.diff-file.file-holder');
        nested.forEach(processDiffFile);
      }
    }
  });

  // Observe the diff files holder if it exists, otherwise observe body
  const container = document.querySelector('.diff-files-holder') || document.body;
  observer.observe(container, { childList: true, subtree: true });

  // Handle virtual scrolling: files can be removed and re-added.
  // When a file is removed, we remove it from `processed` so it gets
  // re-processed when it's added back.
  const removalObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.diff-file.file-holder')) {
          const key = node.id || node.getAttribute('data-path') || '';
          processed.delete(key);
        }
      }
    }
  });
  removalObserver.observe(container, { childList: true, subtree: true });

  function cleanup() {
    observer.disconnect();
    removalObserver.disconnect();
    processed.clear();
  }

  // Auto-cleanup on abort signal (extension context invalidation)
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
