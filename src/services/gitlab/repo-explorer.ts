// ---------------------------------------------------------------------------
// Repo Explorer — provides tool-callable functions for AI-driven repo
// exploration during related files discovery.
//
// Runs in the service worker. Each function maps to a tool the AI can call
// to navigate the repository structure and find real file paths.
//
// Design decisions:
// - Non-recursive directory listing by default (fast, single API call)
// - Recursive subtree fetch for targeted exploration
// - File search uses a cached full tree (fetched once, reused across calls)
// - All returned paths are real — they come directly from the GitLab API
// ---------------------------------------------------------------------------

import * as gitlab from '../gitlab/gitlab-client';
import type { GitLabTreeItem } from '@/types/gitlab';

type HostConfig = { url: string; pat: string };

export type RepoExplorerContext = {
  host: HostConfig;
  projectId: number;
  ref: string;
  /** Lazily populated full tree cache for search_files */
  _fullTreeCache: string[] | null;
};

export function createExplorerContext(
  host: HostConfig,
  projectId: number,
  ref: string,
): RepoExplorerContext {
  return { host, projectId, ref, _fullTreeCache: null };
}

/**
 * List files and subdirectories at a given path (single level).
 */
export async function listDirectory(
  ctx: RepoExplorerContext,
  path: string,
): Promise<{ entries: Array<{ name: string; type: 'file' | 'dir'; path: string }> }> {
  const result = await gitlab.fetchFileTree(
    ctx.host,
    ctx.projectId,
    ctx.ref,
    path || undefined,
    false,
  );

  if (!result.ok) {
    return { entries: [] };
  }

  return {
    entries: result.data.map((item) => ({
      name: item.name,
      type: item.type === 'blob' ? 'file' as const : 'dir' as const,
      path: item.path,
    })),
  };
}

/**
 * Get all file paths under a directory recursively.
 * Capped at 500 results to keep context manageable.
 */
export async function getSubtree(
  ctx: RepoExplorerContext,
  path: string,
): Promise<{ files: string[] }> {
  const result = await gitlab.fetchFileTree(
    ctx.host,
    ctx.projectId,
    ctx.ref,
    path || undefined,
    true,
  );

  if (!result.ok) {
    return { files: [] };
  }

  const files = result.data
    .filter((item) => item.type === 'blob')
    .map((item) => item.path)
    .slice(0, 500);

  return { files };
}

/**
 * Search for files by name pattern across the entire repo.
 * Uses a cached full tree (fetched once per review session).
 * Pattern matching is case-insensitive substring match.
 */
export async function searchFiles(
  ctx: RepoExplorerContext,
  pattern: string,
): Promise<{ matches: string[] }> {
  // Lazily fetch and cache the full tree
  if (!ctx._fullTreeCache) {
    ctx._fullTreeCache = await fetchFullTreePaths(ctx);
  }

  const lower = pattern.toLowerCase();
  const matches = ctx._fullTreeCache.filter((p) => p.toLowerCase().includes(lower));

  // Cap results to keep context manageable
  return { matches: matches.slice(0, 100) };
}

/**
 * Fetch all file paths in the repo. For large repos this may be incomplete
 * (GitLab paginates at 100 items per page, max 10 pages = 1000 items).
 * We fetch with higher page limits to get better coverage.
 */
async function fetchFullTreePaths(ctx: RepoExplorerContext): Promise<string[]> {
  // Fetch the recursive tree — gitlab-client handles pagination
  const result = await gitlab.fetchFileTree(
    ctx.host,
    ctx.projectId,
    ctx.ref,
    undefined,
    true,
  );

  if (!result.ok) return [];

  return result.data
    .filter((item) => item.type === 'blob')
    .map((item) => item.path);
}

// ---------------------------------------------------------------------------
// Tool definitions — OpenAI function calling format
// ---------------------------------------------------------------------------

export const REPO_EXPLORER_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_directory',
      description: 'List files and subdirectories at a given path in the repository. Use empty string for root directory.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path from project root (e.g. "src/services"). Use "" for root.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_subtree',
      description: 'Get all file paths under a directory recursively. Returns up to 500 files. Use this to see all files in a specific area of the codebase.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path from project root (e.g. "src/components"). Use "" for root.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_files',
      description: 'Search for files by name pattern across the entire repository. Case-insensitive substring match. Use this to find specific files like test files, interfaces, configs, etc.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Search pattern to match against file paths (e.g. "IAutomationStep", "test", ".config").',
          },
        },
        required: ['pattern'],
      },
    },
  },
];

/**
 * Execute a tool call and return the result as a JSON string.
 */
export async function executeToolCall(
  ctx: RepoExplorerContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case 'list_directory': {
      const result = await listDirectory(ctx, (args.path as string) || '');
      return JSON.stringify(result);
    }
    case 'get_subtree': {
      const result = await getSubtree(ctx, (args.path as string) || '');
      return JSON.stringify(result);
    }
    case 'search_files': {
      const result = await searchFiles(ctx, (args.pattern as string) || '');
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}
