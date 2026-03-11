// ---------------------------------------------------------------------------
// Chat types — data structures for the MR Q&A chat feature.
//
// Design decisions:
// - ChatMessage mirrors the AI client's ChatMessage shape but adds metadata
//   (id, timestamp) for UI rendering and conversation tracking.
// - SuggestedQuestion is a simple label/question pair — the label is what
//   the user sees, the question is what gets sent to the AI.
// - FileReference is parsed from AI responses (the [[filePath:line]] syntax)
//   and used to render clickable diff links in the chat UI.
// - The chat is ephemeral per page load (same as the review store) — no
//   persistence across navigations. The review context changes with each MR.
// ---------------------------------------------------------------------------

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

export type SuggestedQuestion = {
  label: string;
  question: string;
};

export type FileReference = {
  filePath: string;
  line?: number;
  lineEnd?: number;
  /** The raw matched text from the AI response, e.g. "[[src/foo.ts:42]]" */
  raw: string;
};

export type ChatStatus = 'idle' | 'streaming' | 'error';
