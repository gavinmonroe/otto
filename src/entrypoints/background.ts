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
import { normalizeUrl } from '@/lib/utils';

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
  };

  registerMessageHandler(handlers);

  // -----------------------------------------------------------------
  // Streaming handler — review pipeline
  // -----------------------------------------------------------------

  registerStreamHandler(async (request, send) => {
    if (request.type !== 'STREAM_REVIEW') return;

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
  });
});
