// ---------------------------------------------------------------------------
// Review Orchestrator — coordinates the full review pipeline.
//
// Runs in the service worker. This is the top-level coordinator that:
// 1. Receives a review request (MrContext + which tasks to run)
// 2. Fetches additional context from GitLab (file contents, file tree)
// 3. Dispatches AI tasks in parallel where possible
// 4. Streams results back to the content script via port messages
//
// Design decisions:
// - Tasks are independent and run in parallel. A failure in one task
//   (e.g., edge cases) doesn't block others (e.g., summary).
// - File reviews are parallelized with concurrency control (3 at a time)
//   to balance speed vs. API rate limits.
// - The orchestrator doesn't hold state — it receives everything it needs
//   as parameters and streams results via a callback. This makes it
//   service-worker-safe (no in-memory state to lose on termination).
// - GitLab context fetching (file contents, tree) happens before AI calls
//   so we can include full file context in prompts.
// ---------------------------------------------------------------------------

import type { OttoSettings, GitLabHost } from '@/types/settings';
import type { MrContext, RelatedFile } from '@/types/review';
import type { StreamChunk } from '@/types/messages';
import type { ReviewTask } from './review-types';
import * as aiService from '../ai/ai-service';
import * as gitlab from '../gitlab/gitlab-client';
import * as repoService from '../gitlab/repo-service';
import { normalizeUrl } from '@/lib/utils';

type SendChunk = (chunk: StreamChunk) => void;

/**
 * Execute the full review pipeline.
 *
 * @param context - MR context (from content script)
 * @param tasks - Which review tasks to run
 * @param settings - Current Otto settings
 * @param send - Callback to stream results back to the content script
 */
export async function executeReview(
  context: MrContext,
  tasks: ReviewTask[],
  settings: OttoSettings,
  send: SendChunk,
): Promise<void> {
  // Resolve the GitLab host for this MR
  const host = resolveHost(settings, context.hostUrl);

  // Pre-fetch context that multiple tasks need
  const fileContents = new Map<string, string>();
  let fileTreePaths: string[] = [];

  if (host && context.projectId) {
    // Fetch file contents for changed files (from target branch, for context)
    const contentTasks = context.diffFiles
      .filter((f) => !f.isNew && !f.isDeleted)
      .map((f) => f.filePath);

    if (contentTasks.length > 0) {
      const contents = await repoService.fetchMultipleFiles(
        host,
        context.projectId,
        contentTasks,
        context.targetBranch,
      );
      for (const [path, content] of contents) {
        if (content) fileContents.set(path, content);
      }
    }

    // Fetch file tree if we need related files discovery
    if (tasks.includes('relatedFiles')) {
      const treeResult = await repoService.getFullFileTree(
        host,
        context.projectId,
        context.targetBranch,
      );
      if (treeResult.ok) {
        fileTreePaths = treeResult.data
          .filter((item) => item.type === 'blob')
          .map((item) => item.path);
      }
    }
  }

  // Run tasks in parallel — each task is isolated
  const taskPromises: Promise<void>[] = [];

  if (tasks.includes('summary')) {
    taskPromises.push(runSummaryTask(context, settings, send));
  }

  if (tasks.includes('codeReview')) {
    taskPromises.push(runCodeReviewTask(context, settings, fileContents, send));
  }

  if (tasks.includes('edgeCases')) {
    taskPromises.push(runEdgeCasesTask(context, settings, fileContents, send));
  }

  if (tasks.includes('relatedFiles')) {
    taskPromises.push(
      runRelatedFilesTask(context, settings, fileContents, fileTreePaths, host, send),
    );
  }

  // Wait for all tasks to complete (errors are caught per-task)
  await Promise.all(taskPromises);

  send({ type: 'STREAM_ALL_COMPLETE' });
}

// ---------------------------------------------------------------------------
// Individual task runners — each catches its own errors
// ---------------------------------------------------------------------------

async function runSummaryTask(
  context: MrContext,
  settings: OttoSettings,
  send: SendChunk,
): Promise<void> {
  try {
    const result = await aiService.generateSummary(
      settings.ai,
      context,
      (delta) => send({ type: 'STREAM_SUMMARY_DELTA', payload: { content: delta } }),
    );

    if (result.ok) {
      send({ type: 'STREAM_SUMMARY_COMPLETE', payload: { summary: result.data } });
    } else {
      send({ type: 'STREAM_TASK_ERROR', payload: { task: 'summary', error: result.error } });
    }
  } catch (error) {
    send({
      type: 'STREAM_TASK_ERROR',
      payload: { task: 'summary', error: error instanceof Error ? error.message : 'Summary failed' },
    });
  }
}

async function runCodeReviewTask(
  context: MrContext,
  settings: OttoSettings,
  fileContents: Map<string, string>,
  send: SendChunk,
): Promise<void> {
  // Review files in parallel with concurrency limit
  const concurrency = 3;
  const files = context.diffFiles.filter((f) => !f.isDeleted || f.diff.length > 0);

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchPromises = batch.map(async (file) => {
      try {
        const result = await aiService.generateFileReview(
          settings.ai,
          {
            file,
            fullFileContent: fileContents.get(file.filePath) || null,
            mrTitle: context.title,
            mrDescription: context.description,
          },
          (delta) => send({
            type: 'STREAM_FILE_REVIEW_DELTA',
            payload: { filePath: file.filePath, content: delta },
          }),
        );

        if (result.ok) {
          send({ type: 'STREAM_FILE_REVIEW_COMPLETE', payload: { fileReview: result.data } });
        } else {
          send({
            type: 'STREAM_TASK_ERROR',
            payload: { task: `codeReview:${file.filePath}`, error: result.error },
          });
        }
      } catch (error) {
        send({
          type: 'STREAM_TASK_ERROR',
          payload: {
            task: `codeReview:${file.filePath}`,
            error: error instanceof Error ? error.message : 'File review failed',
          },
        });
      }
    });

    await Promise.all(batchPromises);
  }
}

async function runEdgeCasesTask(
  context: MrContext,
  settings: OttoSettings,
  fileContents: Map<string, string>,
  send: SendChunk,
): Promise<void> {
  try {
    const fileContentsRecord: Record<string, string> = {};
    for (const [path, content] of fileContents) {
      fileContentsRecord[path] = content;
    }

    const result = await aiService.generateEdgeCases(
      settings.ai,
      {
        diffFiles: context.diffFiles,
        fileContents: fileContentsRecord,
        mrTitle: context.title,
        mrDescription: context.description,
      },
      (delta) => send({ type: 'STREAM_EDGE_CASES_DELTA', payload: { content: delta } }),
    );

    if (result.ok) {
      send({ type: 'STREAM_EDGE_CASES_COMPLETE', payload: { edgeCases: result.data } });
    } else {
      send({ type: 'STREAM_TASK_ERROR', payload: { task: 'edgeCases', error: result.error } });
    }
  } catch (error) {
    send({
      type: 'STREAM_TASK_ERROR',
      payload: { task: 'edgeCases', error: error instanceof Error ? error.message : 'Edge case analysis failed' },
    });
  }
}

async function runRelatedFilesTask(
  context: MrContext,
  settings: OttoSettings,
  fileContents: Map<string, string>,
  fileTreePaths: string[],
  host: GitLabHost | null,
  send: SendChunk,
): Promise<void> {
  try {
    // Build import map from changed files
    const imports: Record<string, string[]> = {};
    for (const file of context.diffFiles) {
      const content = fileContents.get(file.filePath);
      if (content) {
        imports[file.filePath] = repoService.extractImports(content, file.filePath);
      }
    }

    // Ask AI to discover related files
    const result = await aiService.discoverRelatedFiles(settings.ai, {
      diffFiles: context.diffFiles,
      imports,
      fileTree: fileTreePaths,
      mrTitle: context.title,
    });

    if (!result.ok) {
      send({ type: 'STREAM_TASK_ERROR', payload: { task: 'relatedFiles', error: result.error } });
      return;
    }

    // Fetch content for discovered related files
    const relatedFiles: RelatedFile[] = [];
    if (host && context.projectId && result.data.length > 0) {
      const filePaths = result.data.map((f) => f.filePath);
      const contents = await repoService.fetchMultipleFiles(
        host,
        context.projectId,
        filePaths,
        context.targetBranch,
      );

      for (const rawFile of result.data) {
        relatedFiles.push({
          filePath: rawFile.filePath,
          reason: rawFile.reason,
          content: contents.get(rawFile.filePath) || null,
          relationship: rawFile.relationship,
        });
      }
    } else {
      // No GitLab host configured — return files without content
      for (const rawFile of result.data) {
        relatedFiles.push({
          filePath: rawFile.filePath,
          reason: rawFile.reason,
          content: null,
          relationship: rawFile.relationship,
        });
      }
    }

    send({ type: 'STREAM_RELATED_FILES_COMPLETE', payload: { files: relatedFiles } });
  } catch (error) {
    send({
      type: 'STREAM_TASK_ERROR',
      payload: { task: 'relatedFiles', error: error instanceof Error ? error.message : 'Related files discovery failed' },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveHost(settings: OttoSettings, hostUrl: string): GitLabHost | null {
  const normalized = normalizeUrl(hostUrl).toLowerCase();
  return settings.gitlab.hosts.find(
    (h) => normalizeUrl(h.url).toLowerCase() === normalized,
  ) || null;
}
