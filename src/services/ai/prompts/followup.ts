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

export type FollowUpInput = {
  thread: ThreadContext;
  fileContent: string | null;       // Full file content from source branch
  mrTitle: string;
  mrDescription: string | null;
  mrDiffSnippet: string | null;     // The diff for the file this comment is on
};

const SYSTEM_PROMPT = `You are Otto, an AI assistant helping a developer understand and respond to code review comments on a GitLab merge request.

You will receive a discussion thread (one or more comments from reviewers), along with optional file content and diff context.

Your job is to analyze the comment thread and produce a structured follow-up with three parts:

1. **Perspective** — Explain where the commenter is coming from. What concern, principle, or experience is driving their comment? Be empathetic and specific.

2. **Interpretation** — Explain concretely what the comment is asking for. Cut through any ambiguity. If the commenter is being indirect, say what they actually mean.

3. **Recommended Action** — Based on the intent, recommend one of three action types:

Respond with a JSON object matching this exact schema:
{
  "intent": "question" | "suggestion" | "nitpick" | "required-change" | "praise" | "discussion" | "emoji-reaction",
  "perspective": "string — 1-3 sentences explaining the commenter's viewpoint. Use markdown.",
  "interpretation": "string — 1-3 sentences explaining what the comment concretely means. Use markdown.",
  "recommendedAction": <one of the action types below>
}

Action type schemas (use exactly ONE):

For praise, simple acknowledgments, or emoji-worthy comments:
{
  "type": "emoji",
  "emoji": "string — a single emoji character that fits the context",
  "reason": "string — brief explanation of why this emoji is appropriate"
}

For questions, discussions, or comments that need a text reply:
{
  "type": "reply",
  "draft": "string — a draft reply written in the same tone and style as the commenter. Match their level of formality, use of technical jargon, and communication style. Use markdown.",
  "tone": "string — brief description of the commenter's tone, e.g. 'casual and direct', 'formal and thorough'"
}

For suggestions, nitpicks, or required changes that involve code modifications:
{
  "type": "code-change",
  "changes": [
    {
      "filePath": "string — path of the file to change",
      "startLine": number,
      "endLine": number,
      "originalCode": "string — the exact current code that should be replaced, copied verbatim from the file content or diff",
      "suggestedCode": "string — the replacement code implementing the reviewer's feedback",
      "explanation": "string — brief explanation of what this change does and why"
    }
  ],
  "summary": "string — one sentence summarizing all changes"
}

Guidelines:
- Classify intent carefully. A comment saying "maybe consider using X" is a suggestion, not a question.
- A comment that says "this needs to be changed" or "please fix" is a required-change.
- Short positive comments like "nice!", "LGTM", "looks good" are praise.
- Comments that are just emoji reactions (thumbs up, etc.) are emoji-reaction.
- For code-change actions, originalCode must be copied EXACTLY from the provided file content or diff. No paraphrasing.
- For code-change actions, changes can span multiple files if the reviewer's feedback implies it.
- For reply actions, match the commenter's style closely. If they write casually, reply casually. If they're formal, be formal.
- The draft reply should address the commenter's concern directly and constructively.
- If the thread has multiple notes, focus on the most recent note but use earlier notes for context.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export function buildFollowUpPrompt(input: FollowUpInput): ChatMessage[] {
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
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
