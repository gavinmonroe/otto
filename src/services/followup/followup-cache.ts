// ---------------------------------------------------------------------------
// Follow-Up Cache — persists comment follow-up analyses in chrome.storage.
//
// Cache key: `otto_followup:{projectPath}:{mrIid}:{commentId}`
// The threadHash ensures cache invalidates when the thread changes
// (new replies added).
//
// Design decisions:
// - Separate key prefix (`otto_followup:`) so follow-up entries don't
//   collide with review cache entries.
// - Max 100 cached follow-ups with 14-day TTL.
// - Each entry is small (~1KB) so storage pressure is low.
// ---------------------------------------------------------------------------

import type { FollowUpAnalysis } from '@/types/followup';

const CACHE_PREFIX = 'otto_followup:';
const MAX_CACHED = 100;
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export type CachedFollowUp = {
  version: 1;
  projectPath: string;
  mrIid: number;
  commentId: string;
  threadHash: string;
  timestamp: number;
  analysis: FollowUpAnalysis;
};

function buildKey(projectPath: string, mrIid: number, commentId: string): string {
  return `${CACHE_PREFIX}${projectPath}:${mrIid}:${commentId}`;
}

export async function loadCachedFollowUp(
  projectPath: string,
  mrIid: number,
  commentId: string,
  threadHash: string,
): Promise<CachedFollowUp | null> {
  try {
    const key = buildKey(projectPath, mrIid, commentId);
    const result = await chrome.storage.local.get(key);
    const cached = result[key] as CachedFollowUp | undefined;

    if (!cached) return null;
    if (cached.version !== 1) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null;
    if (cached.threadHash !== threadHash) return null;

    return cached;
  } catch {
    return null;
  }
}

export async function saveCachedFollowUp(entry: CachedFollowUp): Promise<void> {
  try {
    const key = buildKey(entry.projectPath, entry.mrIid, entry.commentId);
    await chrome.storage.local.set({ [key]: entry });
    await evictOld();
  } catch {
    // Non-fatal
  }
}

async function evictOld(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null);
    const entries: Array<{ key: string; timestamp: number }> = [];

    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(CACHE_PREFIX) && value && typeof value === 'object' && 'timestamp' in value) {
        entries.push({ key, timestamp: (value as CachedFollowUp).timestamp });
      }
    }

    if (entries.length <= MAX_CACHED) return;

    entries.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = entries.slice(0, entries.length - MAX_CACHED);
    await chrome.storage.local.remove(toRemove.map((e) => e.key));
  } catch {
    // Non-fatal
  }
}
