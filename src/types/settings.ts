// ---------------------------------------------------------------------------
// Settings schema — the single source of truth for all Otto configuration.
//
// Design decisions:
// - `hosts` is an array because users may work across gitlab.com + self-hosted.
// - Each host has a UUID `id` so we can reference it stably (not by index).
// - Model config is per-task because different tasks have different cost/quality
//   tradeoffs (e.g., haiku for related-files discovery, sonnet for code review).
// - Temperature is per-task for the same reason.
// - `apiKey` and `pat` are stored as plain strings in chrome.storage.local.
//   They never leave the extension (service worker only). chrome.storage.local
//   is NOT synced across devices and is only accessible to this extension.
// ---------------------------------------------------------------------------

export type AiTaskType = 'summary' | 'codeReview' | 'edgeCases' | 'relatedFiles' | 'followUp';

export type GitLabHost = {
  id: string;
  url: string;       // e.g., "https://gitlab.com" — no trailing slash
  pat: string;        // Personal Access Token (read_api scope minimum)
  label: string;      // User-friendly name, e.g., "Work GitLab"
};

export type AiConfig = {
  baseUrl: string;    // OpenAI-compatible endpoint, e.g., "http://localhost:8000/v1"
  apiKey: string;
  models: Record<AiTaskType, string>;
  temperatures: Record<AiTaskType, number>;
  maxTokens: Record<AiTaskType, number>;  // 0 = not set (let model/provider decide)
};

export type Preferences = {
  autoReview: boolean;
  streamResponses: boolean;
  theme: 'light' | 'dark' | 'auto';
};

export type OttoSettings = {
  ai: AiConfig;
  gitlab: {
    hosts: GitLabHost[];
  };
  preferences: Preferences;
};

// ---------------------------------------------------------------------------
// Defaults — used when no settings exist yet (first install).
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: OttoSettings = {
  ai: {
    baseUrl: '',
    apiKey: '',
    models: {
      summary: 'claude-sonnet-4-5',
      codeReview: 'claude-sonnet-4-5',
      edgeCases: 'claude-sonnet-4-5',
      relatedFiles: 'claude-haiku-4-5',
      followUp: 'claude-sonnet-4-5',
    },
    temperatures: {
      summary: 0.3,
      codeReview: 0.2,
      edgeCases: 0.4,
      relatedFiles: 0.1,
      followUp: 0.3,
    },
    maxTokens: {
      summary: 0,
      codeReview: 0,
      edgeCases: 16384,
      relatedFiles: 0,
      followUp: 0,
    },
  },
  gitlab: {
    hosts: [],
  },
  preferences: {
    autoReview: false,
    streamResponses: true,
    theme: 'auto',
  },
};
