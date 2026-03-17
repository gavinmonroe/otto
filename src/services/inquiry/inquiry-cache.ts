// ---------------------------------------------------------------------------
// Inquiry Cache — persists line inquiries in chrome.storage.local.
//
// Cache key: `otto_inquiry:{projectPath}:{mrIid}:{inquiryId}`
//
// Design decisions:
// - Keyed by projectPath + mrIid + inquiryId. Each inquiry is stored
//   independently so we can load/evict per-inquiry.
// - Includes a diffHash for the file — if the file's diff changes (new
//   commits), the cached inquiry is stale and should be invalidated.
//   Unlike chat (which persists across commits), inquiries are anchored
//   to specific line numbers that may shift.
// - Max 50 cached inquiries per MR, 7-day TTL.
// - Slides are stored in full (question + answer). No truncation — inquiries
//   are short-lived Q&A, not long conversations.
// ---------------------------------------------------------------------------

import type { CachedInquiry, InquirySlide } from '@/types/inquiry';

const INQUIRY_CACHE_PREFIX = 'otto_inquiry:';
const MAX_CACHED_INQUIRIES = 50;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function buildCacheKey(projectPath: string, mrIid: number, inquiryId: string): string {
  return `${INQUIRY_CACHE_PREFIX}${projectPath}:${mrIid}:${inquiryId}`;
}

// ---------------------------------------------------------------------------
// djb2 hash — duplicated from inquiry-store.ts to avoid circular imports.
// Same algorithm as review-cache.ts.
// ---------------------------------------------------------------------------

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Compute a diff hash for a single file's diff content. */
export function computeFileDiffHash(diff: string): string {
  return djb2(diff);
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load a single cached inquiry.
 * Returns null if not found, expired, or diff hash doesn't match.
 */
export async function loadCachedInquiry(
  projectPath: string,
  mrIid: number,
  inquiryId: string,
  currentDiffHash?: string,
): Promise<CachedInquiry | null> {
  try {
    const key = buildCacheKey(projectPath, mrIid, inquiryId);
    const result = await chrome.storage.local.get(key);
    const cached = result[key] as CachedInquiry | undefined;

    if (!cached) return null;
    if (Date.now() - cached.cachedAt > CACHE_TTL_MS) return null;
    // If a current diff hash is provided, validate against it
    if (currentDiffHash && cached.diffHash !== currentDiffHash) return null;

    return cached;
  } catch {
    return null;
  }
}

/**
 * Load all cached inquiries for an MR.
 * Filters out expired entries but does NOT validate diff hashes (caller
 * should do that per-file if needed).
 */
export async function loadAllCachedInquiries(
  projectPath: string,
  mrIid: number,
): Promise<CachedInquiry[]> {
  try {
    const prefix = `${INQUIRY_CACHE_PREFIX}${projectPath}:${mrIid}:`;
    const all = await chrome.storage.local.get(null);
    const results: CachedInquiry[] = [];
    const now = Date.now();

    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(prefix)) continue;
      const cached = value as CachedInquiry;
      if (now - cached.cachedAt > CACHE_TTL_MS) continue;
      results.push(cached);
    }

    return results;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Save an inquiry to the cache.
 */
export async function saveCachedInquiry(
  projectPath: string,
  mrIid: number,
  inquiry: {
    id: string;
    filePath: string;
    startLine: number;
    endLine: number;
    diffSnippet: string;
    codeContent: string;
    slides: InquirySlide[];
    savedForTeam: boolean;
  },
  fileDiff: string,
): Promise<void> {
  try {
    const key = buildCacheKey(projectPath, mrIid, inquiry.id);
    const cached: CachedInquiry = {
      id: inquiry.id,
      filePath: inquiry.filePath,
      startLine: inquiry.startLine,
      endLine: inquiry.endLine,
      diffSnippet: inquiry.diffSnippet,
      codeContent: inquiry.codeContent,
      slides: inquiry.slides,
      savedForTeam: inquiry.savedForTeam,
      diffHash: computeFileDiffHash(fileDiff),
      cachedAt: Date.now(),
    };
    await chrome.storage.local.set({ [key]: cached });
    await evictOldEntries(projectPath, mrIid);
  } catch {
    // Non-fatal — caching is best-effort
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete a single cached inquiry.
 */
export async function deleteCachedInquiry(
  projectPath: string,
  mrIid: number,
  inquiryId: string,
): Promise<void> {
  try {
    const key = buildCacheKey(projectPath, mrIid, inquiryId);
    await chrome.storage.local.remove(key);
  } catch {
    // Non-fatal
  }
}

/**
 * Delete all cached inquiries for an MR.
 */
export async function deleteAllCachedInquiries(
  projectPath: string,
  mrIid: number,
): Promise<void> {
  try {
    const prefix = `${INQUIRY_CACHE_PREFIX}${projectPath}:${mrIid}:`;
    const all = await chrome.storage.local.get(null);
    const toRemove = Object.keys(all).filter((k) => k.startsWith(prefix));
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
    }
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Eviction
// ---------------------------------------------------------------------------

/**
 * Evict oldest cached inquiries for an MR if we exceed the max count.
 */
async function evictOldEntries(projectPath: string, mrIid: number): Promise<void> {
  try {
    const prefix = `${INQUIRY_CACHE_PREFIX}${projectPath}:${mrIid}:`;
    const all = await chrome.storage.local.get(null);
    const entries: Array<{ key: string; cachedAt: number }> = [];

    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(prefix) || !value || typeof value !== 'object') continue;
      entries.push({ key, cachedAt: (value as CachedInquiry).cachedAt });
    }

    if (entries.length <= MAX_CACHED_INQUIRIES) return;

    entries.sort((a, b) => a.cachedAt - b.cachedAt);
    const toRemove = entries.slice(0, entries.length - MAX_CACHED_INQUIRIES);
    await chrome.storage.local.remove(toRemove.map((e) => e.key));
  } catch {
    // Non-fatal
  }
}
