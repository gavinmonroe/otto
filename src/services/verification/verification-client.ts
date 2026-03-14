// ---------------------------------------------------------------------------
// Verification Runner Client — communicates with an external verification
// server to execute AI-generated tests, contracts, and behavioral scenarios.
//
// Runs in the service worker. The server is optional — when not configured,
// all verification falls back to AI-only reasoning (no execution).
//
// Design decisions:
// - Pure functions, same pattern as gitlab-client.ts and ai-client.ts.
// - Returns Result<T> for all operations.
// - The server API is simple: POST a verification payload, GET results.
// - Supports both synchronous (wait for results) and async (poll) modes.
// - When no server is configured, returns a clear "not configured" result
//   so callers can fall back gracefully.
// ---------------------------------------------------------------------------

import type { Result } from '@/types/messages';
import type {
  PropertyTest,
  PropertyTestResult,
  AdversarialTestData,
  CiExecutionResult,
  CiVerificationJob,
  TrustSignals,
} from '@/types/verification';
import { normalizeUrl } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerificationServerConfig = {
  baseUrl: string;   // e.g., "http://localhost:3100"
  apiKey?: string;   // Optional auth
};

type VerificationPayload = {
  projectPath: string;
  mrIid: number;
  sourceBranch: string;
  targetBranch: string;
  tests: Array<{
    id: string;
    testCode: string;
    targetFunction: string;
    filePath: string;
  }>;
  diffContent: string;         // Combined diff for all files
};

type VerificationResponse = {
  jobId: string;
  status: 'completed' | 'running' | 'failed';
  results: Array<{
    testId: string;
    status: 'held' | 'counterexample' | 'error';
    iterations: number;
    counterexample: string | null;
    errorMessage: string | null;
  }>;
  mutationScore: number | null;
  coverageDelta: number | null;
  executionTimeMs: number;
};

// ---------------------------------------------------------------------------
// Server communication
// ---------------------------------------------------------------------------

/**
 * Submit tests to the verification server for execution.
 * Returns results synchronously (server runs tests and responds).
 *
 * If no server is configured, returns ok: false with a descriptive error
 * so the caller can fall back to AI-only mode.
 */
export async function executeTests(
  config: VerificationServerConfig | null,
  payload: VerificationPayload,
  signal?: AbortSignal,
): Promise<Result<VerificationResponse>> {
  if (!config || !config.baseUrl) {
    return { ok: false, error: 'No verification server configured. Using AI-only reasoning.' };
  }

  const url = `${normalizeUrl(config.baseUrl)}/api/v1/verify`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        error: `Verification server error (${response.status}): ${text || response.statusText}`,
      };
    }

    const data = await response.json() as VerificationResponse;
    return { ok: true, data };
  } catch (error) {
    if (signal?.aborted) {
      return { ok: false, error: 'Verification cancelled' };
    }
    return {
      ok: false,
      error: `Failed to reach verification server at ${config.baseUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Map server response to our domain types.
 */
export function mapServerResults(
  response: VerificationResponse,
  tests: AdversarialTestData,
): { results: PropertyTestResult[]; execution: CiExecutionResult } {
  const results: PropertyTestResult[] = response.results.map((r) => ({
    testId: r.testId,
    status: r.status,
    iterations: r.iterations,
    counterexample: r.counterexample,
    errorMessage: r.errorMessage,
    aiReasoned: false,
  }));

  const job: CiVerificationJob = {
    method: 'server',
    pipelineId: null,
    pipelineUrl: null,
    jobStatus: response.status === 'completed' ? 'success' : 'failed',
    startedAt: Date.now() - response.executionTimeMs,
    completedAt: Date.now(),
  };

  return {
    results,
    execution: {
      job,
      testResults: results,
      mutationScore: response.mutationScore,
      coverageDelta: response.coverageDelta,
      executionTimeMs: response.executionTimeMs,
    },
  };
}

/**
 * Check if a verification server is reachable.
 */
export async function testServerConnection(
  config: VerificationServerConfig,
): Promise<Result<{ version: string }>> {
  const url = `${normalizeUrl(config.baseUrl)}/api/v1/health`;

  try {
    const response = await fetch(url, {
      headers: config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {},
    });

    if (!response.ok) {
      return { ok: false, error: `Server returned ${response.status}` };
    }

    const data = await response.json() as { version: string };
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: `Cannot reach server: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
