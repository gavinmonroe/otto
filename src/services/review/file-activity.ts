// ---------------------------------------------------------------------------
// File Activity Service — discovers recently-merged MRs that touched the
// same files as the current diff.
//
// Runs in the service worker. Called by the review orchestrator as a
// parallel task alongside summary/code-review/edge-cases.
//
// Design decisions:
// - Per-MR changed paths are cached in chrome.storage.local. Merged MRs are
//   immutable, so these caches only expire via TTL (30 days) or eviction.
// - Concurrency-limited to 5 parallel API calls to avoid hammering GitLab.
// - Non-fatal throughout — partial results are always returned.
// - The current MR is excluded from results.
// - Results are structured for three consumers: overview panel (aggregate),
//   per-file footer (file-level), and AI prompts (text).
// ---------------------------------------------------------------------------

import type { GitLabHost } from '@/types/settings';
import type { DiffFileData, FileActivity, FileActivityData, RecentMr } from '@/types/review';
import type { GitLabMergedMrSummary } from '@/types/gitlab';
import * as gitlab from '../gitlab/gitlab-client';

// ---------------------------------------------------------------------------
// Cache for per-MR changed paths (merged MRs are immutable)
// ---------------------------------------------------------------------------

const MR_PATHS_PREFIX = 'otto_mr_paths:';
const MR_PATHS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_CACHED_MR_PATHS = 200;

type CachedMrPaths = {
  projectId: number;
  mrIid: number;
  paths: string[];
  timestamp: number;
};

async function loadCachedMrPaths(
  projectId: number,
  mrIid: number,
): Promise<string[] | null> {
  try {
    const key = `${MR_PATHS_PREFIX}${projectId}:${mrIid}`;
    const result = await chrome.storage.local.get(key);
    const cached = result[key] as CachedMrPaths | undefined;
    if (!cached) return null;
    if (Date.now() - cached.timestamp > MR_PATHS_TTL_MS) return null;
    return cached.paths;
  } catch {
    return null;
  }
}

async function saveCachedMrPaths(
  projectId: number,
  mrIid: number,
  paths: string[],
): Promise<void> {
  try {
    const key = `${MR_PATHS_PREFIX}${projectId}:${mrIid}`;
    const entry: CachedMrPaths = { projectId, mrIid, paths, timestamp: Date.now() };
    await chrome.storage.local.set({ [key]: entry });
    // Best-effort eviction — don't block on it
    evictOldMrPaths().catch(() => {});
  } catch {
    // Non-fatal
  }
}

async function evictOldMrPaths(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const entries: Array<{ key: string; timestamp: number }> = [];

  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(MR_PATHS_PREFIX) && value && typeof value === 'object' && 'timestamp' in value) {
      entries.push({ key, timestamp: (value as CachedMrPaths).timestamp });
    }
  }

  if (entries.length <= MAX_CACHED_MR_PATHS) return;

  entries.sort((a, b) => a.timestamp - b.timestamp);
  const toRemove = entries.slice(0, entries.length - MAX_CACHED_MR_PATHS);
  await chrome.storage.local.remove(toRemove.map((e) => e.key));
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

const LOOKBACK_DAYS = 30;
const MAX_RECENT_MRS = 20;
const CONCURRENCY = 5;

type ProgressCallback = (message: string) => void;

/**
 * Discover file activity for the current MR's changed files.
 *
 * @param host - GitLab host config (url + PAT)
 * @param projectId - Numeric project ID
 * @param currentMrIid - The MR being reviewed (excluded from results)
 * @param targetBranch - The target branch of the current MR (filters recent MRs)
 * @param diffFiles - The current MR's changed files
 * @param onProgress - Optional callback for progress messages
 */
export async function discoverFileActivity(
  host: GitLabHost,
  projectId: number,
  currentMrIid: number,
  targetBranch: string,
  diffFiles: DiffFileData[],
  onProgress?: ProgressCallback,
): Promise<FileActivityData> {
  const currentPaths = new Set(diffFiles.map((f) => f.filePath));

  // 1. Fetch recent merged MRs — no target branch filter so we catch
  //    cross-branch activity (e.g., MRs merged to develop that touch the same files).
  const updatedAfter = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const mrListResult = await gitlab.fetchRecentMergedMrs(
    host,
    projectId,
    targetBranch,
    updatedAfter,
    MAX_RECENT_MRS,
  );

  if (!mrListResult.ok) {
    return emptyResult();
  }

  // Exclude the current MR and filter to MRs actually merged within the lookback window.
  // (updated_after catches MRs updated by comments — we only want recently merged ones.)
 const recentMrs = mrListResult.data.filter((mr) => mr.iid !== currentMrIid);

  if (recentMrs.length === 0) {
    onProgress?.('No recently-merged MRs found.');
    return emptyResult();
  }

  onProgress?.(`Found ${recentMrs.length} recently-merged MR(s). Checking changed files...`);

  // 2. Fetch changed paths for each MR (concurrency-limited, cache-first)
  const mrPathsMap = new Map<number, string[]>();

  for (let i = 0; i < recentMrs.length; i += CONCURRENCY) {
    const batch = recentMrs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((mr) => fetchPathsForMr(host, projectId, mr.iid)),
    );
    for (let j = 0; j < batch.length; j++) {
      if (results[j]) {
        mrPathsMap.set(batch[j].iid, results[j]!);
      }
    }
  }

  // 3. Cross-reference: for each current diff file, find which recent MRs touched it
  const fileActivities: FileActivity[] = [];
  const seenMrIids = new Set<number>();

  for (const filePath of currentPaths) {
    const matchingMrs: RecentMr[] = [];

    for (const mr of recentMrs) {
      const paths = mrPathsMap.get(mr.iid);
      if (!paths) continue;
      if (paths.includes(filePath)) {
        matchingMrs.push(toRecentMr(mr));
        seenMrIids.add(mr.iid);
      }
    }

    if (matchingMrs.length > 0) {
      // Sort by mergedAt descending
      matchingMrs.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
      fileActivities.push({ filePath, recentMrs: matchingMrs });
    }
  }

  if (fileActivities.length === 0) {
    onProgress?.('No overlapping file changes found in recent MRs.');
    return emptyResult();
  }

  const result: FileActivityData = {
    fileActivities,
    totalRecentMrs: seenMrIids.size,
    lookbackDays: LOOKBACK_DAYS,
  };

  const fileCount = fileActivities.length;
  onProgress?.(
    `${fileCount} file(s) were also modified in ${seenMrIids.size} recent MR(s).`,
  );

  return result;
}

/**
 * Format file activity data as text for injection into AI prompts.
 * Gives the AI awareness of recent changes to the same files.
 */
export function formatFileActivityForPrompt(data: FileActivityData): string {
  if (data.fileActivities.length === 0) return '';

  const lines: string[] = [
    `## Recent File Activity (last ${data.lookbackDays} days)`,
    `The following files in this MR were also modified in recently-merged MRs.`,
    `Pay attention to potential integration issues with these recent changes.`,
    '',
  ];

  for (const activity of data.fileActivities) {
    lines.push(`### ${activity.filePath}`);
    for (const mr of activity.recentMrs) {
      const daysAgo = Math.round(
        (Date.now() - new Date(mr.mergedAt).getTime()) / (24 * 60 * 60 * 1000),
      );
      lines.push(`- !${mr.iid} "${mr.title}" by @${mr.author} (merged ${daysAgo}d ago)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchPathsForMr(
  host: GitLabHost,
  projectId: number,
  mrIid: number,
): Promise<string[] | null> {
  // Check cache first — merged MRs are immutable
  const cached = await loadCachedMrPaths(projectId, mrIid);
  if (cached) return cached;

  const result = await gitlab.fetchMrChangedPaths(host, projectId, mrIid);
  if (!result.ok) return null;

  // Cache for future lookups
  await saveCachedMrPaths(projectId, mrIid, result.data);
  return result.data;
}

function toRecentMr(mr: GitLabMergedMrSummary): RecentMr {
  return {
    iid: mr.iid,
    title: mr.title,
    author: mr.author.username,
    mergedAt: mr.merged_at || new Date().toISOString(),
    webUrl: mr.web_url,
  };
}

function emptyResult(): FileActivityData {
  return { fileActivities: [], totalRecentMrs: 0, lookbackDays: LOOKBACK_DAYS };
}
