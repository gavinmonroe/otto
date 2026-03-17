// ---------------------------------------------------------------------------
// Conflict Client — bridges Botto WebSocket to the conflict store.
//
// Responsibilities:
//   1. Request conflicts via GET_CONFLICTS when an MR page loads
//   2. Listen for CONFLICT_UPDATED broadcasts and update the store
//   3. Clean up listeners on disconnect/navigation
//
// Requires Botto connection — conflict radar is server-side only because
// it needs cross-MR visibility that a single browser extension can't have.
// ---------------------------------------------------------------------------

import type { BottoClient } from '../../lib/botto-client';
import type { ConflictReport } from '../../types/conflict';
import { useConflictStore } from './conflict-store';

/** Active listener cleanup function, if any. */
let unsubConflictUpdated: (() => void) | null = null;

/** Generation counter — incremented on each init to detect stale responses. */
let conflictGeneration = 0;

/**
 * Initialize conflict radar for the current MR.
 * Fetches the initial conflict report and subscribes to live updates.
 *
 * Call this once when the MR page loads and Botto is connected.
 * Call `teardownConflictClient()` when navigating away.
 */
export async function initConflictClient(
  botto: BottoClient,
  projectPath: string,
  mrIid: number,
): Promise<void> {
  const store = useConflictStore.getState();

  // Clean up any previous subscription
  teardownConflictClient();

  // Capture the current generation so we can detect if the user navigated
  // away (triggering a new init or teardown) while our fetch was in-flight.
  const gen = ++conflictGeneration;

  // Subscribe to live updates first (so we don't miss broadcasts
  // that arrive between the request and response)
  unsubConflictUpdated = botto.onMessage('CONFLICT_UPDATED', (data) => {
    const msg = data as { mr_iid?: number; mrIid?: number; conflicts?: ConflictReport };
    const reportMrIid = msg.mrIid ?? msg.mr_iid;

    // Only update if this broadcast is for our MR
    if (reportMrIid === mrIid && msg.conflicts) {
      useConflictStore.getState().setReport(msg.conflicts);
    }
  });

  // Fetch initial conflict report
  store.setLoading();

  try {
    const response = await botto.sendRequest<{ ok: boolean; data?: { mrIid: number; conflicts: ConflictReport['conflicts'] }; error?: string }>({
      type: 'GET_CONFLICTS',
      project_path: projectPath,
      mr_iid: mrIid,
    });

    // Stale response guard: if the generation changed while we were awaiting,
    // the user navigated to a different MR. Discard this response.
    if (gen !== conflictGeneration) return;

    if (response?.ok && response.data) {
      store.setReport({
        mrIid: response.data.mrIid ?? mrIid,
        conflicts: response.data.conflicts ?? [],
      });
    } else {
      // No conflicts or feature disabled — set empty report
      store.setReport({ mrIid, conflicts: [] });
    }
  } catch (e) {
    if (gen !== conflictGeneration) return;
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.warn('[otto] conflict radar fetch failed:', msg);
    store.setError(msg);
  }
}

/**
 * Clean up conflict client subscriptions.
 * Call when navigating away from an MR or disconnecting from Botto.
 */
export function teardownConflictClient(): void {
  unsubConflictUpdated?.();
  unsubConflictUpdated = null;
  useConflictStore.getState().reset();
}
