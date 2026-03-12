// ---------------------------------------------------------------------------
// Review Orchestrator — coordinates the full review pipeline.
//
// Runs in the service worker. Now includes smart context enrichment:
// before AI calls, it analyzes the repo to find callers, importers,
// and exported symbols for each changed file.
// ---------------------------------------------------------------------------

import type { OttoSettings, GitLabHost } from '@/types/settings';
import type { MrContext, RelatedFile, FileActivityData, AcValidationData, AcValidationResult } from '@/types/review';
import type { StreamChunk } from '@/types/messages';
import type { ReviewTask } from './review-types';
import type { TicketInfo } from '@/types/ticket';
import * as aiService from '../ai/ai-service';
import * as gitlab from '../gitlab/gitlab-client';
import * as repoService from '../gitlab/repo-service';
import { createExplorerContext } from '../gitlab/repo-explorer';
import { buildEnrichedContext, formatFileContext } from '../gitlab/context-enrichment';
import type { EnrichedContext } from '../gitlab/context-enrichment';
import { extractTicketRefs, findProviderForKey } from '../ticket/ticket-parser';
import { loadCachedTickets, saveCachedTicket } from '../ticket/ticket-cache';
import { loadPreferences, formatPreferencesForPrompt, incrementReviewCount } from './reviewer-prefs';
import { fetchJiraTicket } from '../ticket/jira-client';
import { loadLatestCachedReview, computeFileDiffHash } from './review-cache';
import { discoverFileActivity, formatFileActivityForPrompt } from './file-activity';
import { parseAcceptanceCriteria } from '../ticket/ac-parser';
import { fetchRepoConfig, formatRepoConfigForPrompt } from './repo-config';
import type { RepoConfig } from './repo-config';
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

  // Detect self-review: is the current user the MR author?
  const isAuthorReview = !!(
    host?.username &&
    context.authorUsername &&
    host.username.toLowerCase() === context.authorUsername.toLowerCase()
  );

  if (isAuthorReview) {
    send({ type: 'STREAM_PROGRESS', payload: { message: 'Self-review mode: reviewing your own MR before requesting peer review.' } });
  }

  // Start summary and ticket fetch in parallel — both are fast and independent.
  // This ensures the port stays alive while context enrichment runs.
  const taskPromises: Promise<void>[] = [];

  // Fetch ticket context in parallel with everything else
  const ticketContextReady = fetchTicketContext(context, settings, send);

  // Discover file activity (cross-MR awareness) in parallel.
  // Code review needs this data, but edge cases and related files don't.
  const fileActivityReady = runFileActivityTask(context, host, send);

  if (tasks.includes('summary')) {
    send({ type: 'STREAM_PROGRESS', payload: { message: 'Generating MR summary...' } });
    // Summary can use ticket context — wait for it
    taskPromises.push(
      ticketContextReady.then(({ formatted }) =>
        runSummaryTask(context, settings, formatted, send),
      ),
    );
  }

  // Pre-fetch context in parallel with summary
  send({ type: 'STREAM_PROGRESS', payload: { message: 'Fetching file context from repository...' } });
  const contextReady = prepareContext(context, tasks, host, send);

  // Wait for context + tickets, then launch tasks.
  // Code review also waits for file activity (needs per-file context).
  // Edge cases and related files start immediately — they don't need file activity.
  const remainingTasks = Promise.all([contextReady, ticketContextReady]).then(
    async ([{ fileContents, fileTreePaths, enrichedContext, repoConfig }, { formatted: ticketContext, tickets }]) => {
      const remaining: Promise<void>[] = [];

      if (tasks.includes('codeReview')) {
        // Code review waits for file activity so it can inject per-file context.
        // File activity is fast (API calls only, no AI) so this doesn't cause timeouts.
        remaining.push(
          fileActivityReady.then((fileActivity) => {
            send({ type: 'STREAM_PROGRESS', payload: { message: `Reviewing ${context.diffFiles.length} changed files...` } });
            return runCodeReviewTask(context, settings, fileContents, enrichedContext, ticketContext, fileActivity, repoConfig, isAuthorReview, host, send);
          }),
        );
      }

      if (tasks.includes('edgeCases')) {
        send({ type: 'STREAM_PROGRESS', payload: { message: 'Analyzing edge cases...' } });
        remaining.push(runEdgeCasesTask(context, settings, fileContents, ticketContext, send));
      }

      if (tasks.includes('relatedFiles')) {
        send({ type: 'STREAM_PROGRESS', payload: { message: 'Discovering related files...' } });
        remaining.push(
          runRelatedFilesTask(context, settings, fileContents, fileTreePaths, host, send),
        );
      }

      // AC validation — only runs if tickets with acceptance criteria exist
      if (tickets.size > 0) {
        remaining.push(runAcValidationTask(context, settings, tickets, send));
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
  repoConfig: RepoConfig | null;
  ticketContext: string | null;
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
  let repoConfig: RepoConfig | null = null;

  if (!host || !context.projectId) {
    return { fileContents, fileTreePaths, enrichedContext, repoConfig, ticketContext: null };
  }

  // Fetch .otto.json repo config in parallel with file contents
  const repoConfigReady = fetchRepoConfig(host, context.projectId, context.sourceBranch)
    .then((config) => {
      if (config) {
        send({ type: 'STREAM_PROGRESS', payload: { message: 'Loaded .otto.json project configuration.' } });
      }
      return config;
    })
    .catch(() => null); // Non-fatal

  // Fetch file contents for changed files (from target branch, for context)
  const contentTasks = context.diffFiles
    .filter((f) => !f.isNew && !f.isDeleted)
    .map((f) => f.filePath);

  if (contentTasks.length > 0) {
    try {
      send({ type: 'STREAM_PROGRESS', payload: { message: `Fetching ${contentTasks.length} file(s) from source branch...` } });
      const contents = await repoService.fetchMultipleFiles(
        host,
        context.projectId,
        contentTasks,
        context.sourceBranch,
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
      context.sourceBranch,
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
          context.sourceBranch,
          treeResult.data,
        );
      } catch {
        // Non-fatal — reviews still work without enriched context
      }
    }
  } catch {
    // Non-fatal — file tree fetch failed
  }

  repoConfig = await repoConfigReady;

  return { fileContents, fileTreePaths, enrichedContext, repoConfig, ticketContext: null };
}

type TicketContextResult = {
  formatted: string | null;
  tickets: Map<string, TicketInfo>;
};

async function fetchTicketContext(
  context: MrContext,
  settings: OttoSettings,
  send: SendChunk,
): Promise<TicketContextResult> {
  const empty: TicketContextResult = { formatted: null, tickets: new Map() };
  const providers = settings.tickets?.providers ?? [];
  if (providers.length === 0) {
    send({ type: 'STREAM_PROGRESS', payload: { message: 'No ticket providers configured — skipping ticket context.' } });
    return empty;
  }

  const ticketKeys = extractTicketRefs(
    context.title,
    context.description,
    context.sourceBranch,
    providers,
  );

  if (ticketKeys.length === 0) {
    send({ type: 'STREAM_PROGRESS', payload: { message: 'No ticket references found in MR title, description, or branch name.' } });
    return empty;
  }

  send({ type: 'STREAM_PROGRESS', payload: { message: `Found ticket refs: ${ticketKeys.join(', ')}. Fetching context...` } });

  // Load from cache first
  const cachedMap = await loadCachedTickets(ticketKeys);
  const tickets = new Map<string, TicketInfo>();
  const uncachedKeys: string[] = [];

  for (const key of ticketKeys) {
    const cached = cachedMap.get(key);
    if (cached) {
      tickets.set(key, cached);
      send({ type: 'STREAM_PROGRESS', payload: { message: `${key}: loaded from cache` } });
    } else {
      uncachedKeys.push(key);
    }
  }

  // Fetch uncached tickets
  for (const ticketKey of uncachedKeys) {
    const provider = findProviderForKey(ticketKey, providers);
    if (!provider) {
      send({ type: 'STREAM_PROGRESS', payload: { message: `${ticketKey}: no matching provider found (check project prefixes)` } });
      continue;
    }

    try {
      const result = await fetchJiraTicket(provider, ticketKey);
      if (result.ok) {
        tickets.set(ticketKey, result.data);
        await saveCachedTicket(ticketKey, provider.baseUrl, result.data);
        send({ type: 'STREAM_PROGRESS', payload: { message: `${ticketKey}: fetched "${result.data.title}"` } });
      } else {
        send({ type: 'STREAM_PROGRESS', payload: { message: `${ticketKey}: fetch failed — ${result.error}` } });
      }
    } catch (error) {
      send({ type: 'STREAM_PROGRESS', payload: { message: `${ticketKey}: fetch error — ${error instanceof Error ? error.message : 'unknown'}` } });
    }
  }

  if (tickets.size === 0) return empty;

  const resolvedKeys = Array.from(tickets.keys());
  const formatted = formatTicketContext(tickets);

  // Send ticket context to the UI so it's visible to the user
  send({
    type: 'STREAM_TICKET_CONTEXT',
    payload: { ticketContext: formatted, ticketKeys: resolvedKeys },
  });

  return { formatted, tickets };
}

function formatTicketContext(tickets: Map<string, TicketInfo>): string {
  const sections: string[] = [];

  for (const [key, ticket] of tickets) {
    let section = `### ${key}: ${ticket.title}
**Type:** ${ticket.type} | **Status:** ${ticket.status}${ticket.priority ? ` | **Priority:** ${ticket.priority}` : ''}`;

    if (ticket.description) {
      // Truncate long descriptions
      const desc = ticket.description.length > 1500
        ? ticket.description.slice(0, 1500) + '\n... (truncated)'
        : ticket.description;
      section += `\n\n**Description:**\n${desc}`;
    }

    if (ticket.acceptanceCriteria) {
      const ac = ticket.acceptanceCriteria.length > 1000
        ? ticket.acceptanceCriteria.slice(0, 1000) + '\n... (truncated)'
        : ticket.acceptanceCriteria;
      section += `\n\n**Acceptance Criteria:**\n${ac}`;
    }

    if (ticket.labels.length > 0) {
      section += `\n**Labels:** ${ticket.labels.join(', ')}`;
    }

    sections.push(section);
  }

  return sections.join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Individual task runners
// ---------------------------------------------------------------------------

async function runSummaryTask(
  context: MrContext,
  settings: OttoSettings,
  ticketContext: string | null,
  send: SendChunk,
): Promise<void> {
  try {
    const result = await aiService.generateSummary(
      settings.ai,
      context,
      (delta) => send({ type: 'STREAM_SUMMARY_DELTA', payload: { content: delta } }),
      undefined, // signal
      ticketContext,
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
  ticketContext: string | null,
  fileActivity: FileActivityData | null,
  repoConfig: RepoConfig | null,
  isAuthorReview: boolean,
  host: GitLabHost | null,
  send: SendChunk,
): Promise<void> {
  const concurrency = 3;
  const allFiles = context.diffFiles.filter((f) => !f.isDeleted || f.diff.length > 0);

  // Load reviewer preferences for this host
  let reviewerPreferences: string | null = null;
  try {
    const prefs = await loadPreferences(context.hostUrl);
    reviewerPreferences = formatPreferencesForPrompt(prefs, context.projectPath);
    await incrementReviewCount(context.hostUrl);
  } catch {
    // Non-critical — proceed without preferences
  }

  // Incremental review: check if we have a previous review with per-file hashes.
  // Files whose diff hasn't changed can reuse their cached FileReview.
  let filesToReview = allFiles;
  const previousReview = await loadLatestCachedReview(context.projectPath, context.mrIid);

  if (previousReview?.fileDiffHashes && Object.keys(previousReview.fileDiffHashes).length > 0) {
    const cachedFileReviews = new Map(
      previousReview.fileReviews.map((fr) => [fr.filePath, fr]),
    );

    const unchanged: string[] = [];
    const changed: typeof allFiles = [];

    for (const file of allFiles) {
      const currentHash = computeFileDiffHash(file);
      const previousHash = previousReview.fileDiffHashes[file.filePath];

      if (previousHash && currentHash === previousHash && cachedFileReviews.has(file.filePath)) {
        // File unchanged — reuse cached review
        unchanged.push(file.filePath);
        const cachedReview = cachedFileReviews.get(file.filePath)!;
        send({ type: 'STREAM_FILE_REVIEW_COMPLETE', payload: { fileReview: cachedReview } });
      } else {
        changed.push(file);
      }
    }

    if (unchanged.length > 0) {
      send({
        type: 'STREAM_PROGRESS',
        payload: { message: `Reusing cached reviews for ${unchanged.length} unchanged file(s). Reviewing ${changed.length} changed file(s)...` },
      });
    }

    filesToReview = changed;
  }

  if (filesToReview.length === 0) return;

  for (let i = 0; i < filesToReview.length; i += concurrency) {
    const batch = filesToReview.slice(i, i + concurrency);
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
                  host, context.projectId, callerPath, context.sourceBranch,
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

        // Build per-file activity context (cross-MR awareness)
        let fileActivityContext: string | null = null;
        if (fileActivity) {
          const activity = fileActivity.fileActivities.find((a) => a.filePath === file.filePath);
          if (activity && activity.recentMrs.length > 0) {
            const lines = [
              `## Recent Activity (last ${fileActivity.lookbackDays} days)`,
              `This file was also modified in recently-merged MRs. Watch for integration issues.`,
              '',
            ];
            for (const mr of activity.recentMrs) {
              const daysAgo = Math.round(
                (Date.now() - new Date(mr.mergedAt).getTime()) / (24 * 60 * 60 * 1000),
              );
              lines.push(`- !${mr.iid} "${mr.title}" by @${mr.author} (merged ${daysAgo}d ago)`);
            }
            fileActivityContext = lines.join('\n');
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
            ticketContext,
            reviewerPreferences,
            fileActivityContext,
            repoConfigContext: repoConfig ? formatRepoConfigForPrompt(repoConfig) : null,
            isAuthorReview,
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
  ticketContext: string | null,
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
        ticketContext,
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
    if (!host || !context.projectId) {
      send({ type: 'STREAM_TASK_ERROR', payload: { task: 'relatedFiles', error: 'GitLab host required for related files discovery' } });
      return;
    }

    const imports: Record<string, string[]> = {};
    for (const file of context.diffFiles) {
      const content = fileContents.get(file.filePath);
      if (content) {
        imports[file.filePath] = repoService.extractImports(content, file.filePath);
      }
    }

    // Create a repo explorer context for the AI to use tools
    const explorerCtx = createExplorerContext(
      host,
      context.projectId,
      context.sourceBranch,
    );

    send({ type: 'STREAM_PROGRESS', payload: { message: 'AI is exploring the repository to find related files...' } });

    const result = await aiService.discoverRelatedFiles(
      settings.ai,
      {
        diffFiles: context.diffFiles,
        imports,
        mrTitle: context.title,
      },
      explorerCtx,
    );

    if (!result.ok) {
      send({ type: 'STREAM_TASK_ERROR', payload: { task: 'relatedFiles', error: result.error } });
      return;
    }

    // Filter out changed files and clean up paths
    const changedPaths = new Set(context.diffFiles.map((f) => f.filePath));
    const validated = result.data.filter((f) => {
      const fp = f.filePath.replace(/^\/+/, '').trim();
      return fp && !changedPaths.has(fp);
    });

    // Fetch content for the validated files
    const relatedFiles: RelatedFile[] = [];
    if (validated.length > 0) {
      const filePaths = validated.map((f) => f.filePath);
      const contents = await repoService.fetchMultipleFiles(
        host,
        context.projectId,
        filePaths,
        context.sourceBranch,
      );

      for (const rawFile of validated) {
        relatedFiles.push({
          filePath: rawFile.filePath,
          reason: rawFile.reason,
          content: contents.get(rawFile.filePath) || null,
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

/**
 * Discover file activity (cross-MR awareness) and send results to the UI.
 * Runs in parallel with other tasks. Non-fatal — returns empty data on failure.
 */
async function runFileActivityTask(
  context: MrContext,
  host: GitLabHost | null,
  send: SendChunk,
): Promise<FileActivityData | null> {
  if (!host || !context.projectId) {
    send({ type: 'STREAM_TASK_ERROR', payload: { task: 'fileActivity', error: 'No GitLab host configured' } });
    return null;
  }

  try {
    const result = await discoverFileActivity(
      host,
      context.projectId,
      context.mrIid,
      context.targetBranch,
      context.diffFiles,
      (message) => send({ type: 'STREAM_PROGRESS', payload: { message } }),
    );

    if (result.fileActivities.length > 0) {
      send({ type: 'STREAM_FILE_ACTIVITY_COMPLETE', payload: { fileActivity: result } });
      return result;
    }

    // No overlapping activity found — still mark as complete (not error)
    send({ type: 'STREAM_FILE_ACTIVITY_COMPLETE', payload: { fileActivity: result } });
    return null;
  } catch (error) {
    send({
      type: 'STREAM_TASK_ERROR',
      payload: { task: 'fileActivity', error: error instanceof Error ? error.message : 'File activity check failed' },
    });
    return null;
  }
}

/**
 * Validate acceptance criteria from linked tickets against the MR diff.
 * Runs in parallel with other tasks. Non-fatal — silently skips if no AC found.
 */
async function runAcValidationTask(
  context: MrContext,
  settings: OttoSettings,
  tickets: Map<string, TicketInfo>,
  send: SendChunk,
): Promise<void> {
  // Only run if we have tickets with acceptance criteria
  const ticketsWithAc: Array<{ key: string; ticket: TicketInfo; criteria: string[] }> = [];

  for (const [key, ticket] of tickets) {
    if (ticket.acceptanceCriteria) {
      const criteria = parseAcceptanceCriteria(ticket.acceptanceCriteria);
      if (criteria.length > 0) {
        ticketsWithAc.push({ key, ticket, criteria });
      }
    }
  }

  if (ticketsWithAc.length === 0) return;

  send({ type: 'STREAM_PROGRESS', payload: { message: `Validating acceptance criteria for ${ticketsWithAc.map((t) => t.key).join(', ')}...` } });

  const results: AcValidationResult[] = [];

  for (const { key, ticket, criteria } of ticketsWithAc) {
    try {
      const result = await aiService.validateAcceptanceCriteria(
        settings.ai,
        {
          ticketKey: key,
          criteria,
          diffFiles: context.diffFiles,
          mrTitle: context.title,
          mrDescription: context.description,
          ticketTitle: ticket.title,
          ticketDescription: ticket.description,
        },
      );

      if (result.ok) {
        results.push(result.data);
      } else {
        send({
          type: 'STREAM_PROGRESS',
          payload: { message: `AC validation for ${key} failed: ${result.error}` },
        });
      }
    } catch (error) {
      send({
        type: 'STREAM_PROGRESS',
        payload: { message: `AC validation for ${key} error: ${error instanceof Error ? error.message : 'unknown'}` },
      });
    }
  }

  if (results.length > 0) {
    let satisfiedCount = 0;
    let unclearCount = 0;
    let notFoundCount = 0;

    for (const result of results) {
      for (const c of result.criteria) {
        if (c.status === 'satisfied') satisfiedCount++;
        else if (c.status === 'unclear') unclearCount++;
        else notFoundCount++;
      }
    }

    const acValidation: AcValidationData = {
      results,
      satisfiedCount,
      unclearCount,
      notFoundCount,
    };

    send({ type: 'STREAM_AC_VALIDATION_COMPLETE', payload: { acValidation } });
  }
}

function resolveHost(settings: OttoSettings, hostUrl: string): GitLabHost | null {
  const normalized = normalizeUrl(hostUrl).toLowerCase();
  return settings.gitlab.hosts.find(
    (h) => normalizeUrl(h.url).toLowerCase() === normalized,
  ) || null;
}
