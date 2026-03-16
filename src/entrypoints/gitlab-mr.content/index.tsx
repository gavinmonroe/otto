// ---------------------------------------------------------------------------
// Content Script Entry — GitLab MR Page
//
// Mounts UI into the GitLab page:
// 1. FollowUpButton — on every comment's action bar (all tabs)
// 2. MrOverviewPanel — above the diff file list (diffs tab)
// 3. FileReviewCard — button in each diff file's header (diffs tab)
// 4. FileReviewFooter — collapsible sections in each diff file's footer
// 5. InlineCommentThread — review comments injected into diff rows
//
// The follow-up feature starts immediately on any MR page tab.
// The review/diff features wait for the diffs tab to become active.
// ---------------------------------------------------------------------------

import './style.css';
import { createRoot } from 'react-dom/client';
import { parseMrUrl, waitForDiffsTab, observeDiffFiles } from '@/lib/dom-observer';
import { buildMrContext } from '@/services/gitlab/mr-parser';
import { useReviewStore } from '@/services/review/review-store';
import { startReviewStream, tryLoadCachedReview, dispatchStreamChunk } from '@/services/review/stream-dispatcher';
import { sendMessage } from '@/lib/messaging';
import { setMrQueuePort, getMrQueuePort, disconnectMrQueuePort } from '@/services/review/queue-bridge';
import { MrOverviewPanel } from '@/components/review/MrOverviewPanel';
import { FileReviewCard } from '@/components/review/FileReviewCard';
import { FileReviewFooter } from '@/components/review/FileReviewFooter';
import { ThemeProvider } from '@/components/ThemeContext';
import { OttoErrorBoundary } from '@/components/OttoErrorBoundary';
import { startInlineCommentInjection } from '@/services/review/inline-injector';
import { startRelatedFilesSidebar } from '@/services/review/sidebar-injector';
import { startRiskInjection } from '@/services/review/risk-injector';
import { startFollowUpButtonInjection } from '@/services/followup/followup-injector';
import { startKeyboardManager } from '@/services/review/keyboard-manager';
import { ChatPill } from '@/components/chat/ChatPill';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatStore } from '@/services/chat/chat-store';
import { tryLoadCachedChat } from '@/services/chat/chat-stream-dispatcher';
import { createElement } from 'react';
import type { ReviewTask } from '@/services/review/review-types';
import type { OttoSettings } from '@/types/settings';
import { startHealthMonitor } from '@/services/review/health-monitor';
import { HealthWarningToast } from '@/components/review/HealthWarningToast';
import { guardedMutation } from '@/lib/dom-guard';
import { getBottoClient, disconnectBotto } from '@/lib/botto-client';
import { registerBottoTransport } from '@/lib/messaging';

export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',

  async main(ctx) {
    const urlInfo = parseMrUrl(window.location.href);
    if (!urlInfo) return;

    const isDarkMode = detectDarkMode();

    // Start health monitor early — before any heavy work begins.
    startHealthMonitor(ctx.signal);

    // Clean up Botto connection when the content script is invalidated
    // (page navigation, extension update, etc.)
    ctx.onInvalidated(() => {
      disconnectBotto();
    });

    // Fetch settings once upfront — used to gate features below.
    const settingsResult = await sendMessage({ type: 'GET_SETTINGS' });
    const settings: OttoSettings | null = settingsResult.ok ? settingsResult.data : null;
    const enabled = settings?.preferences.enabledFeatures;

    // Initialize Botto client if configured — must happen before any review streams.
    // Store settings on globalThis so stream-dispatcher can access them synchronously.
    if (settings) {
      (globalThis as any).__ottoSettings = settings;
      const bottoClient = getBottoClient(settings);
      if (bottoClient) {
        try {
          await bottoClient.connect();
          registerBottoTransport(() => bottoClient);
        } catch (e) {
          console.warn('[otto] Botto connection failed, falling back to local:', e);
        }
      }
    }

    // Build a lightweight MR context immediately (no API diff fetch).
    // This gives follow-up buttons the mrContext they need on any tab.
    const lightContext = await buildMrContext(false);
    if (lightContext) {
      useReviewStore.getState().setMrContext(lightContext);
      // Load cached chat history for this MR
      if (enabled?.chat !== false) {
        tryLoadCachedChat(lightContext.projectPath, lightContext.mrIid);
      }

      // Notify Botto we're viewing this MR (for broadcast targeting + cached review delivery)
      const bottoClient = settings ? getBottoClient(settings) : null;
      if (bottoClient?.isConnected()) {
        bottoClient.viewingMr(lightContext.projectPath, lightContext.mrIid);

        // Listen for broadcast messages from other Ottos
        bottoClient.onMessage('COMMENT_ACTION_BROADCAST', (msg: any) => {
          const store = useReviewStore.getState();
          // Update comment status in the store if we have the comment
          for (const fr of store.fileReviews) {
            const comment = fr.comments.find((c) => c.id === msg.comment_id);
            if (comment) {
              store.updateCommentStatus(comment.id, msg.action, msg.edited_body);
              break;
            }
          }
        });

        bottoClient.onMessage('FIX_PROGRESS', (msg: any) => {
          if (msg.comment_id) {
            const store = useReviewStore.getState();
            store.updateFixJob(msg.comment_id, {
              jobId: msg.job_id,
              status: msg.status,
              detail: msg.detail,
            });
          }
        });

        bottoClient.onMessage('FIX_COMPLETE', (msg: any) => {
          if (msg.comment_id) {
            const store = useReviewStore.getState();
            if (msg.commit_sha) {
              store.updateFixJob(msg.comment_id, {
                jobId: msg.job_id,
                status: 'complete',
                detail: 'Fix applied',
                commitSha: msg.commit_sha,
              });
            } else {
              store.updateFixJob(msg.comment_id, {
                jobId: msg.job_id,
                status: 'failed',
                detail: msg.error || 'Fix failed',
                error: msg.error || 'Unknown error',
              });
            }
          }
        });

        bottoClient.onMessage('CACHED_REVIEW', (msg: any) => {
          // Botto sent us a cached review on join — hydrate the store
          if (msg.review) {
            useReviewStore.getState().hydrateFromCache(msg.review);
          }
        });

        bottoClient.onMessage('EVENT_NOTIFICATION', (msg: any) => {
          if (msg.event_type === 'user_joined_mr' && msg.payload?.viewer_count > 1) {
            useReviewStore.getState().setProgressMessage(
              `${msg.payload.viewer_count} team members viewing this MR`,
            );
          }
        });
      }
    }

    // Start follow-up button injection — comments exist on all tabs.
    // Only inject if the feature is enabled.
    if (enabled?.followUp !== false) {
      startFollowUpButtonInjection(isDarkMode, ctx.signal);
    }

    // Mount the chat UI — available on any MR tab, not just diffs.
    // Always mount the overlay (for health toast), but only include
    // chat components if the feature is enabled.
    mountChatUI(ctx, isDarkMode, enabled?.chat !== false);

    // The rest of the review features require the diffs tab.
    initDiffsFeatures(ctx, urlInfo, isDarkMode, enabled);

    ctx.addEventListener(window, 'wxt:locationchange', async (event) => {
      const newUrlInfo = parseMrUrl(event.newUrl.href);
      if (!newUrlInfo) return;
      if (newUrlInfo.mrIid !== urlInfo.mrIid || newUrlInfo.projectPath !== urlInfo.projectPath) {
        // Notify Botto we left the old MR
        const bottoClient = settings ? getBottoClient(settings) : null;
        if (bottoClient?.isConnected()) {
          bottoClient.leftMr();
        }
        // Disconnect queue port for the old MR — prevents stale chunks
        disconnectMrQueuePort();
        useReviewStore.getState().reset();
        useChatStore.getState().reset();
        const newContext = await buildMrContext(false);
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

/**
 * Initialize diff-tab-specific features. Waits for the diffs tab to become
 * active, then mounts review UI. Runs independently of follow-up injection
 * so buttons appear on comments immediately regardless of which tab is active.
 */
async function initDiffsFeatures(
  ctx: typeof ContentScriptContext.prototype,
  urlInfo: { hostUrl: string; projectPath: string; mrIid: number },
  isDarkMode: boolean,
  enabled?: Record<string, boolean>,
): Promise<void> {
  const diffsContainer = await waitForDiffsTab(ctx.signal);
  if (!diffsContainer) return;

  // Now that diffs are visible, enrich the MR context with full API diffs
  const mrContext = await buildMrContext(true);
  if (!mrContext) return;

  useReviewStore.getState().setMrContext(mrContext);

  // Load cached review BEFORE starting injectors. This way injectors see
  // the data in their initial state (cheap) instead of reacting to a store
  // update after subscribing (expensive — triggers 40+ React re-renders and
  // all injector subscriptions simultaneously).
  const hasCachedReview = await tryLoadCachedReview(mrContext);

  // Overview panel is always mounted — it shows disabled states for
  // turned-off features and lets users click to run them ad-hoc.
  await mountOverviewPanel(ctx, isDarkMode);

  observeDiffFiles((fileElement, filePath) => {
    mountFileReviewCard(ctx, fileElement, filePath, isDarkMode);
    mountFileReviewFooter(ctx, fileElement, filePath, isDarkMode);
  }, ctx.signal);

  // Code review injectors — only start if codeReview is enabled
  if (enabled?.codeReview !== false) {
    startInlineCommentInjection(isDarkMode, ctx.signal);
    startRiskInjection(isDarkMode, ctx.signal);
  }

  // Related files sidebar — only start if relatedFiles is enabled
  if (enabled?.relatedFiles !== false) {
    startRelatedFilesSidebar(isDarkMode, ctx.signal);
  }

  // Keyboard shortcuts always active (they navigate existing UI)
  startKeyboardManager(ctx.signal);

  // Auto-review if no cached review was found
  if (!hasCachedReview) {
    await loadOrAutoReview(mrContext, enabled);
  }
}

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

  guardedMutation(() => {
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
  });
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

  guardedMutation(() => {
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
  });
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
// Chat UI — floating pill + panel, available on any MR tab.
// ---------------------------------------------------------------------------

async function mountChatUI(
  ctx: typeof ContentScriptContext.prototype,
  isDarkMode: boolean,
  chatEnabled: boolean,
): Promise<void> {
  // Mount into a fixed-position shadow DOM container on the body
  const ui = await createShadowRootUi(ctx, {
    name: 'otto-chat',
    position: 'overlay',
    onMount: (container) => {
      // Inject animation keyframes into the shadow root
      const styleEl = document.createElement('style');
      styleEl.textContent = getChatStyles();
      container.append(styleEl);

      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-otto-chat', 'true');
      container.append(wrapper);

      const root = createRoot(wrapper);
      root.render(
        createElement(ThemeProvider, {
          isDark: isDarkMode,
          children: createElement('div', null,
            chatEnabled && createElement(OttoErrorBoundary, { name: 'Chat' },
              createElement(ChatPill),
              createElement(ChatPanel),
            ),
            createElement(OttoErrorBoundary, { name: 'HealthToast' },
              createElement(HealthWarningToast),
            ),
          ),
        }),
      );
      return root;
    },
    onRemove: (root) => {
      root?.unmount();
      useChatStore.getState().reset();
    },
  });

  ui.mount();
}

function getChatStyles(): string {
  return `
    :host {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    button { font-family: inherit; }
    @keyframes otto-chat-cursor {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    @keyframes otto-chat-pulse {
      0%, 100% { opacity: 0.4; transform: scale(0.8); }
      50% { opacity: 1; transform: scale(1); }
    }
  `;
}

// ---------------------------------------------------------------------------
// Auto-review — triggers a review automatically on page load if the
// user has enabled the preference and has an AI provider configured.
// ---------------------------------------------------------------------------

async function loadOrAutoReview(
  mrContext: import('@/types/review').MrContext,
  enabled?: Record<string, boolean>,
): Promise<void> {
  // Check the queue FIRST — it's the authority for in-progress reviews.
  // A review at 60% won't have a complete cache yet, so checking cache first
  // would miss it and fall through to starting a duplicate.
  const queueResult = await sendMessage({
    type: 'GET_QUEUE_STATUS',
    payload: { projectPath: mrContext.projectPath },
  });
  if (queueResult.ok) {
    const queuedItem = queueResult.data.items.find(
      (i) => i.mrIid === mrContext.mrIid && (i.status === 'queued' || i.status === 'running' || i.status === 'paused'),
    );
    if (queuedItem) {
      subscribeToQueueUpdates(mrContext);
      return;
    }
  }

  // Cache was already checked and hydrated by initDiffsFeatures before
  // injectors started. If the store has data, skip straight to done.
  const storeState = useReviewStore.getState();
  if (storeState.status === 'complete' || storeState.fileReviews.length > 0) return;

  const settingsResult = await sendMessage({ type: 'GET_SETTINGS' });
  if (!settingsResult.ok) return;

  const settings = settingsResult.data;
  if (!settings.preferences.autoReview) return;
  if (!settings.ai.baseUrl) return;

  const hasGitLabHost = settings.gitlab.hosts.some(
    (h) => mrContext.hostUrl.toLowerCase().startsWith(h.url.toLowerCase()),
  );

  // Build task list from enabled features only
  const allTasks: ReviewTask[] = ['summary', 'codeReview', 'edgeCases'];
  if (hasGitLabHost) allTasks.push('relatedFiles');

  // Include verification tasks if explicitly enabled
  if (enabled?.adversarialTests === true) allTasks.push('adversarialTests');
  if (enabled?.contracts === true) allTasks.push('contracts');
  if (enabled?.behavioralDelta === true) allTasks.push('behavioralDelta');

  const tasks = allTasks.filter((t) => enabled?.[t] !== false);
  if (tasks.length === 0) return; // Nothing to do

  startReviewStream(mrContext, tasks);
}

// ---------------------------------------------------------------------------
// Queue subscription — live updates when MR is being reviewed via the queue.
//
// When the user navigates to an MR that's queued or running, we:
// 1. Set the store to 'loading' so the UI shows progress (not "Review MR")
// 2. Connect a queue port for real-time status updates
// 3. Sync task progress dots from queue snapshots
// 4. Auto-hydrate from cache when the review completes
// 5. Show error if the review fails
// ---------------------------------------------------------------------------

function subscribeToQueueUpdates(
  mrContext: import('@/types/review').MrContext,
): void {
  const store = useReviewStore.getState();

  // Disconnect any existing queue port from a previous navigation
  disconnectMrQueuePort();

  // Load partial cache first — if the queue has been saving partial results
  // every 10s, we can show completed summary/files immediately instead of
  // starting from a blank loading state. New chunks will layer on top.
  tryLoadCachedReview(mrContext).then((loaded) => {
    if (loaded) {
      const s = useReviewStore.getState();
      // Only override to streaming if the review isn't already complete.
      // Edge case: review finished between page load and queue check —
      // hydrateFromCache set status to 'complete', don't overwrite it.
      if (s.status !== 'complete') {
        s.setStatus('streaming');
        s.setProgressMessage('Review is running from the queue...');
      }
    }
  });

  // Set status to loading without resetting results — preserves any partial
  // data and doesn't wipe progress. The queue is the source of truth for progress.
  store.setStatus('loading');
  store.setProgressMessage('Review is running from the queue...');

  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connect({ name: `otto-queue:${mrContext.projectPath}` });
    setMrQueuePort(port);
  } catch {
    store.setProgressMessage('Review is queued. Refresh to see results when complete.');
    return;
  }

  port.onMessage.addListener((message: { type: string; payload: any }) => {
    // Forward stream chunks directly to the store — live results rendering
    if (message.type === 'QUEUE_STREAM_CHUNK') {
      const { mrIid: chunkMrIid, chunk } = message.payload;
      if (chunkMrIid === mrContext.mrIid) {
        // Don't dispatch STREAM_ALL_COMPLETE — we handle completion via status update
        // to avoid the store marking complete before cache is saved
        if (chunk.type !== 'STREAM_ALL_COMPLETE' && chunk.type !== 'STREAM_REVIEW_PAUSED') {
          dispatchStreamChunk(chunk);
        }
      }
      return;
    }

    if (message.type !== 'QUEUE_STATUS_UPDATE') return;

    const item = message.payload.items.find((i: any) => i.mrIid === mrContext.mrIid);
    if (!item) return;

    const s = useReviewStore.getState();

    // Sync task progress dots from the queue snapshot
    if (item.progress) {
      for (const [taskName, taskSnap] of Object.entries(item.progress.tasks) as Array<[string, { status: 'idle' | 'loading' | 'streaming' | 'complete' | 'error' }]>) {
        const validTasks = ['summary', 'codeReview', 'edgeCases', 'relatedFiles', 'fileActivity', 'adversarialTests', 'contracts', 'behavioralDelta'];
        if (validTasks.includes(taskName)) {
          s.setTaskStatus(taskName as import('@/services/review/review-types').ReviewTask, taskSnap.status);
        }
      }
      // Sync file review count
      if (item.progress.filesTotal > 0) {
        s.setFileReviewsTotal(item.progress.filesTotal);
      }
    }

    switch (item.status) {
      case 'queued':
        s.setProgressMessage('Review is queued. It will start automatically.');
        break;

      case 'running': {
        const pct = item.progress?.overallPercent ?? 0;
        const filesInfo = item.progress?.filesTotal
          ? ` (${item.progress.filesComplete}/${item.progress.filesTotal} files)`
          : '';
        s.setProgressMessage(`Queue review in progress: ${pct}%${filesInfo}`);
        // Keep status as streaming once we have progress
        if (pct > 0) s.setStatus('streaming');
        break;
      }

      case 'paused':
        s.setProgressMessage('Queue review is paused. Resume from the MR list page.');
        break;

      case 'complete':
        // Review finished — load results from cache and hydrate the store
        s.setProgressMessage('Queue review complete. Loading results...');
        tryLoadCachedReview(mrContext).then((loaded) => {
          if (!loaded) {
            s.setProgressMessage('Review complete but results not found. Try refreshing.');
          }
        });
        disconnectMrQueuePort();
        break;

      case 'error':
        s.setError(item.error ?? 'Queue review failed');
        disconnectMrQueuePort();
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    setMrQueuePort(null);
  });
}
