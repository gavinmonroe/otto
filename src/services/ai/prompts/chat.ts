// ---------------------------------------------------------------------------
// Prompt: MR Chat Q&A
//
// Builds the prompt for free-form Q&A about a merge request. The AI receives
// the full review context (summary, file reviews, edge cases, related files)
// plus the raw diffs, and answers the user's question conversationally.
//
// Output format: Markdown with [[filePath:line]] references for clickable
// links, and a <!-- suggestions: [...] --> block for follow-up questions.
//
// Design decisions:
// - The system prompt instructs the AI to use [[filePath:line]] syntax for
//   file references. This is a custom syntax parsed client-side — it won't
//   render as markdown, so we intercept it before rendering.
// - Suggested questions are embedded in an HTML comment so they don't render
//   as visible text but can be parsed by the client.
// - The review context is included as structured sections so the AI can
//   reference specific findings without re-analyzing the diffs from scratch.
// - Conversation history is passed as prior messages so the AI maintains
//   context across a multi-turn conversation.
// - Raw diffs are included so the AI can answer questions about code that
//   the review might not have specifically commented on.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../ai-client';
import type { ChatReviewContext } from '@/types/messages';
import type { ChatMessage as UiChatMessage } from '@/types/chat';
import { OTTO_IDENTITY } from './shared';

const SYSTEM_PROMPT = `${OTTO_IDENTITY}

The user is a developer reviewing (or authoring) this MR and wants to ask questions about it.

You have access to the full MR metadata, all file diffs, and a completed AI review (summary, per-file comments, edge cases, related files).

## Code references

Use this syntax to create clickable links that scroll to the exact line in the diff:
  [[filePath:lineNumber]]
  [[filePath:lineStart-lineEnd]]

Use these liberally. Only reference files/lines that exist in the MR diffs or review. Never fabricate paths or line numbers.

## Follow-up suggestions

End every response with exactly 2-3 contextual follow-up questions:
<!-- suggestions: ["Question one?", "Question two?", "Question three?"] -->

## Response guidelines

- Match the length of your answer to the complexity of the question. A simple question gets a direct answer, not an essay.
- Don't start with "Great question!" or "Let me explain..." — just answer.
- Use markdown: headers, bullet points, fenced code blocks with language tags.
- Reference specific lines with [[filePath:line]] — don't just mention file names in prose.
- If you don't have enough context, say so. Never make up code that isn't in the diff or review.`;

export const DEFAULT_CHAT_PROMPT = SYSTEM_PROMPT;

/**
 * Build the chat prompt messages array.
 *
 * The structure is:
 * 1. System prompt (instructions + custom prompt if set)
 * 2. A large "context" user message with all review data + diffs
 * 3. Conversation history (alternating user/assistant messages)
 * 4. The current user question
 *
 * The context message is always first (after system) so the AI has full
 * context before seeing any conversation. This means the context is sent
 * once and conversation history grows after it.
 *
 * History is capped to the most recent messages to stay within token limits.
 * The context message + system prompt are already large, so we keep history
 * to a reasonable window.
 */
const MAX_HISTORY_MESSAGES = 20; // ~10 turns of conversation

export function buildChatPrompt(
  question: string,
  reviewContext: ChatReviewContext,
  history: UiChatMessage[],
  customSystemPrompt?: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: buildContextMessage(reviewContext) },
    // The AI acknowledges the context — this anchors the conversation
    { role: 'assistant', content: 'I\'ve reviewed the MR context, diffs, and review findings. What would you like to know?' },
  ];

  // Cap history to most recent messages to stay within token limits
  const recentHistory = history.length > MAX_HISTORY_MESSAGES
    ? history.slice(-MAX_HISTORY_MESSAGES)
    : history;

  for (const msg of recentHistory) {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  // Current question
  messages.push({ role: 'user', content: question });

  return messages;
}

/**
 * Build the context message that gives the AI all the review data.
 * This is a single large message with structured sections.
 *
 * For large MRs, diffs are truncated to stay within reasonable token limits.
 * The review findings (summary, comments, edge cases) are always included
 * in full since they're already condensed by the AI.
 */
function buildContextMessage(ctx: ChatReviewContext): string {
  const { mrContext, summary, fileReviews, edgeCases, relatedFiles } = ctx;

  let content = `# MR Context

**Title:** ${mrContext.title}
**Source:** ${mrContext.sourceBranch} → **Target:** ${mrContext.targetBranch}
**Project:** ${mrContext.projectPath}

## Description
${mrContext.description || '(No description provided)'}`;

  // Include the review summary if available
  if (summary) {
    content += `

## Review Summary
**Overview:** ${summary.overview}
**Risk Assessment:** ${summary.riskAssessment}
**Key Changes:**
${summary.keyChanges.map((c) => `- ${c}`).join('\n')}
**Affected Areas:** ${summary.affectedAreas.join(', ')}`;
  }

  // Include per-file review findings
  if (fileReviews.length > 0) {
    content += `

## Per-File Review Findings`;

    for (const fr of fileReviews) {
      content += `

### ${fr.filePath} (risk: ${fr.riskLevel})
${fr.summary}`;

      if (fr.comments.length > 0) {
        content += `\n**Comments (${fr.comments.length}):**`;
        for (const c of fr.comments) {
          const lineRef = c.startLine
            ? c.endLine && c.endLine !== c.startLine
              ? ` (lines ${c.startLine}-${c.endLine})`
              : ` (line ${c.startLine})`
            : '';
          content += `\n- [${c.severity}/${c.category}]${lineRef} ${c.title}: ${c.body}`;
        }
      }
    }
  }

  // Include edge cases
  if (edgeCases.length > 0) {
    content += `

## Edge Cases Found`;
    for (const ec of edgeCases) {
      const fileRef = ec.filePath
        ? ec.lineRange
          ? ` (${ec.filePath}:${ec.lineRange.start}-${ec.lineRange.end})`
          : ` (${ec.filePath})`
        : '';
      content += `\n- [${ec.severity}] ${ec.title}${fileRef}: ${ec.description}`;
    }
  }

  // Include related files
  if (relatedFiles.length > 0) {
    content += `

## Related Files (not in diff but relevant)`;
    for (const rf of relatedFiles) {
      content += `\n- ${rf.filePath} (${rf.relationship}): ${rf.reason}`;
    }
  }

  // Include raw diffs — the AI needs these to answer questions about
  // specific code that the review might not have commented on.
  //
  // Token budget: truncate individual diffs if the total would be too large.
  // ~4 chars per token is a rough estimate. We target ~60k chars for diffs
  // (~15k tokens), leaving room for the rest of the context + conversation.
  const MAX_DIFF_CHARS = 60_000;
  const MAX_PER_FILE_CHARS = 8_000;

  const diffFiles = mrContext.diffFiles;
  let totalDiffChars = 0;
  for (const f of diffFiles) {
    totalDiffChars += f.diff.length;
  }

  const needsTruncation = totalDiffChars > MAX_DIFF_CHARS;

  content += `

## File Diffs (${diffFiles.length} files${needsTruncation ? ', some truncated for context limits' : ''})`;

  let remainingBudget = MAX_DIFF_CHARS;

  for (const f of diffFiles) {
    const status = f.isNew ? '[NEW]' : f.isDeleted ? '[DELETED]' : f.isRenamed ? '[RENAMED]' : '[MODIFIED]';

    if (remainingBudget <= 0) {
      content += `\n\n### ${status} ${f.filePath} (+${f.addedLines} -${f.removedLines})\n*(diff omitted — context limit reached)*`;
      continue;
    }

    let diff = f.diff;
    const perFileLimit = needsTruncation ? Math.min(MAX_PER_FILE_CHARS, remainingBudget) : diff.length;

    if (diff.length > perFileLimit) {
      diff = diff.slice(0, perFileLimit) + '\n... (truncated)';
    }

    remainingBudget -= diff.length;

    content += `

### ${status} ${f.filePath} (+${f.addedLines} -${f.removedLines})
\`\`\`diff
${diff}
\`\`\``;
  }

  return content;
}
