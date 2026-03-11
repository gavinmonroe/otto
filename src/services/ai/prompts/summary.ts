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

const SYSTEM_PROMPT = `You are Otto, an expert code reviewer. Your task is to provide a concise, actionable summary of a GitLab merge request.

You will receive the MR title, description, branch info, and the complete diff for all changed files.

Respond with a JSON object matching this exact schema:
{
  "overview": "string — 2-4 sentence summary of what changed and why. Use markdown.",
  "riskAssessment": "string — 1-2 sentence assessment of the overall risk level (low/medium/high) and why.",
  "keyChanges": ["string — each is a concise bullet point describing a key change"],
  "affectedAreas": ["string — high-level areas of the codebase affected, e.g. 'Authentication', 'Database layer', 'API endpoints'"]
}

Guidelines:
- Focus on the "what" and "why", not line-by-line details.
- The overview should help a reviewer decide where to focus their attention.
- Risk assessment should consider: scope of changes, complexity, potential for regressions, security implications.
- Keep keyChanges to 3-7 items. Each should be one sentence.
- Keep affectedAreas to 2-5 items. Use domain language, not file paths.
- Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.`;

export function buildSummaryPrompt(context: MrContext): ChatMessage[] {
  const diffSummary = context.diffFiles.map((f) => {
    const status = f.isNew ? '[NEW]' : f.isDeleted ? '[DELETED]' : f.isRenamed ? '[RENAMED]' : '[MODIFIED]';
    return `${status} ${f.filePath} (+${f.addedLines} -${f.removedLines})\n${f.diff}`;
  }).join('\n\n---\n\n');

  const userContent = `# Merge Request: ${context.title}

**Source branch:** ${context.sourceBranch} → **Target branch:** ${context.targetBranch}
**Project:** ${context.projectPath}

## Description
${context.description || '(No description provided)'}

## Changed Files (${context.diffFiles.length} files)

${diffSummary}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
