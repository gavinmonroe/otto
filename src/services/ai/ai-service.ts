// ---------------------------------------------------------------------------
// AI Service — orchestrates AI calls with model routing and prompt building.
//
// Runs in the service worker. This is the bridge between the review
// orchestrator (which knows about reviews) and the AI client (which knows
// about HTTP). The AI service knows about prompts and model selection.
//
// Design decisions:
// - Each review task (summary, code review, edge cases, related files) has
//   its own method that builds the prompt, selects the model, and calls
//   the AI client.
// - Model and temperature are resolved from settings per task type.
// - Streaming methods yield content deltas for real-time UI updates.
// - Non-streaming methods return parsed structured data.
// - JSON parsing from AI responses is fault-tolerant: we try to extract
//   JSON from the response even if the AI wraps it in markdown fences.
// ---------------------------------------------------------------------------

import type { AiConfig, AiTaskType } from '@/types/settings';
import type {
  MrContext,
  MrSummary,
  FileReview,
  ReviewComment,
  EdgeCase,
  DiffFileData,
} from '@/types/review';
import type { Result } from '@/types/messages';
import { chatCompletion, chatCompletionStream } from './ai-client';
import type { AiClientConfig } from './ai-client';
import { buildSummaryPrompt } from './prompts/summary';
import { buildCodeReviewPrompt } from './prompts/code-review';
import type { CodeReviewInput } from './prompts/code-review';
import { buildEdgeCasePrompt } from './prompts/edge-cases';
import type { EdgeCaseInput } from './prompts/edge-cases';
import { buildRelatedFilesPrompt } from './prompts/related-files';
import type { RelatedFilesInput } from './prompts/related-files';
import { generateId } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClientConfig(aiConfig: AiConfig): AiClientConfig {
  return { baseUrl: aiConfig.baseUrl, apiKey: aiConfig.apiKey };
}

function getModel(aiConfig: AiConfig, task: AiTaskType): string {
  return aiConfig.models[task];
}

function getTemperature(aiConfig: AiConfig, task: AiTaskType): number {
  return aiConfig.temperatures[task];
}

/**
 * Extract JSON from an AI response that might be wrapped in markdown fences.
 * AI models sometimes respond with ```json ... ``` despite instructions not to.
 */
function extractJson(text: string): string {
  // Try to find JSON in markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find a JSON object or array directly
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) return jsonMatch[1].trim();

  return text.trim();
}

/**
 * Safely parse JSON from AI response with error context.
 */
function parseAiJson<T>(text: string, context: string): Result<T> {
  try {
    const json = extractJson(text);
    const parsed = JSON.parse(json) as T;
    return { ok: true, data: parsed };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to parse AI response for ${context}: ${error instanceof Error ? error.message : 'Invalid JSON'}`,
    };
  }
}

// ---------------------------------------------------------------------------
// MR Summary
// ---------------------------------------------------------------------------

/**
 * Generate an MR summary. Streams content deltas for real-time display,
 * then parses the complete response into structured MrSummary.
 */
export async function generateSummary(
  aiConfig: AiConfig,
  context: MrContext,
  onDelta?: (content: string) => void,
  signal?: AbortSignal,
): Promise<Result<MrSummary>> {
  const messages = buildSummaryPrompt(context);
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'summary');
  const temperature = getTemperature(aiConfig, 'summary');

  if (onDelta) {
    // Streaming mode: collect full text while yielding deltas
    let fullText = '';
    try {
      const stream = chatCompletionStream(config, { model, messages, temperature }, signal);
      for await (const chunk of stream) {
        fullText += chunk;
        onDelta(chunk);
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Summary stream failed' };
    }
    return parseAiJson<MrSummary>(fullText, 'summary');
  } else {
    // Non-streaming mode
    const result = await chatCompletion(config, { model, messages, temperature });
    if (!result.ok) return result;
    const content = result.data.choices[0]?.message?.content || '';
    return parseAiJson<MrSummary>(content, 'summary');
  }
}

// ---------------------------------------------------------------------------
// Per-File Code Review
// ---------------------------------------------------------------------------

type RawFileReview = {
  summary: string;
  riskLevel: 'low' | 'medium' | 'high';
  comments: Array<{
    startLine: number | null;
    endLine: number | null;
    severity: ReviewComment['severity'];
    category: ReviewComment['category'];
    title: string;
    body: string;
    originalCode: string | null;
    suggestion: string | null;
  }>;
};

/**
 * Generate a code review for a single file.
 */
export async function generateFileReview(
  aiConfig: AiConfig,
  input: CodeReviewInput,
  onDelta?: (content: string) => void,
  signal?: AbortSignal,
): Promise<Result<FileReview>> {
  const messages = buildCodeReviewPrompt(input);
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'codeReview');
  const temperature = getTemperature(aiConfig, 'codeReview');

  let fullText = '';

  if (onDelta) {
    try {
      const stream = chatCompletionStream(config, { model, messages, temperature }, signal);
      for await (const chunk of stream) {
        fullText += chunk;
        onDelta(chunk);
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Code review stream failed' };
    }
  } else {
    const result = await chatCompletion(config, { model, messages, temperature });
    if (!result.ok) return result;
    fullText = result.data.choices[0]?.message?.content || '';
  }

  const parsed = parseAiJson<RawFileReview>(fullText, `code review for ${input.file.filePath}`);
  if (!parsed.ok) return parsed;

  // Transform raw AI output into our domain types (add IDs, default status)
  const fileReview: FileReview = {
    filePath: input.file.filePath,
    summary: parsed.data.summary,
    riskLevel: parsed.data.riskLevel,
    comments: parsed.data.comments.map((c) => ({
      id: generateId(),
      filePath: input.file.filePath,
      startLine: c.startLine,
      endLine: c.endLine,
      severity: c.severity,
      category: c.category,
      title: c.title,
      body: c.body,
      originalCode: c.originalCode ?? null,
      suggestion: c.suggestion,
      status: 'pending' as const,
      editedBody: null,
    })),
  };

  return { ok: true, data: fileReview };
}

// ---------------------------------------------------------------------------
// Edge Case Analysis
// ---------------------------------------------------------------------------

type RawEdgeCase = {
  title: string;
  description: string;
  filePath: string | null;
  lineRange: { start: number; end: number } | null;
  severity: EdgeCase['severity'];
  category: EdgeCase['category'];
  hypotheticalTrace: string | null;
};

/**
 * Generate edge case analysis for the MR.
 */
export async function generateEdgeCases(
  aiConfig: AiConfig,
  input: EdgeCaseInput,
  onDelta?: (content: string) => void,
  signal?: AbortSignal,
): Promise<Result<EdgeCase[]>> {
  const messages = buildEdgeCasePrompt(input);
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'edgeCases');
  const temperature = getTemperature(aiConfig, 'edgeCases');

  let fullText = '';

  if (onDelta) {
    try {
      const stream = chatCompletionStream(config, { model, messages, temperature }, signal);
      for await (const chunk of stream) {
        fullText += chunk;
        onDelta(chunk);
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Edge case stream failed' };
    }
  } else {
    const result = await chatCompletion(config, { model, messages, temperature });
    if (!result.ok) return result;
    fullText = result.data.choices[0]?.message?.content || '';
  }

  const parsed = parseAiJson<RawEdgeCase[]>(fullText, 'edge cases');
  if (!parsed.ok) return parsed;

  const edgeCases: EdgeCase[] = parsed.data.map((e) => ({
    id: generateId(),
    title: e.title,
    description: e.description,
    filePath: e.filePath,
    lineRange: e.lineRange,
    severity: e.severity,
    category: e.category,
    hypotheticalTrace: e.hypotheticalTrace,
  }));

  return { ok: true, data: edgeCases };
}

// ---------------------------------------------------------------------------
// Related Files Discovery
// ---------------------------------------------------------------------------

type RawRelatedFile = {
  filePath: string;
  reason: string;
  relationship: 'imports' | 'imported-by' | 'shared-type' | 'test' | 'config' | 'other';
};

/**
 * Discover related files not in the diff.
 * This is non-streaming because the output is structured and typically small.
 */
export async function discoverRelatedFiles(
  aiConfig: AiConfig,
  input: RelatedFilesInput,
): Promise<Result<RawRelatedFile[]>> {
  const messages = buildRelatedFilesPrompt(input);
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'relatedFiles');
  const temperature = getTemperature(aiConfig, 'relatedFiles');

  const result = await chatCompletion(config, { model, messages, temperature });
  if (!result.ok) return result;

  const content = result.data.choices[0]?.message?.content || '';
  return parseAiJson<RawRelatedFile[]>(content, 'related files');
}
