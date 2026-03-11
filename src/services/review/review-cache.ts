// ---------------------------------------------------------------------------
// Review Cache — persists completed review results in chrome.storage.local.
//
// Cache key: `otto_review:{projectPath}:{mrIid}:{diffHash}`
// The diffHash is a simple hash of all diff content, so the cache auto-
// invalidates when the MR is updated (new commits, rebases, etc.).
//
// Design decisions:
// - Stored in chrome.storage.local (not sync — reviews can be large).
// - Each cached review includes a timestamp for TTL-based cleanup.
// - Max 50 cached reviews — oldest are evicted on save.
// - The cache stores the full review result (summary, file reviews,
//   related files, edge cases) plus comment statuses (accept/dismiss).
// - Cache is read by the content script on page load. If a valid cache
//   exists, the store is hydrated immediately — no AI calls needed.
// - Regeneration bypasses the cache and overwrites it on completion.
// ---------------------------------------------------------------------------

import type {
  MrSummary,
  FileReview,
  RelatedFile,
  EdgeCase,
  DiffFileData,
} from '@/types/review';

const CACHE_PREFIX = 'otto_review:';
const MAX_CACHED_REVIEWS = 50;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type CachedReview = {
  version: 1;
  projectPath: string;
  mrIid: number;
  diffHash: string;
  timestamp: number;
  summary: MrSummary | null;
  fileReviews: FileReview[];
  relatedFiles: RelatedFile[];
  edgeCases: EdgeCase[];
  /** Per-file diff hashes for incremental re-review. Maps filePath → hash. */
  fileDiffHashes: Record<string, string>;
};

/**
 * Build a cache key for a specific MR review.
 */
export function buildCacheKey(projectPath: string, mrIid: number, diffHash: string): string {
  return `${CACHE_PREFIX}${projectPath}:${mrIid}:${diffHash}`;
}

/**
 * Compute a simple hash of the diff content for cache invalidation.
 * Uses a fast string hash — not cryptographic, just for change detection.
 */
export function computeDiffHash(diffFiles: DiffFileData[]): string {
  const content = diffFiles
    .map((f) => `${f.filePath}:${f.isNew}:${f.isDeleted}:${f.diff}`)
    .join('\n');
  return simpleHash(content);
}

/**
 * Compute a hash for a single file's diff content.
 * Used for incremental re-review: only files whose hash changed get re-reviewed.
 */
export function computeFileDiffHash(file: DiffFileData): string {
  return simpleHash(`${file.filePath}:${file.isNew}:${file.isDeleted}:${file.diff}`);
}

/**
 * Build a map of filePath → diffHash for all files in the MR.
 */
export function computeFileDiffHashes(diffFiles: DiffFileData[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const file of diffFiles) {
    hashes[file.filePath] = computeFileDiffHash(file);
  }
  return hashes;
}

/**
 * Load a cached review from chrome.storage.local.
 * Returns null if no cache exists, cache is expired, or cache version mismatches.
 */
export async function loadCachedReview(
  projectPath: string,
  mrIid: number,
  diffHash: string,
): Promise<CachedReview | null> {
  try {
    const key = buildCacheKey(projectPath, mrIid, diffHash);
    const result = await chrome.storage.local.get(key);
    const cached = result[key] as CachedReview | undefined;

    if (!cached) return null;
    if (cached.version !== 1) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null;
    if (cached.diffHash !== diffHash) return null;

    return cached;
  } catch {
    return null;
  }
}

/**
 * Save a completed review to the cache.
 * Also evicts old entries if we exceed MAX_CACHED_REVIEWS.
 */
export async function saveCachedReview(review: CachedReview): Promise<void> {
  try {
    const key = buildCacheKey(review.projectPath, review.mrIid, review.diffHash);
    await chrome.storage.local.set({ [key]: review });
    await evictOldEntries();
  } catch {
    // Non-fatal — caching is best-effort
  }
}

/**
 * Delete a specific cached review (used before regeneration).
 */
export async function deleteCachedReview(
  projectPath: string,
  mrIid: number,
  diffHash: string,
): Promise<void> {
  try {
    const key = buildCacheKey(projectPath, mrIid, diffHash);
    await chrome.storage.local.remove(key);
  } catch {
    // Non-fatal
  }
}

/**
 * Load the most recent cached review for an MR, regardless of diffHash.
 * Used for incremental re-review: we need the previous per-file hashes
 * even when the overall diffHash has changed (new commits pushed).
 */
export async function loadLatestCachedReview(
  projectPath: string,
  mrIid: number,
): Promise<CachedReview | null> {
  try {
    const prefix = `${CACHE_PREFIX}${projectPath}:${mrIid}:`;
    const all = await chrome.storage.local.get(null);
    let latest: CachedReview | null = null;

    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(prefix)) continue;
      const cached = value as CachedReview;
      if (!cached || cached.version !== 1) continue;
      if (Date.now() - cached.timestamp > CACHE_TTL_MS) continue;
      if (!latest || cached.timestamp > latest.timestamp) {
        latest = cached;
      }
    }

    return latest;
  } catch {
    return null;
  }
}

/**
 * Evict oldest cached reviews if we exceed the max count.
 */
async function evictOldEntries(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null);
    const cacheEntries: Array<{ key: string; timestamp: number }> = [];

    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(CACHE_PREFIX) && value && typeof value === 'object' && 'timestamp' in value) {
        cacheEntries.push({ key, timestamp: (value as CachedReview).timestamp });
      }
    }

    if (cacheEntries.length <= MAX_CACHED_REVIEWS) return;

    // Sort oldest first, remove excess
    cacheEntries.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = cacheEntries.slice(0, cacheEntries.length - MAX_CACHED_REVIEWS);
    await chrome.storage.local.remove(toRemove.map((e) => e.key));
  } catch {
    // Non-fatal
  }
}

/**
 * Fast non-cryptographic string hash (djb2 variant).
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
