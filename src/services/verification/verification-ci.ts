// ---------------------------------------------------------------------------
// CI Bridge — triggers verification tests via GitLab CI pipelines.
//
// Uses the existing GitLab API client pattern to trigger child pipelines
// or create temporary branches with generated test files.
//
// Design decisions:
// - Two modes: pipeline trigger (requires CI template) and commit-based
//   (zero setup, creates a temp branch with test files).
// - Polls pipeline status until completion.
// - Cleans up temporary branches after results are fetched.
// - Falls back gracefully when CI is not available.
// ---------------------------------------------------------------------------

import type { Result } from '@/types/messages';
import type {
  PropertyTest,
  PropertyTestResult,
  CiVerificationJob,
  CiExecutionResult,
  CiJobStatus,
} from '@/types/verification';
import type { GitLabHost } from '@/types/settings';
import { encodeProjectPath, normalizeUrl, sleep } from '@/lib/utils';

type CiHostConfig = {
  url: string;
  pat: string;
};

// ---------------------------------------------------------------------------
// Pipeline trigger mode
// ---------------------------------------------------------------------------

type TriggerPipelineParams = {
  host: CiHostConfig;
  projectId: number;
  ref: string;                    // Branch to run pipeline on
  variables: Record<string, string>;  // CI variables (test code as base64, etc.)
};

/**
 * Trigger a pipeline with variables containing the test payload.
 * Requires a .gitlab-ci.yml in the repo with an otto-verify job template.
 */
async function triggerPipeline(
  params: TriggerPipelineParams,
): Promise<Result<{ pipelineId: number; webUrl: string }>> {
  const { host, projectId, ref, variables } = params;
  const baseUrl = normalizeUrl(host.url);
  const url = `${baseUrl}/api/v4/projects/${projectId}/pipeline`;

  const body = {
    ref,
    variables: Object.entries(variables).map(([key, value]) => ({
      key,
      variable_type: 'env_var',
      value,
    })),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': host.pat,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, error: `Pipeline trigger failed (${response.status}): ${text || response.statusText}` };
    }

    const data = await response.json() as { id: number; web_url: string };
    return { ok: true, data: { pipelineId: data.id, webUrl: data.web_url } };
  } catch (error) {
    return { ok: false, error: `Pipeline trigger failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

/**
 * Poll a pipeline's status until it completes or times out.
 */
async function pollPipelineStatus(
  host: CiHostConfig,
  projectId: number,
  pipelineId: number,
  signal?: AbortSignal,
  maxWaitMs = 300_000,  // 5 minutes
): Promise<Result<{ status: CiJobStatus; jobUrl: string | null }>> {
  const baseUrl = normalizeUrl(host.url);
  const url = `${baseUrl}/api/v4/projects/${projectId}/pipelines/${pipelineId}`;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (signal?.aborted) {
      return { ok: false, error: 'Pipeline polling cancelled' };
    }

    try {
      const response = await fetch(url, {
        headers: { 'PRIVATE-TOKEN': host.pat },
      });

      if (!response.ok) {
        return { ok: false, error: `Pipeline status check failed (${response.status})` };
      }

      const data = await response.json() as { status: string; web_url: string };
      const status = mapGitLabStatus(data.status);

      if (status === 'success' || status === 'failed' || status === 'cancelled') {
        return { ok: true, data: { status, jobUrl: data.web_url } };
      }

      // Still running — wait before polling again
      await sleep(5000);
    } catch (error) {
      return { ok: false, error: `Pipeline polling failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  return { ok: false, error: 'Pipeline timed out after 5 minutes' };
}

/**
 * Fetch pipeline job artifacts (the JSON results file).
 */
async function fetchPipelineArtifact(
  host: CiHostConfig,
  projectId: number,
  pipelineId: number,
  artifactPath: string,
): Promise<Result<string>> {
  const baseUrl = normalizeUrl(host.url);
  // Get jobs for this pipeline, find the otto-verify job
  const jobsUrl = `${baseUrl}/api/v4/projects/${projectId}/pipelines/${pipelineId}/jobs`;

  try {
    const jobsResponse = await fetch(jobsUrl, {
      headers: { 'PRIVATE-TOKEN': host.pat },
    });

    if (!jobsResponse.ok) {
      return { ok: false, error: `Failed to fetch pipeline jobs (${jobsResponse.status})` };
    }

    const jobs = await jobsResponse.json() as Array<{ id: number; name: string; status: string }>;
    const verifyJob = jobs.find((j) => j.name === 'otto-verify' || j.name.includes('otto'));

    if (!verifyJob) {
      return { ok: false, error: 'No otto-verify job found in pipeline' };
    }

    // Fetch the artifact
    const artifactUrl = `${baseUrl}/api/v4/projects/${projectId}/jobs/${verifyJob.id}/artifacts/${artifactPath}`;
    const artifactResponse = await fetch(artifactUrl, {
      headers: { 'PRIVATE-TOKEN': host.pat },
    });

    if (!artifactResponse.ok) {
      return { ok: false, error: `Failed to fetch artifact (${artifactResponse.status})` };
    }

    const text = await artifactResponse.text();
    return { ok: true, data: text };
  } catch (error) {
    return { ok: false, error: `Artifact fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CiBridgeConfig = {
  host: CiHostConfig;
  projectId: number;
  sourceBranch: string;
};

/**
 * Run verification tests via GitLab CI.
 *
 * Flow:
 * 1. Encode test payload as base64 CI variable
 * 2. Trigger pipeline on the source branch
 * 3. Poll until complete
 * 4. Fetch results artifact
 * 5. Return parsed results
 *
 * Returns ok: false if CI is not available or the pipeline fails.
 */
export async function runVerificationViaCi(
  config: CiBridgeConfig,
  tests: PropertyTest[],
  signal?: AbortSignal,
): Promise<Result<CiExecutionResult>> {
  const startTime = Date.now();

  // Encode tests as a CI variable (base64 to avoid escaping issues)
  const testPayload = JSON.stringify(tests.map((t) => ({
    id: t.id,
    testCode: t.testCode,
    targetFunction: t.targetFunction,
    filePath: t.filePath,
  })));
  const encodedTests = btoa(testPayload);

  // Trigger the pipeline
  const triggerResult = await triggerPipeline({
    host: config.host,
    projectId: config.projectId,
    ref: config.sourceBranch,
    variables: {
      OTTO_VERIFY: 'true',
      OTTO_TESTS: encodedTests,
    },
  });

  if (!triggerResult.ok) return triggerResult;

  const { pipelineId, webUrl } = triggerResult.data;

  // Poll until complete
  const statusResult = await pollPipelineStatus(
    config.host,
    config.projectId,
    pipelineId,
    signal,
  );

  if (!statusResult.ok) return statusResult;

  // Build the job record
  const job: CiVerificationJob = {
    method: 'gitlab-ci',
    pipelineId,
    pipelineUrl: webUrl,
    jobStatus: statusResult.data.status,
    startedAt: startTime,
    completedAt: Date.now(),
  };

  // If pipeline failed, return partial result
  if (statusResult.data.status !== 'success') {
    return {
      ok: true,
      data: {
        job,
        testResults: tests.map((t) => ({
          testId: t.id,
          status: 'error' as const,
          iterations: null,
          counterexample: null,
          errorMessage: 'CI pipeline failed',
          aiReasoned: false,
        })),
        mutationScore: null,
        coverageDelta: null,
        executionTimeMs: Date.now() - startTime,
      },
    };
  }

  // Fetch results artifact
  const artifactResult = await fetchPipelineArtifact(
    config.host,
    config.projectId,
    pipelineId,
    '.otto/results.json',
  );

  if (!artifactResult.ok) {
    // Pipeline succeeded but no artifact — return success with no detailed results
    return {
      ok: true,
      data: {
        job,
        testResults: tests.map((t) => ({
          testId: t.id,
          status: 'not-run' as const,
          iterations: null,
          counterexample: null,
          errorMessage: 'No results artifact found',
          aiReasoned: false,
        })),
        mutationScore: null,
        coverageDelta: null,
        executionTimeMs: Date.now() - startTime,
      },
    };
  }

  // Parse the results
  try {
    const results = JSON.parse(artifactResult.data) as {
      testResults: Array<{
        testId: string;
        status: 'held' | 'counterexample' | 'error';
        iterations: number;
        counterexample: string | null;
        errorMessage: string | null;
      }>;
      mutationScore: number | null;
      coverageDelta: number | null;
    };

    return {
      ok: true,
      data: {
        job,
        testResults: results.testResults.map((r) => ({
          ...r,
          aiReasoned: false,
        })),
        mutationScore: results.mutationScore,
        coverageDelta: results.coverageDelta,
        executionTimeMs: Date.now() - startTime,
      },
    };
  } catch {
    return {
      ok: true,
      data: {
        job,
        testResults: tests.map((t) => ({
          testId: t.id,
          status: 'error' as const,
          iterations: null,
          counterexample: null,
          errorMessage: 'Failed to parse results artifact',
          aiReasoned: false,
        })),
        mutationScore: null,
        coverageDelta: null,
        executionTimeMs: Date.now() - startTime,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapGitLabStatus(status: string): CiJobStatus {
  switch (status) {
    case 'success': return 'success';
    case 'failed': return 'failed';
    case 'canceled':
    case 'cancelled': return 'cancelled';
    case 'running': return 'running';
    default: return 'pending';
  }
}
