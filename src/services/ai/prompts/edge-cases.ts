// ---------------------------------------------------------------------------
// Prompt: Edge Case & Stack Trace Analysis
//
// Analyzes changed code for potential failure modes, missing error handling,
// boundary conditions, and generates hypothetical stack traces.
//
// Output format: JSON array of EdgeCase objects.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../ai-client';
import type { DiffFileData } from '@/types/review';
import { OTTO_IDENTITY } from './shared';

const SYSTEM_PROMPT = `${OTTO_IDENTITY}

Your task: analyze code changes for potential failure modes, missing error handling, and edge cases that could cause production issues.

You will receive the diffs of changed files and optionally their full content for context.

Respond with a JSON array matching this schema:
[
  {
    "title": "string — concise title of the edge case or failure mode",
    "description": "string — what triggers it, what breaks, and how to fix it. If the mitigation is obvious from the description, omit it. Use markdown.",
    "filePath": "string | null — primary file this relates to",
    "lineRange": { "start": number, "end": number } | null,
    "severity": "critical" | "moderate" | "minor",
    "category": "error-handling" | "boundary-condition" | "race-condition" | "null-safety" | "type-safety" | "resource-leak" | "other",
    "hypotheticalTrace": "string | null — realistic stack trace (3-5 lines max) using actual function names from the diff. Format as a code block."
  }
]

Guidelines:
- Think like a QA engineer trying to break the code.
- Consider: null/undefined inputs, empty arrays/strings, concurrent access, network failures, large inputs, malformed data, permission errors.
- Severity: critical = data loss, security, crash | moderate = wrong behavior, silent failure | minor = cosmetic, unlikely scenario.
- 3-5 most impactful edge cases max. Skip trivial ones. If the changes are straightforward, return an empty array.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export const DEFAULT_EDGE_CASES_PROMPT = SYSTEM_PROMPT;

export type EdgeCaseInput = {
  diffFiles: DiffFileData[];
  fileContents: Record<string, string>;  // filePath → full content (target branch)
  mrTitle: string;
  mrDescription: string | null;
  ticketContext: string | null;
};

export function buildEdgeCasePrompt(input: EdgeCaseInput, customSystemPrompt?: string): ChatMessage[] {
  const filesSection = input.diffFiles.map((f) => {
    let section = `## ${f.filePath}
**Status:** ${f.isNew ? 'New file' : f.isDeleted ? 'Deleted' : 'Modified'}

### Diff
\`\`\`diff
${f.diff}
\`\`\``;

    const fullContent = input.fileContents[f.filePath];
    if (fullContent) {
      // Only include full content if it's not too large
      if (fullContent.length < 5000) {
        section += `

### Full File (target branch)
\`\`\`
${fullContent}
\`\`\``;
      }
    }

    return section;
  }).join('\n\n---\n\n');

  const userContent = `# MR: ${input.mrTitle}
${input.mrDescription ? `\n## Description\n${input.mrDescription}\n` : ''}${input.ticketContext ? `\n## Linked Ticket(s)\n${input.ticketContext}\n` : ''}
## Changed Files

${filesSection}`;

  return [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
