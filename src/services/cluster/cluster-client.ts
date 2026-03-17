// ---------------------------------------------------------------------------
// Cluster Client — bridges Botto WebSocket to the cluster store.
//
// Responsibilities:
//   1. Request clusters via GET_CLUSTER when an MR page loads
//   2. Listen for CLUSTER_UPDATED broadcasts and update the store
//   3. Clean up listeners on disconnect/navigation
//
// Like conflict radar, cluster detection requires Botto for cross-MR visibility.
// Without Botto, Otto falls back to showing ticket-grouped MRs from the MR list
// (handled in the ClusterBanner component, not here).
// ---------------------------------------------------------------------------

import type { BottoClient } from '../../lib/botto-client';
import type { MrCluster } from '../../types/cluster';
import { useClusterStore } from './cluster-store';

/** Active listener cleanup function, if any. */
let unsubClusterUpdated: (() => void) | null = null;

/** Generation counter — incremented on each init to detect stale responses. */
let clusterGeneration = 0;

/**
 * Initialize cluster awareness for the current MR.
 * Fetches clusters containing this MR and subscribes to live updates.
 *
 * Call this once when the MR page loads and Botto is connected.
 * Call `teardownClusterClient()` when navigating away.
 */
export async function initClusterClient(
  botto: BottoClient,
  projectPath: string,
  mrIid: number,
): Promise<void> {
  const store = useClusterStore.getState();

  // Clean up any previous subscription
  teardownClusterClient();

  // Capture the current generation so we can detect if the user navigated
  // away (triggering a new init or teardown) while our fetch was in-flight.
  const gen = ++clusterGeneration;

  // Subscribe to live updates first
  unsubClusterUpdated = botto.onMessage('CLUSTER_UPDATED', (data) => {
    const msg = data as { cluster?: MrCluster };
    const cluster = msg.cluster;

    if (!cluster) return;

    // Only update if this cluster involves our MR
    const involveUs = cluster.memberMrs?.some((m) => m.mrIid === mrIid);
    if (involveUs) {
      useClusterStore.getState().updateCluster(cluster);
    }
  });

  // Fetch initial clusters
  store.setLoading();

  try {
    const response = await botto.sendRequest<{ ok: boolean; data?: { clusters: MrCluster[] }; error?: string }>({
      type: 'GET_CLUSTER',
      project_path: projectPath,
      mr_iid: mrIid,
    });

    // Stale response guard: if the generation changed while we were awaiting,
    // the user navigated to a different MR. Discard this response.
    if (gen !== clusterGeneration) return;

    if (response?.ok && response.data) {
      store.setClusters(response.data.clusters ?? []);
    } else {
      store.setClusters([]);
    }
  } catch (e) {
    if (gen !== clusterGeneration) return;
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.warn('[otto] cluster fetch failed:', msg);
    store.setError(msg);
  }
}

/**
 * Clean up cluster client subscriptions.
 * Call when navigating away from an MR or disconnecting from Botto.
 */
export function teardownClusterClient(): void {
  unsubClusterUpdated?.();
  unsubClusterUpdated = null;
  useClusterStore.getState().reset();
}
