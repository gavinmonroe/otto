// ---------------------------------------------------------------------------
// Repo service — higher-level repository operations built on gitlab-client.
//
// This runs in the service worker. It provides operations like "fetch the
// content of multiple files" or "get the import graph for a file" that
// the review orchestrator needs.
//
// Design decisions:
// - Operates on projectId (numeric), not project path. The caller resolves
//   the path to an ID before calling these functions.
// - Batches file content fetches with concurrency control to avoid
//   hammering the GitLab API.
// - Import parsing is best-effort — it handles common patterns for JS/TS,
//   Python, Go, Ruby, Java but doesn't need to be perfect. The AI will
//   reason about relationships too.
// ---------------------------------------------------------------------------

import type { Result } from '@/types/messages';
import type { GitLabTreeItem } from '@/types/gitlab';
import * as gitlab from './gitlab-client';

type HostConfig = { url: string; pat: string };

/**
 * Fetch the content of multiple files, with concurrency control.
 * Returns a map of filePath → content (or null if fetch failed).
 */
export async function fetchMultipleFiles(
  host: HostConfig,
  projectId: number,
  filePaths: string[],
  ref: string,
  concurrency = 5,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();

  // Process in batches to avoid overwhelming the API
  for (let i = 0; i < filePaths.length; i += concurrency) {
    const batch = filePaths.slice(i, i + concurrency);
    const promises = batch.map(async (filePath) => {
      const result = await gitlab.fetchFileContent(host, projectId, filePath, ref);
      results.set(filePath, result.ok ? result.data : null);
    });
    await Promise.all(promises);
  }

  return results;
}

/**
 * Get the full recursive file tree for a project.
 * Caches nothing — the service worker can be terminated at any time.
 */
export async function getFullFileTree(
  host: HostConfig,
  projectId: number,
  ref: string,
): Promise<Result<GitLabTreeItem[]>> {
  return gitlab.fetchFileTree(host, projectId, ref, undefined, true);
}

/**
 * Extract import/require paths from file content.
 * Best-effort parsing — handles common patterns across languages.
 * Returns relative and absolute import paths as-is (not resolved).
 */
export function extractImports(content: string, filePath: string): string[] {
  const imports: string[] = [];
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  // JavaScript / TypeScript
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) {
    // import ... from '...'
    const esImports = content.matchAll(/(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]/g);
    for (const match of esImports) imports.push(match[1]);

    // require('...')
    const requires = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of requires) imports.push(match[1]);

    // Dynamic import('...')
    const dynamicImports = content.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of dynamicImports) imports.push(match[1]);
  }

  // Python
  if (['py'].includes(ext)) {
    // from x.y import z
    const fromImports = content.matchAll(/from\s+([\w.]+)\s+import/g);
    for (const match of fromImports) imports.push(match[1]);

    // import x.y
    const plainImports = content.matchAll(/^import\s+([\w.]+)/gm);
    for (const match of plainImports) imports.push(match[1]);
  }

  // Go
  if (['go'].includes(ext)) {
    const goImports = content.matchAll(/import\s+(?:\(\s*)?(?:[\w.]+\s+)?"([^"]+)"/g);
    for (const match of goImports) imports.push(match[1]);
  }

  // Ruby
  if (['rb'].includes(ext)) {
    const rubyRequires = content.matchAll(/require(?:_relative)?\s+['"]([^'"]+)['"]/g);
    for (const match of rubyRequires) imports.push(match[1]);
  }

  // Java / Kotlin
  if (['java', 'kt', 'kts'].includes(ext)) {
    const javaImports = content.matchAll(/import\s+([\w.]+)/g);
    for (const match of javaImports) imports.push(match[1]);
  }

  return [...new Set(imports)]; // Deduplicate
}

/**
 * Resolve a relative import path to an absolute project path.
 * Best-effort — handles common patterns but not all edge cases.
 */
export function resolveImportPath(
  importPath: string,
  fromFile: string,
  fileTree: string[],
): string | null {
  // Skip external packages (no relative path indicator)
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return null;
  }

  const fromDir = fromFile.split('/').slice(0, -1).join('/');
  let resolved: string;

  if (importPath.startsWith('/')) {
    resolved = importPath.slice(1); // Absolute from project root
  } else {
    // Resolve relative path
    const parts = fromDir.split('/').filter(Boolean);
    const importParts = importPath.split('/');

    for (const part of importParts) {
      if (part === '.') continue;
      if (part === '..') {
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    resolved = parts.join('/');
  }

  // Try exact match first
  if (fileTree.includes(resolved)) return resolved;

  // Try common extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rb', '.java', '.kt'];
  for (const ext of extensions) {
    if (fileTree.includes(resolved + ext)) return resolved + ext;
  }

  // Try index files
  const indexFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];
  for (const indexFile of indexFiles) {
    const indexPath = `${resolved}/${indexFile}`;
    if (fileTree.includes(indexPath)) return indexPath;
  }

  return null;
}
