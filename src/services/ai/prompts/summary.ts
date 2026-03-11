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

const SYSTEM_PROMPT = `You are Otto, an expert code reviewer. Provide a concise summary of a GitLab merge request.

You will receive the MR title, description, branch info, and the complete diff for all changed files.

Respond with a JSON object matching this exact schema:
{
  "overview": "string — 1-2 sentences. What changed and why. Be direct, no filler. Use markdown.",
  "riskAssessment": "string — 1 sentence. State the risk level (low/medium/high) and the single biggest reason why.",
  "keyChanges": ["string — short bullet points, max 8 words each. Focus on what matters."],
  "affectedAreas": ["string — high-level areas affected, e.g. 'Authentication', 'Database layer', 'API endpoints'"]
}

Guidelines:
- Be concise. Every word should earn its place.
- overview: help the reviewer know where to focus. No preamble like "This MR..." — just state the change.
- keyChanges: 3-5 items max. Short phrases, not full sentences.
- affectedAreas: 2-4 items. Domain language, not file paths.
- riskAssessment: one sentence. Don't repeat what's in the overview.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

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
