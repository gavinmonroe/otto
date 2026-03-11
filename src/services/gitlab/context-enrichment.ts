// ---------------------------------------------------------------------------
// Context Enrichment Service — smart repo analysis for richer reviews.
//
// Runs in the service worker. Before AI calls, this service analyzes the
// repo to find files that reference, import, or call code from the changed
// files. This gives the AI reviewer the same context a human reviewer
// would gather by tracing through the codebase.
//
// What it discovers:
// - Reverse imports: files that import from changed files
// - Forward imports: files that changed files import from
// - Test files: test/spec files for changed modules
// - Config references: config files that reference changed paths
// - Callers: files that reference exported symbols from changed files
//
// Design decisions:
// - Uses the file tree + grep-like content search via GitLab API
// - Batches requests with concurrency control
// - Returns structured EnrichedContext that prompts can consume
// - Tolerant of failures — returns what it can find
// ---------------------------------------------------------------------------

import type { Result } from '@/types/messages';
import type { GitLabTreeItem } from '@/types/gitlab';
import type { DiffFileData } from '@/types/review';
import * as gitlab from '../gitlab/gitlab-client';
import { extractImports, resolveImportPath } from '../gitlab/repo-service';

type HostConfig = { url: string; pat: string };

/**
 * Enriched context for a single changed file.
 */
export type FileContext = {
  filePath: string;
  /** Files that import this file */
  importedBy: string[];
  /** Files this file imports (resolved to project paths) */
  imports: string[];
  /** Test files that likely test this file */
  testFiles: string[];
  /** Exported symbols (function/class/const names) from this file */
  exportedSymbols: string[];
  /** Files that reference exported symbols from this file */
  referencedBy: Array<{ filePath: string; symbol: string }>;
};

/**
 * Full enriched context for the MR.
 */
export type EnrichedContext = {
  fileContexts: Map<string, FileContext>;
  /** All file paths in the project (blob type only) */
  projectFiles: string[];
};

/**
 * Build enriched context for all changed files in the MR.
 *
 * @param host - GitLab host config
 * @param projectId - Numeric project ID
 * @param diffFiles - Changed files from the MR
 * @param sourceBranch - Source branch ref for fetching file contents
 * @param fileTree - Pre-fetched file tree (if available)
 */
export async function buildEnrichedContext(
  host: HostConfig,
  projectId: number,
  diffFiles: DiffFileData[],
  sourceBranch: string,
  fileTree?: GitLabTreeItem[],
): Promise<EnrichedContext> {
  // Get the full file tree if not provided
  let allFiles: string[];
  if (fileTree) {
    allFiles = fileTree.filter((f) => f.type === 'blob').map((f) => f.path);
  } else {
    const treeResult = await gitlab.fetchFileTree(host, projectId, sourceBranch, undefined, true);
    allFiles = treeResult.ok
      ? treeResult.data.filter((f) => f.type === 'blob').map((f) => f.path)
      : [];
  }

  const changedPaths = new Set(diffFiles.map((f) => f.filePath));
  const fileContexts = new Map<string, FileContext>();

  // Phase 1: Fetch content of changed files to extract exports + imports
  const changedFileContents = new Map<string, string>();
  const contentBatchSize = 5;
  const nonDeletedFiles = diffFiles.filter((f) => !f.isDeleted);

  for (let i = 0; i < nonDeletedFiles.length; i += contentBatchSize) {
    const batch = nonDeletedFiles.slice(i, i + contentBatchSize);
    const promises = batch.map(async (file) => {
      // Fetch from source branch (the new version)
      const result = await gitlab.fetchFileContent(host, projectId, file.filePath, sourceBranch);
      if (result.ok) {
        changedFileContents.set(file.filePath, result.data);
      }
    });
    await Promise.all(promises);
  }

  // Phase 2: For each changed file, analyze imports, exports, and find reverse deps
  for (const file of diffFiles) {
    const content = changedFileContents.get(file.filePath) || '';
    const ctx: FileContext = {
      filePath: file.filePath,
      importedBy: [],
      imports: [],
      testFiles: [],
      exportedSymbols: [],
      referencedBy: [],
    };

    // Extract what this file imports
    if (content) {
      const rawImports = extractImports(content, file.filePath);
      ctx.imports = rawImports
        .map((imp) => resolveImportPath(imp, file.filePath, allFiles))
        .filter((p): p is string => p !== null);
    }

    // Extract exported symbols
    if (content) {
      ctx.exportedSymbols = extractExportedSymbols(content, file.filePath);
    }

    // Find test files by naming convention
    ctx.testFiles = findTestFiles(file.filePath, allFiles);

    fileContexts.set(file.filePath, ctx);
  }

  // Phase 3: Find reverse imports — scan nearby files that might import changed files
  // We don't scan the entire repo (too expensive), but scan files in the same
  // and parent directories, plus files that share directory prefixes.
  const candidateFiles = findCandidateImporters(diffFiles, allFiles);

  // Fetch candidate file contents in batches
  const candidateContents = new Map<string, string>();
  const candidates = candidateFiles.filter((f) => !changedPaths.has(f));

  for (let i = 0; i < candidates.length; i += contentBatchSize) {
    const batch = candidates.slice(i, i + contentBatchSize);
    const promises = batch.map(async (filePath) => {
      const result = await gitlab.fetchFileContent(host, projectId, filePath, sourceBranch);
      if (result.ok) {
        candidateContents.set(filePath, result.data);
      }
    });
    await Promise.all(promises);
  }

  // Check each candidate for imports of changed files
  for (const [candidatePath, candidateContent] of candidateContents) {
    const candidateImports = extractImports(candidateContent, candidatePath);

    for (const file of diffFiles) {
      const ctx = fileContexts.get(file.filePath);
      if (!ctx) continue;

      // Check if this candidate imports the changed file
      const resolvedImports = candidateImports
        .map((imp) => resolveImportPath(imp, candidatePath, allFiles))
        .filter((p): p is string => p !== null);

      if (resolvedImports.includes(file.filePath)) {
        ctx.importedBy.push(candidatePath);
      }

      // Check if this candidate references exported symbols
      for (const symbol of ctx.exportedSymbols) {
        // Simple heuristic: check if the symbol name appears in the file
        // and the file imports from the changed file
        if (resolvedImports.includes(file.filePath) && candidateContent.includes(symbol)) {
          ctx.referencedBy.push({ filePath: candidatePath, symbol });
        }
      }
    }
  }

  return { fileContexts, projectFiles: allFiles };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract exported symbol names from file content.
 * Handles JS/TS export patterns.
 */
function extractExportedSymbols(content: string, filePath: string): string[] {
  const symbols: string[] = [];
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) {
    // export function name
    const funcExports = content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g);
    for (const m of funcExports) symbols.push(m[1]);

    // export const/let/var name
    const varExports = content.matchAll(/export\s+(?:const|let|var)\s+(\w+)/g);
    for (const m of varExports) symbols.push(m[1]);

    // export class name
    const classExports = content.matchAll(/export\s+class\s+(\w+)/g);
    for (const m of classExports) symbols.push(m[1]);

    // export type/interface name
    const typeExports = content.matchAll(/export\s+(?:type|interface)\s+(\w+)/g);
    for (const m of typeExports) symbols.push(m[1]);

    // export default function/class name
    const defaultExports = content.matchAll(/export\s+default\s+(?:function|class)\s+(\w+)/g);
    for (const m of defaultExports) symbols.push(m[1]);

    // export { name1, name2 }
    const namedExports = content.matchAll(/export\s*\{([^}]+)\}/g);
    for (const m of namedExports) {
      const names = m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim());
      symbols.push(...names.filter((n) => n && !n.includes('*')));
    }
  }

  if (['py'].includes(ext)) {
    // Python: top-level def/class (all are implicitly exported)
    const defs = content.matchAll(/^(?:def|class)\s+(\w+)/gm);
    for (const m of defs) symbols.push(m[1]);
  }

  if (['go'].includes(ext)) {
    // Go: capitalized names are exported
    const goExports = content.matchAll(/^(?:func|type|var|const)\s+([A-Z]\w*)/gm);
    for (const m of goExports) symbols.push(m[1]);
  }

  return [...new Set(symbols)];
}

/**
 * Find test files for a given source file by naming convention.
 */
function findTestFiles(filePath: string, allFiles: string[]): string[] {
  const base = filePath.replace(/\.[^.]+$/, '');
  const ext = filePath.split('.').pop() || '';
  const dir = filePath.split('/').slice(0, -1).join('/');
  const fileName = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || '';

  const testPatterns = [
    // Same directory: file.test.ts, file.spec.ts
    `${base}.test.${ext}`,
    `${base}.spec.${ext}`,
    `${base}_test.${ext}`,
    // __tests__ directory
    `${dir}/__tests__/${fileName}.test.${ext}`,
    `${dir}/__tests__/${fileName}.spec.${ext}`,
    // test/ directory at same level
    `${dir}/test/${fileName}.test.${ext}`,
    `${dir}/test/${fileName}.spec.${ext}`,
    // Go convention
    `${base}_test.go`,
    // Python convention
    `${dir}/test_${fileName}.py`,
    `${dir}/tests/test_${fileName}.py`,
  ];

  return allFiles.filter((f) => testPatterns.includes(f));
}

/**
 * Find candidate files that might import changed files.
 * Scans files in the same directory, parent directory, and sibling directories.
 * Also includes index/barrel files that might re-export.
 * Caps at 50 files to avoid excessive API calls.
 */
function findCandidateImporters(diffFiles: DiffFileData[], allFiles: string[]): string[] {
  const changedDirs = new Set<string>();
  const changedPaths = new Set(diffFiles.map((f) => f.filePath));

  for (const file of diffFiles) {
    const parts = file.filePath.split('/');
    // Same directory
    changedDirs.add(parts.slice(0, -1).join('/'));
    // Parent directory
    if (parts.length > 2) {
      changedDirs.add(parts.slice(0, -2).join('/'));
    }
  }

  const codeExtensions = new Set([
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
    'py', 'go', 'rb', 'java', 'kt', 'kts',
  ]);

  const candidates = allFiles.filter((f) => {
    if (changedPaths.has(f)) return false;
    const ext = f.split('.').pop()?.toLowerCase() || '';
    if (!codeExtensions.has(ext)) return false;

    const dir = f.split('/').slice(0, -1).join('/');
    // File is in a directory near the changed files
    if (changedDirs.has(dir)) return true;
    // File is a barrel/index file in a parent directory
    const fileName = f.split('/').pop() || '';
    if (fileName.startsWith('index.') && changedDirs.has(dir)) return true;

    return false;
  });

  // Cap to avoid excessive API calls
  return candidates.slice(0, 50);
}

/**
 * Format enriched context for a file into a string suitable for AI prompts.
 */
export function formatFileContext(ctx: FileContext): string {
  const parts: string[] = [];

  if (ctx.importedBy.length > 0) {
    parts.push(`**Imported by:** ${ctx.importedBy.join(', ')}`);
  }
  if (ctx.imports.length > 0) {
    parts.push(`**Imports from:** ${ctx.imports.join(', ')}`);
  }
  if (ctx.testFiles.length > 0) {
    parts.push(`**Test files:** ${ctx.testFiles.join(', ')}`);
  }
  if (ctx.exportedSymbols.length > 0) {
    parts.push(`**Exported symbols:** ${ctx.exportedSymbols.join(', ')}`);
  }
  if (ctx.referencedBy.length > 0) {
    const refs = ctx.referencedBy.map((r) => `${r.filePath} (uses \`${r.symbol}\`)`);
    parts.push(`**Referenced by:** ${refs.join(', ')}`);
  }

  return parts.length > 0 ? parts.join('\n') : '(No additional context found)';
}
