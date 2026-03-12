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
import { OTTO_IDENTITY } from './shared';

const SYSTEM_PROMPT = `${OTTO_IDENTITY}

Your task: review a single file's changes in a merge request and produce actionable comments.

You will receive the file's unified diff and optionally the full file content from the target branch for context.

Respond with a JSON object matching this exact schema:
{
  "summary": "string — one paragraph: what changed and why it matters",
  "riskLevel": "low" | "medium" | "high",
  "comments": [
    {
      "startLine": number | null,
      "endLine": number | null,
      "severity": "critical" | "warning" | "suggestion" | "info",
      "category": "bug" | "logic-error" | "security" | "performance" | "readability" | "style" | "error-handling" | "naming" | "duplication" | "other",
      "title": "string — one-line summary of the issue",
      "body": "string — state the risk, not just the symptom. A pointed question beats a paragraph of explanation. Use markdown.",
      "originalCode": "string | null — exact original code being replaced, copied verbatim from the diff/file",
      "suggestion": "string | null — concrete replacement code, not vague advice",
      "suggestionSummary": "string | null — when suggestion is provided, a plain-English sentence describing what the change does and why, written for a developer skimming quickly. e.g. 'Adds a null check for user before accessing .email to prevent TypeError in unauthenticated requests.'"
    }
  ]
}

Guidelines:
- Line numbers refer to the NEW file (right side of the diff). Use null for file-level comments.
- Focus on what matters: bugs, logic errors, security, missing error handling. Skip style nitpicks unless they hurt readability.
- If the fix is obvious from the problem statement, skip the suggestion.
- When providing a suggestion, ALWAYS include originalCode (copied from the diff/file) to enable diff view in the UI.
- originalCode and suggestion: pure code — no markdown fences, no diff markers.
- For new files, review design and structure. For deleted files, flag remaining references.
- Order by severity (critical first). Empty comments array is fine if the code looks good.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export const DEFAULT_CODE_REVIEW_PROMPT = SYSTEM_PROMPT;

export type CodeReviewInput = {
  file: DiffFileData;
  fullFileContent: string | null;  // Content from target branch for context
  mrTitle: string;
  mrDescription: string | null;
  /** Enriched repo context: who imports this file, what it exports, callers */
  repoContext: string | null;
  /** Content of files that import this file (truncated) */
  callerSnippets: Array<{ filePath: string; snippet: string }> | null;
  /** Formatted ticket context from linked issues */
  ticketContext: string | null;
  /** Reviewer preferences learned from past reviews + repo facts */
  reviewerPreferences: string | null;
  /** Recent MR activity for this file (cross-MR awareness) */
  fileActivityContext: string | null;
  /** Project configuration from .otto.json */
  repoConfigContext: string | null;
  /** Whether the current user is the MR author (self-review mode) */
  isAuthorReview: boolean;
};

export function buildCodeReviewPrompt(input: CodeReviewInput, customSystemPrompt?: string): ChatMessage[] {
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

  if (input.repoContext) {
    userContent += `

## Repository Context
${input.repoContext}`;
  }

  if (input.callerSnippets && input.callerSnippets.length > 0) {
    userContent += `

## Files That Use This Code
${input.callerSnippets.map((c) => `### ${c.filePath}\n\`\`\`\n${c.snippet}\n\`\`\``).join('\n\n')}`;
  }

  if (input.mrDescription) {
    userContent += `

## MR Description
${input.mrDescription}`;
  }

  if (input.ticketContext) {
    userContent += `

## Linked Ticket(s)
${input.ticketContext}`;
  }

  if (input.reviewerPreferences) {
    userContent += `

${input.reviewerPreferences}`;
  }

  if (input.fileActivityContext) {
    userContent += `

${input.fileActivityContext}`;
  }

  if (input.repoConfigContext) {
    userContent += `

${input.repoConfigContext}`;
  }

  if (input.isAuthorReview) {
    userContent += `

## Self-Review Mode
You are reviewing the author's own code before they request peer review. Adjust your approach:
- Prioritize issues a peer reviewer would flag: bugs, missing error handling, edge cases, unclear naming.
- Suppress style nitpicks — the author can fix those on their own.
- Frame findings as "before requesting review, consider..." not "this code has a problem."
- Flag missing test coverage for new behavior.
- Call out anything that needs a comment or documentation for the reviewer's benefit.`;
  }

  return [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
