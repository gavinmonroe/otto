// ---------------------------------------------------------------------------
// Conflict Store — Zustand store for Conflict Radar state.
//
// Separate from the review store (same pattern as presence-store) to avoid
// triggering 40+ review subscribers on conflict updates. Conflict data
// changes infrequently (webhook-driven) and has different consumers.
//
// Hydrated via GET_CONFLICTS on MR page load (if Botto is connected).
// Updated via CONFLICT_UPDATED broadcast messages from Botto.
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import type { ConflictReport } from '../../types/conflict';

type ConflictState = {
  /** Current conflict report for the viewed MR. Null if not loaded yet. */
  report: ConflictReport | null;
  /** Loading status. */
  status: 'idle' | 'loading' | 'loaded' | 'error';
  /** Error message if status is 'error'. */
  error: string | null;
};

type ConflictActions = {
  /** Set the conflict report (from GET_CONFLICTS response or CONFLICT_UPDATED broadcast). */
  setReport: (report: ConflictReport) => void;
  /** Mark as loading (GET_CONFLICTS request in flight). */
  setLoading: () => void;
  /** Set error state. */
  setError: (error: string) => void;
  /** Clear all conflict data (MR navigation, disconnect). */
  reset: () => void;
};

export const useConflictStore = create<ConflictState & ConflictActions>((set) => ({
  report: null,
  status: 'idle',
  error: null,

  setReport: (report) =>
    set({ report, status: 'loaded', error: null }),

  setLoading: () =>
    set({ status: 'loading', error: null }),

  setError: (error) =>
    set({ status: 'error', error }),

  reset: () =>
    set({ report: null, status: 'idle', error: null }),
}));

// ---------------------------------------------------------------------------
// Derived helpers — used by UI components for quick lookups.
// ---------------------------------------------------------------------------

/** Get all conflicts for a specific file path. */
export function getConflictsForFile(filePath: string) {
  const { report } = useConflictStore.getState();
  if (!report) return [];
  const fc = report.conflicts.find((c) => c.filePath === filePath);
  return fc?.conflictingMrs ?? [];
}

/** Check if any high-severity conflicts exist. */
export function hasHighSeverityConflicts(): boolean {
  const { report } = useConflictStore.getState();
  if (!report) return false;
  return report.conflicts.some((fc) =>
    fc.conflictingMrs.some((cm) => cm.severity === 'high'),
  );
}

/** Total number of conflicting file/MR pairs. */
export function totalConflictCount(): number {
  const { report } = useConflictStore.getState();
  if (!report) return 0;
  return report.conflicts.reduce(
    (sum, fc) => sum + fc.conflictingMrs.length,
    0,
  );
}
