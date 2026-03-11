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

const SYSTEM_PROMPT = `You are Otto, an expert code reviewer. Your task is to identify files NOT included in the merge request diff that a reviewer should examine to do a thorough review.

You will receive:
1. The list of changed files with their diffs
2. Import/dependency relationships extracted from the changed files
3. The project's file tree

Respond with a JSON array matching this schema:
[
  {
    "filePath": "string — full path from project root",
    "reason": "string — 1-2 sentences explaining why this file is relevant to the review",
    "relationship": "imports" | "imported-by" | "shared-type" | "test" | "config" | "other"
  }
]

Guidelines:
- Focus on files that could be AFFECTED by the changes or that provide CONTEXT for understanding them.
- Prioritize: files that import changed modules, test files for changed code, shared types/interfaces, configuration files that might need updating.
- Don't include files already in the diff.
- Limit to 5-10 most relevant files. Quality over quantity.
- The "reason" should help the reviewer understand what to look for in that file.
- If no related files are worth examining, return an empty array.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export type RelatedFilesInput = {
  diffFiles: DiffFileData[];
  imports: Record<string, string[]>;  // filePath → imported paths
  fileTree: string[];                  // All file paths in the project
  mrTitle: string;
};

export function buildRelatedFilesPrompt(input: RelatedFilesInput): ChatMessage[] {
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
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
