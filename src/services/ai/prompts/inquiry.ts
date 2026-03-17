// ---------------------------------------------------------------------------
// Prompt: Line Inquiry
//
// Builds the prompt for the line inquiry composer — a focused Q&A about a
// specific line range in the diff. Unlike the general chat, this is scoped
// to a precise code selection and optimized for one-off explanations.
//
// Design decisions:
// - The system prompt positions the AI as a code explainer, not a reviewer.
//   No unsolicited review commentary — just answer the question.
// - Previous slides are included as conversation history so follow-ups
//   have continuity without a full chat protocol.
// - The full file diff is included for broader context, but the selected
//   range is highlighted so the AI knows exactly what the user is asking about.
// - No [[filePath:line]] syntax — inquiries are already anchored to a
//   specific range, so clickable references add noise.
// - No suggested follow-up questions in HTML comments — the carousel has
//   its own quick action chips.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../ai-client';
import type { InquiryContext } from '@/types/inquiry';
import { OTTO_IDENTITY } from './shared';

const SYSTEM_PROMPT = `${OTTO_IDENTITY}

You are answering a developer's question about a specific section of code in a merge request diff.

## Your role

You are a code explainer. The developer has selected specific lines and asked a question about them. Answer precisely and concisely.

## Rules

- Answer ONLY the question asked. Do not volunteer review comments, suggestions, or unsolicited opinions about code quality.
- Match your depth to the question. "How does this work?" gets a walkthrough. "What calls this?" gets a list.
- Use markdown: fenced code blocks with language tags, bullet points, headers for longer answers.
- Reference specific line numbers from the selected range when relevant.
- If the question asks for an alternative approach, show concrete code — don't just describe it abstractly.
- If you don't have enough context to answer fully, say what you can and note what's missing.
- No preamble. Start with the answer.`;

export const DEFAULT_INQUIRY_PROMPT = SYSTEM_PROMPT;

/**
 * Build the inquiry prompt messages array.
 *
 * Structure:
 * 1. System prompt
 * 2. Context message (MR metadata + selected code + full file diff)
 * 3. Previous slides as conversation history (for follow-ups)
 * 4. Current question
 */
export function buildInquiryPrompt(
  context: InquiryContext,
  question: string,
  customSystemPrompt?: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: buildContextMessage(context) },
    { role: 'assistant', content: 'I see the selected code. What would you like to know?' },
  ];

  // Add previous slides as conversation history
  for (const slide of context.previousSlides) {
    messages.push({ role: 'user', content: slide.question });
    if (slide.answer) {
      messages.push({ role: 'assistant', content: slide.answer });
    }
  }

  // Current question
  messages.push({ role: 'user', content: question });

  return messages;
}

/**
 * Build the context message with the selected code and surrounding diff.
 */
function buildContextMessage(ctx: InquiryContext): string {
  const { mrContext, filePath, startLine, endLine, codeContent, diffSnippet, fullFileDiff } = ctx;

  // Detect language from file extension for code block syntax highlighting
  const ext = filePath.split('.').pop() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
    kt: 'kotlin', swift: 'swift', cs: 'csharp', cpp: 'cpp', c: 'c',
    php: 'php', vue: 'vue', svelte: 'svelte', html: 'html', css: 'css',
    scss: 'scss', sql: 'sql', sh: 'bash', yml: 'yaml', yaml: 'yaml',
    toml: 'toml', json: 'json', md: 'markdown', ex: 'elixir', exs: 'elixir',
    scala: 'scala', clj: 'clojure', hs: 'haskell', dart: 'dart',
    r: 'r', lua: 'lua', pl: 'perl', tf: 'hcl',
  };
  const lang = langMap[ext] || ext;

  const lineRange = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`;

  let content = `# Selected Code

**File:** ${filePath}
**Lines:** ${lineRange}
**MR:** ${mrContext.title} (${mrContext.sourceBranch} → ${mrContext.targetBranch})
**Project:** ${mrContext.projectPath}`;

  // The actual selected code content
  if (codeContent) {
    content += `

## Selected Code (${lineRange})
\`\`\`${lang}
${codeContent}
\`\`\``;
  }

  // The diff snippet for the selected range
  if (diffSnippet) {
    content += `

## Diff for Selected Lines
\`\`\`diff
${diffSnippet}
\`\`\``;
  }

  // Full file diff for broader context — truncated if very large
  if (fullFileDiff) {
    const MAX_FULL_DIFF_CHARS = 12_000;
    let diff = fullFileDiff;
    if (diff.length > MAX_FULL_DIFF_CHARS) {
      diff = diff.slice(0, MAX_FULL_DIFF_CHARS) + '\n... (truncated)';
    }

    content += `

## Full File Diff (for broader context)
\`\`\`diff
${diff}
\`\`\``;
  }

  // MR description for additional context
  if (mrContext.description) {
    const desc = mrContext.description.length > 2000
      ? mrContext.description.slice(0, 2000) + '... (truncated)'
      : mrContext.description;
    content += `

## MR Description
${desc}`;
  }

  return content;
}
