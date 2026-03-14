// ---------------------------------------------------------------------------
// Service Worker (background.ts) — the central message router.
//
// This is the extension's "backend". It:
// 1. Handles one-shot messages from content scripts (sendMessage)
// 2. Handles streaming connections from content scripts (connect)
// 3. Routes requests to the appropriate service (GitLab, AI, storage)
//
// Design decisions:
// - No in-memory state. Every handler reads settings fresh from storage.
//   The service worker can be terminated at any time by Chrome.
// - Each handler is a pure async function: receives payload, returns result.
// - Error handling is per-handler — one failing request doesn't affect others.
// - The stream handler runs the review orchestrator, which manages its own
//   parallelism and error isolation.
// ---------------------------------------------------------------------------

import { registerMessageHandler, registerStreamHandler } from '@/lib/messaging';
import type { MessageHandlerMap } from '@/lib/messaging';
import { loadSettings, saveSettings } from '@/lib/storage';
import * as gitlab from '@/services/gitlab/gitlab-client';
import * as aiClient from '@/services/ai/ai-client';
import { executeReview } from '@/services/review/review-orchestrator';
import { generateFollowUp, generateChatResponse } from '@/services/ai/ai-service';
import { loadCachedFollowUp, saveCachedFollowUp } from '@/services/followup/followup-cache';
import { fetchJiraTicket, testJiraConnection } from '@/services/ticket/jira-client';
import { loadCachedTicket, saveCachedTicket, loadCachedTickets } from '@/services/ticket/ticket-cache';
import { findProviderForKey } from '@/services/ticket/ticket-parser';
import { highlight, highlightLines } from '@/services/syntax/highlighter';
import { normalizeUrl } from '@/lib/utils';
import { loadCachedPreview, saveCachedPreview, loadCachedPreviews, extractRiskFromReviewCache } from '@/services/gitlab/mr-preview-cache';
import { computeLanguageBreakdown, countDiffLines } from '@/services/gitlab/language-utils';
import type { MrPreviewData } from '@/types/mr-preview';
import type { MrContext, DiffFileData } from '@/types/review';
import type { StreamChunk } from '@/types/messages';
import {
  initQueueManager,
  enqueueReview,
  pauseReview,
  resumeReview,
  cancelReview,
  getQueueStatus,
  registerPort,
} from '@/services/review-queue/queue-manager';
import { computePriority } from '@/services/review-queue/priority-scorer';
import type { QueuedReview } from '@/types/review-queue';

export default defineBackground(() => {
  // -----------------------------------------------------------------
  // One-shot message handlers
  // -----------------------------------------------------------------

  const handlers: MessageHandlerMap = {
    GET_SETTINGS: async () => {
      const settings = await loadSettings();
      return { ok: true, data: settings };
    },

    SAVE_SETTINGS: async (payload) => {
      try {
        await saveSettings(payload);
        return { ok: true, data: undefined };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to save settings' };
      }
    },

    RESOLVE_GITLAB_HOST: async (payload) => {
      const settings = await loadSettings();
      const normalized = normalizeUrl(payload.pageUrl).toLowerCase();
      const host = settings.gitlab.hosts.find(
        (h) => normalized.startsWith(normalizeUrl(h.url).toLowerCase()),
      ) || null;
      return { ok: true, data: host };
    },

    FETCH_PROJECT: async (payload) => {
      const settings = await loadSettings();
      const host = settings.gitlab.hosts.find((h) => h.id === payload.hostId);
      if (!host) return { ok: false, error: 'GitLab host not found in settings' };
      return gitlab.fetchProject(host, payload.projectPath);
    },

    FETCH_MR_METADATA: async (payload) => {
      const settings = await loadSettings();
      const host = settings.gitlab.hosts.find((h) => h.id === payload.hostId);
      if (!host) return { ok: false, error: 'GitLab host not found in settings' };
      return gitlab.fetchMergeRequest(host, payload.projectId, payload.mrIid);
    },

    FETCH_MR_CHANGES: async (payload) => {
      const settings = await loadSettings();
      const host = settings.gitlab.hosts.find((h) => h.id === payload.hostId);
      if (!host) return { ok: false, error: 'GitLab host not found in settings' };
      return gitlab.fetchMergeRequestChanges(host, payload.projectId, payload.mrIid);
    },

    FETCH_FILE_CONTENT: async (payload) => {
      const settings = await loadSettings();
      const host = settings.gitlab.hosts.find((h) => h.id === payload.hostId);
      if (!host) return { ok: false, error: 'GitLab host not found in settings' };
      return gitlab.fetchFileContent(host, payload.projectId, payload.filePath, payload.ref);
    },

    FETCH_FILE_TREE: async (payload) => {
      const settings = await loadSettings();
      const host = settings.gitlab.hosts.find((h) => h.id === payload.hostId);
      if (!host) return { ok: false, error: 'GitLab host not found in settings' };
      return gitlab.fetchFileTree(host, payload.projectId, payload.ref, payload.path, payload.recursive);
    },

    FETCH_AI_MODELS: async () => {
      const settings = await loadSettings();
      if (!settings.ai.baseUrl) {
        return { ok: false, error: 'AI provider not configured. Set the base URL in settings.' };
      }
      return aiClient.fetchModels({
        baseUrl: settings.ai.baseUrl,
        apiKey: settings.ai.apiKey,
      });
    },

    TEST_AI_CONNECTION: async (payload) => {
      return aiClient.testConnection({
        baseUrl: payload.baseUrl,
        apiKey: payload.apiKey,
      });
    },

    TEST_GITLAB_CONNECTION: async (payload) => {
      return gitlab.testConnection({
        url: payload.host.url,
        pat: payload.host.pat,
      });
    },

    OPEN_OPTIONS: async () => {
      try {
        await chrome.runtime.openOptionsPage();
        return { ok: true, data: undefined };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to open options' };
      }
    },

    HIGHLIGHT_CODE: async (payload) => {
      try {
        const html = await highlight(payload.code, payload.lang, payload.isDark);
        return { ok: true, data: html };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Highlight failed' };
      }
    },

    HIGHLIGHT_LINES: async (payload) => {
      try {
        const htmlLines = await highlightLines(payload.lines, payload.lang, payload.isDark);
        return { ok: true, data: htmlLines };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Highlight lines failed' };
      }
    },

    FETCH_MR_DISCUSSIONS: async (payload) => {
      const settings = await loadSettings();
      const host = settings.gitlab.hosts.find((h) => h.id === payload.hostId);
      if (!host) return { ok: false, error: 'GitLab host not found in settings' };
      return gitlab.fetchMrDiscussions(host, payload.projectId, payload.mrIid);
    },

    FETCH_TICKET: async (payload) => {
      // Check cache first
      const cached = await loadCachedTicket(payload.ticketKey);
      if (cached) return { ok: true, data: cached };

      const settings = await loadSettings();
      const providers = settings.tickets?.providers ?? [];
      const provider = findProviderForKey(payload.ticketKey, providers);
      if (!provider) {
        return { ok: false, error: `No ticket provider configured for ${payload.ticketKey}` };
      }

      const result = await fetchJiraTicket(provider, payload.ticketKey);
      if (result.ok) {
        await saveCachedTicket(payload.ticketKey, provider.baseUrl, result.data);
      }
      return result;
    },

    FETCH_TICKET_BATCH: async (payload) => {
      const settings = await loadSettings();
      const providers = settings.tickets?.providers ?? [];
      if (providers.length === 0) {
        return { ok: false, error: 'No ticket providers configured' };
      }

      // Load what we can from cache
      const cachedMap = await loadCachedTickets(payload.ticketKeys);
      const results: Record<string, import('@/types/ticket').TicketInfo> = {};
      const uncachedKeys: string[] = [];

      for (const key of payload.ticketKeys) {
        const cached = cachedMap.get(key);
        if (cached) {
          results[key] = cached;
        } else {
          uncachedKeys.push(key);
        }
      }

      // Fetch uncached tickets (concurrency of 3)
      for (let i = 0; i < uncachedKeys.length; i += 3) {
        const batch = uncachedKeys.slice(i, i + 3);
        const fetches = batch.map(async (ticketKey) => {
          const provider = findProviderForKey(ticketKey, providers);
          if (!provider) return;

          const result = await fetchJiraTicket(provider, ticketKey);
          if (result.ok) {
            results[ticketKey] = result.data;
            await saveCachedTicket(ticketKey, provider.baseUrl, result.data);
          }
        });
        await Promise.all(fetches);
      }

      return { ok: true, data: results };
    },

    TEST_JIRA_CONNECTION: async (payload) => {
      return testJiraConnection(payload.provider);
    },

    ANALYZE_COMMENT: async (payload) => {
      const settings = await loadSettings();

      // Gate: follow-up feature must be enabled
      if (settings.preferences.enabledFeatures?.followUp === false) {
        return { ok: false, error: 'Comment follow-up is disabled in Otto settings.' };
      }

      if (!settings.ai.baseUrl) {
        return { ok: false, error: 'AI provider not configured. Open Otto settings to set up your AI endpoint.' };
      }

      const { thread, threadHash, projectPath, mrIid } = payload;
      const commentId = thread.notes[thread.notes.length - 1]?.id || thread.discussionId;

      // Check cache first
      const cached = await loadCachedFollowUp(projectPath, mrIid, commentId, threadHash);
      if (cached) {
        return { ok: true, data: cached.analysis };
      }

      // Fetch full file content if this is an inline comment and we have a GitLab host
      let fileContent: string | null = null;
      let mrDiffSnippet: string | null = thread.diffSnippet;

      if (thread.filePath && payload.hostId && payload.projectId) {
        const host = settings.gitlab.hosts.find((h) => h.id === payload.hostId);
        if (host) {
          const fileResult = await gitlab.fetchFileContent(
            host,
            payload.projectId,
            thread.filePath,
            payload.sourceBranch,
          );
          if (fileResult.ok) {
            fileContent = fileResult.data;
          }

          // If we don't have a diff snippet from the DOM, try to get it from the API
          if (!mrDiffSnippet) {
            const changesResult = await gitlab.fetchMergeRequestChanges(
              host,
              payload.projectId,
              mrIid,
            );
            if (changesResult.ok) {
              const fileChange = changesResult.data.changes.find(
                (c) => c.new_path === thread.filePath || c.old_path === thread.filePath,
              );
              if (fileChange) {
                mrDiffSnippet = fileChange.diff;
              }
            }
          }
        }
      }

      // Call AI
      const result = await generateFollowUp(
        settings.ai,
        {
          thread,
          fileContent,
          mrTitle: payload.mrTitle,
          mrDescription: payload.mrDescription,
          mrDiffSnippet,
        },
        commentId,
      );

      if (!result.ok) return result;

      // Save to cache
      await saveCachedFollowUp({
        version: 1,
        projectPath,
        mrIid,
        commentId,
        threadHash,
        timestamp: Date.now(),
        analysis: result.data,
      });

      return result;
    },

    FETCH_MR_PREVIEW: async (payload) => {
      const { hostId, projectId, projectPath, mrIid } = payload;

      // Check preview cache first
      const cached = await loadCachedPreview(projectPath, mrIid);
      if (cached) return { ok: true, data: cached };

      // Resolve GitLab host
      const settings = await loadSettings();
      const host = settings.gitlab.hosts.find((h) => h.id === hostId);
      if (!host) return { ok: false, error: 'GitLab host not found in settings' };

      // Fetch MR changes from GitLab API
      const changesResult = await gitlab.fetchMergeRequestChanges(host, projectId, mrIid);
      if (!changesResult.ok) return changesResult;

      const { mr, changes } = changesResult.data;

      // Compute language breakdown from diffs
      const languages = computeLanguageBreakdown(changes);

      // Sum lines added/removed across all files
      let linesAdded = 0;
      let linesRemoved = 0;
      for (const file of changes) {
        const { added, removed } = countDiffLines(file.diff);
        linesAdded += added;
        linesRemoved += removed;
      }

      // Check existing review cache for risk level (reuse, don't re-compute)
      const riskLevel = await extractRiskFromReviewCache(projectPath, mrIid);

      const preview: MrPreviewData = {
        mrIid,
        projectPath,
        state: mr.state,
        filesChanged: changes.length,
        linesAdded,
        linesRemoved,
        languages,
        riskLevel,
        fetchedAt: Date.now(),
      };

      // Save to cache (non-blocking)
      saveCachedPreview(preview);

      return { ok: true, data: preview };
    },

    // -----------------------------------------------------------------
    // Queue handlers — MR list command center
    // -----------------------------------------------------------------

    ENQUEUE_REVIEW: async (payload) => {
      try {
        const priority = computePriority({
          filesChanged: payload.filesChanged,
          linesAdded: payload.linesAdded,
          linesRemoved: payload.linesRemoved,
          riskLevel: payload.riskLevel,
          labels: payload.labels,
          createdAt: payload.createdAt,
          updatedAt: payload.updatedAt,
          mrState: payload.mrState,
        });

        const item: QueuedReview = {
          mrIid: payload.mrIid,
          projectPath: payload.projectPath,
          projectId: payload.projectId,
          hostUrl: payload.hostUrl,
          hostId: payload.hostId,
          title: payload.title,
          authorUsername: payload.authorUsername,
          sourceBranch: payload.sourceBranch,
          targetBranch: payload.targetBranch,
          labels: payload.labels,
          mrState: payload.mrState,
          filesChanged: payload.filesChanged,
          linesAdded: payload.linesAdded,
          linesRemoved: payload.linesRemoved,
          riskLevel: payload.riskLevel,
          status: 'queued',
          priority,
          progress: null,
          tasks: payload.tasks,
          enqueuedAt: Date.now(),
          startedAt: null,
          completedAt: null,
          pausedAt: null,
          error: null,
        };

        const result = await enqueueReview(item);
        return { ok: true, data: result };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to enqueue review' };
      }
    },

    PAUSE_REVIEW: async (payload) => {
      try {
        const result = await pauseReview(payload.projectPath, payload.mrIid);
        return { ok: true, data: result };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to pause review' };
      }
    },

    RESUME_REVIEW: async (payload) => {
      try {
        const result = await resumeReview(payload.projectPath, payload.mrIid);
        return { ok: true, data: result };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to resume review' };
      }
    },

    CANCEL_REVIEW: async (payload) => {
      try {
        const result = await cancelReview(payload.projectPath, payload.mrIid);
        return { ok: true, data: result };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to cancel review' };
      }
    },

    GET_QUEUE_STATUS: async (payload) => {
      try {
        const status = getQueueStatus(payload.projectPath);
        return { ok: true, data: status };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to get queue status' };
      }
    },

    FETCH_MR_PREVIEWS_BATCH: async (payload) => {
      const { hostId, projectId, projectPath, mrIids } = payload;

      // Load what we can from cache
      const cached = await loadCachedPreviews(projectPath, mrIids);
      const results: Record<number, MrPreviewData> = {};
      const uncachedIids: number[] = [];

      for (const iid of mrIids) {
        const cachedPreview = cached.get(iid);
        if (cachedPreview) {
          results[iid] = cachedPreview;
        } else {
          uncachedIids.push(iid);
        }
      }

      if (uncachedIids.length === 0) {
        return { ok: true, data: results };
      }

      // Resolve GitLab host
      const settings = await loadSettings();
      const host = settings.gitlab.hosts.find((h) => h.id === hostId);
      if (!host) return { ok: false, error: 'GitLab host not found in settings' };

      // Fetch uncached previews in batches of 3 to avoid hammering GitLab
      for (let i = 0; i < uncachedIids.length; i += 3) {
        const batch = uncachedIids.slice(i, i + 3);
        const fetches = batch.map(async (mrIid) => {
          try {
            const changesResult = await gitlab.fetchMergeRequestChanges(host, projectId, mrIid);
            if (!changesResult.ok) return;

            const { mr, changes } = changesResult.data;
            const languages = computeLanguageBreakdown(changes);

            let linesAdded = 0;
            let linesRemoved = 0;
            for (const file of changes) {
              const { added, removed } = countDiffLines(file.diff);
              linesAdded += added;
              linesRemoved += removed;
            }

            const riskLevel = await extractRiskFromReviewCache(projectPath, mrIid);

            const preview: MrPreviewData = {
              mrIid,
              projectPath,
              state: mr.state,
              filesChanged: changes.length,
              linesAdded,
              linesRemoved,
              languages,
              riskLevel,
              fetchedAt: Date.now(),
            };

            results[mrIid] = preview;
            saveCachedPreview(preview); // Non-blocking
          } catch {
            // Skip failed fetches — partial results are fine
          }
        });
        await Promise.all(fetches);
      }

      return { ok: true, data: results };
    },
  };

  registerMessageHandler(handlers);

  // -----------------------------------------------------------------
  // Queue manager initialization
  // -----------------------------------------------------------------

  // Context builder: fetches MR changes from GitLab and builds MrContext.
  // Used by the queue manager to construct the context for queued reviews.
  const buildMrContext = async (
    hostId: string,
    projectId: number,
    mrIid: number,
  ): Promise<MrContext | null> => {
    const settings = await loadSettings();
    const host = settings.gitlab.hosts.find((h) => h.id === hostId);
    if (!host) return null;

    const changesResult = await gitlab.fetchMergeRequestChanges(host, projectId, mrIid);
    if (!changesResult.ok) return null;

    const { mr, changes } = changesResult.data;

    const diffFiles: DiffFileData[] = changes.map((c) => ({
      filePath: c.new_path,
      oldPath: c.renamed_file ? c.old_path : null,
      isNew: c.new_file,
      isDeleted: c.deleted_file,
      isRenamed: c.renamed_file,
      diff: c.diff,
      addedLines: countDiffLines(c.diff).added,
      removedLines: countDiffLines(c.diff).removed,
    }));

    return {
      projectPath: mr.web_url.match(/^https?:\/\/[^/]+\/(.+)\/-\/merge_requests/)?.[1] ?? '',
      projectId,
      mrIid,
      hostUrl: host.url,
      title: mr.title,
      description: mr.description,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      authorUsername: mr.author?.username ?? null,
      diffFiles,
    };
  };

  // Review executor: wraps executeReview with settings loading.
  // The queue manager calls this to run each queued review.
  const queueExecutor = async (
    context: MrContext,
    tasks: import('@/services/review/review-types').ReviewTask[],
    send: (chunk: StreamChunk) => void,
    signal: AbortSignal,
  ): Promise<void> => {
    const settings = await loadSettings();

    if (!settings.ai.baseUrl) {
      send({
        type: 'STREAM_TASK_ERROR',
        payload: { task: 'review', error: 'AI provider not configured.' },
      });
      send({ type: 'STREAM_ALL_COMPLETE' });
      return;
    }

    await executeReview(context, tasks, settings, send, signal);
  };

  // Initialize the queue manager (rehydrates persisted state)
  initQueueManager(queueExecutor, buildMrContext).catch((error) => {
    console.error('[Background] Queue manager init failed:', error);
  });

  // -----------------------------------------------------------------
  // Queue port listener — content scripts connect for real-time updates
  // -----------------------------------------------------------------

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name.startsWith('otto-queue:')) {
      registerPort(port);
    }
  });

  // -----------------------------------------------------------------
  // Streaming handler — review pipeline + chat Q&A
  // -----------------------------------------------------------------

  registerStreamHandler(async (request, send) => {
    if (request.type === 'STREAM_REVIEW') {
      const settings = await loadSettings();

      if (!settings.ai.baseUrl) {
        send({
          type: 'STREAM_TASK_ERROR',
          payload: { task: 'review', error: 'AI provider not configured. Open Otto settings to set up your AI endpoint.' },
        });
        send({ type: 'STREAM_ALL_COMPLETE' });
        return;
      }

      await executeReview(
        request.payload.mrContext,
        request.payload.tasks,
        settings,
        send,
      );
      return;
    }

    if (request.type === 'STREAM_CHAT') {
      const settings = await loadSettings();

      if (!settings.ai.baseUrl) {
        send({
          type: 'STREAM_CHAT_ERROR',
          payload: { error: 'AI provider not configured. Open Otto settings to set up your AI endpoint.' },
        });
        return;
      }

      const { question, history, reviewContext } = request.payload;

      const result = await generateChatResponse(
        settings.ai,
        question,
        reviewContext,
        history,
        (delta) => {
          send({ type: 'STREAM_CHAT_DELTA', payload: { content: delta } });
        },
      );

      if (result.ok) {
        send({
          type: 'STREAM_CHAT_COMPLETE',
          payload: { content: result.data.content, suggestedQuestions: result.data.suggestedQuestions },
        });
      } else {
        send({ type: 'STREAM_CHAT_ERROR', payload: { error: result.error } });
      }
      return;
    }
  });
});
