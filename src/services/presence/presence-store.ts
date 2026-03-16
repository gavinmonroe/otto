// ---------------------------------------------------------------------------
// Presence Store — lightweight Zustand store for file-level viewer presence.
//
// Separate from the review store to avoid adding subscribers to the hot path.
// The review store has 40+ subscribers that fire on every streaming delta —
// presence updates (every 2-3s) should not trigger those.
//
// State shape: a Map of user_id → files they're currently viewing.
// Updated by PRESENCE_UPDATE (delta) and PRESENCE_SNAPSHOT (bulk) messages
// from Botto. Read by the presence-injector for rendering avatar dots.
// ---------------------------------------------------------------------------

import { create } from 'zustand';

export type ViewerFile = {
  path: string;
  firstLine?: number;
  lastLine?: number;
};

export type ViewerPresence = {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
  files: ViewerFile[];
};

type PresenceState = {
  /** Map of user_id → their currently visible files. */
  viewers: Map<string, ViewerPresence>;
};

type PresenceActions = {
  /** Apply a delta update from a single user (PRESENCE_UPDATE). */
  updateViewer: (userId: string, files: ViewerFile[], displayName?: string, avatarUrl?: string) => void;

  /** Bulk-set all viewers from a snapshot (PRESENCE_SNAPSHOT on MR join). */
  setSnapshot: (viewers: ViewerPresence[]) => void;

  /** Remove a specific viewer (user left MR or disconnected — empty files). */
  removeViewer: (userId: string) => void;

  /** Clear all presence data (MR navigation, disconnect). */
  reset: () => void;
};

export const usePresenceStore = create<PresenceState & PresenceActions>((set) => ({
  viewers: new Map(),

  updateViewer: (userId, files, displayName?, avatarUrl?) =>
    set((state) => {
      // Empty files = user left — remove them
      if (files.length === 0) {
        if (!state.viewers.has(userId)) return state;
        const next = new Map(state.viewers);
        next.delete(userId);
        return { viewers: next };
      }
      const next = new Map(state.viewers);
      // Preserve existing display info if not provided in this delta
      const existing = state.viewers.get(userId);
      next.set(userId, {
        userId,
        displayName: displayName ?? existing?.displayName,
        avatarUrl: avatarUrl ?? existing?.avatarUrl,
        files,
      });
      return { viewers: next };
    }),

  setSnapshot: (viewers) =>
    set(() => {
      const map = new Map<string, ViewerPresence>();
      for (const v of viewers) {
        map.set(v.userId, v);
      }
      return { viewers: map };
    }),

  removeViewer: (userId) =>
    set((state) => {
      if (!state.viewers.has(userId)) return state;
      const next = new Map(state.viewers);
      next.delete(userId);
      return { viewers: next };
    }),

  reset: () => set({ viewers: new Map() }),
}));

// ---------------------------------------------------------------------------
// Derived helper — get all viewers for a specific file path.
// Called by the presence injector per file. Cheap: iterates the viewer map
// (typically 1-5 entries) and filters by file path.
// ---------------------------------------------------------------------------

export function getViewersForFile(filePath: string): ViewerPresence[] {
  const { viewers } = usePresenceStore.getState();
  const result: ViewerPresence[] = [];
  for (const viewer of viewers.values()) {
    if (viewer.files.some((f) => f.path === filePath)) {
      result.push(viewer);
    }
  }
  return result;
}
