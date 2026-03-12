// ---------------------------------------------------------------------------
// Repo Config — reads .otto.json from the repository root for team-level
// review configuration.
//
// Design decisions:
// - Fetched once during context preparation, cached in memory for the session.
// - Missing file is the normal case — most repos won't have one initially.
// - Schema is intentionally loose: unknown fields are ignored, not rejected.
// - Merges with (not replaces) user settings — user preferences still win
//   for personal taste. Repo config provides the team baseline.
// - The config is formatted as text and injected into AI prompts alongside
//   reviewer preferences and repo facts.
// ---------------------------------------------------------------------------

import type { GitLabHost } from '@/types/settings';
import * as gitlab from '../gitlab/gitlab-client';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * The shape of .otto.json in the repository root.
 * All fields are optional — partial configs are fine.
 */
export type RepoConfig = {
  /** Free-text project context injected into all AI prompts.
   *  e.g., "Django 4.2 REST API, PostgreSQL, Celery for async tasks" */
  context?: string;

  /** Review focus areas — categories the AI should prioritize.
   *  e.g., ["sql-injection", "n-plus-one", "missing-migrations"] */
  focus?: string[];

  /** Categories the AI should deprioritize or skip.
   *  e.g., ["style", "naming"] */
  ignore?: string[];

  /** Free-text review template/checklist injected into code review prompts.
   *  e.g., "Check for: auth on new endpoints, migration safety, backward compat" */
  reviewTemplate?: string;

  /** Jira custom field ID for acceptance criteria (overrides heuristic detection).
   *  e.g., "customfield_10042" */
  acceptanceCriteriaField?: string;
};

// ---------------------------------------------------------------------------
// Fetch + Parse
// ---------------------------------------------------------------------------

const CONFIG_FILE = '.otto.json';

/**
 * Fetch and parse .otto.json from the repository root.
 * Returns null if the file doesn't exist or can't be parsed.
 * Non-fatal — callers should treat null as "no repo config".
 */
export async function fetchRepoConfig(
  host: GitLabHost,
  projectId: number,
  ref: string,
): Promise<RepoConfig | null> {
  const result = await gitlab.fetchFileContent(host, projectId, CONFIG_FILE, ref);

  if (!result.ok) {
    // 404 is expected — most repos won't have .otto.json
    return null;
  }

  try {
    const raw = JSON.parse(result.data);
    return validateRepoConfig(raw);
  } catch {
    // Malformed JSON — silently ignore
    return null;
  }
}

/**
 * Validate and sanitize the parsed config.
 * Unknown fields are dropped. Invalid types are coerced or ignored.
 */
function validateRepoConfig(raw: unknown): RepoConfig | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;
  const config: RepoConfig = {};

  if (typeof obj.context === 'string' && obj.context.trim()) {
    config.context = obj.context.trim().slice(0, 2000); // Cap at 2000 chars
  }

  if (Array.isArray(obj.focus)) {
    config.focus = obj.focus
      .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
      .map((f) => f.trim())
      .slice(0, 20); // Cap at 20 items
  }

  if (Array.isArray(obj.ignore)) {
    config.ignore = obj.ignore
      .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
      .map((f) => f.trim())
      .slice(0, 20);
  }

  if (typeof obj.reviewTemplate === 'string' && obj.reviewTemplate.trim()) {
    config.reviewTemplate = obj.reviewTemplate.trim().slice(0, 2000);
  }

  if (typeof obj.acceptanceCriteriaField === 'string' && obj.acceptanceCriteriaField.trim()) {
    config.acceptanceCriteriaField = obj.acceptanceCriteriaField.trim();
  }

  // Return null if nothing useful was found
  const hasContent = config.context || config.focus?.length || config.ignore?.length
    || config.reviewTemplate || config.acceptanceCriteriaField;
  return hasContent ? config : null;
}

/**
 * Format repo config as text for injection into AI prompts.
 * Produces a structured block that the AI can use for context.
 */
export function formatRepoConfigForPrompt(config: RepoConfig): string {
  const lines: string[] = ['## Project Configuration (from .otto.json)'];

  if (config.context) {
    lines.push(`\n**Project context:** ${config.context}`);
  }

  if (config.focus && config.focus.length > 0) {
    lines.push(`\n**Review focus areas** (prioritize these): ${config.focus.join(', ')}`);
  }

  if (config.ignore && config.ignore.length > 0) {
    lines.push(`\n**Deprioritized categories** (skip unless critical): ${config.ignore.join(', ')}`);
  }

  if (config.reviewTemplate) {
    lines.push(`\n**Review checklist:**\n${config.reviewTemplate}`);
  }

  return lines.join('\n');
}
