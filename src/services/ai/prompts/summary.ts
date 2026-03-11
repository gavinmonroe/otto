// ---------------------------------------------------------------------------
// Prompt: MR Summary
//
// Generates a concise overview of the entire merge request.
// The AI receives all diff data + MR metadata and produces a structured
// summary with risk assessment.
//
// Output format: JSON matching MrSummary type.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../ai-client';
import type { MrContext } from '@/types/review';
import { OTTO_IDENTITY } from './shared';

const SYSTEM_PROMPT = `${OTTO_IDENTITY}

Your task: summarize a GitLab merge request.

You will receive the MR title, description, branch info, and the complete diff for all changed files.

Respond with a JSON object matching this exact schema:
{
  "overview": "string — 1-2 sentences. What changed and why. No preamble like 'This MR...' — just state the change. Use markdown.",
  "riskAssessment": "string — 1 sentence. Risk level (low/medium/high) and the single biggest reason. Don't repeat the overview.",
  "keyChanges": ["string — 3-5 items. Short phrases (max 8 words), not full sentences. Focus on what matters."],
  "affectedAreas": ["string — 2-4 items. Domain language, not file paths (e.g. 'Authentication', 'Database layer')."]
}

Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export const DEFAULT_SUMMARY_PROMPT = SYSTEM_PROMPT;

export function buildSummaryPrompt(context: MrContext, customSystemPrompt?: string, ticketContext?: string): ChatMessage[] {
  const diffSummary = context.diffFiles.map((f) => {
    const status = f.isNew ? '[NEW]' : f.isDeleted ? '[DELETED]' : f.isRenamed ? '[RENAMED]' : '[MODIFIED]';
    return `${status} ${f.filePath} (+${f.addedLines} -${f.removedLines})\n${f.diff}`;
  }).join('\n\n---\n\n');

  const userContent = `# Merge Request: ${context.title}

**Source branch:** ${context.sourceBranch} → **Target branch:** ${context.targetBranch}
**Project:** ${context.projectPath}

## Description
${context.description || '(No description provided)'}
${ticketContext ? `\n## Linked Ticket(s)\n${ticketContext}` : ''}
## Changed Files (${context.diffFiles.length} files)

${diffSummary}`;

  return [
    { role: 'system', content: customSystemPrompt || SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
