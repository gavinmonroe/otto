// ---------------------------------------------------------------------------
// Inquiry Store — Zustand store for line inquiry state in the content script.
//
// Design decisions:
// - Supports multiple inquiries per MR (keyed by deterministic ID), but only
//   one can be active (open) at a time. Opening a new one closes the previous.
// - Each inquiry has its own slide array and navigation index. The carousel
//   navigates within a single inquiry's slides.
// - Streaming state (currentDelta) lives on the inquiry itself, not globally,
//   so we don't lose context if the user closes and reopens.
// - The store is ephemeral per page load (same as chat/review stores).
//   Persistence is handled by inquiry-cache.ts.
// - Team indicators are a separate lightweight array — full slide data is
//   fetched on demand from Botto when the user clicks a gutter dot.
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import type {
  LineInquiry,
  InquirySlide,
  InquiryStatus,
  TeamInquiryIndicator,
  CachedInquiry,
} from '@/types/inquiry';
import { generateId } from '@/lib/utils';

// ---------------------------------------------------------------------------
// djb2 hash — same algorithm as review-cache.ts and comment-parser.ts.
// Duplicated here to avoid cross-module import from a service into a store.
// ---------------------------------------------------------------------------

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Deterministic inquiry ID from its anchor coordinates. */
export function buildInquiryId(
  filePath: string,
  startLine: number,
  endLine: number,
  mrIid: number,
): string {
  return djb2(`${filePath}:${startLine}:${endLine}:${mrIid}`);
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

type InquiryState = {
  /** All inquiries for this MR, keyed by inquiry ID. */
  inquiries: Record<string, LineInquiry>;
  /** The currently open inquiry (composer or carousel visible). Null if none. */
  activeInquiryId: string | null;
  /** Lightweight indicators from Botto for gutter dot rendering. */
  teamIndicators: TeamInquiryIndicator[];
};

type InquiryActions = {
  /**
   * Begin composing a new inquiry for a line range.
   * If an inquiry already exists for this exact range, reopens it instead.
   * Returns the inquiry ID.
   */
  startComposing: (params: {
    filePath: string;
    startLine: number;
    endLine: number;
    diffSnippet: string;
    codeContent: string;
    mrIid: number;
  }) => string;

  /**
   * Submit a question for an inquiry. Creates a new slide in 'streaming' state.
   * The stream dispatcher calls appendDelta/completeSlide as data arrives.
   */
  submitQuestion: (inquiryId: string, question: string) => void;

  /** Append streaming delta content to the active slide. */
  appendDelta: (inquiryId: string, content: string) => void;

  /** Finalize the current slide with the complete answer. */
  completeSlide: (inquiryId: string, answer: string) => void;

  /** Set error state on an inquiry. */
  setError: (inquiryId: string, error: string) => void;

  /** Set status directly (used by cancel/retry flows). */
  setStatus: (inquiryId: string, status: InquiryStatus) => void;

  /**
   * Reset the last slide for retry — clears its answer so the new stream
   * can take over cleanly. Without this, the old partial answer would show
   * instead of the new streaming delta (InquirySlide renders answer || delta).
   */
  resetSlideForRetry: (inquiryId: string) => void;

  /** Navigate the carousel. */
  navigateSlide: (inquiryId: string, direction: 'prev' | 'next') => void;

  /** Jump to a specific slide index. */
  goToSlide: (inquiryId: string, index: number) => void;

  /** Close the active inquiry (hides composer/carousel, clears active). */
  closeInquiry: () => void;

  /** Mark an inquiry as saved for team (Botto). */
  markSavedForTeam: (inquiryId: string) => void;

  /** Replace team indicators (called on MR load from Botto). */
  setTeamIndicators: (indicators: TeamInquiryIndicator[]) => void;

  /**
   * Hydrate an inquiry from a Botto team fetch or local cache.
   * If the inquiry already exists with slides, merges (keeps local state).
   */
  hydrateInquiry: (cached: CachedInquiry) => void;

  /** Hydrate multiple inquiries from cache on page load. */
  hydrateFromCache: (cached: CachedInquiry[]) => void;

  /** Remove an inquiry entirely. */
  removeInquiry: (inquiryId: string) => void;

  /** Reset all state (called on MR navigation). */
  reset: () => void;
};

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_STATE: InquiryState = {
  inquiries: {},
  activeInquiryId: null,
  teamIndicators: [],
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useInquiryStore = create<InquiryState & InquiryActions>()((set, get) => ({
  ...INITIAL_STATE,

  startComposing: ({ filePath, startLine, endLine, diffSnippet, codeContent, mrIid }) => {
    const id = buildInquiryId(filePath, startLine, endLine, mrIid);
    const existing = get().inquiries[id];

    if (existing && existing.slides.length > 0) {
      // Reopen existing inquiry — show the carousel
      set({ activeInquiryId: id });
      return id;
    }

    // Create new inquiry in composing state
    const inquiry: LineInquiry = {
      id,
      filePath,
      startLine,
      endLine,
      diffSnippet,
      codeContent,
      slides: existing?.slides ?? [],
      currentSlideIndex: existing?.slides.length ? existing.slides.length - 1 : 0,
      status: existing?.slides.length ? 'idle' : 'composing',
      currentDelta: '',
      error: null,
      savedForTeam: existing?.savedForTeam ?? false,
    };

    set((s) => ({
      inquiries: { ...s.inquiries, [id]: inquiry },
      activeInquiryId: id,
    }));

    return id;
  },

  submitQuestion: (inquiryId, question) => {
    const inquiry = get().inquiries[inquiryId];
    if (!inquiry) return;

    const slide: InquirySlide = {
      id: generateId(),
      question,
      answer: '',
      timestamp: Date.now(),
    };

    set((s) => ({
      inquiries: {
        ...s.inquiries,
        [inquiryId]: {
          ...inquiry,
          slides: [...inquiry.slides, slide],
          currentSlideIndex: inquiry.slides.length, // navigate to the new slide
          status: 'streaming',
          currentDelta: '',
          error: null,
        },
      },
    }));
  },

  appendDelta: (inquiryId, content) => {
    const inquiry = get().inquiries[inquiryId];
    if (!inquiry) return;

    set((s) => ({
      inquiries: {
        ...s.inquiries,
        [inquiryId]: {
          ...inquiry,
          currentDelta: inquiry.currentDelta + content,
        },
      },
    }));
  },

  completeSlide: (inquiryId, answer) => {
    const inquiry = get().inquiries[inquiryId];
    if (!inquiry || inquiry.slides.length === 0) return;

    // Update the last slide with the complete answer
    const slides = [...inquiry.slides];
    const lastIdx = slides.length - 1;
    slides[lastIdx] = { ...slides[lastIdx], answer };

    set((s) => ({
      inquiries: {
        ...s.inquiries,
        [inquiryId]: {
          ...inquiry,
          slides,
          status: 'idle',
          currentDelta: '',
        },
      },
    }));
  },

  setError: (inquiryId, error) => {
    const inquiry = get().inquiries[inquiryId];
    if (!inquiry) return;

    set((s) => ({
      inquiries: {
        ...s.inquiries,
        [inquiryId]: {
          ...inquiry,
          status: 'error',
          error,
          currentDelta: '',
        },
      },
    }));
  },

  setStatus: (inquiryId, status) => {
    const inquiry = get().inquiries[inquiryId];
    if (!inquiry) return;

    set((s) => ({
      inquiries: {
        ...s.inquiries,
        [inquiryId]: {
          ...inquiry,
          status,
          error: status !== 'error' ? null : inquiry.error,
        },
      },
    }));
  },

  resetSlideForRetry: (inquiryId) => {
    const inquiry = get().inquiries[inquiryId];
    if (!inquiry || inquiry.slides.length === 0) return;

    // Clear the last slide's answer so the new stream renders via currentDelta
    const slides = [...inquiry.slides];
    const lastIdx = slides.length - 1;
    slides[lastIdx] = { ...slides[lastIdx], answer: '' };

    set((s) => ({
      inquiries: {
        ...s.inquiries,
        [inquiryId]: {
          ...inquiry,
          slides,
          status: 'streaming',
          currentDelta: '',
          error: null,
        },
      },
    }));
  },

  navigateSlide: (inquiryId, direction) => {
    const inquiry = get().inquiries[inquiryId];
    if (!inquiry || inquiry.slides.length === 0) return;

    const newIndex = direction === 'next'
      ? Math.min(inquiry.currentSlideIndex + 1, inquiry.slides.length - 1)
      : Math.max(inquiry.currentSlideIndex - 1, 0);

    if (newIndex === inquiry.currentSlideIndex) return;

    set((s) => ({
      inquiries: {
        ...s.inquiries,
        [inquiryId]: { ...inquiry, currentSlideIndex: newIndex },
      },
    }));
  },

  goToSlide: (inquiryId, index) => {
    const inquiry = get().inquiries[inquiryId];
    if (!inquiry) return;

    const clamped = Math.max(0, Math.min(index, inquiry.slides.length - 1));
    if (clamped === inquiry.currentSlideIndex) return;

    set((s) => ({
      inquiries: {
        ...s.inquiries,
        [inquiryId]: { ...inquiry, currentSlideIndex: clamped },
      },
    }));
  },

  closeInquiry: () => set({ activeInquiryId: null }),

  markSavedForTeam: (inquiryId) => {
    const inquiry = get().inquiries[inquiryId];
    if (!inquiry) return;

    set((s) => ({
      inquiries: {
        ...s.inquiries,
        [inquiryId]: { ...inquiry, savedForTeam: true },
      },
    }));
  },

  setTeamIndicators: (indicators) => set({ teamIndicators: indicators }),

  hydrateInquiry: (cached) => {
    const existing = get().inquiries[cached.id];

    // If we already have this inquiry with more slides (local state ahead
    // of cache), keep the local version.
    if (existing && existing.slides.length >= cached.slides.length) return;

    const inquiry: LineInquiry = {
      id: cached.id,
      filePath: cached.filePath,
      startLine: cached.startLine,
      endLine: cached.endLine,
      diffSnippet: cached.diffSnippet,
      codeContent: cached.codeContent,
      slides: cached.slides,
      currentSlideIndex: cached.slides.length > 0 ? cached.slides.length - 1 : 0,
      status: 'idle',
      currentDelta: '',
      error: null,
      savedForTeam: cached.savedForTeam,
    };

    set((s) => ({
      inquiries: { ...s.inquiries, [cached.id]: inquiry },
    }));
  },

  hydrateFromCache: (cached) => {
    const inquiries: Record<string, LineInquiry> = {};
    for (const c of cached) {
      inquiries[c.id] = {
        id: c.id,
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        diffSnippet: c.diffSnippet,
        codeContent: c.codeContent,
        slides: c.slides,
        currentSlideIndex: c.slides.length > 0 ? c.slides.length - 1 : 0,
        status: 'idle',
        currentDelta: '',
        error: null,
        savedForTeam: c.savedForTeam,
      };
    }

    set((s) => ({
      inquiries: { ...s.inquiries, ...inquiries },
    }));
  },

  removeInquiry: (inquiryId) => {
    set((s) => {
      const { [inquiryId]: _, ...rest } = s.inquiries;
      return {
        inquiries: rest,
        activeInquiryId: s.activeInquiryId === inquiryId ? null : s.activeInquiryId,
      };
    });
  },

  reset: () => set(INITIAL_STATE),
}));
