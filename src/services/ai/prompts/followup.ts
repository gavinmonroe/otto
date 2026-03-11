// ---------------------------------------------------------------------------
// Prompt: Comment Follow-Up Analysis
//
// Analyzes a GitLab MR comment thread and produces a structured follow-up
// with three parts: perspective (where the commenter is coming from),
// interpretation (what they're concretely asking), and recommended action
// (emoji, reply, or code changes).
//
// The AI adapts its recommended action based on the classified intent:
// - praise / emoji-reaction → suggest an emoji
// - question / discussion → draft a reply matching the commenter's tone
// - suggestion / nitpick / required-change → produce concrete code changes
//
// Output format: JSON matching FollowUpAnalysis type.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../ai-client';
import type { ThreadContext } from '@/types/followup';
import { OTTO_IDENTITY } from './shared';

export type FollowUpInput = {
  thread: ThreadContext;
  fileContent: string | null;       // Full file content from source branch
  mrTitle: string;
  mrDescription: string | null;
  mrDiffSnippet: string | null;     // The diff for the file this comment is on
};

const SYSTEM_PROMPT = `${OTTO_IDENTITY}

Your task: analyze a code review comment thread and produce a structured follow-up.

You will receive a discussion thread (one or more reviewer comments), along with optional file content and diff context.

Respond with a JSON object matching this exact schema:
{
  "intent": "question" | "suggestion" | "nitpick" | "required-change" | "praise" | "discussion" | "emoji-reaction",
  "perspective": "string — 1-2 sentences: where the commenter is coming from. What concern or principle drives their comment? Don't echo back what they said — interpret what's beneath the words. Use markdown.",
  "interpretation": "string — 1-2 sentences: what the comment concretely asks for. Cut through ambiguity. If they're being indirect, say what they actually mean. Use markdown.",
  "recommendedAction": <one of the action types below>
}

Action type schemas (use exactly ONE):

For praise, acknowledgments, or emoji-worthy comments:
{
  "type": "emoji",
  "emoji": "string — a single emoji character",
  "reason": "string — one sentence why"
}

For questions, discussions, or comments needing a text reply:
{
  "type": "reply",
  "draft": "string — reply matching the commenter's tone and style. Keep it tight: if the reply would be longer than the original comment, you're over-explaining. Use markdown.",
  "tone": "string — e.g. 'casual and direct', 'formal and thorough'"
}

For suggestions, nitpicks, or required changes involving code:
{
  "type": "code-change",
  "changes": [
    {
      "filePath": "string — path of the file to change",
      "startLine": number,
      "endLine": number,
      "originalCode": "string — exact current code, copied verbatim from file content or diff",
      "suggestedCode": "string — replacement code implementing the feedback",
      "explanation": "string — one sentence: what and why"
    }
  ],
  "summary": "string — one sentence summarizing all changes"
}

Intent classification:
- "maybe consider using X" → suggestion | "this needs to be changed" → required-change
- "nice!", "LGTM" → praise | emoji reactions → emoji-reaction

Guidelines:
- For code-change actions, originalCode must be copied EXACTLY. No paraphrasing. Changes can span multiple files.
- For reply actions, match the commenter's style. Casual gets casual, formal gets formal.
- Multiple notes in thread: focus on the most recent, use earlier ones for context.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export const DEFAULT_FOLLOW_UP_PROMPT = SYSTEM_PROMPT;

export function buildFollowUpPrompt(input: FollowUpInput, customSystemPrompt?: string): ChatMessage[] {
  const threadContent = input.thread.notes
    .map((note, i) => `### Comment ${i + 1} by ${note.author}${note.timestamp ? ` (${note.timestamp})` : ''}:\n${note.body}`)
    .join('\n\n');

  let userContent = `# Comment Follow-Up Analysis

**MR:** ${input.mrTitle}
**Discussion ID:** ${input.thread.discussionId}`;

  if (input.thread.filePath) {
    userContent += `\n**File:** ${input.thread.filePath}`;
  }

  if (input.thread.lineRange) {
    userContent += `\n**Lines:** ${input.thread.lineRange.start}–${input.thread.lineRange.end}`;
  }

  userContent += `

## Discussion Thread
${threadContent}`;

  if (input.thread.diffSnippet) {
    userContent += `

## Diff Context (code the comment is attached to)
\`\`\`diff
${input.thread.diffSnippet}
\`\`\``;
  }

  if (input.mrDiffSnippet) {
    userContent += `

## Full File Diff
\`\`\`diff
${input.mrDiffSnippet}
\`\`\``;
  }

  if (input.fileContent) {
    userContent += `

## Full File Content (source branch)
\`\`\`
${input.fileContent}
\`\`\``;
  }

  if (input.mrDescription) {
    userContent += `

## MR Description
${input.mrDescription}`;
  }

  return [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
