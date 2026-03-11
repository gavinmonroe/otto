// ---------------------------------------------------------------------------
// Extension message protocol — typed message passing between content script
// and service worker.
//
// Design decisions:
// - Discriminated union on `type` field for exhaustive switch handling.
// - Request types are SCREAMING_SNAKE_CASE (convention from standards.md).
// - Each request has a corresponding response type via MessageResponseMap.
// - Streaming messages use a separate port-based protocol (StreamMessage).
// - The Result pattern is used for responses that can fail.
//
// Why a map instead of conditional types:
// - Easier to read and extend
// - Better IDE support (hover shows the concrete type)
// - Simpler to add new message types (just add to both union + map)
// ---------------------------------------------------------------------------

import type { OttoSettings, GitLabHost } from './settings';
import type {
  MrContext,
  MrSummary,
  FileReview,
  RelatedFile,
  EdgeCase,
} from './review';
import type {
  GitLabMergeRequest,
  GitLabProject,
  GitLabTreeItem,
  GitLabDiscussion,
} from './gitlab';
import type { FollowUpAnalysis, ThreadContext } from './followup';
import type { TicketInfo } from './ticket';
import type { TicketProvider } from './ticket';

// ---------------------------------------------------------------------------
// Result type — used for all responses that can fail.
// ---------------------------------------------------------------------------

export type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E };

// ---------------------------------------------------------------------------
// Request messages — content script → service worker (via sendMessage)
// ---------------------------------------------------------------------------

export type GetSettingsMessage = {
  type: 'GET_SETTINGS';
};

export type SaveSettingsMessage = {
  type: 'SAVE_SETTINGS';
  payload: OttoSettings;
};

export type ResolveGitLabHostMessage = {
  type: 'RESOLVE_GITLAB_HOST';
  payload: { pageUrl: string };
};

export type FetchProjectMessage = {
  type: 'FETCH_PROJECT';
  payload: { hostId: string; projectPath: string };
};

export type FetchMrMetadataMessage = {
  type: 'FETCH_MR_METADATA';
  payload: { hostId: string; projectId: number; mrIid: number };
};

export type FetchMrChangesMessage = {
  type: 'FETCH_MR_CHANGES';
  payload: { hostId: string; projectId: number; mrIid: number };
};

export type FetchFileContentMessage = {
  type: 'FETCH_FILE_CONTENT';
  payload: { hostId: string; projectId: number; filePath: string; ref: string };
};

export type FetchFileTreeMessage = {
  type: 'FETCH_FILE_TREE';
  payload: { hostId: string; projectId: number; path?: string; ref: string; recursive?: boolean };
};

export type FetchAiModelsMessage = {
  type: 'FETCH_AI_MODELS';
};

export type TestAiConnectionMessage = {
  type: 'TEST_AI_CONNECTION';
  payload: { baseUrl: string; apiKey: string };
};

export type TestGitLabConnectionMessage = {
  type: 'TEST_GITLAB_CONNECTION';
  payload: { host: GitLabHost };
};

export type OpenOptionsMessage = {
  type: 'OPEN_OPTIONS';
};

export type HighlightCodeMessage = {
  type: 'HIGHLIGHT_CODE';
  payload: { code: string; lang: string | null; isDark: boolean };
};

export type HighlightLinesMessage = {
  type: 'HIGHLIGHT_LINES';
  payload: { lines: string[]; lang: string | null; isDark: boolean };
};

export type AnalyzeCommentMessage = {
  type: 'ANALYZE_COMMENT';
  payload: {
    hostId: string | null;       // null if no GitLab host configured
    projectId: number | null;
    mrIid: number;
    projectPath: string;
    sourceBranch: string;
    mrTitle: string;
    mrDescription: string | null;
    thread: ThreadContext;
    threadHash: string;          // For cache validation
  };
};

export type FetchMrDiscussionsMessage = {
  type: 'FETCH_MR_DISCUSSIONS';
  payload: { hostId: string; projectId: number; mrIid: number };
};

export type FetchTicketMessage = {
  type: 'FETCH_TICKET';
  payload: { ticketKey: string };
};

export type FetchTicketBatchMessage = {
  type: 'FETCH_TICKET_BATCH';
  payload: { ticketKeys: string[] };
};

export type TestJiraConnectionMessage = {
  type: 'TEST_JIRA_CONNECTION';
  payload: { provider: TicketProvider };
};

export type RequestMessage =
  | GetSettingsMessage
  | SaveSettingsMessage
  | ResolveGitLabHostMessage
  | FetchProjectMessage
  | FetchMrMetadataMessage
  | FetchMrChangesMessage
  | FetchFileContentMessage
  | FetchFileTreeMessage
  | FetchAiModelsMessage
  | TestAiConnectionMessage
  | TestGitLabConnectionMessage
  | OpenOptionsMessage
  | HighlightCodeMessage
  | HighlightLinesMessage
  | AnalyzeCommentMessage
  | FetchMrDiscussionsMessage
  | FetchTicketMessage
  | FetchTicketBatchMessage
  | TestJiraConnectionMessage;

// ---------------------------------------------------------------------------
// Response map — maps each request type to its response type.
// ---------------------------------------------------------------------------

export type MessageResponseMap = {
  GET_SETTINGS: Result<OttoSettings>;
  SAVE_SETTINGS: Result<void>;
  RESOLVE_GITLAB_HOST: Result<GitLabHost | null>;
  FETCH_PROJECT: Result<GitLabProject>;
  FETCH_MR_METADATA: Result<GitLabMergeRequest>;
  FETCH_MR_CHANGES: Result<{ mr: GitLabMergeRequest; changes: import('./gitlab').GitLabDiffFile[] }>;
  FETCH_FILE_CONTENT: Result<string>;
  FETCH_FILE_TREE: Result<GitLabTreeItem[]>;
  FETCH_AI_MODELS: Result<string[]>;
  TEST_AI_CONNECTION: Result<{ model: string }>;
  TEST_GITLAB_CONNECTION: Result<{ username: string }>;
  OPEN_OPTIONS: Result<void>;
  HIGHLIGHT_CODE: Result<string>;
  HIGHLIGHT_LINES: Result<string[]>;
  ANALYZE_COMMENT: Result<FollowUpAnalysis>;
  FETCH_MR_DISCUSSIONS: Result<GitLabDiscussion[]>;
  FETCH_TICKET: Result<TicketInfo>;
  FETCH_TICKET_BATCH: Result<Record<string, TicketInfo>>;
  TEST_JIRA_CONNECTION: Result<{ displayName: string }>;
};

// ---------------------------------------------------------------------------
// Streaming messages — used over chrome.runtime.connect() ports.
//
// The port name is 'otto-stream'. The content script opens the port,
// sends a StreamRequest, and receives StreamChunk messages until
// a StreamComplete or StreamError arrives.
// ---------------------------------------------------------------------------

export type StreamRequest = {
  type: 'STREAM_REVIEW';
  payload: {
    mrContext: MrContext;
    tasks: Array<'summary' | 'codeReview' | 'edgeCases' | 'relatedFiles'>;
  };
};

export type StreamChunk =
  | { type: 'STREAM_SUMMARY_DELTA'; payload: { content: string } }
  | { type: 'STREAM_SUMMARY_COMPLETE'; payload: { summary: MrSummary } }
  | { type: 'STREAM_FILE_REVIEW_DELTA'; payload: { filePath: string; content: string } }
  | { type: 'STREAM_FILE_REVIEW_COMPLETE'; payload: { fileReview: FileReview } }
  | { type: 'STREAM_RELATED_FILES_COMPLETE'; payload: { files: RelatedFile[] } }
  | { type: 'STREAM_EDGE_CASES_DELTA'; payload: { content: string } }
  | { type: 'STREAM_EDGE_CASES_COMPLETE'; payload: { edgeCases: EdgeCase[] } }
  | { type: 'STREAM_PROGRESS'; payload: { message: string } }
  | { type: 'STREAM_TASK_ERROR'; payload: { task: string; error: string } }
  | { type: 'STREAM_ALL_COMPLETE' };
