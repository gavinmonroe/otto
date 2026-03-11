// ---------------------------------------------------------------------------
// Prompt: Related Files Discovery
//
// Identifies files NOT in the diff that are relevant to the review.
// The AI receives the list of changed files, their import relationships,
// and the project file tree, then reasons about which other files a
// reviewer should look at.
//
// Output format: JSON array of related file objects.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../ai-client';
import type { DiffFileData } from '@/types/review';
import { OTTO_IDENTITY } from './shared';

const SYSTEM_PROMPT = `${OTTO_IDENTITY}

Your task: identify files NOT in the merge request diff that a reviewer should examine for a thorough review.

You will receive the list of changed files with diffs, import/dependency relationships, and the project file tree.

Respond with a JSON array matching this schema:
[
  {
    "filePath": "string — full path from project root",
    "reason": "string — 1-2 sentences: why this file is relevant and what to look for in it",
    "relationship": "imports" | "imported-by" | "shared-type" | "test" | "config" | "other"
  }
]

Guidelines:
- Focus on files AFFECTED by the changes or that provide CONTEXT for understanding them.
- Prioritize: importers of changed modules, test files, shared types/interfaces, configs that might need updating.
- Don't include files already in the diff. 5-10 most relevant files max. Empty array if none are worth examining.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export const DEFAULT_RELATED_FILES_PROMPT = SYSTEM_PROMPT;

export type RelatedFilesInput = {
  diffFiles: DiffFileData[];
  imports: Record<string, string[]>;  // filePath → imported paths
  fileTree: string[];                  // All file paths in the project
  mrTitle: string;
};

export function buildRelatedFilesPrompt(input: RelatedFilesInput, customSystemPrompt?: string): ChatMessage[] {
  const changedFiles = input.diffFiles.map((f) => {
    const status = f.isNew ? '[NEW]' : f.isDeleted ? '[DELETED]' : f.isRenamed ? '[RENAMED]' : '[MODIFIED]';
    return `${status} ${f.filePath} (+${f.addedLines} -${f.removedLines})`;
  }).join('\n');

  const importMap = Object.entries(input.imports)
    .map(([file, imports]) => `${file}:\n${imports.map((i) => `  → ${i}`).join('\n')}`)
    .join('\n\n');

  // Truncate file tree if too large (keep it under ~4000 chars)
  let fileTreeStr = input.fileTree.join('\n');
  if (fileTreeStr.length > 4000) {
    // Keep files that share directories with changed files
    const changedDirs = new Set(
      input.diffFiles.map((f) => f.filePath.split('/').slice(0, -1).join('/')),
    );
    const relevantFiles = input.fileTree.filter((f) => {
      const dir = f.split('/').slice(0, -1).join('/');
      return changedDirs.has(dir) || changedDirs.has(dir.split('/').slice(0, -1).join('/'));
    });
    fileTreeStr = relevantFiles.join('\n');
    if (fileTreeStr.length > 4000) {
      fileTreeStr = fileTreeStr.slice(0, 4000) + '\n... (truncated)';
    }
  }

  const userContent = `# MR: ${input.mrTitle}

## Changed Files
${changedFiles}

## Import Relationships
${importMap || '(No imports detected)'}

## Project File Tree
${fileTreeStr}`;

  return [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
