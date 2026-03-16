// ---------------------------------------------------------------------------
// Botto WebSocket client — manages the connection between Otto and Botto.
//
// Architecture: The actual WebSocket lives in the service worker (botto-bridge.ts)
// because content script WebSockets are blocked by page CSP (GitLab's CSP
// only allows wss://gitlab.com). This client communicates with the bridge
// via chrome.runtime.connect() ports.
//
// When Botto is not configured, this module returns null — Otto continues
// to use chrome.runtime messaging as before.
// ---------------------------------------------------------------------------

import type { OttoSettings } from '@/types/settings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BottoConnectionState = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error';

export type ServerCapabilities = {
  sandbox_enabled: boolean;
  max_concurrent_reviews: number;
  shared_triage_available: boolean;
  version: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type StreamHandler = {
  onChunk: (chunk: unknown) => void;
  onEnd: () => void;
  onError: (error: string) => void;
};

type ConnectionListener = (state: BottoConnectionState) => void;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT = 30000;

export class BottoClient {
  private port: chrome.runtime.Port | null = null;
  private state: BottoConnectionState = 'disconnected';
  private serverUrl: string;
  private apiKey: string;
  private userId: string;
  private capabilities: ServerCapabilities | null = null;

  // Multiplexing
  private pendingRequests = new Map<string, PendingRequest>();
  private activeStreams = new Map<string, StreamHandler>();
  private requestCounter = 0;
  private streamCounter = 0;

  // Connect promise (resolved when AUTH_OK arrives)
  private connectResolve: ((caps: ServerCapabilities) => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;
  private authTimeout: ReturnType<typeof setTimeout> | null = null;

  // Listeners
  private connectionListeners = new Set<ConnectionListener>();
  private messageListeners = new Map<string, Set<(data: unknown) => void>>();

  constructor(serverUrl: string, apiKey: string, userId: string) {
    this.serverUrl = serverUrl;
    this.apiKey = apiKey;
    this.userId = userId;
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  connect(): Promise<ServerCapabilities> {
    return new Promise((resolve, reject) => {
      if (this.state === 'connected' && this.capabilities) {
        resolve(this.capabilities);
        return;
      }

      this.connectResolve = resolve;
      this.connectReject = reject;

      this.setState('connecting');

      // Open a port to the service worker bridge
      try {
        this.port = chrome.runtime.connect({ name: 'botto' });
      } catch (e) {
        this.setState('error');
        reject(new Error(`failed to connect to bridge: ${e}`));
        return;
      }

      // Auth timeout
      this.authTimeout = setTimeout(() => {
        this.setState('error');
        this.connectReject?.(new Error('auth timeout'));
        this.connectResolve = null;
        this.connectReject = null;
      }, 10_000);

      // Listen for messages from the bridge
      this.port.onMessage.addListener((msg) => {
        this.handleBridgeMessage(msg);
      });

      this.port.onDisconnect.addListener(() => {
        this.port = null;
        if (this.authTimeout) {
          clearTimeout(this.authTimeout);
          this.authTimeout = null;
        }
        if (this.connectReject) {
          this.connectReject(new Error('bridge disconnected'));
          this.connectResolve = null;
          this.connectReject = null;
        }
        this.setState('disconnected');

        // Reject pending requests
        for (const [, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('disconnected'));
        }
        this.pendingRequests.clear();

        // End active streams
        for (const [, handler] of this.activeStreams) {
          handler.onError('disconnected');
        }
        this.activeStreams.clear();
      });

      // Tell the bridge to connect the WebSocket
      this.port.postMessage({
        type: 'BOTTO_CONNECT',
        serverUrl: this.serverUrl,
        apiKey: this.apiKey,
        userId: this.userId,
      });
    });
  }

  disconnect(): void {
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }

    this.port?.postMessage({ type: 'BOTTO_DISCONNECT' });
    this.port?.disconnect();
    this.port = null;
    this.setState('disconnected');

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('disconnected'));
    }
    this.pendingRequests.clear();

    // End all active streams
    for (const [, handler] of this.activeStreams) {
      handler.onError('disconnected');
    }
    this.activeStreams.clear();

    this.connectResolve = null;
    this.connectReject = null;
  }

  getState(): BottoConnectionState { return this.state; }
  getCapabilities(): ServerCapabilities | null { return this.capabilities; }
  isConnected(): boolean { return this.state === 'connected'; }

  // -------------------------------------------------------------------------
  // Send raw data through the bridge
  // -------------------------------------------------------------------------

  private send(data: Record<string, unknown>): void {
    this.port?.postMessage({ type: 'BOTTO_SEND', data: JSON.stringify(data) });
  }

  // -------------------------------------------------------------------------
  // One-shot request/response
  // -------------------------------------------------------------------------

  async sendRequest<T = unknown>(payload: Record<string, unknown>): Promise<T> {
    if (!this.isConnected()) {
      throw new Error('not connected to Botto');
    }

    const requestId = `req_${++this.requestCounter}`;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('request timeout'));
      }, REQUEST_TIMEOUT);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      this.send({
        type: 'REQUEST',
        request_id: requestId,
        payload,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------

  openStream(
    payload: Record<string, unknown>,
    onChunk: (chunk: unknown) => void,
    onEnd: () => void,
    onError?: (error: string) => void,
  ): { streamId: string; cancel: () => void } {
    if (!this.isConnected()) {
      throw new Error('not connected to Botto');
    }

    const streamId = `stream_${++this.streamCounter}`;

    this.activeStreams.set(streamId, {
      onChunk,
      onEnd,
      onError: onError ?? (() => {}),
    });

    this.send({
      type: 'STREAM_START',
      stream_id: streamId,
      payload,
    });

    return {
      streamId,
      cancel: () => {
        this.send({
          type: 'STREAM_CANCEL',
          stream_id: streamId,
        });
        this.activeStreams.delete(streamId);
      },
    };
  }

  // -------------------------------------------------------------------------
  // Presence
  // -------------------------------------------------------------------------

  viewingMr(projectPath: string, mrIid: number): void {
    if (!this.isConnected()) return;
    this.send({
      type: 'VIEWING_MR',
      project_path: projectPath,
      mr_iid: mrIid,
    });
  }

  leftMr(): void {
    if (!this.isConnected()) return;
    this.send({ type: 'LEFT_MR' });
  }

  // -------------------------------------------------------------------------
  // Comment actions
  // -------------------------------------------------------------------------

  sendCommentAction(
    projectPath: string,
    mrIid: number,
    commentId: string,
    action: string,
    editedBody?: string,
  ): void {
    if (!this.isConnected()) return;
    this.send({
      type: 'COMMENT_ACTION',
      project_path: projectPath,
      mr_iid: mrIid,
      comment_id: commentId,
      action,
      edited_body: editedBody ?? null,
    });
  }

  // -------------------------------------------------------------------------
  // Sandbox fix
  // -------------------------------------------------------------------------

  requestFix(
    projectPath: string,
    mrIid: number,
    commentId: string,
    suggestion: string,
    filePath: string,
    originalCode: string,
    sourceBranch?: string,
    commentBody?: string,
    commentTitle?: string,
    severity?: string,
    targetBranch?: string,
    startLine?: number | null,
    endLine?: number | null,
    gitlabNoteId?: number | null,
  ): void {
    if (!this.isConnected()) return;
    this.send({
      type: 'REQUEST_FIX',
      project_path: projectPath,
      mr_iid: mrIid,
      comment_id: commentId,
      suggestion,
      file_path: filePath,
      original_code: originalCode,
      source_branch: sourceBranch ?? null,
      comment_body: commentBody ?? null,
      comment_title: commentTitle ?? null,
      severity: severity ?? null,
      target_branch: targetBranch ?? null,
      start_line: startLine ?? null,
      end_line: endLine ?? null,
      gitlab_note_id: gitlabNoteId ?? null,
    });
  }

  // -------------------------------------------------------------------------
  // Event listeners
  // -------------------------------------------------------------------------

  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  /** Listen for specific message types (e.g., COMMENT_ACTION_BROADCAST, FIX_PROGRESS). */
  onMessage(type: string, listener: (data: unknown) => void): () => void {
    if (!this.messageListeners.has(type)) {
      this.messageListeners.set(type, new Set());
    }
    this.messageListeners.get(type)!.add(listener);
    return () => this.messageListeners.get(type)?.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Internal — bridge message handling
  // -------------------------------------------------------------------------

  private setState(state: BottoConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.connectionListeners) {
      try { listener(state); } catch {}
    }
  }

  /** Handle messages from the service worker bridge. */
  private handleBridgeMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'BOTTO_STATE': {
        const bridgeState = msg.state as string;
        if (bridgeState === 'connected') {
          // Don't set connected yet — wait for AUTH_OK in BOTTO_MESSAGE
          this.setState('authenticating');
        } else if (bridgeState === 'error') {
          this.setState('error');
        } else if (bridgeState === 'disconnected') {
          if (this.state === 'connected') {
            this.setState('disconnected');
          }
        }
        break;
      }

      case 'BOTTO_MESSAGE': {
        const raw = msg.data as string;
        try {
          const parsed = JSON.parse(raw);
          this.handleServerMessage(parsed);
        } catch {
          // Ignore unparseable messages
        }
        break;
      }

      case 'BOTTO_ERROR': {
        const error = msg.error as string;
        if (this.connectReject) {
          this.connectReject(new Error(error));
          this.connectResolve = null;
          this.connectReject = null;
        }
        break;
      }
    }
  }

  /** Handle a parsed message from the Botto server (via bridge). */
  private handleServerMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;

    // Handle auth response
    if (type === 'AUTH_OK') {
      if (this.authTimeout) {
        clearTimeout(this.authTimeout);
        this.authTimeout = null;
      }
      this.capabilities = msg.capabilities as ServerCapabilities;
      this.setState('connected');
      this.connectResolve?.(this.capabilities);
      this.connectResolve = null;
      this.connectReject = null;
      return;
    }

    if (type === 'AUTH_ERROR') {
      if (this.authTimeout) {
        clearTimeout(this.authTimeout);
        this.authTimeout = null;
      }
      this.setState('error');
      this.connectReject?.(new Error(msg.error as string));
      this.connectResolve = null;
      this.connectReject = null;
      return;
    }

    // Route post-auth messages
    switch (type) {
      case 'RESPONSE': {
        const requestId = msg.request_id as string;
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(requestId);
          pending.resolve(msg.payload);
        }
        break;
      }

      case 'STREAM_CHUNK': {
        const streamId = msg.stream_id as string;
        const handler = this.activeStreams.get(streamId);
        if (handler) {
          handler.onChunk(msg.chunk);
        }
        break;
      }

      case 'STREAM_END': {
        const streamId = msg.stream_id as string;
        const handler = this.activeStreams.get(streamId);
        if (handler) {
          handler.onEnd();
          this.activeStreams.delete(streamId);
        }
        break;
      }

      case 'ERROR': {
        const requestId = msg.request_id as string | undefined;
        if (requestId) {
          const pending = this.pendingRequests.get(requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(requestId);
            pending.reject(new Error(msg.error as string));
          }
        }
        break;
      }

      default: {
        // Broadcast to type-specific listeners (COMMENT_ACTION_BROADCAST, FIX_PROGRESS, etc.)
        const listeners = this.messageListeners.get(type);
        if (listeners) {
          for (const listener of listeners) {
            try { listener(msg); } catch {}
          }
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton management
// ---------------------------------------------------------------------------

let instance: BottoClient | null = null;

/**
 * Get or create the Botto client singleton. Returns null if Botto is not configured.
 * Always returns the existing instance if one exists — callers check isConnected().
 * This prevents replacing a connected instance with a new disconnected one.
 */
export function getBottoClient(settings: OttoSettings): BottoClient | null {
  if (!settings.botto?.enabled || !settings.botto?.serverUrl) {
    return null;
  }

  if (instance) {
    return instance;
  }

  // Determine user ID from the first GitLab host's username
  const userId = settings.gitlab.hosts[0]?.username ?? 'unknown';

  instance = new BottoClient(
    settings.botto.serverUrl,
    settings.botto.apiKey ?? '',
    userId,
  );

  return instance;
}

/** Disconnect and destroy the singleton. */
export function disconnectBotto(): void {
  instance?.disconnect();
  instance = null;
}
