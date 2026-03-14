// ---------------------------------------------------------------------------
// Follow-Up Injector — mounts FollowUpButton into GitLab comment action bars
// and manages FollowUpPanel rendering below discussion threads.
//
// Design decisions:
// - Uses MutationObserver to catch lazy-loaded discussions (GitLab loads
//   them on scroll and tab switch).
// - Each button gets its own shadow DOM container for CSS isolation.
// - Panels are mounted below the discussion container (not inside the note)
//   so they span the full width and don't break GitLab's layout.
// - Tracks mounted buttons and panels by note ID to avoid duplicates and
//   enable cleanup.
// - Subscribes to the Zustand store to re-render panels when follow-up
//   state changes (e.g., analysis completes while panel is open).
// ---------------------------------------------------------------------------

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemeProvider } from '@/components/ThemeContext';
import { OttoErrorBoundary } from '@/components/OttoErrorBoundary';
import { FollowUpButton } from '@/components/followup/FollowUpButton';
import { FollowUpPanel } from '@/components/followup/FollowUpPanel';
import { useReviewStore } from '@/services/review/review-store';
import { getHealthLevel } from '@/services/review/health-monitor';

const BUTTON_ATTR = 'data-otto-followup-btn';
const PANEL_ATTR = 'data-otto-followup-panel';

type MountedButton = { root: Root; container: HTMLElement };
type MountedPanel = { root: Root; container: HTMLElement; commentId: string };

const mountedButtons = new Map<string, MountedButton>();
const mountedPanels = new Map<string, MountedPanel>();

// Track which panels are visible (toggled open)
const visiblePanels = new Set<string>();

/**
 * Start observing the DOM for GitLab comment notes and inject Otto
 * follow-up buttons into their action bars.
 *
 * Returns a cleanup function that removes all injected UI and stops observing.
 */
export function startFollowUpButtonInjection(isDarkMode: boolean, signal?: AbortSignal): () => void {
  // Initial scan — process notes already on the page
  scanAndInjectButtons(isDarkMode);

  // Watch for new notes (lazy-loaded discussions, tab switches)
  // Debounced to prevent cascading mutation storms on large MRs.
  let scanTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      pruneDetachedButtons();
      pruneDetachedPanels();
      scanAndInjectButtons(isDarkMode);
    }, 200);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Periodic rescan — catches virtual scrolling edge cases where GitLab
  // destroys and recreates note elements without triggering useful mutations.
  // Skipped in critical health to reduce main thread pressure.
  const rescanInterval = setInterval(() => {
    if (getHealthLevel() === 'critical') return;
    pruneDetachedButtons();
    pruneDetachedPanels();
    scanAndInjectButtons(isDarkMode);
  }, 3000);

  // Rescan when tab becomes visible — GitLab may re-render discussions
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      setTimeout(() => {
        pruneDetachedButtons();
        pruneDetachedPanels();
        scanAndInjectButtons(isDarkMode);
      }, 500);
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);

  // Subscribe to store for panel re-renders — only when followUps reference changes.
  // Without this, every streaming delta triggers panel iteration ~60 times/sec.
  let prevFollowUps = useReviewStore.getState().followUps;

  const storeUnsubscribe = useReviewStore.subscribe((state) => {
    if (state.followUps === prevFollowUps) return;
    prevFollowUps = state.followUps;

    for (const [commentId, panel] of mountedPanels) {
      const analysis = state.followUps[commentId];
      if (analysis && visiblePanels.has(commentId)) {
        renderPanel(panel, analysis, commentId, isDarkMode);
      }
    }
  });

  function cleanup() {
    observer.disconnect();
    storeUnsubscribe();
    clearInterval(rescanInterval);
    document.removeEventListener('visibilitychange', handleVisibility);
    if (scanTimer) clearTimeout(scanTimer);

    for (const [id, { root, container }] of mountedButtons) {
      root.unmount();
      container.remove();
      mountedButtons.delete(id);
    }

    for (const [id, { root, container }] of mountedPanels) {
      root.unmount();
      container.remove();
      mountedPanels.delete(id);
    }

    visiblePanels.clear();
  }

  if (signal) {
    signal.addEventListener('abort', cleanup, { once: true });
  }

  return cleanup;
}

// ---------------------------------------------------------------------------
// Pruning — remove tracked entries whose DOM containers were destroyed
// by GitLab's virtual scrolling or discussion re-rendering.
// ---------------------------------------------------------------------------

function pruneDetachedButtons(): void {
  for (const [noteId, { root, container }] of mountedButtons) {
    if (!container.isConnected) {
      root.unmount();
      mountedButtons.delete(noteId);
    }
  }
}

function pruneDetachedPanels(): void {
  for (const [commentId, { root, container }] of mountedPanels) {
    if (!container.isConnected) {
      root.unmount();
      mountedPanels.delete(commentId);
      visiblePanels.delete(commentId);
    }
  }
}

// ---------------------------------------------------------------------------
// DOM scanning and button injection
// ---------------------------------------------------------------------------

function scanAndInjectButtons(isDarkMode: boolean): void {
  // Find all note elements that have action bars.
  // GitLab uses different DOM structures across versions:
  // - Older: .note with .note-actions
  // - Newer: [data-testid] wrappers with different action bar classes
  // - Vue 3 migration: .timeline-entry containers
  // We cast a wide net and filter inside the loop.
  const noteElements = document.querySelectorAll(
    '.note:not([data-otto-followup-btn]), ' +
    '.timeline-entry:not([data-otto-followup-btn]), ' +
    '[data-testid="note-wrapper"]:not([data-otto-followup-btn]), ' +
    '[data-testid="noteable-note-container"]:not([data-otto-followup-btn]), ' +
    'li.note:not([data-otto-followup-btn])',
  );

  for (const noteEl of noteElements) {
    const htmlNote = noteEl as HTMLElement;

    // Skip system notes (e.g., "merged", "assigned to", "mentioned in")
    if (htmlNote.classList.contains('system-note')) continue;
    if (htmlNote.querySelector('.system-note-message')) continue;

    // Skip notes that are Otto's own injected UI
    if (htmlNote.closest('[data-otto-overview]') || htmlNote.closest('[data-otto-followup-panel]')) continue;

    // Find the action bar — try multiple selectors for GitLab version compat
    const actionBar = htmlNote.querySelector(
      '.note-actions, [data-testid="note-actions"], .note-header-actions',
    );
    if (!actionBar) continue;

    // Get a stable ID for this note
    const noteId = getNoteId(htmlNote);
    if (mountedButtons.has(noteId)) continue;

    // Mark as processed
    htmlNote.setAttribute(BUTTON_ATTR, noteId);

    injectButton(htmlNote, actionBar as HTMLElement, noteId, isDarkMode);
  }
}

function getNoteId(noteEl: HTMLElement): string {
  return (
    noteEl.getAttribute('data-note-id') ||
    noteEl.id?.replace('note_', '') ||
    noteEl.querySelector('[data-note-id]')?.getAttribute('data-note-id') ||
    `dom-${Math.random().toString(36).slice(2, 10)}`
  );
}

function injectButton(
  noteElement: HTMLElement,
  actionBar: HTMLElement,
  noteId: string,
  isDarkMode: boolean,
): void {
  // Create container for the button
  const container = document.createElement('div');
  container.style.display = 'inline-flex';
  container.style.alignItems = 'center';
  container.style.marginLeft = '4px';

  // Insert into the action bar
  actionBar.appendChild(container);

  // Shadow DOM for isolation
  const shadow = container.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = getButtonShadowStyles(isDarkMode);
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  const root = createRoot(mountPoint);

  const handleTogglePanel = (commentId: string) => {
    togglePanel(noteElement, commentId, isDarkMode);
  };

  root.render(
    createElement(ThemeProvider, {
      isDark: isDarkMode,
      children: createElement(OttoErrorBoundary, { name: 'FollowUpButton' },
        createElement(FollowUpButton, {
          noteElement,
          onTogglePanel: handleTogglePanel,
        }),
      ),
    }),
  );

  mountedButtons.set(noteId, { root, container });
}

// ---------------------------------------------------------------------------
// Panel management
// ---------------------------------------------------------------------------

function togglePanel(noteElement: HTMLElement, commentId: string, isDarkMode: boolean): void {
  if (visiblePanels.has(commentId)) {
    // Hide the panel
    visiblePanels.delete(commentId);
    const panel = mountedPanels.get(commentId);
    if (panel) {
      panel.container.style.display = 'none';
    }
    return;
  }

  // Show or create the panel
  visiblePanels.add(commentId);

  const existing = mountedPanels.get(commentId);
  if (existing) {
    existing.container.style.display = 'block';
    // Re-render with latest state
    const analysis = useReviewStore.getState().followUps[commentId];
    if (analysis) {
      renderPanel(existing, analysis, commentId, isDarkMode);
    }
    return;
  }

  // Create a new panel container below the discussion
  const discussion = noteElement.closest(
    '.discussion, .note-discussion, [data-discussion-id], .timeline-entry',
  ) || noteElement;

  const panelContainer = document.createElement('div');
  panelContainer.setAttribute(PANEL_ATTR, commentId);

  // Insert after the discussion container
  discussion.insertAdjacentElement('afterend', panelContainer);

  // Shadow DOM
  const shadow = panelContainer.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = getPanelShadowStyles();
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  const root = createRoot(mountPoint);
  const panel: MountedPanel = { root, container: panelContainer, commentId };
  mountedPanels.set(commentId, panel);

  const analysis = useReviewStore.getState().followUps[commentId];
  if (analysis) {
    renderPanel(panel, analysis, commentId, isDarkMode);
  }
}

function renderPanel(
  panel: MountedPanel,
  analysis: import('@/types/followup').FollowUpAnalysis,
  commentId: string,
  isDarkMode: boolean,
): void {
  const handleDismiss = () => {
    visiblePanels.delete(commentId);
    panel.container.style.display = 'none';
  };

  panel.root.render(
    createElement(ThemeProvider, {
      isDark: isDarkMode,
      children: createElement(OttoErrorBoundary, { name: 'FollowUpPanel' },
        createElement(FollowUpPanel, {
          analysis,
          onDismiss: handleDismiss,
        }),
      ),
    }),
  );
}

// ---------------------------------------------------------------------------
// Shadow DOM styles
// ---------------------------------------------------------------------------

function getButtonShadowStyles(isDarkMode: boolean): string {
  const brandColor = isDarkMode ? '#40C4F5' : '#0c93e7';
  const borderColor = isDarkMode ? '#374151' : '#e5e7eb';

  return `
    :host {
      display: inline-flex;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    @keyframes otto-followup-spin {
      to { transform: rotate(360deg); }
    }
    button {
      font-family: inherit;
    }
    button:hover:not(:disabled) {
      border-color: ${brandColor} !important;
      background: ${isDarkMode ? 'rgba(64, 196, 245, 0.1)' : 'rgba(12, 147, 231, 0.08)'} !important;
    }
  `;
}

function getPanelShadowStyles(): string {
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
