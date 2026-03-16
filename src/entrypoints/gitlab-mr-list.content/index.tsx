
// ---------------------------------------------------------------------------
// Content Script Entry — GitLab MR List Page (Command Center)
//
// Injects enhanced preview strips, ticket group headers, toolbar, and
// queue status bar into GitLab's merge requests listing page.
// ---------------------------------------------------------------------------
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '@/lib/messaging';
import { onSettingsChange, loadSettings } from '@/lib/storage';
import { ThemeProvider } from '@/components/ThemeContext';
import { MrPreviewStrip } from '@/components/mr-list/MrPreviewStrip';
import { MrEnhancedStrip } from '@/components/mr-list/MrEnhancedStrip';
import { TicketGroupHeader } from '@/components/mr-list/TicketGroupHeader';
import { MrListToolbar } from '@/components/mr-list/MrListToolbar';
import { QueueStatusBar } from '@/components/mr-list/QueueStatusBar';
import { TeamDigestBanner } from '@/components/mr-list/TeamDigestBanner';
import type { TeamDigest } from '@/components/mr-list/TeamDigestBanner';
import { computePriority } from '@/services/review-queue/priority-scorer';
import { groupMrsByTicket, enrichGroups } from '@/services/review-queue/ticket-grouper';
import type { MrPreviewData } from '@/types/mr-preview';
import type {
  QueuedReview,
  QueueStatus,
  QueueSortKey,
  TicketGroup,
  ReviewPriority,
} from '@/types/review-queue';
import type { ReviewTask } from '@/services/review/review-types';
import { getBottoClient, disconnectBotto } from '@/lib/botto-client';
import { registerBottoTransport } from '@/lib/messaging';
import { DEFAULT_HUE, getBrandColor, getLogoColor } from '@/lib/palette';
export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  async main(ctx) {
    const listInfo = parseMrListUrl(window.location.href);
    if (!listInfo) return;
    const settings = await loadSettings();
    if (settings.preferences.enabledFeatures?.mrListPreview === false) {
      listenForSettingsToggle(ctx, listInfo);
      return;
    }

    // Cache enabled features for building task lists when enqueuing
    cachedEnabledFeatures = settings.preferences.enabledFeatures ?? null;

    // Resolve GitLab username before creating Botto client
    let gitlabUsername: string | undefined;
    const host = settings.gitlab.hosts[0];
    if (host) {
      gitlabUsername = host.username;
      if (!gitlabUsername) {
        try {
          const testResult = await sendMessage({
            type: 'TEST_GITLAB_CONNECTION',
            payload: { host },
          });
          if (testResult.ok) {
            const data = testResult.data as { username?: string };
            if (data?.username) {
              gitlabUsername = data.username;
              // Persist so we never need this API call again
              host.username = gitlabUsername;
              sendMessage({
                type: 'SAVE_SETTINGS',
                payload: settings,
              }).catch(() => {});
            }
          }
        } catch {}
      }
    }

    // Initialize Botto client if configured (needed for digest feature)
    const bottoClient = getBottoClient(settings, gitlabUsername);
    if (bottoClient) {
      try {
        await bottoClient.connect();
        registerBottoTransport(() => bottoClient);
      } catch {
        // Botto not available — digest won't load, everything else works
      }
    }

    // Clean up Botto on invalidation
    ctx.onInvalidated(() => {
      disconnectBotto();
    });

    // If queue feature is enabled, run the full command center.
    // Otherwise, fall back to basic preview strips only.
    const brandHueForMount = settings.preferences.brandHue ?? DEFAULT_HUE;
    if (settings.preferences.enabledFeatures?.mrReviewQueue !== false) {
      await initMrListCommandCenter(ctx, listInfo, brandHueForMount);
    } else {
      await initBasicPreviews(ctx, listInfo, brandHueForMount);
    }
  },
});
// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------
type MrListInfo = {
  hostUrl: string;
  projectPath: string;
};
function parseMrListUrl(url: string): MrListInfo | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/^\/(.+)\/-\/merge_requests\/?$/);
    if (!match) return null;
    return { hostUrl: u.origin, projectPath: match[1] };
  } catch {
    return null;
  }
}
// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
type MountedComponent = {
  container: HTMLElement;
  root: ReturnType<typeof createRoot>;
};
const mountedStrips = new Map<number, MountedComponent>();
const mountedGroupHeaders = new Map<string, MountedComponent>();
let mountedToolbar: MountedComponent | null = null;
let mountedStatusBar: MountedComponent | null = null;
const previewCache = new Map<number, MrPreviewData>();
const priorityCache = new Map<number, ReviewPriority>();
let currentQueueStatus: QueueStatus | null = null;
let currentSortKey: QueueSortKey = 'priority';
let currentGroups: TicketGroup[] = [];
let currentUngrouped: number[] = [];
let queuePort: chrome.runtime.Port | null = null;
/** Guard to prevent MutationObserver from firing during our own DOM manipulation */
let suppressObserver = false;
/** Toolbar re-render function — set by mountToolbar, called by queue status updates */
let rerenderToolbar: (() => void) | null = null;
/** Cached settings for building task lists */
let cachedEnabledFeatures: Record<string, boolean> | null = null;
/** Mounted digest banner */
let mountedDigest: MountedComponent | null = null;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
type MountContext = {
  hostId: string;
  projectId: number;
  projectPath: string;
  hostUrl: string;
  isDark: boolean;
  brandColor: string;
  brandHue: number;
};
async function initMrListCommandCenter(
  ctx: typeof ContentScriptContext.prototype,
  listInfo: MrListInfo,
  brandHue: number = DEFAULT_HUE,
): Promise<void> {
  const isDark = detectDarkMode();

  // Show a loading indicator immediately so the user knows Otto is working.
  // This appears before any async work (host resolution, preview fetching).
  const loadingIndicator = mountLoadingIndicator(isDark, brandHue);

  const hostResult = await sendMessage({
    type: 'RESOLVE_GITLAB_HOST',
    payload: { pageUrl: listInfo.hostUrl },
  });
  if (!hostResult.ok || !hostResult.data) { loadingIndicator.remove(); return; }
  const host = hostResult.data;

  loadingIndicator.update('Resolving project...');

  const projectResult = await sendMessage({
    type: 'FETCH_PROJECT',
    payload: { hostId: host.id, projectPath: listInfo.projectPath },
  });
  if (!projectResult.ok) { loadingIndicator.remove(); return; }
  const projectId = projectResult.data.id;
  const mountContext: MountContext = {
    hostId: host.id,
    projectId,
    projectPath: listInfo.projectPath,
    hostUrl: listInfo.hostUrl,
    isDark,
    brandColor: getBrandColor(brandHue, isDark),
    brandHue,
  };
  loadingIndicator.update('Waiting for MR list...');

  // Wait for MR rows to appear — GitLab's Vue app may not have rendered them yet.
  const rows = await waitForMrRows(ctx.signal);
  if (rows.length === 0) { loadingIndicator.remove(); return; }

  loadingIndicator.update(`Loading previews for ${rows.length} MRs...`);
  // Batch-fetch preview data for all visible MRs
  const mrIids = rows.map((r) => r.mrIid);
  const batchResult = await sendMessage({
    type: 'FETCH_MR_PREVIEWS_BATCH',
    payload: {
      hostId: host.id,
      projectId,
      projectPath: listInfo.projectPath,
      mrIids,
    },
  });
  if (batchResult.ok) {
    for (const [iidStr, preview] of Object.entries(batchResult.data)) {
      const iid = Number(iidStr);
      previewCache.set(iid, preview);
    }
  }
  // Compute priorities for all MRs
  for (const row of rows) {
    const preview = previewCache.get(row.mrIid);
    const mrMeta = extractMrMetaFromDom(row.element);
    const priority = computePriority({
      filesChanged: preview?.filesChanged,
      linesAdded: preview?.linesAdded,
      linesRemoved: preview?.linesRemoved,
      riskLevel: preview?.riskLevel,
      labels: mrMeta.labels,
      createdAt: mrMeta.createdAt,
      mrState: preview?.state as 'opened' | 'closed' | 'merged' | 'locked' | undefined,
    });
    priorityCache.set(row.mrIid, priority);
  }
  // Group by ticket
  const groupableMrs = rows.map((r) => {
    const meta = extractMrMetaFromDom(r.element);
    return {
      mrIid: r.mrIid,
      title: meta.title,
      sourceBranch: meta.sourceBranch,
      priorityScore: priorityCache.get(r.mrIid)?.score ?? 0,
    };
  });
  const groupResult = groupMrsByTicket(groupableMrs);
  currentGroups = groupResult.groups;
  currentUngrouped = groupResult.ungroupedIids;

  // Fetch ticket details if Jira is configured
  const ticketKeys = currentGroups.map((g) => g.ticketKey);
  if (ticketKeys.length > 0) {
    sendMessage({
      type: 'FETCH_TICKET_BATCH',
      payload: { ticketKeys },
    }).then((result) => {
      if (result.ok) {
        const enriched: Record<string, { title?: string; status?: string }> = {};
        for (const [key, info] of Object.entries(result.data)) {
          enriched[key] = { title: info.title, status: info.status };
        }
        currentGroups = enrichGroups(currentGroups, enriched);
        renderGroupHeaders(rows, mountContext, ctx);
      }
    });
  }
  // Sort DOM rows
  sortAndReorderDom(rows);

  // Remove loading indicator — toolbar replaces it
  loadingIndicator.remove();

  // Mount toolbar
  mountToolbar(mountContext, ctx, rows.length);
  // Mount enhanced strips
  for (const row of rows) {
    mountEnhancedStrip(row, mountContext, ctx);
  }
  // Mount group headers
  renderGroupHeaders(rows, mountContext, ctx);
  // Connect queue port for real-time updates
  connectQueuePort(mountContext, rows, ctx);
  // Fetch initial queue status
  const statusResult = await sendMessage({
    type: 'GET_QUEUE_STATUS',
    payload: { projectPath: listInfo.projectPath },
  });
  if (statusResult.ok) {
    currentQueueStatus = statusResult.data;
    rerenderAllStrips(rows, mountContext, ctx);
    renderStatusBar(mountContext, ctx);
  }

  // Fetch and mount team digest banner (Botto-only, non-blocking)
  fetchAndMountDigest(mountContext, ctx);
  // Watch for new rows (pagination, infinite scroll)
  const listContainer = document.querySelector('.issuable-list')
    || document.querySelector('.mr-list')
    || document.querySelector('[data-testid="issuable-list"]')
    || document.body;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (suppressObserver) return; // Skip mutations caused by our own DOM manipulation
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;

      // Prune stale entries — GitLab's SPA can destroy DOM nodes on navigation
      let prunedCount = 0;
      for (const [iid, mounted] of mountedStrips) {
        if (!mounted.container.isConnected) {
          mounted.root.unmount();
          mountedStrips.delete(iid);
          prunedCount++;
        }
      }
      for (const [key, mounted] of mountedGroupHeaders) {
        if (!mounted.container.isConnected) {
          mounted.root.unmount();
          mountedGroupHeaders.delete(key);
        }
      }

      const currentRows = findMrRows();
      const newRows = currentRows.filter((r) => !mountedStrips.has(r.mrIid));
      if (newRows.length === 0 && prunedCount === 0) return;

      // If we pruned stale entries or found new rows, refresh queue status
      // so strips render with current queue data (completed, running, etc.)
      const refreshQueueStatus = async () => {
        const statusResult = await sendMessage({
          type: 'GET_QUEUE_STATUS',
          payload: { projectPath: mountContext.projectPath },
        });
        if (statusResult.ok) {
          currentQueueStatus = statusResult.data;
          rerenderAllStrips(currentRows, mountContext, ctx);
          renderStatusBar(mountContext, ctx);
          rerenderToolbar?.();
        }
      };

      if (newRows.length === 0) {
        // Only pruned — just refresh queue status for existing rows
        refreshQueueStatus();
        return;
      }

      // Reconnect queue port if it was lost during navigation
      if (!queuePort) {
        connectQueuePort(mountContext, currentRows, ctx);
      }

      // Fetch previews for new rows
      const newIids = newRows.map((r) => r.mrIid);
      sendMessage({
        type: 'FETCH_MR_PREVIEWS_BATCH',
        payload: {
          hostId: mountContext.hostId,
          projectId: mountContext.projectId,
          projectPath: mountContext.projectPath,
          mrIids: newIids,
        },
      }).then((result) => {
        if (result.ok) {
          for (const [iidStr, preview] of Object.entries(result.data)) {
            previewCache.set(Number(iidStr), preview);
          }
        }
        for (const row of newRows) {
          const preview = previewCache.get(row.mrIid);
          const meta = extractMrMetaFromDom(row.element);
          priorityCache.set(row.mrIid, computePriority({
            filesChanged: preview?.filesChanged,
            linesAdded: preview?.linesAdded,
            linesRemoved: preview?.linesRemoved,
            riskLevel: preview?.riskLevel,
            labels: meta.labels,
            mrState: preview?.state as 'opened' | 'closed' | 'merged' | 'locked' | undefined,
          }));
          mountEnhancedStrip(row, mountContext, ctx);
        }

        // Refresh queue status so new strips render with current data
        refreshQueueStatus();
      });
    }, 200);
  });
  observer.observe(listContainer, { childList: true, subtree: true });
  // Settings changes
  const unsubscribe = onSettingsChange((newSettings) => {
    if (newSettings.preferences.enabledFeatures?.mrListPreview === false) {
      removeAll();
    }
  });
  // Cleanup
  ctx.signal.addEventListener('abort', () => {
    observer.disconnect();
    if (debounceTimer) clearTimeout(debounceTimer);
    unsubscribe();
    disconnectQueuePort();
    removeAll();
  }, { once: true });
}
function listenForSettingsToggle(
  ctx: typeof ContentScriptContext.prototype,
  listInfo: MrListInfo,
): void {
  let initialized = false;
  const unsubscribe = onSettingsChange(async (newSettings) => {
    if (initialized) return;
    if (newSettings.preferences.enabledFeatures?.mrListPreview !== false) {
      initialized = true;
      unsubscribe();
      await initMrListCommandCenter(ctx, listInfo);
    }
  });
  ctx.signal.addEventListener('abort', () => { unsubscribe(); }, { once: true });
}

// ---------------------------------------------------------------------------
// Basic previews fallback — used when mrReviewQueue is disabled.
// Mounts simple MrPreviewStrip components (no queue, no grouping).
// ---------------------------------------------------------------------------

async function initBasicPreviews(
  ctx: typeof ContentScriptContext.prototype,
  listInfo: MrListInfo,
  brandHue: number = DEFAULT_HUE,
): Promise<void> {
  const isDark = detectDarkMode();
  const loadingIndicator = mountLoadingIndicator(isDark, brandHue);

  const hostResult = await sendMessage({
    type: 'RESOLVE_GITLAB_HOST',
    payload: { pageUrl: listInfo.hostUrl },
  });
  if (!hostResult.ok || !hostResult.data) { loadingIndicator.remove(); return; }
  const host = hostResult.data;

  const projectResult = await sendMessage({
    type: 'FETCH_PROJECT',
    payload: { hostId: host.id, projectPath: listInfo.projectPath },
  });
  if (!projectResult.ok) { loadingIndicator.remove(); return; }
  const projectId = projectResult.data.id;

  const mountCtx: MountContext = {
    hostId: host.id,
    projectId,
    projectPath: listInfo.projectPath,
    hostUrl: listInfo.hostUrl,
    isDark,
    brandColor: getBrandColor(brandHue, isDark),
    brandHue,
  };

  loadingIndicator.update('Waiting for MR list...');
  const rows = await waitForMrRows(ctx.signal);
  loadingIndicator.remove();

  for (const row of rows) {
    mountBasicStrip(row, mountCtx, ctx);
  }
  if (rows.length === 0) return;

  const listContainer = document.querySelector('.issuable-list')
    || document.querySelector('.mr-list')
    || document.querySelector('[data-testid="issuable-list"]')
    || document.body;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const currentRows = findMrRows();
      for (const row of currentRows) {
        if (!mountedStrips.has(row.mrIid)) {
          mountBasicStrip(row, mountCtx, ctx);
        }
      }
    }, 200);
  });
  observer.observe(listContainer, { childList: true, subtree: true });

  const unsubscribe = onSettingsChange((newSettings) => {
    if (newSettings.preferences.enabledFeatures?.mrListPreview === false) {
      removeAll();
    }
  });

  ctx.signal.addEventListener('abort', () => {
    observer.disconnect();
    if (debounceTimer) clearTimeout(debounceTimer);
    unsubscribe();
    removeAll();
  }, { once: true });
}

// ---------------------------------------------------------------------------
// Queue port — real-time updates from background
// ---------------------------------------------------------------------------
function connectQueuePort(
  mountContext: MountContext,
  rows: MrRowInfo[],
  ctx: typeof ContentScriptContext.prototype,
): void {
  try {
    queuePort = chrome.runtime.connect({ name: `otto-queue:${mountContext.projectPath}` });
    queuePort.onMessage.addListener((message: { type: string; payload: QueueStatus }) => {
      if (message.type === 'QUEUE_STATUS_UPDATE') {
        currentQueueStatus = message.payload;
        const currentRows = findMrRows();
        rerenderAllStrips(currentRows, mountContext, ctx);
        renderStatusBar(mountContext, ctx);
        rerenderToolbar?.(); // Update queue count badge
      }
    });
    queuePort.onDisconnect.addListener(() => {
      queuePort = null;
    });
  } catch {
    // Port connection can fail if SW is restarting
  }
}
function disconnectQueuePort(): void {
  try {
    queuePort?.disconnect();
  } catch {
    // Already disconnected
  }
  queuePort = null;
}
// ---------------------------------------------------------------------------
// Sorting — respects ticket grouping so grouped MRs stay together
// ---------------------------------------------------------------------------
function sortAndReorderDom(rows: MrRowInfo[]): void {
  const rowMap = new Map(rows.map((r) => [r.mrIid, r]));
  const groupedIids = new Set<number>();
  for (const group of currentGroups) {
    for (const iid of group.mrIids) {
      groupedIids.add(iid);
    }
  }

  // Build the final order:
  // 1. Grouped MRs — groups sorted by highest-priority MR, MRs within group sorted by sort key
  // 2. Ungrouped MRs — sorted by sort key
  const ordered: MrRowInfo[] = [];

  // Sort groups by highest-priority MR within each group
  const sortedGroups = [...currentGroups].sort((a, b) => {
    const aTop = a.mrIids[0] ? (priorityCache.get(a.mrIids[0])?.score ?? 0) : 0;
    const bTop = b.mrIids[0] ? (priorityCache.get(b.mrIids[0])?.score ?? 0) : 0;
    return bTop - aTop;
  });

  for (const group of sortedGroups) {
    // Sort MRs within the group by the current sort key
    const groupRows = group.mrIids
      .map((iid) => rowMap.get(iid))
      .filter((r): r is MrRowInfo => r !== undefined)
      .sort((a, b) => compareMrRows(a, b, currentSortKey));

    // Update the group's mrIids to match the new sort order
    group.mrIids = groupRows.map((r) => r.mrIid);

    ordered.push(...groupRows);
  }

  // Ungrouped MRs sorted by sort key, placed after all groups
  const ungroupedRows = currentUngrouped
    .map((iid) => rowMap.get(iid))
    .filter((r): r is MrRowInfo => r !== undefined)
    .sort((a, b) => compareMrRows(a, b, currentSortKey));

  ordered.push(...ungroupedRows);

  // Reorder DOM nodes within their parent
  const parent = ordered[0]?.element.parentElement;
  if (!parent) return;

  // Suppress observer while we manipulate the DOM
  suppressObserver = true;
  for (const row of ordered) {
    parent.appendChild(row.element);
  }
  // Re-enable after a microtask so the observer's queued mutations are ignored
  queueMicrotask(() => { suppressObserver = false; });
}
function compareMrRows(a: MrRowInfo, b: MrRowInfo, sortKey: QueueSortKey): number {
  switch (sortKey) {
    case 'priority': {
      const pa = priorityCache.get(a.mrIid)?.score ?? 0;
      const pb = priorityCache.get(b.mrIid)?.score ?? 0;
      return pb - pa; // Higher priority first
    }
    case 'newest':
      return b.mrIid - a.mrIid; // Higher IID = newer
    case 'oldest':
      return a.mrIid - b.mrIid;
    case 'mostFiles': {
      const fa = previewCache.get(a.mrIid)?.filesChanged ?? 0;
      const fb = previewCache.get(b.mrIid)?.filesChanged ?? 0;
      return fb - fa;
    }
    case 'mostLines': {
      const la = (previewCache.get(a.mrIid)?.linesAdded ?? 0) + (previewCache.get(a.mrIid)?.linesRemoved ?? 0);
      const lb = (previewCache.get(b.mrIid)?.linesAdded ?? 0) + (previewCache.get(b.mrIid)?.linesRemoved ?? 0);
      return lb - la;
    }
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
type MrRowInfo = {
  element: Element;
  mrIid: number;
};
type MrDomMeta = {
  title: string;
  sourceBranch: string;
  labels: string[];
  createdAt?: string;
};
function findMrRows(): MrRowInfo[] {
  const rows: MrRowInfo[] = [];
  const seen = new Set<number>();
  const candidates = document.querySelectorAll(
    '.merge-request, li[data-testid="issuable-container"], .issuable-list > li',
  );
  for (const el of candidates) {
    const link = el.querySelector<HTMLAnchorElement>(
      'a.js-prefetch-document, a[data-testid="issuable-title-link"], .merge-request-title-text a, .issuable-reference a, a.title',
    );
    if (!link) continue;
    const iid = extractMrIid(link.href);
    if (iid === null || seen.has(iid)) continue;
    seen.add(iid);
    rows.push({ element: el, mrIid: iid });
  }
  return rows;
}

/**
 * Wait for MR rows to appear in the DOM.
 * GitLab's Vue app may not have rendered them when the content script runs.
 * Uses a combination of polling + MutationObserver for responsiveness.
 * Gives up after 15 seconds and returns whatever is available (possibly empty).
 */
function waitForMrRows(signal: AbortSignal): Promise<MrRowInfo[]> {
  // Try immediately first
  const immediate = findMrRows();
  if (immediate.length > 0) return Promise.resolve(immediate);

  return new Promise<MrRowInfo[]>((resolve) => {
    const MAX_WAIT = 15_000;
    const POLL_INTERVAL = 500;
    let resolved = false;

    const finish = (rows: MrRowInfo[]) => {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      clearTimeout(giveUpTimer);
      clearInterval(pollTimer);
      resolve(rows);
    };

    // MutationObserver — catches rows as soon as they're inserted
    const observer = new MutationObserver(() => {
      const rows = findMrRows();
      if (rows.length > 0) finish(rows);
    });

    const listContainer = document.querySelector('.issuable-list')
      || document.querySelector('.mr-list')
      || document.querySelector('[data-testid="issuable-list"]')
      || document.querySelector('.content-list')
      || document.body;

    observer.observe(listContainer, { childList: true, subtree: true });

    // Polling fallback — in case the observer misses the initial render
    const pollTimer = setInterval(() => {
      const rows = findMrRows();
      if (rows.length > 0) finish(rows);
    }, POLL_INTERVAL);

    // Give up after MAX_WAIT — return whatever we have (possibly empty)
    const giveUpTimer = setTimeout(() => {
      finish(findMrRows());
    }, MAX_WAIT);

    // Abort cleanup
    signal.addEventListener('abort', () => {
      finish([]);
    }, { once: true });
  });
}
function extractMrIid(href: string): number | null {
  const match = href.match(/\/-\/merge_requests\/(\d+)/);
  if (!match) return null;
  return parseInt(match[1], 10);
}
function extractMrMetaFromDom(element: Element): MrDomMeta {
  // Title from the MR link text
  const titleEl = element.querySelector(
    'a.js-prefetch-document, a[data-testid="issuable-title-link"], .merge-request-title-text a, a.title',
  );
  const title = titleEl?.textContent?.trim() ?? '';
  // Source branch from the branch reference element
  const branchEl = element.querySelector(
    '.ref-name, [data-testid="issuable-branch-name"], .issuable-meta .branch-name',
  );
  const sourceBranch = branchEl?.textContent?.trim() ?? '';
  // Labels from label elements
  const labelEls = element.querySelectorAll(
    '.gl-label-text, [data-testid="label-title"], .issuable-label',
  );
  const labels: string[] = [];
  for (const el of labelEls) {
    const text = el.textContent?.trim();
    if (text) labels.push(text);
  }
  // Created at from time element
  const timeEl = element.querySelector('time');
  const createdAt = timeEl?.getAttribute('datetime') ?? undefined;
  return { title, sourceBranch, labels, createdAt };
}
// ---------------------------------------------------------------------------
// Mount / unmount
// ---------------------------------------------------------------------------
function mountEnhancedStrip(
  row: MrRowInfo,
  mountContext: MountContext,
  ctx: typeof ContentScriptContext.prototype,
): void {
  // Don't double-mount
  if (mountedStrips.has(row.mrIid)) return;
  if (row.element.querySelector('[data-otto-mr-preview]')) return;
  const preview = previewCache.get(row.mrIid);
  if (!preview) {
    // Fall back to basic strip if no preview data
    mountBasicStrip(row, mountContext, ctx);
    return;
  }
  const container = document.createElement('div');
  container.setAttribute('data-otto-mr-preview', String(row.mrIid));
  row.element.appendChild(container);
  const shadow = container.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = getResetStyles();
  shadow.appendChild(styleEl);
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  renderEnhancedStrip(root, row.mrIid, preview, mountContext);
  mountedStrips.set(row.mrIid, { container, root });
  ctx.signal.addEventListener('abort', () => {
    root.unmount();
    container.remove();
    mountedStrips.delete(row.mrIid);
  }, { once: true });
}
function mountBasicStrip(
  row: MrRowInfo,
  mountContext: MountContext,
  ctx: typeof ContentScriptContext.prototype,
): void {
  if (row.element.querySelector('[data-otto-mr-preview]')) return;
  const container = document.createElement('div');
  container.setAttribute('data-otto-mr-preview', String(row.mrIid));
  row.element.appendChild(container);
  const shadow = container.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = getResetStyles();
  shadow.appendChild(styleEl);
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  root.render(
    createElement(ThemeProvider, {
      isDark: mountContext.isDark,
      children: createElement(MrPreviewStrip, {
        hostId: mountContext.hostId,
        projectId: mountContext.projectId,
        projectPath: mountContext.projectPath,
        mrIid: row.mrIid,
      }),
    }),
  );
  mountedStrips.set(row.mrIid, { container, root });
  ctx.signal.addEventListener('abort', () => {
    root.unmount();
    container.remove();
    mountedStrips.delete(row.mrIid);
  }, { once: true });
}
function renderEnhancedStrip(
  root: ReturnType<typeof createRoot>,
  mrIid: number,
  preview: MrPreviewData,
  mountContext: MountContext,
): void {
  const queueItem = currentQueueStatus?.items.find((i) => i.mrIid === mrIid) ?? null;
  const priority = priorityCache.get(mrIid) ?? null;
  root.render(
    createElement(ThemeProvider, {
      isDark: mountContext.isDark,
      children: createElement(MrEnhancedStrip, {
        preview,
        queueItem,
        priority,
        onEnqueue: (iid: number, failedTasksOnly?: boolean) => handleEnqueue(iid, mountContext, failedTasksOnly),
        onPause: (iid: number) => handlePause(iid, mountContext),
        onResume: (iid: number) => handleResume(iid, mountContext),
        onCancel: (iid: number) => handleCancel(iid, mountContext),
      }),
    }),
  );
}
function rerenderAllStrips(
  rows: MrRowInfo[],
  mountContext: MountContext,
  ctx: typeof ContentScriptContext.prototype,
): void {
  for (const row of rows) {
    const mounted = mountedStrips.get(row.mrIid);
    const preview = previewCache.get(row.mrIid);
    if (mounted && preview) {
      renderEnhancedStrip(mounted.root, row.mrIid, preview, mountContext);
    }
  }
}
// ---------------------------------------------------------------------------
// Group headers
// ---------------------------------------------------------------------------
function renderGroupHeaders(
  rows: MrRowInfo[],
  mountContext: MountContext,
  ctx: typeof ContentScriptContext.prototype,
): void {
  // Suppress observer while we manipulate the DOM
  suppressObserver = true;

  // Remove existing headers
  for (const [key, mounted] of mountedGroupHeaders) {
    mounted.root.unmount();
    mounted.container.remove();
    mountedGroupHeaders.delete(key);
  }
  // Build a map of mrIid → DOM element
  const rowMap = new Map(rows.map((r) => [r.mrIid, r.element]));
  for (const group of currentGroups) {
    if (group.mrIids.length === 0) continue;
    // Find the first MR row in this group
    const firstIid = group.mrIids[0];
    const firstRow = rowMap.get(firstIid);
    if (!firstRow) continue;
    const container = document.createElement('div');
    container.setAttribute('data-otto-ticket-group', group.ticketKey);
    // Insert before the first MR row
    firstRow.parentElement?.insertBefore(container, firstRow);
    const shadow = container.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = getResetStyles();
    shadow.appendChild(styleEl);
    const mountPoint = document.createElement('div');
    shadow.appendChild(mountPoint);
    const root = createRoot(mountPoint);
    root.render(
      createElement(ThemeProvider, {
        isDark: mountContext.isDark,
        hue: mountContext.brandHue,
        children: createElement(TicketGroupHeader, {
          group,
          onToggle: (ticketKey: string) => {
            const g = currentGroups.find((gr) => gr.ticketKey === ticketKey);
            if (!g) return;
            g.expanded = !g.expanded;
            // Show/hide child MR rows (skip the first — always visible)
            for (let i = 1; i < g.mrIids.length; i++) {
              const el = rowMap.get(g.mrIids[i]) as HTMLElement | undefined;
              if (el) {
                el.style.display = g.expanded ? '' : 'none';
              }
              // Also hide the strip
              const strip = mountedStrips.get(g.mrIids[i]);
              if (strip) {
                strip.container.style.display = g.expanded ? '' : 'none';
              }
            }
            // Re-render this header to update the toggle icon
            renderGroupHeaders(rows, mountContext, ctx);
          },
        }),
      }),
    );
    mountedGroupHeaders.set(group.ticketKey, { container, root });
    // Add left border accent to child rows for tree visual
    for (const iid of group.mrIids) {
      const el = rowMap.get(iid) as HTMLElement | undefined;
      if (el) {
        el.style.borderLeft = `2px solid ${mountContext.brandColor}`;
        el.style.paddingLeft = '8px';
      }
    }
  }

  // Re-enable observer after DOM manipulation
  queueMicrotask(() => { suppressObserver = false; });
}
// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------
function mountToolbar(
  mountContext: MountContext,
  ctx: typeof ContentScriptContext.prototype,
  totalMrCount: number,
): void {
  const listContainer = document.querySelector('.issuable-list')
    || document.querySelector('.mr-list')
    || document.querySelector('[data-testid="issuable-list"]');
  if (!listContainer) return;
  const container = document.createElement('div');
  container.setAttribute('data-otto-toolbar', 'true');
  listContainer.parentElement?.insertBefore(container, listContainer);
  const shadow = container.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = getResetStyles();
  shadow.appendChild(styleEl);
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  const renderToolbar = () => {
    const queuedCount = currentQueueStatus?.items.filter(
      (i) => i.status === 'queued' || i.status === 'running',
    ).length ?? 0;
    root.render(
      createElement(ThemeProvider, {
        isDark: mountContext.isDark,
        hue: mountContext.brandHue,
        children: createElement(MrListToolbar, {
          sortKey: currentSortKey,
          onSortChange: (key: QueueSortKey) => {
            currentSortKey = key;
            const rows = findMrRows();
            sortAndReorderDom(rows);
            renderGroupHeaders(rows, mountContext, ctx);
            renderToolbar();
          },
          onQueueAll: () => handleQueueAll(mountContext),
          queuedCount,
          totalCount: totalMrCount,
        }),
      }),
    );
  };
  renderToolbar();
  rerenderToolbar = renderToolbar; // Expose for queue status updates
  mountedToolbar = { container, root };
  ctx.signal.addEventListener('abort', () => {
    root.unmount();
    container.remove();
    mountedToolbar = null;
    rerenderToolbar = null;
  }, { once: true });
}
// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------
function renderStatusBar(
  mountContext: MountContext,
  ctx: typeof ContentScriptContext.prototype,
): void {
  if (!currentQueueStatus) return;
  const activeCount = currentQueueStatus.items.filter(
    (i) => i.status === 'running' || i.status === 'queued' || i.status === 'paused',
  ).length;
  // Remove if nothing active
  if (activeCount === 0 && mountedStatusBar) {
    mountedStatusBar.root.unmount();
    mountedStatusBar.container.remove();
    mountedStatusBar = null;
    return;
  }
  if (activeCount === 0) return;
  // Create if not exists
  if (!mountedStatusBar) {
    const listContainer = document.querySelector('.issuable-list')
      || document.querySelector('.mr-list')
      || document.querySelector('[data-testid="issuable-list"]');
    if (!listContainer) return;
    const container = document.createElement('div');
    container.setAttribute('data-otto-status-bar', 'true');
    listContainer.parentElement?.insertBefore(container, listContainer.nextSibling);
    const shadow = container.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = getResetStyles();
    shadow.appendChild(styleEl);
    const mountPoint = document.createElement('div');
    shadow.appendChild(mountPoint);
    const root = createRoot(mountPoint);
    mountedStatusBar = { container, root };
    ctx.signal.addEventListener('abort', () => {
      root.unmount();
      container.remove();
      mountedStatusBar = null;
    }, { once: true });
  }
  mountedStatusBar.root.render(
    createElement(ThemeProvider, {
      isDark: mountContext.isDark,
      children: createElement(QueueStatusBar, {
        status: currentQueueStatus,
        onPauseAll: () => handlePauseAll(mountContext),
        onCancelAll: () => handleCancelAll(mountContext),
      }),
    }),
  );
}
// ---------------------------------------------------------------------------
// Queue action handlers
// ---------------------------------------------------------------------------
function handleEnqueue(mrIid: number, mountContext: MountContext, failedTasksOnly?: boolean): void {
  const preview = previewCache.get(mrIid);

  // Find the actual MR row element for this IID
  const rows = findMrRows();
  const row = rows.find((r) => r.mrIid === mrIid);
  const meta = extractMrMetaFromDom(row?.element ?? document.body);

  // Determine which tasks to run
  let tasks = buildTaskListFromSettings();

  if (failedTasksOnly) {
    // Only retry tasks that failed in the previous run
    const queueItem = currentQueueStatus?.items.find((i) => i.mrIid === mrIid);
    if (queueItem?.progress?.tasks) {
      const failedTasks = Object.entries(queueItem.progress.tasks)
        .filter(([_, snap]) => snap.status === 'error')
        .map(([name]) => name as ReviewTask);
      if (failedTasks.length > 0) {
        tasks = failedTasks;
      }
    }
  }

  sendMessage({
    type: 'ENQUEUE_REVIEW',
    payload: {
      mrIid,
      projectPath: mountContext.projectPath,
      projectId: mountContext.projectId,
      hostUrl: mountContext.hostUrl,
      hostId: mountContext.hostId,
      title: meta.title,
      authorUsername: '',
      sourceBranch: meta.sourceBranch,
      targetBranch: '',
      labels: meta.labels,
      mrState: (preview?.state as 'opened' | 'closed' | 'merged' | 'locked') ?? 'opened',
      filesChanged: preview?.filesChanged ?? 0,
      linesAdded: preview?.linesAdded ?? 0,
      linesRemoved: preview?.linesRemoved ?? 0,
      riskLevel: preview?.riskLevel,
      createdAt: meta.createdAt,
      tasks: buildTaskListFromSettings(),
    },
  });
}
function handlePause(mrIid: number, mountContext: MountContext): void {
  sendMessage({
    type: 'PAUSE_REVIEW',
    payload: { projectPath: mountContext.projectPath, mrIid },
  });
}
function handleResume(mrIid: number, mountContext: MountContext): void {
  sendMessage({
    type: 'RESUME_REVIEW',
    payload: { projectPath: mountContext.projectPath, mrIid },
  });
}
function handleCancel(mrIid: number, mountContext: MountContext): void {
  sendMessage({
    type: 'CANCEL_REVIEW',
    payload: { projectPath: mountContext.projectPath, mrIid },
  });
}
function handleQueueAll(mountContext: MountContext): void {
  const rows = findMrRows();
  for (const row of rows) {
    // Skip already queued/running/complete
    const existing = currentQueueStatus?.items.find((i) => i.mrIid === row.mrIid);
    if (existing && existing.status !== 'error') continue;
    handleEnqueue(row.mrIid, mountContext);
  }
}
function handlePauseAll(mountContext: MountContext): void {
  if (!currentQueueStatus) return;
  for (const item of currentQueueStatus.items) {
    if (item.status === 'running' || item.status === 'queued') {
      sendMessage({
        type: 'PAUSE_REVIEW',
        payload: { projectPath: mountContext.projectPath, mrIid: item.mrIid },
      });
    }
  }
}
function handleCancelAll(mountContext: MountContext): void {
  if (!currentQueueStatus) return;
  for (const item of currentQueueStatus.items) {
    if (item.status === 'queued' || item.status === 'running' || item.status === 'paused') {
      sendMessage({
        type: 'CANCEL_REVIEW',
        payload: { projectPath: mountContext.projectPath, mrIid: item.mrIid },
      });
    }
  }
}
// ---------------------------------------------------------------------------
// Team digest — fetched from Botto, cached client-side
// ---------------------------------------------------------------------------

const DIGEST_CACHE_KEY = 'otto_digest_cache';
const DIGEST_DISMISS_KEY = 'otto_digest_dismissed';

async function fetchAndMountDigest(
  mountContext: MountContext,
  ctx: typeof ContentScriptContext.prototype,
): Promise<void> {
  const settings = await loadSettings();
  const bottoClient = getBottoClient(settings);
  if (!bottoClient?.isConnected()) return;

  const userId = settings.gitlab.hosts[0]?.username ?? 'unknown';

  // Check if user dismissed this period's digest
  try {
    const stored = await chrome.storage.local.get(DIGEST_DISMISS_KEY);
    const dismissed = stored[DIGEST_DISMISS_KEY];
    if (dismissed?.project === mountContext.projectPath) {
      const age = Date.now() - (dismissed.at ?? 0);
      // Daily: don't re-show for 20 hours. Weekly: don't re-show for 5 days.
      const ttl = dismissed.period === 'daily' ? 20 * 3600_000 : 5 * 86400_000;
      if (age < ttl) return;
    }
  } catch {}

  // Check client-side cache first (1 hour TTL)
  let digest: TeamDigest | null = null;
  try {
    const stored = await chrome.storage.local.get(DIGEST_CACHE_KEY);
    const cached = stored[DIGEST_CACHE_KEY];
    if (
      cached?.project === mountContext.projectPath &&
      Date.now() - (cached.fetchedAt ?? 0) < 3600_000
    ) {
      digest = cached.digest;
    }
  } catch {}

  // Fetch from Botto if not cached
  if (!digest) {
    try {
      const result = await bottoClient.sendRequest<{ ok: boolean; data: TeamDigest }>({
        type: 'GET_TEAM_DIGEST',
        project_path: mountContext.projectPath,
        period: 'weekly',
      });
      if (result && (result as any).ok && (result as any).data) {
        digest = (result as any).data;
        // Cache client-side
        chrome.storage.local.set({
          [DIGEST_CACHE_KEY]: {
            project: mountContext.projectPath,
            digest,
            fetchedAt: Date.now(),
          },
        }).catch(() => {});
      }
    } catch {
      // Botto request failed — skip digest silently
      return;
    }
  }

  if (!digest || (digest.team_stats.mrs_merged === 0 && digest.team_stats.mrs_open === 0)) {
    return; // Nothing to show
  }

  // Mount the banner above the toolbar (or above the list)
  const anchor = document.querySelector('[data-otto-toolbar]')
    || document.querySelector('.issuable-list')
    || document.querySelector('.mr-list')
    || document.querySelector('[data-testid="issuable-list"]');
  if (!anchor?.parentElement) return;

  const container = document.createElement('div');
  container.setAttribute('data-otto-digest', 'true');
  anchor.parentElement.insertBefore(container, anchor);

  const shadow = container.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = getResetStyles();
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  const root = createRoot(mountPoint);
  const finalDigest = digest;

  root.render(
    createElement(ThemeProvider, {
      isDark: mountContext.isDark,
      children: createElement(TeamDigestBanner, {
        digest: finalDigest,
        userId,
        onDismiss: () => {
          root.unmount();
          container.remove();
          mountedDigest = null;
          // Remember dismissal
          chrome.storage.local.set({
            [DIGEST_DISMISS_KEY]: {
              project: mountContext.projectPath,
              period: finalDigest.period,
              at: Date.now(),
            },
          }).catch(() => {});
        },
      }),
    }),
  );

  mountedDigest = { container, root };

  ctx.signal.addEventListener('abort', () => {
    root.unmount();
    container.remove();
    mountedDigest = null;
  }, { once: true });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
function removeAll(): void {
  for (const [iid, strip] of mountedStrips) {
    strip.root.unmount();
    strip.container.remove();
    mountedStrips.delete(iid);
  }
  for (const [key, header] of mountedGroupHeaders) {
    header.root.unmount();
    header.container.remove();
    mountedGroupHeaders.delete(key);
  }
  if (mountedToolbar) {
    mountedToolbar.root.unmount();
    mountedToolbar.container.remove();
    mountedToolbar = null;
    rerenderToolbar = null;
  }
  if (mountedStatusBar) {
    mountedStatusBar.root.unmount();
    mountedStatusBar.container.remove();
    mountedStatusBar = null;
  }
  if (mountedDigest) {
    mountedDigest.root.unmount();
    mountedDigest.container.remove();
    mountedDigest = null;
  }
  disconnectQueuePort();
}

// ---------------------------------------------------------------------------
// Task list builder — respects user's enabled feature preferences
// ---------------------------------------------------------------------------

/**
 * Build the review task list from the user's enabled features.
 * Called at enqueue time so each queued review runs exactly what the user wants.
 */
function buildTaskListFromSettings(): ReviewTask[] {
  const enabled = cachedEnabledFeatures;
  const tasks: ReviewTask[] = [];

  // Core tasks — enabled by default unless explicitly disabled
  if (enabled?.summary !== false) tasks.push('summary');
  if (enabled?.codeReview !== false) tasks.push('codeReview');
  if (enabled?.edgeCases !== false) tasks.push('edgeCases');
  if (enabled?.relatedFiles !== false) tasks.push('relatedFiles');

  // Verification tasks — disabled by default, only if explicitly enabled
  if (enabled?.adversarialTests === true) tasks.push('adversarialTests');
  if (enabled?.contracts === true) tasks.push('contracts');
  if (enabled?.behavioralDelta === true) tasks.push('behavioralDelta');

  // Always include at least summary + codeReview
  if (tasks.length === 0) {
    tasks.push('summary', 'codeReview');
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// Loading indicator — shown while Otto initializes on the MR list page
// ---------------------------------------------------------------------------

type LoadingIndicatorHandle = {
  update: (message: string) => void;
  remove: () => void;
};

function mountLoadingIndicator(isDark: boolean, brandHue: number = DEFAULT_HUE): LoadingIndicatorHandle {
  const brandColor = getLogoColor(brandHue);
  const bg = isDark ? '#161b22' : '#f6f8fa';
  const border = isDark ? '#30363d' : '#d0d7de';
  const text = isDark ? '#c9d1d9' : '#24292f';
  const textMuted = isDark ? '#8b949e' : '#57606a';

  const container = document.createElement('div');
  container.setAttribute('data-otto-loading', 'true');

  // Find the list container to insert before
  const listContainer = document.querySelector('.issuable-list')
    || document.querySelector('.mr-list')
    || document.querySelector('[data-testid="issuable-list"]')
    || document.querySelector('.content-list');

  if (listContainer?.parentElement) {
    listContainer.parentElement.insertBefore(container, listContainer);
  } else {
    document.body.appendChild(container);
  }

  const shadow = container.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { display: block; }
      @keyframes otto-load-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.1); opacity: 0.85; }
      }
      .otto-loading-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: ${bg};
        border-bottom: 1px solid ${border};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        line-height: 1.4;
      }
      .otto-loading-logo {
        flex-shrink: 0;
      }
      .otto-loading-logo svg {
        display: block;
      }
      .otto-loading-bolt {
        transform-origin: center;
        animation: otto-load-pulse 1.6s ease-in-out infinite;
      }
      .otto-loading-label {
        font-weight: 600;
        color: ${text};
      }
      .otto-loading-msg {
        color: ${textMuted};
      }
      .otto-loading-dots::after {
        content: '';
        animation: otto-dots 1.5s steps(4, end) infinite;
      }
      @keyframes otto-dots {
        0% { content: ''; }
        25% { content: '.'; }
        50% { content: '..'; }
        75% { content: '...'; }
      }
    </style>
    <div class="otto-loading-bar">
      <div class="otto-loading-logo">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 200 200">
          <path d="m114.4 8.5h-3.61c-33.58 0-60.65 17.18-70.29 46.1-0.67 2.14 0.48 3.01 2.15 3.01h9.58c2.04 0 3.4-1.12 4.28-3.01 9.8-20.64 27.68-30.64 54.28-30.64h3.44c34.71 0 59.65 26.15 59.65 59.01 0 18.7-8.75 32.29-18.67 44.21-9.23 11.1-18.46 20.13-18.46 34.65v26.84c0 1.53 1.04 2.42 2.46 2.42h10.86c1.26 0 1.93-1.21 1.93-2.34v-28.05c0-8.79 7.84-15.71 15.85-25.28 11.09-13.11 21.64-27.95 21.64-52.29 0-39.99-30.64-74.63-75.09-74.63z" fill="${brandColor}"/>
          <path d="m92.74 158.2h-30.02c-6.07 0-9.35-5.3-9.35-9.54v-12.78c0-1.33-1.08-2.04-2.21-2.04h-10.78c-1.34 0-2.17 1.12-2.17 2.16v12.75c0 12.13 10 24.66 24.1 24.66h15c1.34 0 2.01 0.88 2.01 2.01v13.06c0 1.24 0.96 2.22 2.09 2.22h11.17c1.13 0 1.88-1.05 1.88-2.1v-28.33c0-1.13-0.88-2.07-1.72-2.07z" fill="${brandColor}"/>
          <path class="otto-loading-bolt" d="m119.9 57.61h-37.29c-1.51 0-2.31 1.23-2.31 2.45v11.18c0 1.48 1.05 2.37 2.31 2.37h14.53c1.42 0 1.67 1.23 1 2.45l-14.14 25.73c-0.88 1.69-0.21 3.03 1.46 3.03h12.68c1.17 0 1.83-1.05 2.59-2.46l21.86-38.23c1.67-3.11 0.17-5.82-2.69-6.52z" fill="${isDark ? '#c9d1d9' : '#24292f'}"/>
          <path class="otto-loading-bolt" d="m51.41 104.8h-14.53c-1.42 0-2.17-1.21-1.25-3.03l14.14-24.71c1.14-2.04 0.47-3.47-1.36-3.47h-12.99c-1.59 0-2.55 0.7-3.21 2.12l-22.54 39.65c-1.04 2.34 0.61 4.89 3.05 4.89h38.69c1.42 0 1.96-1.22 1.96-2.35v-11.18c0-1.23-0.96-1.92-1.96-1.92z" fill="${isDark ? '#c9d1d9' : '#24292f'}"/>
        </svg>
      </div>
      <span class="otto-loading-label">Otto</span>
      <span class="otto-loading-msg" id="otto-load-msg">Initializing<span class="otto-loading-dots"></span></span>
    </div>
  `;

  const msgEl = shadow.getElementById('otto-load-msg');

  return {
    update(message: string) {
      if (msgEl) msgEl.innerHTML = `${message}<span class="otto-loading-dots"></span>`;
    },
    remove() {
      container.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Theme detection
// ---------------------------------------------------------------------------
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
// ---------------------------------------------------------------------------
// Shadow DOM styles
// ---------------------------------------------------------------------------
function getResetStyles(): string {
  return `
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  `;
}