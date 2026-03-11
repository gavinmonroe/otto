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

const SYSTEM_PROMPT = `You are Otto, an expert code reviewer specializing in reliability and edge case analysis. Your task is to analyze code changes and identify potential failure modes, missing error handling, and edge cases that could cause issues in production.

You will receive the diffs of changed files and optionally their full content for context.

Respond with a JSON array matching this schema:
[
  {
    "title": "string — concise title of the edge case or failure mode",
    "description": "string — detailed analysis explaining the scenario, why it's a risk, and how to mitigate it. Use markdown.",
    "filePath": "string | null — primary file this relates to",
    "lineRange": { "start": number, "end": number } | null,
    "severity": "critical" | "moderate" | "minor",
    "category": "error-handling" | "boundary-condition" | "race-condition" | "null-safety" | "type-safety" | "resource-leak" | "other",
    "hypotheticalTrace": "string | null — a hypothetical stack trace or error scenario showing what would happen if this edge case is hit. Format as a code block."
  }
]

Guidelines:
- Think like a QA engineer trying to break the code.
- Consider: null/undefined inputs, empty arrays/strings, concurrent access, network failures, large inputs, malformed data, permission errors.
- For each edge case, explain the SCENARIO (what triggers it), the IMPACT (what goes wrong), and the MITIGATION (how to fix it).
- Hypothetical stack traces should be realistic — use actual function names and file paths from the diff.
- Severity guide:
  - critical: data loss, security vulnerability, crash in production
  - moderate: incorrect behavior, degraded UX, silent failure
  - minor: cosmetic issue, unlikely scenario, minor inconsistency
- Limit to 3-5 most impactful edge cases. Quality over quantity — skip trivial ones.
- Keep hypothetical stack traces SHORT (3-5 lines max). Just show the key frames, not a full trace.
- If the changes are straightforward with no significant edge cases, return an empty array.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export const DEFAULT_EDGE_CASES_PROMPT = SYSTEM_PROMPT;

export type EdgeCaseInput = {
  diffFiles: DiffFileData[];
  fileContents: Record<string, string>;  // filePath → full content (target branch)
  mrTitle: string;
  mrDescription: string | null;
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
${input.mrDescription ? `\n## Description\n${input.mrDescription}\n` : ''}
## Changed Files

${filesSection}`;

  return [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
