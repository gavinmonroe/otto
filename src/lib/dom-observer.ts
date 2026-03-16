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

import { isOttoMutating } from '@/lib/dom-guard';
import { getHealthLevel } from '@/services/review/health-monitor';

const DEBUG = true;
function dbg(msg: string, ...args: any[]) {
  if (DEBUG) console.log(`[Otto:dom-observer] ${msg}`, ...args);
}

/**
 * Check if an element is in or near the viewport (within 1 screen height).
 * Used to prioritize visible files over off-screen ones.
 */
function isNearViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const margin = window.innerHeight;
  return rect.bottom > -margin && rect.top < window.innerHeight + margin;
}

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
  // Also track by filePath — virtual scrolling recreates elements with
  // new id hashes, but the data-path stays the same. Without this,
  // the same file gets re-processed every time it's recreated.
  const processedPaths = new Set<string>();
  // Files where mounting failed (no .file-actions or .diff-content) —
  // don't keep retrying these on every rescan tick.
  const mountFailed = new Set<string>();
  // Queue of files waiting to be processed — batched via requestIdleCallback
  // to prevent 20+ shadow DOM + React root creations from locking the main
  // thread when the user scrolls rapidly through a large MR.
  const pendingFiles: Array<{ el: Element; filePath: string }> = [];
  let batchScheduled = false;

  // Track scroll state — processing files during scroll is too expensive
  // because GitLab's virtual scrolling already stresses the tab. We defer
  // all file processing until scrolling stops.
  // Use document-level capture to catch scroll events from ANY container
  // (GitLab uses nested scrollable divs, not window scroll).
  let scrolling = false;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;

  function onScroll() {
    scrolling = true;
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrolling = false;

      // Clear mountFailed for visible files — they may have the required
      // DOM structure now (e.g., .file-actions loaded after initial attempt).
      // Also re-scan visible files that lost their injections (virtual scroll).
      const files = document.querySelectorAll('.diff-file.file-holder');
      for (const el of files) {
        if (!isNearViewport(el)) continue;
        const filePath = el.getAttribute('data-path');
        if (!filePath) continue;

        const key = el.id || filePath;

        // Clear mountFailed so the file gets another chance
        if (mountFailed.has(key) || mountFailed.has(filePath)) {
          mountFailed.delete(key);
          mountFailed.delete(filePath);
        }

        // If this visible file lost its injections, re-queue it
        const hasCard = el.querySelector('[data-otto-file-review]');
        const hasFooter = el.querySelector('[data-otto-file-footer]');
        if (!hasCard || !hasFooter) {
          processed.delete(key);
          processedPaths.delete(filePath);
          processDiffFile(el);
        }
      }

      // Process any pending files
      if (pendingFiles.length > 0) {
        dbg(`scroll stopped → processing ${pendingFiles.length} pending files`);
        scheduleBatch();
      }
    }, 500);
  }
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });

  function scheduleBatch() {
    if (batchScheduled) return;
    if (scrolling) return; // Don't process during scroll
    batchScheduled = true;
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(processBatch);
    } else {
      setTimeout(processBatch, 0);
    }
  }

  function processBatch(deadline?: IdleDeadline) {
    batchScheduled = false;

    // Don't process during scroll or health stress
    if (scrolling) return;
    const health = getHealthLevel();
    if (health === 'critical' || health === 'degraded') {
      if (pendingFiles.length > 0) {
        dbg(`processBatch deferred (health=${health}, ${pendingFiles.length} pending)`);
        setTimeout(scheduleBatch, 2000);
      }
      return;
    }

    // Prioritize files visible in the viewport — skip off-screen ones
    // (they'll be processed when the user scrolls to them and stops)
    const visibleIdx = pendingFiles.findIndex(({ el }) => el.isConnected && isNearViewport(el));
    if (visibleIdx === -1) {
      // Prune detached elements from the queue
      const before = pendingFiles.length;
      for (let i = pendingFiles.length - 1; i >= 0; i--) {
        if (!pendingFiles[i].el.isConnected) {
          // Element was destroyed — allow re-processing when it reappears
          processedPaths.delete(pendingFiles[i].filePath);
          pendingFiles.splice(i, 1);
        }
      }
      if (pendingFiles.length > 0) {
        dbg(`processBatch: ${pendingFiles.length} pending but none visible, waiting`);
      }
      return;
    }

    // Move visible file to front and process it
    const [item] = pendingFiles.splice(visibleIdx, 1);

    // Re-query the DOM for a fresh element — the queued reference may be stale
    // if virtual scrolling destroyed and recreated it between queueing and now
    let el = item.el;
    if (!el.isConnected) {
      const fresh = document.querySelector(`.diff-file.file-holder[data-path="${CSS.escape(item.filePath)}"]`);
      if (!fresh || !isNearViewport(fresh)) {
        processedPaths.delete(item.filePath);
        return;
      }
      el = fresh;
    }

    dbg('processDiffFile →', item.filePath);
    onFile(el, item.filePath);

    // Check if mounting actually succeeded — if not, mark as failed
    const hasCard = el.querySelector('[data-otto-file-review]');
    const hasFooter = el.querySelector('[data-otto-file-footer]');
    if (!hasCard || !hasFooter) {
      const key = el.id || item.filePath;
      mountFailed.add(key);
      dbg('mount incomplete for', item.filePath, `(card=${!!hasCard}, footer=${!!hasFooter})`);
    }

    // More visible files? Schedule another batch with a gap
    if (pendingFiles.some(({ el: e }) => e.isConnected && isNearViewport(e))) {
      setTimeout(scheduleBatch, 100);
    }
  }

  function processDiffFile(el: Element) {
    const filePath = el.getAttribute('data-path');
    const fileHash = el.id;
    const key = fileHash || filePath || '';
    if (!key || processed.has(key)) return;
    if (mountFailed.has(key) || (filePath && mountFailed.has(filePath))) return;

    // If this path was already processed but the element is new (virtual
    // scrolling recreated it), check if injections are present. If they
    // are, skip. If not, allow re-processing — the old React roots were
    // destroyed with the old element. This is safe because scroll detection
    // and health gating prevent processing during stress.
    if (filePath && processedPaths.has(filePath)) {
      if (el.querySelector('[data-otto-file-review], [data-otto-file-footer]')) {
        processed.add(key);
        return;
      }
      // Element was recreated without injections — allow re-processing
      dbg('re-injecting (virtual scroll recreated)', filePath);
    }

    processed.add(key);
    if (filePath) {
      processedPaths.add(filePath);
      pendingFiles.push({ el, filePath });
      scheduleBatch();
    }
  }

  function scanExisting() {
    const files = document.querySelectorAll('.diff-file.file-holder');
    files.forEach(processDiffFile);
  }



  // Process files already in the DOM
  scanExisting();

  // Watch for new files (lazy loading).
  // Virtual scrolling destroys and re-creates elements, but we do NOT
  // clear `processed` on removal — the file was already mounted and
  // re-creating React roots on every scroll direction change is the
  // primary cause of CPU spikes. The onFile callback is idempotent
  // (checks for existing [data-otto-*] attributes before mounting).
  //
  // Health-gated: when the tab is degraded or critical, skip processing
  // entirely. Files will be picked up naturally when scrolling stops
  // and health recovers — no active recovery rescan needed.

  const observer = new MutationObserver((mutations) => {
    if (isOttoMutating()) return;

    const health = getHealthLevel();
    if (health === 'critical' || health === 'degraded') return;

    let addedCount = 0;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.diff-file.file-holder')) {
          addedCount++;
          processDiffFile(node);
        }
        const nested = node.querySelectorAll('.diff-file.file-holder');
        addedCount += nested.length;
        nested.forEach(processDiffFile);
      }
      // Removals: intentionally ignored. Don't clear `processed` —
      // re-mounting on virtual scroll re-creation causes CPU spikes.
    }
    if (addedCount > 0) dbg(`MutationObserver: ${addedCount} diff-files added`);
  });

  const container = document.querySelector('.diff-files-holder') || document.body;
  observer.observe(container, { childList: true, subtree: true });

  // Rescan when tab becomes visible again — GitLab may re-render
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      setTimeout(scanExisting, 500);
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);

  function cleanup() {
    observer.disconnect();
    document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
    if (scrollTimer) clearTimeout(scrollTimer);
    document.removeEventListener('visibilitychange', handleVisibility);
    processed.clear();
    processedPaths.clear();
    mountFailed.clear();
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
