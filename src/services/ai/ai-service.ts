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
  AcValidationResult,
  AcCriterionResult,
} from '@/types/review';
import type {
  PropertyTest,
  PropertyTestResult,
  FileTestData,
  AdversarialTestData,
  FunctionContract,
  ContractData,
  BehaviorEntry,
  BehavioralDeltaData,
} from '@/types/verification';
import type { Result } from '@/types/messages';
import { chatCompletion, chatCompletionStream } from './ai-client';
import type { AiClientConfig, ChatMessage, ToolDefinition } from './ai-client';
import { buildSummaryPrompt } from './prompts/summary';
import { buildCodeReviewPrompt } from './prompts/code-review';
import type { CodeReviewInput } from './prompts/code-review';
import { buildEdgeCasePrompt } from './prompts/edge-cases';
import type { EdgeCaseInput } from './prompts/edge-cases';
import { buildRelatedFilesPrompt } from './prompts/related-files';
import type { RelatedFilesInput } from './prompts/related-files';
import { buildFollowUpPrompt } from './prompts/followup';
import type { FollowUpInput } from './prompts/followup';
import type { FollowUpAnalysis, FollowUpAction } from '@/types/followup';
import { buildChatPrompt } from './prompts/chat';
import { buildInquiryPrompt } from './prompts/inquiry';
import { buildAcValidationPrompt } from './prompts/ac-validation';
import type { AcValidationInput } from './prompts/ac-validation';
import { buildAdversarialTestPrompt } from './prompts/adversarial-tests';
import type { AdversarialTestInput } from './prompts/adversarial-tests';
import { buildContractPrompt } from './prompts/contracts';
import type { ContractInput } from './prompts/contracts';
import { buildBehavioralDeltaPrompt } from './prompts/behavioral-delta';
import type { BehavioralDeltaInput } from './prompts/behavioral-delta';
import type { ChatReviewContext } from '@/types/messages';
import type { ChatMessage as UiChatMessage, SuggestedQuestion } from '@/types/chat';
import type { InquiryContext } from '@/types/inquiry';
import { generateId } from '@/lib/utils';
import {
  REPO_EXPLORER_TOOLS,
  executeToolCall,
  type RepoExplorerContext,
} from '@/services/gitlab/repo-explorer';

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
 * Get max_tokens for a task. Returns undefined if set to 0 (not set),
 * which tells the AI client to omit the parameter entirely and let
 * the model/provider use its default.
 */
function getMaxTokens(aiConfig: AiConfig, task: AiTaskType): number | undefined {
  const value = aiConfig.maxTokens?.[task];
  return value && value > 0 ? value : undefined;
}

/**
 * Extract JSON from an AI response that might be wrapped in markdown fences.
 * AI models sometimes respond with ```json ... ``` despite instructions not to.
 *
 * Strategy: try raw parse first (cheapest), then greedy fence extraction,
 * then bare JSON object/array extraction as a last resort.
 */
function extractJson(text: string): string {
  const trimmed = text.trim();

  // Fast path: if the raw text is already valid JSON, use it directly.
  // This avoids regex mismatches entirely.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }

  // Try to find JSON in markdown code fences.
  // Use GREEDY [\s\S]* so we match the LAST closing fence, not the first.
  // This is critical when the JSON contains embedded code blocks (e.g.,
  // hypotheticalTrace fields with triple backticks inside).
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*)\n?\s*```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find a JSON object or array directly
  const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) return jsonMatch[1].trim();

  return trimmed;
}

/**
 * Safely parse JSON from AI response with error context.
 * If standard parsing fails, attempts to repair truncated JSON
 * (common when the model hits max_tokens mid-response).
 */
function parseAiJson<T>(text: string, context: string): Result<T> {
  const json = extractJson(text);

  // Try standard parse first
  try {
    const parsed = JSON.parse(json) as T;
    return { ok: true, data: parsed };
  } catch {
    // Fall through to repair attempt
  }

  // Try to repair truncated JSON — the model likely hit max_tokens
  const repaired = repairTruncatedJson(json);
  if (repaired) {
    try {
      const parsed = JSON.parse(repaired) as T;
      return { ok: true, data: parsed };
    } catch {
      // Repair didn't produce valid JSON either
    }
  }

  return {
    ok: false,
    error: `Failed to parse AI response for ${context}: Unterminated JSON (response may have been truncated). Try regenerating.`,
  };
}

/**
 * Attempt to repair truncated JSON by closing open brackets/braces/strings.
 *
 * Common truncation patterns from AI models:
 * - Array cut mid-object: `[{"a":1},{"b":2` → close string, object, array
 * - String cut mid-value: `[{"a":"hello wor` → close string, object, array
 * - Object cut mid-key: `[{"a":1,"b` → drop incomplete key, close object, array
 *
 * Strategy: find the last complete array element (ends with `}`), truncate
 * everything after it, and close the array. This gives us all fully-formed
 * items even if the last one was cut off.
 */
function repairTruncatedJson(json: string): string | null {
  const trimmed = json.trim();

  // Only attempt repair on arrays (edge cases, related files, etc.)
  if (!trimmed.startsWith('[')) return null;

  // Find the last complete object in the array — look for `}` followed by
  // either `,` or whitespace (but not inside a string).
  // Walk backwards to find the last `}` that closes a top-level array element.
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastCompleteObjectEnd = -1;

  for (let i = 1; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      // depth === 0 means we just closed a top-level array element
      if (depth === 0 && ch === '}') {
        lastCompleteObjectEnd = i;
      }
    }
  }

  if (lastCompleteObjectEnd === -1) return null;

  // Truncate after the last complete object and close the array
  return trimmed.slice(0, lastCompleteObjectEnd + 1) + ']';
}

/**
 * Get the custom system prompt for a task, or undefined if not set.
 * Empty string means "use default".
 */
function getCustomPrompt(aiConfig: AiConfig, task: AiTaskType): string | undefined {
  const value = aiConfig.customPrompts?.[task];
  return value && value.trim() ? value : undefined;
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
  ticketContext?: string | null,
): Promise<Result<MrSummary>> {
  const messages = buildSummaryPrompt(context, getCustomPrompt(aiConfig, 'summary'), ticketContext ?? undefined);
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'summary');
  const temperature = getTemperature(aiConfig, 'summary');
  const max_tokens = getMaxTokens(aiConfig, 'summary');

  if (onDelta) {
    // Streaming mode: collect full text while yielding deltas
    let fullText = '';
    try {
      const stream = chatCompletionStream(config, { model, messages, temperature, max_tokens }, signal);
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
    const result = await chatCompletion(config, { model, messages, temperature, max_tokens });
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
    suggestionSummary: string | null;
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
  const messages = buildCodeReviewPrompt(input, getCustomPrompt(aiConfig, 'codeReview'));
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'codeReview');
  const temperature = getTemperature(aiConfig, 'codeReview');
  const max_tokens = getMaxTokens(aiConfig, 'codeReview');

  let fullText = '';

  if (onDelta) {
    try {
      const stream = chatCompletionStream(config, { model, messages, temperature, max_tokens }, signal);
      for await (const chunk of stream) {
        fullText += chunk;
        onDelta(chunk);
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Code review stream failed' };
    }
  } else {
    const result = await chatCompletion(config, { model, messages, temperature, max_tokens });
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
      suggestionSummary: c.suggestionSummary ?? null,
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
  const messages = buildEdgeCasePrompt(input, getCustomPrompt(aiConfig, 'edgeCases'));
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'edgeCases');
  const temperature = getTemperature(aiConfig, 'edgeCases');
  const max_tokens = getMaxTokens(aiConfig, 'edgeCases');

  let fullText = '';

  if (onDelta) {
    try {
      const stream = chatCompletionStream(config, { model, messages, temperature, max_tokens }, signal);
      for await (const chunk of stream) {
        fullText += chunk;
        onDelta(chunk);
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Edge case stream failed' };
    }
  } else {
    const result = await chatCompletion(config, { model, messages, temperature, max_tokens });
    if (!result.ok) return result;
    fullText = result.data.choices[0]?.message?.content || '';
  }

  const parsed = parseAiJson<RawEdgeCase[] | Record<string, RawEdgeCase[]>>(fullText, 'edge cases');
  if (!parsed.ok) return parsed;

  // Handle AI wrapping the array in an object like {"edgeCases": [...]}
  let rawEdgeCases: RawEdgeCase[];
  if (Array.isArray(parsed.data)) {
    rawEdgeCases = parsed.data;
  } else if (typeof parsed.data === 'object' && parsed.data !== null) {
    // Find the first array value in the object
    const values = Object.values(parsed.data);
    const arr = values.find((v) => Array.isArray(v));
    if (arr) {
      rawEdgeCases = arr;
    } else {
      return { ok: false, error: 'Edge cases response is not an array' };
    }
  } else {
    return { ok: false, error: 'Edge cases response is not an array' };
  }

  const edgeCases: EdgeCase[] = rawEdgeCases.map((e) => ({
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
// Related Files Discovery (Tool-Use Flow)
// ---------------------------------------------------------------------------

type RawRelatedFile = {
  filePath: string;
  reason: string;
  relationship: 'imports' | 'imported-by' | 'shared-type' | 'test' | 'config' | 'other';
};

/** Max tool-use round-trips before forcing a final answer. */
const MAX_TOOL_ITERATIONS = 8;

/**
 * Discover related files using AI-driven repo exploration.
 * The AI uses tools (list_directory, get_subtree, search_files) to navigate
 * the repository and find real file paths, then returns its recommendations.
 */
export async function discoverRelatedFiles(
  aiConfig: AiConfig,
  input: RelatedFilesInput,
  explorerCtx: RepoExplorerContext,
): Promise<Result<RawRelatedFile[]>> {
  const messages: ChatMessage[] = buildRelatedFilesPrompt(input, getCustomPrompt(aiConfig, 'relatedFiles'));
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'relatedFiles');
  const temperature = getTemperature(aiConfig, 'relatedFiles');
  const max_tokens = getMaxTokens(aiConfig, 'relatedFiles');
  const tools: ToolDefinition[] = REPO_EXPLORER_TOOLS;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const result = await chatCompletion(config, {
      model,
      messages,
      temperature,
      max_tokens,
      tools,
      tool_choice: 'auto',
    });

    if (!result.ok) return result;

    const choice = result.data.choices[0];
    if (!choice) {
      return { ok: false, error: 'No response from AI' };
    }

    const toolCalls = choice.message.tool_calls;

    // No tool calls — the AI is giving its final answer
    if (!toolCalls || toolCalls.length === 0) {
      const content = choice.message.content || '';
      return parseAiJson<RawRelatedFile[]>(content, 'related files');
    }

    // Add the assistant message with tool calls to the conversation
    messages.push({
      role: 'assistant',
      content: choice.message.content ?? null,
      tool_calls: toolCalls,
    });

    // Execute each tool call and add results to the conversation
    for (const toolCall of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        // Malformed args — return empty result
      }

      const toolResult = await executeToolCall(explorerCtx, toolCall.function.name, args);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      });
    }
  }

  // Hit max iterations — ask for final answer without tools
  messages.push({
    role: 'user',
    content: 'Please provide your final answer now as a JSON array. No more tool calls.',
  });

  const finalResult = await chatCompletion(config, {
    model,
    messages,
    temperature,
    max_tokens,
  });

  if (!finalResult.ok) return finalResult;

  const content = finalResult.data.choices[0]?.message?.content || '';
  return parseAiJson<RawRelatedFile[]>(content, 'related files');
}

// ---------------------------------------------------------------------------
// Comment Follow-Up Analysis
// ---------------------------------------------------------------------------

/**
 * Raw AI output shape before we attach the commentId.
 */
type RawFollowUpAnalysis = {
  intent: FollowUpAnalysis['intent'];
  perspective: string;
  interpretation: string;
  recommendedAction: FollowUpAction;
};

/**
 * Analyze a comment thread and produce a follow-up recommendation.
 * Non-streaming — follow-up responses are small and fast.
 */
export async function generateFollowUp(
  aiConfig: AiConfig,
  input: FollowUpInput,
  commentId: string,
): Promise<Result<FollowUpAnalysis>> {
  const messages = buildFollowUpPrompt(input, getCustomPrompt(aiConfig, 'followUp'));
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'followUp');
  const temperature = getTemperature(aiConfig, 'followUp');
  const max_tokens = getMaxTokens(aiConfig, 'followUp');

  const result = await chatCompletion(config, { model, messages, temperature, max_tokens });
  if (!result.ok) return result;

  const content = result.data.choices[0]?.message?.content || '';
  const parsed = parseAiJson<RawFollowUpAnalysis>(content, 'comment follow-up');
  if (!parsed.ok) return parsed;

  const analysis: FollowUpAnalysis = {
    commentId,
    intent: parsed.data.intent,
    perspective: parsed.data.perspective,
    interpretation: parsed.data.interpretation,
    recommendedAction: parsed.data.recommendedAction,
  };

  return { ok: true, data: analysis };
}

// ---------------------------------------------------------------------------
// MR Chat Q&A
// ---------------------------------------------------------------------------

export type ChatResponse = {
  content: string;
  suggestedQuestions: SuggestedQuestion[];
};

/**
 * Extract suggested follow-up questions from the AI response.
 * The AI embeds them as: <!-- suggestions: ["Q1?", "Q2?", "Q3?"] -->
 *
 * Returns the questions and the content with the suggestions block removed.
 *
 * The regex matches everything between "<!-- suggestions:" and "-->" rather
 * than trying to match the JSON array directly. This handles questions that
 * contain ] characters (e.g., "What about array[0]?").
 */
function extractSuggestedQuestions(text: string): { content: string; questions: SuggestedQuestion[] } {
  const match = text.match(/<!--\s*suggestions:\s*([\s\S]*?)\s*-->/);
  if (!match) {
    return { content: text, questions: [] };
  }

  const content = text.replace(match[0], '').trimEnd();

  try {
    const jsonStr = match[1].trim();
    const raw = JSON.parse(jsonStr) as string[];
    const questions: SuggestedQuestion[] = raw
      .filter((q) => typeof q === 'string' && q.trim())
      .slice(0, 3)
      .map((q) => ({ label: q, question: q }));
    return { content, questions };
  } catch {
    return { content, questions: [] };
  }
}

/**
 * Generate a chat response for an MR Q&A question.
 * Streams content deltas for real-time display.
 *
 * Unlike other AI methods, chat returns plain markdown — no JSON parsing.
 * Suggested questions are extracted from an HTML comment in the response.
 */
export async function generateChatResponse(
  aiConfig: AiConfig,
  question: string,
  reviewContext: ChatReviewContext,
  history: UiChatMessage[],
  onDelta?: (content: string) => void,
  signal?: AbortSignal,
): Promise<Result<ChatResponse>> {
  const messages = buildChatPrompt(
    question,
    reviewContext,
    history,
    getCustomPrompt(aiConfig, 'chat'),
  );
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'chat');
  const temperature = getTemperature(aiConfig, 'chat');
  const max_tokens = getMaxTokens(aiConfig, 'chat');

  let fullText = '';

  if (onDelta) {
    try {
      const stream = chatCompletionStream(config, { model, messages, temperature, max_tokens }, signal);
      for await (const chunk of stream) {
        fullText += chunk;
        onDelta(chunk);
      }
    } catch (error) {
      if (signal?.aborted) {
        return { ok: false, error: 'Chat cancelled' };
      }
      return { ok: false, error: error instanceof Error ? error.message : 'Chat stream failed' };
    }
  } else {
    const result = await chatCompletion(config, { model, messages, temperature, max_tokens });
    if (!result.ok) return result;
    fullText = result.data.choices[0]?.message?.content || '';
  }

  const { content, questions } = extractSuggestedQuestions(fullText);

  return {
    ok: true,
    data: {
      content,
      suggestedQuestions: questions,
    },
  };
}

// ---------------------------------------------------------------------------
// Acceptance Criteria Validation
// ---------------------------------------------------------------------------

/**
 * Validate acceptance criteria from a linked ticket against the MR diff.
 * Non-streaming — returns the full validation result at once.
 */
export async function validateAcceptanceCriteria(
  aiConfig: AiConfig,
  input: AcValidationInput,
  signal?: AbortSignal,
): Promise<Result<AcValidationResult>> {
  const messages = buildAcValidationPrompt(input, getCustomPrompt(aiConfig, 'acValidation'));
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'acValidation');
  const temperature = getTemperature(aiConfig, 'acValidation');
  const max_tokens = getMaxTokens(aiConfig, 'acValidation');

  const result = await chatCompletion(config, { model, messages, temperature, max_tokens });
  if (!result.ok) return result;

  const content = result.data.choices[0]?.message?.content || '';
  const parsed = parseAiJson<{ criteria: AcCriterionResult[]; summary: string }>(content, 'AC validation');
  if (!parsed.ok) return parsed;

  // Normalize and validate the response
  const criteria = (parsed.data.criteria || []).map((c, i) => ({
    criterion: c.criterion || input.criteria[i] || `Criterion ${i + 1}`,
    status: (['satisfied', 'unclear', 'not-found'].includes(c.status) ? c.status : 'unclear') as AcCriterionResult['status'],
    explanation: c.explanation || '',
    evidence: Array.isArray(c.evidence) ? c.evidence.map((e) => ({
      filePath: e.filePath || '',
      startLine: typeof e.startLine === 'number' ? e.startLine : null,
      endLine: typeof e.endLine === 'number' ? e.endLine : null,
      snippet: e.snippet || null,
    })) : [],
  }));

  return {
    ok: true,
    data: {
      ticketKey: input.ticketKey,
      criteria,
      summary: parsed.data.summary || `${criteria.filter((c) => c.status === 'satisfied').length} of ${criteria.length} criteria satisfied.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Adversarial Test Generation
// ---------------------------------------------------------------------------

type RawPropertyTest = {
  property: string;
  testCode: string;
  targetFunction: string;
  filePath: string;
  lineRange: { start: number; end: number } | null;
};

/**
 * Generate adversarial property-based tests for changed functions.
 * Streams content deltas for real-time display, then parses into structured data.
 */
export async function generateAdversarialTests(
  aiConfig: AiConfig,
  input: AdversarialTestInput,
  onDelta?: (content: string) => void,
  signal?: AbortSignal,
): Promise<Result<AdversarialTestData>> {
  const messages = buildAdversarialTestPrompt(input, getCustomPrompt(aiConfig, 'adversarialTests'));
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'adversarialTests');
  const temperature = getTemperature(aiConfig, 'adversarialTests');
  const max_tokens = getMaxTokens(aiConfig, 'adversarialTests');

  let fullText = '';

  if (onDelta) {
    try {
      const stream = chatCompletionStream(config, { model, messages, temperature, max_tokens }, signal);
      for await (const chunk of stream) {
        fullText += chunk;
        onDelta(chunk);
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Adversarial test generation failed' };
    }
  } else {
    const result = await chatCompletion(config, { model, messages, temperature, max_tokens });
    if (!result.ok) return result;
    fullText = result.data.choices[0]?.message?.content || '';
  }

  const parsed = parseAiJson<RawPropertyTest[] | Record<string, RawPropertyTest[]>>(fullText, 'adversarial tests');
  if (!parsed.ok) return parsed;

  // Handle AI wrapping the array in an object
  let rawTests: RawPropertyTest[];
  if (Array.isArray(parsed.data)) {
    rawTests = parsed.data;
  } else if (typeof parsed.data === 'object' && parsed.data !== null) {
    const values = Object.values(parsed.data);
    const arr = values.find((v) => Array.isArray(v));
    rawTests = arr ? arr : [];
  } else {
    rawTests = [];
  }

  // Transform into domain types, grouped by file
  const testsById = new Map<string, PropertyTest[]>();
  for (const raw of rawTests) {
    // Validate required fields — AI may omit them
    if (!raw.property || !raw.testCode || !raw.targetFunction || !raw.filePath) continue;
    const test: PropertyTest = {
      id: generateId(),
      property: raw.property,
      testCode: raw.testCode,
      targetFunction: raw.targetFunction,
      filePath: raw.filePath,
      lineRange: raw.lineRange ?? null,
    };
    const existing = testsById.get(raw.filePath) || [];
    existing.push(test);
    testsById.set(raw.filePath, existing);
  }

  // Build per-file data with AI-reasoned results (no execution yet)
  const files: FileTestData[] = [];
  for (const [filePath, tests] of testsById) {
    files.push({
      filePath,
      tests,
      results: tests.map((t) => ({
        testId: t.id,
        status: 'not-run' as const,
        iterations: null,
        counterexample: null,
        errorMessage: null,
        aiReasoned: false,
      })),
    });
  }

  const totalTests = rawTests.length;

  return {
    ok: true,
    data: {
      files,
      totalTests,
      totalHeld: 0,
      totalCounterexamples: 0,
      totalErrors: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Contract Inference
// ---------------------------------------------------------------------------

type RawFunctionContract = {
  functionName: string;
  filePath: string;
  lineRange: { start: number; end: number } | null;
  preconditions: Array<{ human: string; code: string | null }>;
  postconditions: Array<{ human: string; code: string | null }>;
  invariants: Array<{ human: string; code: string | null }>;
  verificationStatus: 'verified' | 'violation-possible' | 'unknown';
  violationPath: string | null;
};

/**
 * Infer contracts (preconditions, postconditions, invariants) for changed functions.
 * Streams content deltas for real-time display, then parses into structured data.
 */
export async function generateContracts(
  aiConfig: AiConfig,
  input: ContractInput,
  onDelta?: (content: string) => void,
  signal?: AbortSignal,
): Promise<Result<ContractData>> {
  const messages = buildContractPrompt(input, getCustomPrompt(aiConfig, 'contracts'));
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'contracts');
  const temperature = getTemperature(aiConfig, 'contracts');
  const max_tokens = getMaxTokens(aiConfig, 'contracts');

  let fullText = '';

  if (onDelta) {
    try {
      const stream = chatCompletionStream(config, { model, messages, temperature, max_tokens }, signal);
      for await (const chunk of stream) {
        fullText += chunk;
        onDelta(chunk);
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Contract inference failed' };
    }
  } else {
    const result = await chatCompletion(config, { model, messages, temperature, max_tokens });
    if (!result.ok) return result;
    fullText = result.data.choices[0]?.message?.content || '';
  }

  const parsed = parseAiJson<RawFunctionContract[] | Record<string, RawFunctionContract[]>>(fullText, 'contracts');
  if (!parsed.ok) return parsed;

  // Handle AI wrapping the array in an object
  let rawContracts: RawFunctionContract[];
  if (Array.isArray(parsed.data)) {
    rawContracts = parsed.data;
  } else if (typeof parsed.data === 'object' && parsed.data !== null) {
    const values = Object.values(parsed.data);
    const arr = values.find((v) => Array.isArray(v));
    rawContracts = arr ? arr : [];
  } else {
    rawContracts = [];
  }

  const contracts: FunctionContract[] = rawContracts
    .filter((raw) => raw.functionName && raw.filePath) // Skip entries missing required fields
    .map((raw) => ({
      id: generateId(),
      functionName: raw.functionName,
      filePath: raw.filePath,
      lineRange: raw.lineRange ?? null,
      preconditions: (raw.preconditions || []).map((s) => ({ human: s.human || '', code: s.code ?? null })),
      postconditions: (raw.postconditions || []).map((s) => ({ human: s.human || '', code: s.code ?? null })),
      invariants: (raw.invariants || []).map((s) => ({ human: s.human || '', code: s.code ?? null })),
      verificationStatus: (['verified', 'violation-possible', 'unknown'].includes(raw.verificationStatus)
        ? raw.verificationStatus
        : 'unknown') as FunctionContract['verificationStatus'],
      violationPath: raw.violationPath || null,
      aiReasoned: true,
    }));

  return {
    ok: true,
    data: {
      contracts,
      totalVerified: contracts.filter((c) => c.verificationStatus === 'verified').length,
      totalViolations: contracts.filter((c) => c.verificationStatus === 'violation-possible').length,
      totalUnknown: contracts.filter((c) => c.verificationStatus === 'unknown').length,
    },
  };
}

// ---------------------------------------------------------------------------
// Behavioral Delta Analysis
// ---------------------------------------------------------------------------

type RawBehaviorEntry = {
  description: string;
  testScenario: string;
  expectedOutcome: string;
  filePaths: string[];
  type: 'changed' | 'preserved' | 'unexpected';
};

type RawBehavioralDelta = {
  summary: string;
  changed: RawBehaviorEntry[];
  preserved: RawBehaviorEntry[];
  unexpected: RawBehaviorEntry[];
};

/**
 * Analyze the behavioral delta of the MR — what changed, what was preserved,
 * and what changed unexpectedly.
 * Streams content deltas for real-time display, then parses into structured data.
 */
export async function generateBehavioralDelta(
  aiConfig: AiConfig,
  input: BehavioralDeltaInput,
  onDelta?: (content: string) => void,
  signal?: AbortSignal,
): Promise<Result<BehavioralDeltaData>> {
  const messages = buildBehavioralDeltaPrompt(input, getCustomPrompt(aiConfig, 'behavioralDelta'));
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'behavioralDelta');
  const temperature = getTemperature(aiConfig, 'behavioralDelta');
  const max_tokens = getMaxTokens(aiConfig, 'behavioralDelta');

  let fullText = '';

  if (onDelta) {
    try {
      const stream = chatCompletionStream(config, { model, messages, temperature, max_tokens }, signal);
      for await (const chunk of stream) {
        fullText += chunk;
        onDelta(chunk);
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Behavioral delta analysis failed' };
    }
  } else {
    const result = await chatCompletion(config, { model, messages, temperature, max_tokens });
    if (!result.ok) return result;
    fullText = result.data.choices[0]?.message?.content || '';
  }

  const parsed = parseAiJson<RawBehavioralDelta | Record<string, unknown>>(fullText, 'behavioral delta');
  if (!parsed.ok) return parsed;

  // Handle AI wrapping the response in an extra object (e.g., {"result": {...}})
  let delta: RawBehavioralDelta;
  const data = parsed.data;
  if ('changed' in data || 'preserved' in data || 'unexpected' in data) {
    delta = data as RawBehavioralDelta;
  } else if (typeof data === 'object' && data !== null) {
    // Find the first value that looks like a behavioral delta
    const inner = Object.values(data).find(
      (v) => v && typeof v === 'object' && ('changed' in v || 'preserved' in v),
    ) as RawBehavioralDelta | undefined;
    if (inner) {
      delta = inner;
    } else {
      return { ok: false, error: 'Behavioral delta response has unexpected structure' };
    }
  } else {
    return { ok: false, error: 'Behavioral delta response is not an object' };
  }

  function toBehaviorEntries(raw: RawBehaviorEntry[], type: BehaviorEntry['type']): BehaviorEntry[] {
    return (raw || []).map((r) => ({
      id: generateId(),
      description: r.description || '',
      type,
      testScenario: r.testScenario || '',
      expectedOutcome: r.expectedOutcome || '',
      actualOutcome: null,
      filePaths: r.filePaths || [],
      verified: false,
      aiReasoned: true,
    }));
  }

  return {
    ok: true,
    data: {
      changed: toBehaviorEntries(delta.changed, 'changed'),
      preserved: toBehaviorEntries(delta.preserved, 'preserved'),
      unexpected: toBehaviorEntries(delta.unexpected, 'unexpected'),
      summary: delta.summary || '',
    },
  };
}

// ---------------------------------------------------------------------------
// Line Inquiry
// ---------------------------------------------------------------------------

/**
 * Generate a response for a line inquiry question.
 * Streams content deltas for real-time display.
 *
 * Unlike chat, inquiry returns plain markdown with no suggested questions
 * or [[filePath:line]] references — the response is already anchored to
 * a specific line range.
 */
export async function generateInquiryResponse(
  aiConfig: AiConfig,
  context: InquiryContext,
  question: string,
  onDelta?: (content: string) => void,
  signal?: AbortSignal,
): Promise<Result<string>> {
  const messages = buildInquiryPrompt(
    context,
    question,
    getCustomPrompt(aiConfig, 'inquiry'),
  );
  const config = getClientConfig(aiConfig);
  const model = getModel(aiConfig, 'inquiry');
  const temperature = getTemperature(aiConfig, 'inquiry');
  const max_tokens = getMaxTokens(aiConfig, 'inquiry');

  let fullText = '';

  if (onDelta) {
    try {
      const stream = chatCompletionStream(config, { model, messages, temperature, max_tokens }, signal);
      for await (const chunk of stream) {
        fullText += chunk;
        onDelta(chunk);
      }
    } catch (error) {
      if (signal?.aborted) {
        return { ok: false, error: 'Inquiry cancelled' };
      }
      return { ok: false, error: error instanceof Error ? error.message : 'Inquiry stream failed' };
    }
  } else {
    const result = await chatCompletion(config, { model, messages, temperature, max_tokens });
    if (!result.ok) return result;
    fullText = result.data.choices[0]?.message?.content || '';
  }

  return { ok: true, data: fullText };
}
