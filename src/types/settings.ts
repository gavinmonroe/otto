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

import type { TicketProvider } from './ticket';

export type AiTaskType = 'summary' | 'codeReview' | 'edgeCases' | 'relatedFiles' | 'followUp' | 'chat' | 'acValidation' | 'adversarialTests' | 'contracts' | 'behavioralDelta';

/**
 * Features that can be individually toggled on/off by the user.
 * Controls which LLM-powered features run during reviews and which
 * UI elements are injected into the GitLab page.
 */
export type ToggleableFeature =
  | 'summary'
  | 'codeReview'
  | 'edgeCases'
  | 'relatedFiles'
  | 'followUp'
  | 'chat'
  | 'acValidation'
  | 'mrListPreview'
  | 'mrReviewQueue'
  | 'adversarialTests'
  | 'contracts'
  | 'behavioralDelta';

export type GitLabHost = {
  id: string;
  url: string;       // e.g., "https://gitlab.com" — no trailing slash
  pat: string;        // Personal Access Token (read_api scope minimum)
  label: string;      // User-friendly name, e.g., "Work GitLab"
  username?: string;  // Authenticated user's username (populated on connection test)
};

export type AiConfig = {
  baseUrl: string;    // OpenAI-compatible endpoint, e.g., "http://localhost:8000/v1"
  apiKey: string;
  models: Record<AiTaskType, string>;
  temperatures: Record<AiTaskType, number>;
  maxTokens: Record<AiTaskType, number>;  // 0 = not set (let model/provider decide)
  customPrompts: Record<AiTaskType, string>;  // Empty string = use default
};

export type ReviewMode = 'default' | 'guided';

export type Preferences = {
  autoReview: boolean;
  streamResponses: boolean;
  theme: 'light' | 'dark' | 'auto';
  reviewMode: ReviewMode;
  enabledFeatures: Record<ToggleableFeature, boolean>;
};

export type OttoSettings = {
  ai: AiConfig;
  gitlab: {
    hosts: GitLabHost[];
  };
  tickets: {
    providers: TicketProvider[];
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
      chat: 'claude-sonnet-4-5',
      acValidation: 'claude-sonnet-4-5',
      adversarialTests: 'claude-sonnet-4-5',
      contracts: 'claude-sonnet-4-5',
      behavioralDelta: 'claude-sonnet-4-5',
    },
    temperatures: {
      summary: 0.3,
      codeReview: 0.2,
      edgeCases: 0.4,
      relatedFiles: 0.1,
      followUp: 0.3,
      chat: 0.4,
      acValidation: 0.2,
      adversarialTests: 0.3,
      contracts: 0.2,
      behavioralDelta: 0.3,
    },
    maxTokens: {
      summary: 0,
      codeReview: 0,
      edgeCases: 0,
      relatedFiles: 0,
      followUp: 0,
      chat: 0,
      acValidation: 0,
      adversarialTests: 0,
      contracts: 0,
      behavioralDelta: 0,
    },
    customPrompts: {
      summary: '',
      codeReview: '',
      edgeCases: '',
      relatedFiles: '',
      followUp: '',
      chat: '',
      acValidation: '',
      adversarialTests: '',
      contracts: '',
      behavioralDelta: '',
    },
  },
  gitlab: {
    hosts: [],
  },
  tickets: {
    providers: [],
  },
  preferences: {
    autoReview: false,
    streamResponses: true,
    theme: 'auto',
    reviewMode: 'default',
    enabledFeatures: {
      summary: true,
      codeReview: true,
      edgeCases: true,
      relatedFiles: true,
      followUp: true,
      chat: true,
      acValidation: true,
      mrListPreview: true,
      mrReviewQueue: true,
      adversarialTests: false,
      contracts: false,
      behavioralDelta: false,
    },
  },
};
