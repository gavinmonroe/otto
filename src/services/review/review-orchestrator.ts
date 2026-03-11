// ---------------------------------------------------------------------------
// Review Orchestrator — coordinates the full review pipeline.
//
// Runs in the service worker. Now includes smart context enrichment:
// before AI calls, it analyzes the repo to find callers, importers,
// and exported symbols for each changed file.
// ---------------------------------------------------------------------------

import type { OttoSettings, GitLabHost } from '@/types/settings';
import type { MrContext, RelatedFile } from '@/types/review';
import type { StreamChunk } from '@/types/messages';
import type { ReviewTask } from './review-types';
import * as aiService from '../ai/ai-service';
import * as gitlab from '../gitlab/gitlab-client';
import * as repoService from '../gitlab/repo-service';
import { buildEnrichedContext, formatFileContext } from '../gitlab/context-enrichment';
import type { EnrichedContext } from '../gitlab/context-enrichment';
import { normalizeUrl } from '@/lib/utils';

type SendChunk = (chunk: StreamChunk) => void;

/**
 * Execute the full review pipeline.
 */
export async function executeReview(
  context: MrContext,
  tasks: ReviewTask[],
  settings: OttoSettings,
  send: SendChunk,
): Promise<void> {
  const host = resolveHost(settings, context.hostUrl);

  // Start summary immediately — it only needs the diff, no pre-fetching.
  // This ensures the port stays alive while context enrichment runs.
  const taskPromises: Promise<void>[] = [];

  if (tasks.includes('summary')) {
    send({ type: 'STREAM_PROGRESS', payload: { message: 'Generating MR summary...' } });
    taskPromises.push(runSummaryTask(context, settings, send));
  }

  // Pre-fetch context in parallel with summary
  send({ type: 'STREAM_PROGRESS', payload: { message: 'Fetching file context from repository...' } });
  const contextReady = prepareContext(context, tasks, host, send);

  // Wait for context, then launch remaining tasks
  const remainingTasks = contextReady.then(async ({ fileContents, fileTreePaths, enrichedContext }) => {
    const remaining: Promise<void>[] = [];

    if (tasks.includes('codeReview')) {
      send({ type: 'STREAM_PROGRESS', payload: { message: `Reviewing ${context.diffFiles.length} changed files...` } });
      remaining.push(runCodeReviewTask(context, settings, fileContents, enrichedContext, host, send));
    }

    if (tasks.includes('edgeCases')) {
      send({ type: 'STREAM_PROGRESS', payload: { message: 'Analyzing edge cases...' } });
      remaining.push(runEdgeCasesTask(context, settings, fileContents, send));
    }

    if (tasks.includes('relatedFiles')) {
      send({ type: 'STREAM_PROGRESS', payload: { message: 'Discovering related files...' } });
      remaining.push(
        runRelatedFilesTask(context, settings, fileContents, fileTreePaths, host, send),
      );
    }

    await Promise.all(remaining);
  });

  taskPromises.push(remainingTasks);

  await Promise.all(taskPromises);

  send({ type: 'STREAM_ALL_COMPLETE' });
}

// ---------------------------------------------------------------------------
// Context preparation — runs in parallel with summary
// ---------------------------------------------------------------------------

type PreparedContext = {
  fileContents: Map<string, string>;
  fileTreePaths: string[];
  enrichedContext: EnrichedContext | null;
};

async function prepareContext(
  context: MrContext,
  tasks: ReviewTask[],
  host: GitLabHost | null,
  send: SendChunk,
): Promise<PreparedContext> {
  const fileContents = new Map<string, string>();
  let fileTreePaths: string[] = [];
  let enrichedContext: EnrichedContext | null = null;

  if (!host || !context.projectId) {
    return { fileContents, fileTreePaths, enrichedContext };
  }

  // Fetch file contents for changed files (from target branch, for context)
  const contentTasks = context.diffFiles
    .filter((f) => !f.isNew && !f.isDeleted)
    .map((f) => f.filePath);

  if (contentTasks.length > 0) {
    try {
      send({ type: 'STREAM_PROGRESS', payload: { message: `Fetching ${contentTasks.length} file(s) from target branch...` } });
      const contents = await repoService.fetchMultipleFiles(
        host,
        context.projectId,
        contentTasks,
        context.targetBranch,
      );
      for (const [path, content] of contents) {
        if (content) fileContents.set(path, content);
      }
    } catch {
      // Non-fatal — reviews work without full file context
    }
  }

  // Fetch file tree (needed for related files + context enrichment)
  try {
    const treeResult = await repoService.getFullFileTree(
      host,
      context.projectId,
      context.targetBranch,
    );
    if (treeResult.ok) {
      fileTreePaths = treeResult.data
        .filter((item) => item.type === 'blob')
        .map((item) => item.path);

      // Build enriched context: reverse imports, callers, exported symbols
      try {
        send({ type: 'STREAM_PROGRESS', payload: { message: 'Building enriched context (imports, callers, exports)...' } });
        enrichedContext = await buildEnrichedContext(
          host,
          context.projectId,
          context.diffFiles,
          context.targetBranch,
          treeResult.data,
        );
      } catch {
        // Non-fatal — reviews still work without enriched context
      }
    }
  } catch {
    // Non-fatal — file tree fetch failed
  }

  return { fileContents, fileTreePaths, enrichedContext };
}

// ---------------------------------------------------------------------------
// Individual task runners
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
  enrichedContext: EnrichedContext | null,
  host: GitLabHost | null,
  send: SendChunk,
): Promise<void> {
  const concurrency = 3;
  const files = context.diffFiles.filter((f) => !f.isDeleted || f.diff.length > 0);

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchPromises = batch.map(async (file) => {
      try {
        const fileName = file.filePath.split('/').pop() || file.filePath;
        send({ type: 'STREAM_PROGRESS', payload: { message: `Reviewing ${fileName}...` } });

        // Build repo context string for this file
        let repoContext: string | null = null;
        let callerSnippets: Array<{ filePath: string; snippet: string }> | null = null;

        if (enrichedContext) {
          const fileCtx = enrichedContext.fileContexts.get(file.filePath);
          if (fileCtx) {
            repoContext = formatFileContext(fileCtx);

            // Fetch truncated snippets from files that import this one
            if (fileCtx.importedBy.length > 0 && host && context.projectId) {
              callerSnippets = [];
              const callersToFetch = fileCtx.importedBy.slice(0, 3); // Cap at 3
              for (const callerPath of callersToFetch) {
                const callerResult = await gitlab.fetchFileContent(
                  host, context.projectId, callerPath, context.targetBranch,
                );
                if (callerResult.ok) {
                  // Truncate to first 100 lines to keep prompt size reasonable
                  const lines = callerResult.data.split('\n');
                  const snippet = lines.slice(0, 100).join('\n') +
                    (lines.length > 100 ? '\n// ... (truncated)' : '');
                  callerSnippets.push({ filePath: callerPath, snippet });
                }
              }
              if (callerSnippets.length === 0) callerSnippets = null;
            }
          }
        }

        const result = await aiService.generateFileReview(
          settings.ai,
          {
            file,
            fullFileContent: fileContents.get(file.filePath) || null,
            mrTitle: context.title,
            mrDescription: context.description,
            repoContext,
            callerSnippets,
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
    const imports: Record<string, string[]> = {};
    for (const file of context.diffFiles) {
      const content = fileContents.get(file.filePath);
      if (content) {
        imports[file.filePath] = repoService.extractImports(content, file.filePath);
      }
    }

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
