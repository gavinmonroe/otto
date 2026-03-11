// ---------------------------------------------------------------------------
// Content Script Entry — GitLab MR Diff Page
//
// Mounts three types of UI into the GitLab page:
// 1. MrOverviewPanel — above the diff file list (summary, controls)
// 2. FileReviewCard — button in each diff file's header (trigger review)
// 3. FileReviewFooter — collapsible sections in each diff file's footer
//    (review results appear here, inline with the diff)
// ---------------------------------------------------------------------------

import './style.css';
import { createRoot } from 'react-dom/client';
import { parseMrUrl, waitForDiffsTab, observeDiffFiles } from '@/lib/dom-observer';
import { buildMrContext } from '@/services/gitlab/mr-parser';
import { useReviewStore } from '@/services/review/review-store';
import { startReviewStream, tryLoadCachedReview } from '@/services/review/stream-dispatcher';
import { sendMessage } from '@/lib/messaging';
import { MrOverviewPanel } from '@/components/review/MrOverviewPanel';
import { FileReviewCard } from '@/components/review/FileReviewCard';
import { FileReviewFooter } from '@/components/review/FileReviewFooter';
import { ThemeProvider } from '@/components/ThemeContext';
import { OttoErrorBoundary } from '@/components/OttoErrorBoundary';
import { startInlineCommentInjection } from '@/services/review/inline-injector';
import { startRelatedFilesSidebar } from '@/services/review/sidebar-injector';
import { createElement } from 'react';
import type { ReviewTask } from '@/services/review/review-types';

export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',

  async main(ctx) {
    const urlInfo = parseMrUrl(window.location.href);
    if (!urlInfo) return;

    const diffsContainer = await waitForDiffsTab(ctx.signal);
    if (!diffsContainer) return;

    const isDarkMode = detectDarkMode();

    const mrContext = await buildMrContext(true);
    if (!mrContext) return;

    useReviewStore.getState().setMrContext(mrContext);

    await mountOverviewPanel(ctx, isDarkMode);

    observeDiffFiles((fileElement, filePath) => {
      mountFileReviewCard(ctx, fileElement, filePath, isDarkMode);
      mountFileReviewFooter(ctx, fileElement, filePath, isDarkMode);
    }, ctx.signal);

    // Inject inline comments next to diff lines as reviews complete
    startInlineCommentInjection(isDarkMode, ctx.signal);

    // Inject related files into GitLab's sidebar file tree
    startRelatedFilesSidebar(isDarkMode, ctx.signal);

    // Load cached review or auto-review if preference is enabled
    await loadOrAutoReview(mrContext);

    ctx.addEventListener(window, 'wxt:locationchange', async (event) => {
      const newUrlInfo = parseMrUrl(event.newUrl.href);
      if (!newUrlInfo) return;
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
      root.render(createElement(ThemeProvider, { isDark: isDarkMode, children: createElement(OttoErrorBoundary, { name: 'Overview' }, createElement(MrOverviewPanel)) }));
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
  const fileActions = fileElement.querySelector('.file-actions');
  if (!fileActions) return;
  if (fileActions.querySelector('[data-otto-file-review]')) return;

  const ottoContainer = document.createElement('div');
  ottoContainer.setAttribute('data-otto-file-review', filePath);
  ottoContainer.style.display = 'inline-flex';
  ottoContainer.style.alignItems = 'center';
  ottoContainer.style.marginRight = '4px';

  fileActions.insertBefore(ottoContainer, fileActions.firstChild);

  const shadow = ottoContainer.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = getButtonStyles(isDarkMode);
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  const root = createRoot(mountPoint);
  root.render(createElement(ThemeProvider, { isDark: isDarkMode, children: createElement(OttoErrorBoundary, { name: 'FileReview' }, createElement(FileReviewCard, { filePath })) }));

  ctx.signal.addEventListener('abort', () => {
    root.unmount();
    ottoContainer.remove();
  }, { once: true });
}

/**
 * Mount the review footer at the bottom of each diff file.
 * This is where review results appear as collapsible sections.
 */
function mountFileReviewFooter(
  ctx: typeof ContentScriptContext.prototype,
  fileElement: Element,
  filePath: string,
  isDarkMode: boolean,
): void {
  // Find the diff content area — footer goes after it
  const diffContent = fileElement.querySelector('.diff-content');
  if (!diffContent) return;
  if (fileElement.querySelector('[data-otto-file-footer]')) return;

  const footerContainer = document.createElement('div');
  footerContainer.setAttribute('data-otto-file-footer', filePath);

  // Append after the diff content, still inside the .diff-file
  diffContent.insertAdjacentElement('afterend', footerContainer);

  const shadow = footerContainer.attachShadow({ mode: 'open' });

  // Inject minimal reset styles for the footer shadow DOM
  const styleEl = document.createElement('style');
  styleEl.textContent = getFooterResetStyles();
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  const root = createRoot(mountPoint);
  root.render(createElement(ThemeProvider, { isDark: isDarkMode, children: createElement(OttoErrorBoundary, { name: 'FileFooter' }, createElement(FileReviewFooter, { filePath })) }));

  ctx.signal.addEventListener('abort', () => {
    root.unmount();
    footerContainer.remove();
  }, { once: true });
}

function detectDarkMode(): boolean {
  const body = document.body;
  const html = document.documentElement;

  if (body.classList.contains('gl-dark') || html.classList.contains('gl-dark')) return true;
  if (body.getAttribute('data-color-scheme') === 'dark') return true;

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

function getButtonStyles(isDarkMode: boolean): string {
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
    .otto-file-btn:hover:not(:disabled) { background: ${bgHover}; }
    .otto-file-btn:disabled { cursor: default; }
    .otto-file-btn svg { width: 14px; height: 14px; }
    .otto-spinner { width: 14px; height: 14px; border: 2px solid ${border}; border-top-color: ${text}; border-radius: 50%; animation: otto-spin 0.6s linear infinite; display: inline-block; }
    @keyframes otto-spin { to { transform: rotate(360deg); } }
    .otto-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; font-size: 11px; font-weight: 600; }
    .otto-badge-count { background: ${text}; color: ${isDarkMode ? '#111827' : '#ffffff'}; }
  `;
}

function getFooterResetStyles(): string {
  return `
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    button { font-family: inherit; }
  `;
}

// ---------------------------------------------------------------------------
// Auto-review — triggers a review automatically on page load if the
// user has enabled the preference and has an AI provider configured.
// ---------------------------------------------------------------------------

async function loadOrAutoReview(mrContext: import('@/types/review').MrContext): Promise<void> {
  // Try loading from cache first
  const cached = await tryLoadCachedReview(mrContext);
  if (cached) return; // Cache hit — no need to call AI

  const settingsResult = await sendMessage({ type: 'GET_SETTINGS' });
  if (!settingsResult.ok) return;

  const settings = settingsResult.data;
  if (!settings.preferences.autoReview) return;
  if (!settings.ai.baseUrl) return;

  const hasGitLabHost = settings.gitlab.hosts.some(
    (h) => mrContext.hostUrl.toLowerCase().startsWith(h.url.toLowerCase()),
  );
  const tasks: ReviewTask[] = ['summary', 'codeReview', 'edgeCases'];
  if (hasGitLabHost) tasks.push('relatedFiles');

  startReviewStream(mrContext, tasks);
}
