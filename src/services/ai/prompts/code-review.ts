// ---------------------------------------------------------------------------
// Prompt: Per-File Code Review
//
// Generates review comments for a single file's diff.
// The AI receives the file diff + optional surrounding context (full file
// content from the target branch) and produces structured review comments.
//
// Output format: JSON matching FileReview type.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../ai-client';
import type { DiffFileData } from '@/types/review';

const SYSTEM_PROMPT = `You are Otto, an expert code reviewer. Your task is to review a single file's changes in a merge request and produce actionable review comments.

You will receive the file's unified diff and optionally the full file content from the target branch for context.

Respond with a JSON object matching this exact schema:
{
  "summary": "string — one paragraph summarizing what changed in this file and why it matters",
  "riskLevel": "low" | "medium" | "high",
  "comments": [
    {
      "startLine": number | null,
      "endLine": number | null,
      "severity": "critical" | "warning" | "suggestion" | "info",
      "category": "bug" | "logic-error" | "security" | "performance" | "readability" | "style" | "error-handling" | "naming" | "duplication" | "other",
      "title": "string — one-line summary of the issue",
      "body": "string — detailed explanation with reasoning. Use markdown.",
      "suggestion": "string | null — suggested code fix if applicable, as a code snippet"
    }
  ]
}

Guidelines:
- Line numbers refer to the NEW file (right side of the diff). Use null for file-level comments.
- Focus on substantive issues: bugs, logic errors, security, missing error handling.
- Don't nitpick style unless it significantly impacts readability.
- Each comment should explain WHY something is a problem, not just WHAT is wrong.
- Suggestions should be concrete code snippets, not vague advice.
- For new files, review the overall design and structure.
- For deleted files, note if there might be remaining references.
- Order comments by severity (critical first).
- It's okay to return an empty comments array if the changes look good.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export type CodeReviewInput = {
  file: DiffFileData;
  fullFileContent: string | null;  // Content from target branch for context
  mrTitle: string;
  mrDescription: string | null;
};

export function buildCodeReviewPrompt(input: CodeReviewInput): ChatMessage[] {
  let userContent = `# File: ${input.file.filePath}

**MR:** ${input.mrTitle}
**Status:** ${input.file.isNew ? 'New file' : input.file.isDeleted ? 'Deleted' : input.file.isRenamed ? `Renamed from ${input.file.oldPath}` : 'Modified'}
**Changes:** +${input.file.addedLines} -${input.file.removedLines}

## Diff
\`\`\`diff
${input.file.diff}
\`\`\``;

  if (input.fullFileContent) {
    userContent += `

## Full File Content (target branch, for context)
\`\`\`
${input.fullFileContent}
\`\`\``;
  }

  if (input.mrDescription) {
    userContent += `

## MR Description
${input.mrDescription}`;
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
