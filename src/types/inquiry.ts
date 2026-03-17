// ---------------------------------------------------------------------------
// Inquiry types — data structures for the line inquiry composer feature.
//
// Design decisions:
// - InquirySlide is a single Q&A turn. Each follow-up creates a new slide.
//   The carousel navigates between slides without a scrolling chat history.
// - LineInquiry is the top-level container for one inquiry session, anchored
//   to a file + line range. Multiple inquiries can exist per MR (one active).
// - TeamInquiryIndicator is the lightweight shape sent by Botto for gutter
//   dot rendering — full slide data is fetched on demand.
// - IDs are deterministic hashes of (filePath + startLine + endLine + mrIid)
//   so the same selection always maps to the same inquiry, enabling cache
//   hits and team deduplication.
// - The context snapshot (InquiryContext) is built at submit time and passed
//   to the AI prompt builder. It includes previous slides so follow-ups
//   have conversational continuity without a full chat protocol.
// ---------------------------------------------------------------------------

import type { MrContext } from './review';

// ---------------------------------------------------------------------------
// Core inquiry types
// ---------------------------------------------------------------------------

export type InquirySlide = {
  id: string;                    // crypto.randomUUID per slide
  question: string;              // what the user asked
  answer: string;                // full markdown response (populated on complete)
  timestamp: number;
};

export type InquiryStatus = 'composing' | 'streaming' | 'idle' | 'error';

export type LineInquiry = {
  id: string;                    // deterministic: djb2(filePath + startLine + endLine + mrIid)
  filePath: string;
  startLine: number;
  endLine: number;
  diffSnippet: string;           // the raw diff text for the selected range
  codeContent: string;           // actual source content for the range (if available)
  slides: InquirySlide[];
  currentSlideIndex: number;
  status: InquiryStatus;
  currentDelta: string;          // streaming accumulator for the in-flight slide
  error: string | null;
  savedForTeam: boolean;
};

// ---------------------------------------------------------------------------
// Team sharing (Botto)
// ---------------------------------------------------------------------------

export type TeamInquiryIndicator = {
  inquiryId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  slideCount: number;
  author: string;                // who saved it
  previewQuestion: string;       // first question, truncated for tooltip
};

// ---------------------------------------------------------------------------
// Selection state — ephemeral, tracks the drag interaction before an
// inquiry is created. Not persisted.
// ---------------------------------------------------------------------------

export type LineSelection = {
  filePath: string;
  fileElement: Element;          // the .diff-file DOM node (not persisted)
  startLine: number;
  endLine: number;
  diffSnippet: string;
  codeContent: string;
};

// ---------------------------------------------------------------------------
// AI context — snapshot passed to the prompt builder at submit time.
// Mirrors ChatReviewContext pattern but scoped to the selected lines.
// ---------------------------------------------------------------------------

export type InquiryContext = {
  mrContext: MrContext;
  filePath: string;
  startLine: number;
  endLine: number;
  diffSnippet: string;           // raw unified diff for the range
  codeContent: string;           // source content for the range
  fullFileDiff: string;          // entire file's diff (for broader context)
  previousSlides: InquirySlide[]; // conversation history for follow-ups
};

// ---------------------------------------------------------------------------
// Cache shape — what gets persisted to chrome.storage.local
// ---------------------------------------------------------------------------

export type CachedInquiry = {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  diffSnippet: string;
  codeContent: string;
  slides: InquirySlide[];
  savedForTeam: boolean;
  /** djb2 hash of the file's diff — used for cache invalidation. */
  diffHash: string;
  cachedAt: number;
};

// ---------------------------------------------------------------------------
// Quick action presets — the suggested question chips in the composer.
// ---------------------------------------------------------------------------

export type QuickAction = {
  label: string;                 // display text on the chip
  prompt: string;                // the actual question sent to the AI
};

export const INQUIRY_QUICK_ACTIONS: QuickAction[] = [
  { label: 'How does this work?', prompt: 'How does this code work? Walk me through the logic step by step.' },
  { label: 'Simplify this', prompt: 'Can you explain this code in simpler terms? Dumb it down for me.' },
  { label: 'What calls this?', prompt: 'What other code calls or depends on this? Trace the callers.' },
  { label: 'Another way?', prompt: 'What is another way to write this code? Show me an alternative approach.' },
  { label: 'What could break?', prompt: 'What edge cases or failure modes could break this code?' },
  { label: 'Why this approach?', prompt: 'Why was this approach chosen? What are the tradeoffs compared to alternatives?' },
];
