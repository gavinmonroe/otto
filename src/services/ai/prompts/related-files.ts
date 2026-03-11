// ---------------------------------------------------------------------------
// Prompt: Related Files Discovery (Tool-Use Flow)
//
// Identifies files NOT in the diff that are relevant to the review.
// Instead of receiving a static file tree, the AI uses tools to explore
// the repository structure and find real file paths.
//
// Output format: JSON array of related file objects.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../ai-client';
import type { DiffFileData } from '@/types/review';
import { OTTO_IDENTITY } from './shared';

const SYSTEM_PROMPT = `${OTTO_IDENTITY}

Your task: identify files NOT in the merge request diff that a reviewer should examine for a thorough review.

You have tools to explore the repository:
- **list_directory**: List files and subdirectories at a path. Start with "" for root.
- **get_subtree**: Get all files under a directory recursively (up to 500).
- **search_files**: Search for files by name pattern across the entire repo.

## Workflow
1. Look at the changed files and their import relationships.
2. Use the tools to explore the repository and find related files. Start by listing the directories that contain changed files, then search for imported modules, test files, shared types, etc.
3. Once you have found the relevant files, respond with your final answer.

## Final Answer Format
When you are done exploring, respond with ONLY a JSON array (no tool calls):
[
  {
    "filePath": "string — exact full path as returned by the tools",
    "reason": "string — 1-2 sentences: why this file is relevant",
    "relationship": "imports" | "imported-by" | "shared-type" | "test" | "config" | "other"
  }
]

## Rules
- ONLY use file paths you have seen returned by the tools. Never guess or invent paths.
- Don't include files already in the diff.
- Return 5-10 most relevant files max. Empty array [] if none are worth examining.
- Focus on: importers of changed modules, test files, shared types/interfaces, configs.
- Your final response must be ONLY valid JSON. No markdown fences, no explanation.`;

export const DEFAULT_RELATED_FILES_PROMPT = SYSTEM_PROMPT;

export type RelatedFilesInput = {
  diffFiles: DiffFileData[];
  imports: Record<string, string[]>;  // filePath → imported paths
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

  const userContent = `# MR: ${input.mrTitle}

## Changed Files
${changedFiles}

## Import Relationships
${importMap || '(No imports detected)'}

Use the tools to explore the repository and find files related to these changes. Start by listing the directories that contain the changed files.`;

  return [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
