// ---------------------------------------------------------------------------
// Prompt: Behavioral Delta Analysis
//
// Identifies what behaviors changed, what was preserved, and what changed
// unexpectedly. Frames the diff in terms of observable behavior, not syntax.
//
// Output format: JSON object with changed/preserved/unexpected arrays.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../ai-client';
import type { DiffFileData, MrSummary } from '@/types/review';
import { OTTO_IDENTITY } from './shared';

const SYSTEM_PROMPT = `${OTTO_IDENTITY}

Your task: analyze this merge request and describe what BEHAVIORS changed, what was preserved, and flag anything that changed unexpectedly.

A "behavior" is an observable effect: what a function returns for given inputs, what side effects it produces, what errors it throws, how it handles edge cases. NOT syntax — not "renamed variable x to y" but "the function now validates input before processing."

You will receive the diffs, optionally full file content, and optionally a summary from a prior analysis pass.

Respond with a JSON object matching this schema:
{
  "summary": "string — one sentence: the behavioral essence of this MR",
  "changed": [
    {
      "description": "string — what behavior changed, in plain English",
      "testScenario": "string — how to verify: 'Given X, when Y, then Z'",
      "expectedOutcome": "string — what the new code should do",
      "filePaths": ["string — files involved"],
      "type": "changed"
    }
  ],
  "preserved": [
    {
      "description": "string — what existing behavior should NOT have changed",
      "testScenario": "string — how to verify it's still intact",
      "expectedOutcome": "string — what should still happen",
      "filePaths": ["string — files involved"],
      "type": "preserved"
    }
  ],
  "unexpected": [
    {
      "description": "string — a behavior that appears to have changed but probably shouldn't have",
      "testScenario": "string — how to verify",
      "expectedOutcome": "string — what the developer likely intended",
      "filePaths": ["string — files involved"],
      "type": "unexpected"
    }
  ]
}

Guidelines:
- Think from the CALLER's perspective. What would a consumer of this code notice?
- "Changed" behaviors are intentional — they match the MR title/description.
- "Preserved" behaviors are existing functionality that the diff touches but shouldn't alter. These are regression risks.
- "Unexpected" behaviors are changes that don't align with the stated intent. These are the most valuable findings.
- For each behavior, write a concrete test scenario in Given/When/Then format.
- 3-6 changed behaviors, 3-6 preserved behaviors, 0-3 unexpected. Fewer for simple MRs.
- If the MR is purely additive (new file, new function), preserved and unexpected will be empty.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export const DEFAULT_BEHAVIORAL_DELTA_PROMPT = SYSTEM_PROMPT;

export type BehavioralDeltaInput = {
  diffFiles: DiffFileData[];
  fileContents: Record<string, string>;
  mrTitle: string;
  mrDescription: string | null;
  summary: MrSummary | null;          // Feed prior summary for intent alignment
};

export function buildBehavioralDeltaPrompt(input: BehavioralDeltaInput, customSystemPrompt?: string): ChatMessage[] {
  const filesSection = input.diffFiles.map((f) => {
    let section = `## ${f.filePath}
**Status:** ${f.isNew ? 'New file' : f.isDeleted ? 'Deleted' : 'Modified'}

### Diff
\`\`\`diff
${f.diff}
\`\`\``;

    const fullContent = input.fileContents[f.filePath];
    if (fullContent && fullContent.length < 8000) {
      section += `

### Full File (target branch)
\`\`\`
${fullContent}
\`\`\``;
    }

    return section;
  }).join('\n\n---\n\n');

  let userContent = `# MR: ${input.mrTitle}
${input.mrDescription ? `\n## Description\n${input.mrDescription}\n` : ''}
## Changed Files

${filesSection}`;

  if (input.summary) {
    userContent += `

## Prior Summary (for intent alignment)
**Overview:** ${input.summary.overview}
**Key Changes:** ${input.summary.keyChanges.join('; ')}
**Risk Assessment:** ${input.summary.riskAssessment}`;
  }

  return [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
