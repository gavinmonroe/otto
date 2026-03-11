// ---------------------------------------------------------------------------
// GitLab REST API v4 client — runs in the service worker only.
//
// Design decisions:
// - Pure functions, not a class. Each function takes the host config (url + pat)
//   explicitly. This avoids holding state in the service worker (which can be
//   terminated at any time) and makes each call self-contained.
// - Returns Result<T> for all operations — callers handle errors explicitly.
// - Pagination is handled internally for list endpoints — callers get full arrays.
// - Uses native fetch (available in service workers, no CORS restrictions).
// - Retry logic is handled by the caller (withRetry from utils.ts) — this layer
//   is responsible only for making the HTTP call and parsing the response.
// ---------------------------------------------------------------------------

import type { Result } from '@/types/messages';
import type {
  GitLabProject,
  GitLabMergeRequest,
  GitLabMrChanges,
  GitLabDiffFile,
  GitLabTreeItem,
  GitLabBlameRange,
} from '@/types/gitlab';
import { encodeProjectPath, normalizeUrl } from '@/lib/utils';

type GitLabHostConfig = {
  url: string;   // e.g., "https://gitlab.com"
  pat: string;   // Personal Access Token
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function gitlabFetch<T>(
  host: GitLabHostConfig,
  path: string,
  options?: { params?: Record<string, string | number | boolean | undefined> },
): Promise<Result<T>> {
  const baseUrl = normalizeUrl(host.url);
  const url = new URL(`${baseUrl}/api/v4${path}`);

  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'PRIVATE-TOKEN': host.pat,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 401) {
        return { ok: false, error: 'GitLab authentication failed. Check your Personal Access Token.' };
      }
      if (response.status === 403) {
        return { ok: false, error: 'GitLab access denied. Your PAT may lack the required scopes (read_api).' };
      }
      if (response.status === 404) {
        return { ok: false, error: `GitLab resource not found: ${path}` };
      }
      if (response.status === 429) {
        return { ok: false, error: 'GitLab rate limit exceeded. Try again in a moment.' };
      }
      return { ok: false, error: `GitLab API error ${response.status}: ${body.slice(0, 200)}` };
    }

    const data = await response.json() as T;
    return { ok: true, data };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return { ok: false, error: `Cannot reach GitLab at ${baseUrl}. Check the URL and your network.` };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'GitLab request failed' };
  }
}

/**
 * Fetch all pages of a paginated GitLab endpoint.
 * GitLab uses Link headers for pagination.
 */
async function gitlabFetchAll<T>(
  host: GitLabHostConfig,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  maxPages = 10,
): Promise<Result<T[]>> {
  const baseUrl = normalizeUrl(host.url);
  const allItems: T[] = [];
  let nextUrl: string | null = null;
  let page = 1;

  while (page <= maxPages) {
    const url = nextUrl
      ? new URL(nextUrl)
      : new URL(`${baseUrl}/api/v4${path}`);

    if (!nextUrl) {
      url.searchParams.set('per_page', '100');
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined) {
            url.searchParams.set(key, String(value));
          }
        }
      }
    }

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'PRIVATE-TOKEN': host.pat,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (response.status === 401) {
          return { ok: false, error: 'GitLab authentication failed. Check your Personal Access Token.' };
        }
        return { ok: false, error: `GitLab API error ${response.status}: ${body.slice(0, 200)}` };
      }

      const data = await response.json() as T[];
      allItems.push(...data);

      // Check for next page via Link header
      const linkHeader = response.headers.get('Link');
      nextUrl = parseLinkHeader(linkHeader);
      if (!nextUrl) break;

      page++;
    } catch (error) {
      if (allItems.length > 0) {
        // Return what we have so far if pagination fails mid-way
        return { ok: true, data: allItems };
      }
      return { ok: false, error: error instanceof Error ? error.message : 'GitLab request failed' };
    }
  }

  return { ok: true, data: allItems };
}

function parseLinkHeader(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch project metadata by path (e.g., "namespace/project").
 */
export async function fetchProject(
  host: GitLabHostConfig,
  projectPath: string,
): Promise<Result<GitLabProject>> {
  return gitlabFetch<GitLabProject>(host, `/projects/${encodeProjectPath(projectPath)}`);
}

/**
 * Fetch MR metadata.
 */
export async function fetchMergeRequest(
  host: GitLabHostConfig,
  projectId: number,
  mrIid: number,
): Promise<Result<GitLabMergeRequest>> {
  return gitlabFetch<GitLabMergeRequest>(host, `/projects/${projectId}/merge_requests/${mrIid}`);
}

/**
 * Fetch MR with full diff changes.
 * Note: This endpoint can be slow for large MRs. GitLab may return
 * truncated diffs for very large files (>1MB).
 */
export async function fetchMergeRequestChanges(
  host: GitLabHostConfig,
  projectId: number,
  mrIid: number,
): Promise<Result<{ mr: GitLabMergeRequest; changes: GitLabDiffFile[] }>> {
  const result = await gitlabFetch<GitLabMrChanges>(
    host,
    `/projects/${projectId}/merge_requests/${mrIid}/changes`,
    { params: { access_raw_diffs: true } },
  );
  if (!result.ok) return result;
  const { changes, ...mr } = result.data;
  return { ok: true, data: { mr, changes } };
}

/**
 * Fetch raw file content from the repository.
 * @param ref - Branch name, tag, or commit SHA
 */
export async function fetchFileContent(
  host: GitLabHostConfig,
  projectId: number,
  filePath: string,
  ref: string,
): Promise<Result<string>> {
  const baseUrl = normalizeUrl(host.url);
  const encodedPath = encodeURIComponent(filePath);
  const url = new URL(
    `${baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedPath}/raw`,
  );
  url.searchParams.set('ref', ref);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'PRIVATE-TOKEN': host.pat,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { ok: false, error: `File not found: ${filePath} at ref ${ref}` };
      }
      return { ok: false, error: `Failed to fetch file: ${response.status}` };
    }

    const content = await response.text();
    return { ok: true, data: content };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to fetch file' };
  }
}

/**
 * Fetch the repository file tree.
 * @param path - Subdirectory path (empty string for root)
 * @param ref - Branch name, tag, or commit SHA
 * @param recursive - Whether to fetch the full tree recursively
 */
export async function fetchFileTree(
  host: GitLabHostConfig,
  projectId: number,
  ref: string,
  path?: string,
  recursive?: boolean,
): Promise<Result<GitLabTreeItem[]>> {
  return gitlabFetchAll<GitLabTreeItem>(
    host,
    `/projects/${projectId}/repository/tree`,
    { ref, path, recursive: recursive ?? false },
  );
}

/**
 * Fetch git blame for a file.
 */
export async function fetchBlame(
  host: GitLabHostConfig,
  projectId: number,
  filePath: string,
  ref: string,
): Promise<Result<GitLabBlameRange[]>> {
  const encodedPath = encodeURIComponent(filePath);
  return gitlabFetchAll<GitLabBlameRange>(
    host,
    `/projects/${projectId}/repository/files/${encodedPath}/blame`,
    { ref },
  );
}

/**
 * Test the connection to a GitLab host.
 * Returns the authenticated user's username on success.
 */
export async function testConnection(
  host: GitLabHostConfig,
): Promise<Result<{ username: string }>> {
  const result = await gitlabFetch<{ username: string }>(host, '/user');
  if (!result.ok) return result;
  return { ok: true, data: { username: result.data.username } };
}
