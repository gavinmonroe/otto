// ---------------------------------------------------------------------------
// Prompt: Contract Inference
//
// Infers preconditions, postconditions, and invariants for changed functions.
// The AI reads function signatures and bodies, then expresses what the code
// promises as both human-readable statements and executable assertions.
//
// Output format: JSON array of FunctionContract objects.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../ai-client';
import type { DiffFileData } from '@/types/review';
import { OTTO_IDENTITY } from './shared';

const SYSTEM_PROMPT = `${OTTO_IDENTITY}

Your task: infer contracts (preconditions, postconditions, invariants) for functions that were changed or added in this merge request.

A contract defines what a function PROMISES:
- Preconditions: what must be true BEFORE the function runs (caller's responsibility)
- Postconditions: what will be true AFTER the function runs (function's guarantee)
- Invariants: what remains true throughout execution (structural guarantees)

You will receive the diffs of changed files and optionally their full content.

Respond with a JSON array matching this schema:
[
  {
    "functionName": "string — name of the function",
    "filePath": "string — file containing the function",
    "lineRange": { "start": number, "end": number } | null,
    "preconditions": [
      { "human": "string — plain English", "code": "string | null — TypeScript assertion or Zod schema" }
    ],
    "postconditions": [
      { "human": "string — plain English", "code": "string | null — TypeScript assertion or Zod schema" }
    ],
    "invariants": [
      { "human": "string — plain English", "code": "string | null — TypeScript assertion or Zod schema" }
    ],
    "verificationStatus": "verified" | "violation-possible" | "unknown",
    "violationPath": "string | null — if violation-possible, describe the concrete input/path that breaks the contract"
  }
]

Guidelines:
- Focus on functions that were CHANGED or ADDED. Don't analyze unchanged functions.
- Infer contracts from the code's actual behavior, not from comments or names alone.
- For each contract, reason through whether it actually holds:
  * Trace through all code paths with the preconditions satisfied
  * Check if the postcondition can ever be false
  * If you find a path that violates a postcondition, mark as "violation-possible" and describe the path
  * If all paths satisfy all postconditions, mark as "verified"
  * If the function is too complex to reason about fully, mark as "unknown"
- The "code" field should be a TypeScript expression that evaluates to boolean, or a Zod schema call. Use null if the contract can't be expressed in code.
- Prioritize contracts that matter: null safety, return type guarantees, error handling promises. Skip trivial ones like "returns a value."
- 2-5 functions max. Focus on the most important changed functions.
- If the changes are purely cosmetic, return an empty array.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export const DEFAULT_CONTRACTS_PROMPT = SYSTEM_PROMPT;

export type ContractInput = {
  diffFiles: DiffFileData[];
  fileContents: Record<string, string>;
  mrTitle: string;
  mrDescription: string | null;
};

export function buildContractPrompt(input: ContractInput, customSystemPrompt?: string): ChatMessage[] {
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

  const userContent = `# MR: ${input.mrTitle}
${input.mrDescription ? `\n## Description\n${input.mrDescription}\n` : ''}
## Changed Files

${filesSection}`;

  return [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
