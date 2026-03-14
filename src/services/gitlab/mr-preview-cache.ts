// ---------------------------------------------------------------------------
// MR Preview Cache — persists computed MR preview data in chrome.storage.local.
//
// Cache key: `otto_mrpreview:{projectPath}:{mrIid}`
//
// Design decisions:
// - Follows the same cache pattern as review-cache.ts and followup-cache.ts
//   (prefix keys, TTL, max entries, LRU eviction).
// - Keyed by projectPath + mrIid only (no diffHash). The list page doesn't
//   know the diffHash — it just needs a recent snapshot. TTL handles staleness.
// - Supports bulk loading via `loadCachedPreviews()` for the list page,
//   which needs to check cache for many MRs at once without N storage calls.
// - `extractRiskFromReviewCache()` is a standalone helper that any consumer
//   can call to pull risk level from an existing Otto review cache entry.
//   This avoids duplicating the review cache lookup logic.
// - 1-hour TTL balances freshness with API call reduction. MR list data
//   changes less frequently than individual MR diffs.
// ---------------------------------------------------------------------------

import type { MrPreviewData } from '@/types/mr-preview';

const CACHE_PREFIX = 'otto_mrpreview:';
const REVIEW_CACHE_PREFIX = 'otto_review:';
const MAX_CACHED_PREVIEWS = 200;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Build a cache key for a specific MR preview.
 */
export function buildPreviewCacheKey(projectPath: string, mrIid: number): string {
  return `${CACHE_PREFIX}${projectPath}:${mrIid}`;
}

/**
 * Load a single cached preview.
 * Returns null if no cache exists or cache is expired.
 */
export async function loadCachedPreview(
  projectPath: string,
  mrIid: number,
): Promise<MrPreviewData | null> {
  try {
    const key = buildPreviewCacheKey(projectPath, mrIid);
    const result = await chrome.storage.local.get(key);
    const cached = result[key] as MrPreviewData | undefined;

    if (!cached) return null;
    if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null;

    return cached;
  } catch {
    return null;
  }
}

/**
 * Load cached previews for multiple MRs in a single storage call.
 * Returns a Map of mrIid → MrPreviewData for all cache hits.
 * Expired entries are excluded.
 *
 * This is the primary interface for the list page — avoids N individual
 * storage reads when rendering a page of 20+ MRs.
 */
export async function loadCachedPreviews(
  projectPath: string,
  mrIids: number[],
): Promise<Map<number, MrPreviewData>> {
  const results = new Map<number, MrPreviewData>();
  if (mrIids.length === 0) return results;

  try {
    const keys = mrIids.map((iid) => buildPreviewCacheKey(projectPath, iid));
    const stored = await chrome.storage.local.get(keys);
    const now = Date.now();

    for (const iid of mrIids) {
      const key = buildPreviewCacheKey(projectPath, iid);
      const cached = stored[key] as MrPreviewData | undefined;
      if (cached && now - cached.fetchedAt <= CACHE_TTL_MS) {
        results.set(iid, cached);
      }
    }
  } catch {
    // Non-fatal — return whatever we have
  }

  return results;
}

/**
 * Save a computed preview to the cache.
 * Also evicts old entries if we exceed MAX_CACHED_PREVIEWS.
 */
export async function saveCachedPreview(preview: MrPreviewData): Promise<void> {
  try {
    const key = buildPreviewCacheKey(preview.projectPath, preview.mrIid);
    await chrome.storage.local.set({ [key]: preview });
    await evictOldPreviews();
  } catch {
    // Non-fatal — caching is best-effort
  }
}

/**
 * Extract the overall risk level from an existing Otto review cache entry.
 *
 * Scans review cache entries for the given MR and returns the risk level
 * from the most recent cached review's summary. Returns undefined if no
 * review has been cached.
 *
 * This is a reusable helper — any consumer that needs risk data for an MR
 * can call this without depending on the preview cache.
 */
export async function extractRiskFromReviewCache(
  projectPath: string,
  mrIid: number,
): Promise<'low' | 'medium' | 'high' | undefined> {
  try {
    const prefix = `${REVIEW_CACHE_PREFIX}${projectPath}:${mrIid}:`;
    const all = await chrome.storage.local.get(null);
    let latestTimestamp = 0;
    let riskLevel: 'low' | 'medium' | 'high' | undefined;

    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(prefix)) continue;
      const cached = value as { timestamp?: number; fileReviews?: Array<{ riskLevel?: string }> };
      if (!cached || typeof cached.timestamp !== 'number') continue;
      if (cached.timestamp <= latestTimestamp) continue;

      latestTimestamp = cached.timestamp;

      // Derive overall risk from file reviews: highest risk wins
      if (cached.fileReviews && cached.fileReviews.length > 0) {
        const risks = cached.fileReviews.map((fr) => fr.riskLevel).filter(Boolean);
        if (risks.includes('high')) riskLevel = 'high';
        else if (risks.includes('medium')) riskLevel = 'medium';
        else if (risks.length > 0) riskLevel = 'low';
      }
    }

    return riskLevel;
  } catch {
    return undefined;
  }
}

/**
 * Evict oldest cached previews if we exceed the max count.
 */
async function evictOldPreviews(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null);
    const entries: Array<{ key: string; fetchedAt: number }> = [];

    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(CACHE_PREFIX)) continue;
      const cached = value as MrPreviewData | undefined;
      if (cached && typeof cached.fetchedAt === 'number') {
        entries.push({ key, fetchedAt: cached.fetchedAt });
      }
    }

    if (entries.length <= MAX_CACHED_PREVIEWS) return;

    // Sort oldest first, remove excess
    entries.sort((a, b) => a.fetchedAt - b.fetchedAt);
    const toRemove = entries.slice(0, entries.length - MAX_CACHED_PREVIEWS);
    await chrome.storage.local.remove(toRemove.map((e) => e.key));
  } catch {
    // Non-fatal
  }
}
