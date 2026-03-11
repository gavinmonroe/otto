// ---------------------------------------------------------------------------
// Chat Store — Zustand store for MR Q&A chat state in the content script.
//
// Design decisions:
// - Ephemeral per page load (same as review store). Chat context is tied
//   to the current MR — persisting across navigations would be confusing.
// - Messages array holds the full conversation history. This is passed to
//   the AI for multi-turn context.
// - currentDelta accumulates streaming text for the in-progress assistant
//   message. On completion, it's folded into a proper ChatMessage.
// - suggestedQuestions are replaced after each assistant response. The UI
//   shows initial starters when the conversation is empty.
// - panelX stores the horizontal drag position so it persists across
//   open/close toggles within the same page load.
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import type { ChatMessage, ChatStatus, SuggestedQuestion } from '@/types/chat';
import type { CachedChat } from './chat-cache';
import { generateId } from '@/lib/utils';

type ChatState = {
  messages: ChatMessage[];
  currentDelta: string;
  status: ChatStatus;
  error: string | null;
  suggestedQuestions: SuggestedQuestion[];
  isOpen: boolean;
  panelX: number | null;  // null = default position (right edge)
};

type ChatActions = {
  // Panel visibility
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setPanelX: (x: number) => void;

  // Conversation
  addUserMessage: (content: string) => ChatMessage;
  appendDelta: (content: string) => void;
  completeAssistantMessage: (content: string, suggestions: SuggestedQuestion[]) => void;
  setError: (error: string) => void;
  setStatus: (status: ChatStatus) => void;
  setSuggestedQuestions: (questions: SuggestedQuestion[]) => void;

  /**
   * Remove messages from the end of the conversation.
   * Used by retry to strip the failed user message before re-sending.
   */
  popMessagesAfter: (messageId: string) => void;

  // Cache hydration
  hydrateFromCache: (cached: CachedChat) => void;

  // Lifecycle
  reset: () => void;
};

const INITIAL_STATE: ChatState = {
  messages: [],
  currentDelta: '',
  status: 'idle',
  error: null,
  suggestedQuestions: [],
  isOpen: false,
  panelX: null,
};

export const useChatStore = create<ChatState & ChatActions>()((set, get) => ({
  ...INITIAL_STATE,

  setOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setPanelX: (x) => set({ panelX: x }),

  addUserMessage: (content) => {
    const message: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    set((s) => ({
      messages: [...s.messages, message],
      currentDelta: '',
      status: 'streaming',
      error: null,
    }));
    return message;
  },

  appendDelta: (content) => set((s) => ({
    currentDelta: s.currentDelta + content,
  })),

  completeAssistantMessage: (content, suggestions) => {
    const message: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    };
    set((s) => ({
      messages: [...s.messages, message],
      currentDelta: '',
      status: 'idle',
      suggestedQuestions: suggestions,
    }));
  },

  setError: (error) => set({
    status: 'error',
    error,
    currentDelta: '',
  }),

  setStatus: (status) => set({ status, error: status !== 'error' ? null : get().error }),

  setSuggestedQuestions: (questions) => set({ suggestedQuestions: questions }),

  popMessagesAfter: (messageId) => set((s) => {
    const idx = s.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return {};
    return { messages: s.messages.slice(0, idx) };
  }),

  hydrateFromCache: (cached) => set({
    messages: cached.messages,
    suggestedQuestions: cached.suggestedQuestions,
    status: 'idle',
    error: null,
    currentDelta: '',
  }),

  reset: () => set(INITIAL_STATE),
}));
