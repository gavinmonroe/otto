// ---------------------------------------------------------------------------
// Cluster Store — Zustand store for Cross-MR Cluster state.
//
// Separate from the review store (same pattern as presence-store and
// conflict-store) to avoid triggering review subscribers on cluster updates.
//
// Hydrated via GET_CLUSTER on MR page load (if Botto is connected).
// Updated via CLUSTER_UPDATED broadcast messages from Botto.
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import type { MrCluster } from '../../types/cluster';

type ClusterState = {
  /** Clusters containing the current MR. Usually 0-2 clusters. */
  clusters: MrCluster[];
  /** Loading status. */
  status: 'idle' | 'loading' | 'loaded' | 'error';
  /** Error message if status is 'error'. */
  error: string | null;
};

type ClusterActions = {
  /** Set the cluster list (from GET_CLUSTER response). */
  setClusters: (clusters: MrCluster[]) => void;
  /** Update a single cluster (from CLUSTER_UPDATED broadcast). */
  updateCluster: (cluster: MrCluster) => void;
  /** Remove a cluster by ID (dissolved after MR merge/close). */
  removeCluster: (clusterId: string) => void;
  /** Mark as loading (GET_CLUSTER request in flight). */
  setLoading: () => void;
  /** Set error state. */
  setError: (error: string) => void;
  /** Clear all cluster data (MR navigation, disconnect). */
  reset: () => void;
};

export const useClusterStore = create<ClusterState & ClusterActions>((set) => ({
  clusters: [],
  status: 'idle',
  error: null,

  setClusters: (clusters) =>
    set({ clusters, status: 'loaded', error: null }),

  updateCluster: (cluster) =>
    set((state) => {
      const idx = state.clusters.findIndex((c) => c.id === cluster.id);
      const next = [...state.clusters];
      if (idx >= 0) {
        next[idx] = cluster;
      } else {
        next.push(cluster);
      }
      return { clusters: next, status: 'loaded', error: null };
    }),

  removeCluster: (clusterId) =>
    set((state) => ({
      clusters: state.clusters.filter((c) => c.id !== clusterId),
    })),

  setLoading: () =>
    set({ status: 'loading', error: null }),

  setError: (error) =>
    set({ status: 'error', error }),

  reset: () =>
    set({ clusters: [], status: 'idle', error: null }),
}));

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

/** Get the primary cluster (highest relevance) for the current MR. */
export function getPrimaryCluster(): MrCluster | null {
  const { clusters } = useClusterStore.getState();
  if (clusters.length === 0) return null;
  return clusters.reduce((best, c) =>
    c.relevanceScore > best.relevanceScore ? c : best,
  );
}

/** Get all sibling MR IIDs (other MRs in any cluster, excluding the given IID). */
export function getSiblingMrIids(currentMrIid: number): number[] {
  const { clusters } = useClusterStore.getState();
  const iids = new Set<number>();
  for (const cluster of clusters) {
    for (const member of cluster.memberMrs) {
      if (member.mrIid !== currentMrIid) {
        iids.add(member.mrIid);
      }
    }
  }
  return Array.from(iids);
}
