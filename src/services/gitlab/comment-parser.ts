// ---------------------------------------------------------------------------
// Comment Parser — extracts discussion thread data from GitLab's DOM.
//
// Runs in the content script context. Walks the DOM from a clicked button
// upward to find the discussion container, then extracts all notes in the
// thread along with any inline diff context (file path, line range).
//
// Design decisions:
// - DOM-first approach: we parse what's on the page rather than requiring
//   an API call. This works even without a configured GitLab host/PAT.
// - Multiple selector strategies for different GitLab versions (same
//   pattern as inline-injector.ts and diff-parser.ts).
// - computeThreadHash() uses the same djb2 variant as review-cache.ts
//   so follow-up cache invalidation is consistent.
// - Falls back gracefully: if we can't find a discussion container, we
//   treat the single note element as the entire thread.
// ---------------------------------------------------------------------------

import type { ThreadContext, ThreadNote } from '@/types/followup';

/**
 * Parse a full discussion thread starting from an element inside a note.
 * Walks up the DOM to find the discussion container, then extracts all notes.
 *
 * @param noteElement - Any element inside a GitLab note (e.g., the Otto button)
 */
export function parseCommentThread(noteElement: HTMLElement): ThreadContext | null {
  // Walk up to find the discussion container
  const discussion = noteElement.closest(
    '.discussion, .note-discussion, [data-discussion-id], .timeline-entry',
  );

  // If no discussion wrapper, try the individual note
  const noteContainer = noteElement.closest(
    '.note, .timeline-entry, [data-note-id], .note-body',
  );

  if (!discussion && !noteContainer) return null;

  const container = discussion || noteContainer!;

  // Extract discussion ID
  const discussionId = extractDiscussionId(container);

  // Extract all notes in the thread
  const noteElements = discussion
    ? Array.from(discussion.querySelectorAll('.note, [data-note-id], .timeline-entry-inner'))
    : noteContainer
      ? [noteContainer]
      : [];

  const notes: ThreadNote[] = [];
  for (const el of noteElements) {
    const note = parseNoteElement(el as HTMLElement);
    if (note) notes.push(note);
  }

  if (notes.length === 0) return null;

  // Determine if this is an inline diff comment
  const { filePath, lineRange, diffSnippet } = extractInlineContext(container);

  return {
    discussionId: discussionId || `dom-${notes[0].id}`,
    notes,
    filePath,
    lineRange,
    diffSnippet,
  };
}

/**
 * Compute a hash of all note bodies in a thread for cache invalidation.
 * New replies change the hash, causing a cache miss.
 */
export function computeThreadHash(notes: ThreadNote[]): string {
  const content = notes.map((n) => `${n.id}:${n.body}`).join('\n');
  return simpleHash(content);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractDiscussionId(container: Element): string | null {
  // data-discussion-id is the most reliable
  const fromAttr = container.getAttribute('data-discussion-id');
  if (fromAttr) return fromAttr;

  // Some GitLab versions use id="discussion_<hash>"
  const id = container.id;
  if (id && id.startsWith('discussion_')) return id.replace('discussion_', '');

  // Try finding it on a child element
  const child = container.querySelector('[data-discussion-id]');
  if (child) return child.getAttribute('data-discussion-id');

  return null;
}

function parseNoteElement(el: HTMLElement): ThreadNote | null {
  // Extract note ID
  const noteId =
    el.getAttribute('data-note-id') ||
    el.id?.replace('note_', '') ||
    el.querySelector('[data-note-id]')?.getAttribute('data-note-id') ||
    '';

  if (!noteId) {
    // Last resort: generate a pseudo-ID from content hash
    const body = extractNoteBody(el);
    if (!body) return null;
    return {
      id: `dom-${simpleHash(body)}`,
      author: extractAuthor(el),
      body,
      timestamp: extractTimestamp(el),
    };
  }

  const body = extractNoteBody(el);
  if (!body) return null;

  return {
    id: noteId,
    author: extractAuthor(el),
    body,
    timestamp: extractTimestamp(el),
  };
}

function extractNoteBody(el: HTMLElement): string | null {
  // GitLab renders note content in .note-text or .md
  const noteText = el.querySelector('.note-text, .md, .note-body .md');
  if (noteText) return noteText.textContent?.trim() || null;

  // Fallback: the element itself might be the note body
  const directText = el.querySelector('.note-body');
  if (directText) return directText.textContent?.trim() || null;

  return null;
}

function extractAuthor(el: HTMLElement): string {
  // Try multiple selectors for the author name
  const authorEl =
    el.querySelector('.note-header-author-name') ||
    el.querySelector('.author-link') ||
    el.querySelector('[data-user-id]') ||
    el.querySelector('.note-header a');

  if (authorEl) {
    return authorEl.textContent?.trim() || 'Unknown';
  }

  return 'Unknown';
}

function extractTimestamp(el: HTMLElement): string {
  const timeEl = el.querySelector('time, .note-created-ago, .js-timeago');
  if (timeEl) {
    // Prefer the datetime attribute (ISO format) over display text
    return timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || '';
  }
  return '';
}

/**
 * Extract inline diff context if this discussion is attached to a code line.
 */
function extractInlineContext(container: Element): {
  filePath: string | null;
  lineRange: { start: number; end: number } | null;
  diffSnippet: string | null;
} {
  const result = { filePath: null as string | null, lineRange: null as { start: number; end: number } | null, diffSnippet: null as string | null };

  // Check if this discussion lives inside a .diff-file
  const diffFile = container.closest('.diff-file');
  if (!diffFile) return result;

  result.filePath = diffFile.getAttribute('data-path') || null;

  // Try to extract line info from the discussion's position data
  const positionData = container.getAttribute('data-line-code') ||
    container.querySelector('[data-line-code]')?.getAttribute('data-line-code');

  if (positionData) {
    // GitLab line codes look like: "<file_hash>_<old_line>_<new_line>"
    const parts = positionData.split('_');
    if (parts.length >= 3) {
      const newLine = parseInt(parts[parts.length - 1], 10);
      const oldLine = parseInt(parts[parts.length - 2], 10);
      const line = newLine || oldLine;
      if (line > 0) {
        result.lineRange = { start: line, end: line };
      }
    }
  }

  // Try to grab the diff hunk that the comment is attached to
  // GitLab shows a code snippet above inline discussion threads
  const diffSnippetEl = container.closest('.notes_holder')?.previousElementSibling;
  if (diffSnippetEl) {
    const codeLines = diffSnippetEl.querySelectorAll('.line_content, .diff-td.line_content');
    if (codeLines.length > 0) {
      result.diffSnippet = Array.from(codeLines)
        .map((line) => line.textContent || '')
        .join('\n');
    }
  }

  return result;
}

/**
 * Fast non-cryptographic string hash (djb2 variant).
 * Same implementation as review-cache.ts for consistency.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
