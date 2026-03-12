// ---------------------------------------------------------------------------
// Prompt: Acceptance Criteria Validation
//
// Validates each acceptance criterion from linked tickets against the
// actual code changes in the MR. The AI maps natural language requirements
// to concrete evidence in the diff.
//
// Output format: JSON matching AcValidationResult type.
//
// Design decisions:
// - Criteria are pre-parsed and sent individually so the AI validates each one.
// - The AI sees all diffs (not per-file) because a single criterion may span
//   multiple files (e.g., "API endpoint + frontend form + migration").
// - "unclear" is a first-class status — honesty about uncertainty is critical.
// - Evidence links to specific files/lines so the reviewer can verify.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../ai-client';
import type { DiffFileData } from '@/types/review';
import { OTTO_IDENTITY } from './shared';

const SYSTEM_PROMPT = `${OTTO_IDENTITY}

Your task: validate whether the code changes in this merge request satisfy the acceptance criteria from the linked ticket.

You will receive:
1. A list of acceptance criteria (numbered)
2. The diffs of all changed files in the MR
3. The MR title and description for context

For each criterion, determine one of three statuses:
- "satisfied": The diff contains clear evidence that this criterion is implemented.
- "unclear": The diff contains code that might relate to this criterion, but you cannot confidently confirm it's fully addressed. Be honest — unclear is better than a false positive.
- "not-found": The diff contains no evidence of this criterion being addressed. This could mean it was implemented elsewhere, it's not relevant to this MR, or it was missed.

Respond with a JSON object matching this exact schema:
{
  "criteria": [
    {
      "criterion": "string — the original criterion text",
      "status": "satisfied" | "unclear" | "not-found",
      "explanation": "string — one or two sentences: why this status. Be specific about what you found or didn't find. Use markdown.",
      "evidence": [
        {
          "filePath": "string — path of the file containing evidence",
          "startLine": number | null,
          "endLine": number | null,
          "snippet": "string | null — brief code excerpt (1-3 lines max)"
        }
      ]
    }
  ],
  "summary": "string — one sentence overall assessment, e.g. '3 of 5 criteria satisfied, 1 unclear, 1 not found in this diff.'"
}

Guidelines:
- Validate each criterion independently. Don't skip any.
- Evidence array can be empty for "not-found" status.
- For "unclear", explain what you found and what's missing for full confidence.
- Line numbers refer to the NEW file (right side of the diff).
- Don't infer implementation from test names alone — look for actual logic.
- If a criterion is vague (e.g., "good UX"), mark it "unclear" and explain why it can't be validated from code alone.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export const DEFAULT_AC_VALIDATION_PROMPT = SYSTEM_PROMPT;

export type AcValidationInput = {
  ticketKey: string;
  criteria: string[];              // Pre-parsed individual criteria
  diffFiles: DiffFileData[];
  mrTitle: string;
  mrDescription: string | null;
  ticketTitle: string;
  ticketDescription: string | null;
};

export function buildAcValidationPrompt(input: AcValidationInput, customSystemPrompt?: string): ChatMessage[] {
  let userContent = `# Acceptance Criteria Validation

**Ticket:** ${input.ticketKey} — ${input.ticketTitle}
**MR:** ${input.mrTitle}

## Acceptance Criteria
${input.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Changed Files
`;

  // Include all diffs, with per-file token budgeting
  const maxCharsPerFile = Math.min(
    8000,
    Math.floor(60000 / Math.max(input.diffFiles.length, 1)),
  );

  for (const file of input.diffFiles) {
    const status = file.isNew ? '[NEW]' : file.isDeleted ? '[DELETED]' : file.isRenamed ? `[RENAMED from ${file.oldPath}]` : '[MODIFIED]';
    const diff = file.diff.length > maxCharsPerFile
      ? file.diff.slice(0, maxCharsPerFile) + '\n... (truncated)'
      : file.diff;

    userContent += `
### ${file.filePath} ${status} (+${file.addedLines} -${file.removedLines})
\`\`\`diff
${diff}
\`\`\`
`;
  }

  if (input.mrDescription) {
    userContent += `
## MR Description
${input.mrDescription}`;
  }

  if (input.ticketDescription) {
    // Truncate long descriptions
    const desc = input.ticketDescription.length > 2000
      ? input.ticketDescription.slice(0, 2000) + '\n... (truncated)'
      : input.ticketDescription;
    userContent += `

## Ticket Description
${desc}`;
  }

  return [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
