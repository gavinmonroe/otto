// ---------------------------------------------------------------------------
// Content Script Entry — GitLab MR Diff Page
//
// This is the main entry point for Otto's content script. It:
// 1. Detects if we're on a GitLab MR diffs page
// 2. Waits for the diffs tab to become active
// 3. Builds the MR context from the page
// 4. Mounts the Otto UI via shadow DOM
// 5. Observes for new diff files (lazy loading) and injects per-file UI
//
// Design decisions:
// - Uses WXT's createShadowRootUi for CSS isolation from GitLab.
// - Mounts a single shadow root for the overview panel above the diffs.
// - Mounts individual shadow roots per diff file for file-level review cards.
// - Detects GitLab's dark mode and applies matching theme to Otto UI.
// - Handles SPA navigation via URL change detection.
// - All cleanup is tied to the ContentScriptContext for automatic teardown
//   when the extension is updated or the page navigates away.
// ---------------------------------------------------------------------------

import './style.css';
import { createRoot } from 'react-dom/client';
import { parseMrUrl, waitForDiffsTab, observeDiffFiles, isDiffsTabActive } from '@/lib/dom-observer';
import { buildMrContext } from '@/services/gitlab/mr-parser';
import { useReviewStore } from '@/services/review/review-store';
import { MrOverviewPanel } from '@/components/review/MrOverviewPanel';
import { FileReviewCard } from '@/components/review/FileReviewCard';
import { ThemeProvider } from '@/components/ThemeContext';
import { createElement } from 'react';

export default defineContentScript({
  matches: ['*://*/*'],  // Match all URLs — we filter at runtime for self-hosted support
  runAt: 'document_idle',
  cssInjectionMode: 'ui',

  async main(ctx) {
    // Check if this is a GitLab MR page
    const urlInfo = parseMrUrl(window.location.href);
    if (!urlInfo) return;

    // Wait for the diffs tab to be active
    const diffsContainer = await waitForDiffsTab(ctx.signal);
    if (!diffsContainer) return;

    // Detect GitLab dark mode
    const isDarkMode = detectDarkMode();

    // Build MR context from the page + API
    const mrContext = await buildMrContext(true);
    if (!mrContext) return;

    // Set the context in the store
    useReviewStore.getState().setMrContext(mrContext);

    // Mount the overview panel above the diff files
    await mountOverviewPanel(ctx, isDarkMode);

    // Observe and inject per-file review cards
    const cleanupObserver = observeDiffFiles((fileElement, filePath) => {
      mountFileReviewCard(ctx, fileElement, filePath, isDarkMode);
    }, ctx.signal);

    // Handle SPA navigation — re-initialize if URL changes to a different MR
    ctx.addEventListener(window, 'wxt:locationchange', async (event) => {
      const newUrlInfo = parseMrUrl(event.newUrl.href);
      if (!newUrlInfo) return;

      // Different MR — reset and re-initialize
      if (newUrlInfo.mrIid !== urlInfo.mrIid || newUrlInfo.projectPath !== urlInfo.projectPath) {
        useReviewStore.getState().reset();
        const newContext = await buildMrContext(true);
        if (newContext) {
          useReviewStore.getState().setMrContext(newContext);
        }
      }
    });
  },
});

// ---------------------------------------------------------------------------
// Mount helpers
// ---------------------------------------------------------------------------

async function mountOverviewPanel(
  ctx: typeof ContentScriptContext.prototype,
  isDarkMode: boolean,
): Promise<void> {
  const anchor = document.querySelector('.diff-files-holder');
  if (!anchor) return;

  // Don't double-mount
  if (anchor.querySelector('[data-otto-overview]')) return;

  const ui = await createShadowRootUi(ctx, {
    name: 'otto-overview',
    position: 'inline',
    anchor,
    append: 'first',
    onMount: (container) => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-otto-overview', 'true');
      container.append(wrapper);
      const root = createRoot(wrapper);
      root.render(createElement(ThemeProvider, { isDark: isDarkMode, children: createElement(MrOverviewPanel) }));
      return root;
    },
    onRemove: (root) => root?.unmount(),
  });

  ui.mount();
}

function mountFileReviewCard(
  ctx: typeof ContentScriptContext.prototype,
  fileElement: Element,
  filePath: string,
  isDarkMode: boolean,
): void {
  // Find the file actions area in the header
  const fileActions = fileElement.querySelector('.file-actions');
  if (!fileActions) return;

  // Don't double-mount
  if (fileActions.querySelector('[data-otto-file-review]')) return;

  // Create a container for the Otto button/card
  const ottoContainer = document.createElement('div');
  ottoContainer.setAttribute('data-otto-file-review', filePath);
  ottoContainer.style.display = 'inline-flex';
  ottoContainer.style.alignItems = 'center';
  ottoContainer.style.marginRight = '4px';

  // Insert before the existing actions
  fileActions.insertBefore(ottoContainer, fileActions.firstChild);

  // Mount React into a shadow root inside our container
  const shadow = ottoContainer.attachShadow({ mode: 'open' });

  // Inject styles into the shadow root
  const styleEl = document.createElement('style');
  // We'll inject a minimal inline style for the button since this is a small mount point.
  // The full review card (when expanded) will use the main shadow root approach.
  styleEl.textContent = getFileReviewButtonStyles(isDarkMode);
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  if (isDarkMode) mountPoint.classList.add('dark');
  shadow.appendChild(mountPoint);

  const root = createRoot(mountPoint);
  root.render(createElement(ThemeProvider, { isDark: isDarkMode, children: createElement(FileReviewCard, { filePath }) }));

  // Cleanup on context invalidation
  ctx.signal.addEventListener('abort', () => {
    root.unmount();
    ottoContainer.remove();
  }, { once: true });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function detectDarkMode(): boolean {
  // GitLab applies theme classes to the body or html element
  const body = document.body;
  const html = document.documentElement;

  // Check for GitLab's dark mode indicators
  if (body.classList.contains('gl-dark') || html.classList.contains('gl-dark')) return true;
  if (body.getAttribute('data-color-scheme') === 'dark') return true;

  // Check computed background color as fallback
  const bgColor = getComputedStyle(body).backgroundColor;
  if (bgColor) {
    const match = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const brightness = (parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3])) / 3;
      if (brightness < 128) return true;
    }
  }

  return false;
}

function getFileReviewButtonStyles(isDarkMode: boolean): string {
  const bg = isDarkMode ? '#1f2937' : '#f0f7ff';
  const bgHover = isDarkMode ? '#374151' : '#e0effe';
  const text = isDarkMode ? '#93c5fd' : '#0074c5';
  const border = isDarkMode ? '#374151' : '#bae0fd';

  return `
    :host { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; }
    .otto-file-btn {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 4px;
      background: ${bg}; color: ${text}; border: 1px solid ${border};
      cursor: pointer; font-size: 12px; font-weight: 500;
      transition: background 0.15s;
    }
    .otto-file-btn:hover { background: ${bgHover}; }
    .otto-file-btn svg { width: 14px; height: 14px; }
    .otto-review-panel {
      position: absolute; right: 0; top: 100%; z-index: 100;
      min-width: 400px; max-width: 600px; max-height: 500px;
      overflow-y: auto; background: ${isDarkMode ? '#111827' : '#ffffff'};
      border: 1px solid ${border}; border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 12px;
      color: ${isDarkMode ? '#e5e7eb' : '#1f2937'};
    }
    .otto-comment { padding: 8px 0; border-bottom: 1px solid ${border}; }
    .otto-comment:last-child { border-bottom: none; }
    .otto-severity { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; }
    .otto-severity-critical { background: #fecaca; color: #991b1b; }
    .otto-severity-warning { background: #fef3c7; color: #92400e; }
    .otto-severity-suggestion { background: #dbeafe; color: #1e40af; }
    .otto-severity-info { background: #e0e7ff; color: #3730a3; }
    .otto-comment-title { font-weight: 600; margin: 4px 0 2px; }
    .otto-comment-body { font-size: 12px; line-height: 1.5; }
    .otto-comment-actions { display: flex; gap: 4px; margin-top: 6px; }
    .otto-action-btn {
      padding: 2px 8px; border-radius: 3px; font-size: 11px;
      cursor: pointer; border: 1px solid ${border};
      background: transparent; color: ${text};
    }
    .otto-action-btn:hover { background: ${bgHover}; }
    .otto-action-btn-accept { background: #dcfce7; color: #166534; border-color: #86efac; }
    .otto-action-btn-dismiss { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
    .otto-loading { display: flex; align-items: center; gap: 6px; padding: 8px; color: ${text}; }
    .otto-spinner { width: 14px; height: 14px; border: 2px solid ${border}; border-top-color: ${text}; border-radius: 50%; animation: otto-spin 0.6s linear infinite; }
    @keyframes otto-spin { to { transform: rotate(360deg); } }
    .otto-empty { padding: 8px; text-align: center; color: ${isDarkMode ? '#6b7280' : '#9ca3af'}; font-size: 12px; }
    .otto-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; font-size: 11px; font-weight: 600; }
    .otto-badge-count { background: ${text}; color: ${isDarkMode ? '#111827' : '#ffffff'}; }
  `;
}
