// ---------------------------------------------------------------------------
// Prompt: Adversarial Test Generation
//
// Generates property-based tests targeting changed functions in the diff.
// The AI acts as an adversarial tester — trying to break the code by
// finding inputs that violate expected properties.
//
// Output format: JSON array of PropertyTest objects.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../ai-client';
import type { DiffFileData } from '@/types/review';
import type { EdgeCase } from '@/types/review';
import { OTTO_IDENTITY } from './shared';

const SYSTEM_PROMPT = `${OTTO_IDENTITY}

Your task: generate property-based tests that try to break the changed code. You are an adversarial tester — your goal is to find inputs that cause unexpected behavior, crashes, or incorrect results.

You will receive the diffs of changed files, optionally their full content, and optionally edge cases already identified by a prior analysis pass.

Respond with a JSON array matching this schema:
[
  {
    "property": "string — human-readable property that should hold (e.g., 'parseUnifiedDiff never returns negative line numbers')",
    "testCode": "string — runnable TypeScript test using fast-check style property testing. Use fc.assert(fc.property(...)) patterns. Import nothing — assume fc (fast-check) and the target function are in scope.",
    "targetFunction": "string — name of the function being tested",
    "filePath": "string — file containing the function",
    "lineRange": { "start": number, "end": number } | null
  }
]

Guidelines:
- Focus on functions that were CHANGED or ADDED in the diff. Don't test unchanged code.
- Each test should target ONE property of ONE function. Keep tests atomic.
- Properties to look for:
  * Return type contracts: "never returns null when input is valid"
  * Idempotency: "calling twice produces the same result"
  * Boundary behavior: "handles empty input without throwing"
  * Monotonicity: "larger input produces larger/equal output"
  * Round-trip: "parse(serialize(x)) === x"
  * Error containment: "invalid input returns error, never throws"
  * Invariant preservation: "output always satisfies [condition]"
- Write tests that are HARD to pass. Trivial tests (e.g., "result is defined") are worthless.
- If edge cases are provided, generate tests that specifically target those scenarios.
- For functions with side effects or external dependencies, test the pure logic portions only.
- 3-8 tests per MR. Fewer for simple changes, more for complex logic.
- If the changes are purely cosmetic (renames, formatting), return an empty array.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export const DEFAULT_ADVERSARIAL_TESTS_PROMPT = SYSTEM_PROMPT;

export type AdversarialTestInput = {
  diffFiles: DiffFileData[];
  fileContents: Record<string, string>;  // filePath → full content (target branch)
  mrTitle: string;
  mrDescription: string | null;
  edgeCases: EdgeCase[];                 // Feed edge cases as hints for test generation
};

export function buildAdversarialTestPrompt(input: AdversarialTestInput, customSystemPrompt?: string): ChatMessage[] {
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

  if (input.edgeCases.length > 0) {
    userContent += `

## Edge Cases Already Identified
These edge cases were found by a prior analysis. Use them as hints — generate tests that specifically target these scenarios:

${input.edgeCases.map((ec) => `- **${ec.title}** (${ec.severity}): ${ec.description}${ec.filePath ? ` [${ec.filePath}]` : ''}`).join('\n')}`;
  }

  return [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
