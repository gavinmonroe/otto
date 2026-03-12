// ---------------------------------------------------------------------------
// Keyboard Manager — handles keyboard shortcuts for Otto review navigation.
//
// Design decisions:
// - Listens on document (not shadow DOM) so shortcuts work regardless of focus.
// - Disabled when the user is typing in an input, textarea, or contenteditable.
// - Tracks a "focused comment" index for j/k navigation.
// - Scrolls the focused comment into view and highlights it briefly.
// - All actions delegate to the review store — no direct DOM manipulation.
// - Cleanup via AbortSignal for proper lifecycle management.
//
// Shortcut scheme (avoids GitLab's built-in shortcuts):
//   j / k       — next / previous review comment
//   J / K       — next / previous file (in review queue order)
//   a           — accept focused comment
//   d           — dismiss focused comment
//   e           — edit focused comment
//   c           — open chat about focused comment
//   Escape      — clear focus / close expanded comment
//   ?           — toggle shortcut help
// ---------------------------------------------------------------------------

import { useReviewStore } from '@/services/review/review-store';
import type { ReviewComment } from '@/types/review';

type KeyboardManagerState = {
  focusedCommentIndex: number;  // -1 = no focus
  helpVisible: boolean;
};

let state: KeyboardManagerState = {
  focusedCommentIndex: -1,
  helpVisible: false,
};

// Callbacks for UI integration (set by the content script)
let onFocusChange: ((comment: ReviewComment | null, index: number) => void) | null = null;
let onToggleHelp: ((visible: boolean) => void) | null = null;
let onOpenChat: ((comment: ReviewComment) => void) | null = null;
let onEditComment: ((comment: ReviewComment) => void) | null = null;

/**
 * Start listening for keyboard shortcuts.
 * Returns a cleanup function.
 */
export function startKeyboardManager(
  signal: AbortSignal,
  callbacks: {
    onFocusChange?: (comment: ReviewComment | null, index: number) => void;
    onToggleHelp?: (visible: boolean) => void;
    onOpenChat?: (comment: ReviewComment) => void;
    onEditComment?: (comment: ReviewComment) => void;
  } = {},
): void {
  onFocusChange = callbacks.onFocusChange ?? null;
  onToggleHelp = callbacks.onToggleHelp ?? null;
  onOpenChat = callbacks.onOpenChat ?? null;
  onEditComment = callbacks.onEditComment ?? null;

  state = { focusedCommentIndex: -1, helpVisible: false };

  document.addEventListener('keydown', handleKeyDown, { signal });
}

/**
 * Get all review comments in review-queue order (by file priority, then severity).
 * This is the canonical ordering for j/k navigation.
 */
function getAllComments(): ReviewComment[] {
  const store = useReviewStore.getState();
  if (store.status !== 'complete' || store.fileReviews.length === 0) return [];

  // Flatten all comments, preserving file order (which matches review queue)
  return store.fileReviews.flatMap((fr) => fr.comments);
}

function handleKeyDown(event: KeyboardEvent): void {
  // Don't intercept when typing in inputs
  if (isTyping(event)) return;

  // Don't intercept when modifier keys are held (except Shift for J/K)
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const store = useReviewStore.getState();
  if (store.status !== 'complete') return;

  switch (event.key) {
    case 'j':
      event.preventDefault();
      navigateComment(1);
      break;
    case 'k':
      event.preventDefault();
      navigateComment(-1);
      break;
    case 'J':
      event.preventDefault();
      navigateFile(1);
      break;
    case 'K':
      event.preventDefault();
      navigateFile(-1);
      break;
    case 'a':
      event.preventDefault();
      actOnFocused('accepted');
      break;
    case 'd':
      event.preventDefault();
      actOnFocused('dismissed');
      break;
    case 'e':
      event.preventDefault();
      editFocused();
      break;
    case 'c':
      event.preventDefault();
      chatAboutFocused();
      break;
    case 'Escape':
      event.preventDefault();
      clearFocus();
      break;
    case '?':
      event.preventDefault();
      toggleHelp();
      break;
  }
}

function navigateComment(direction: 1 | -1): void {
  const comments = getAllComments();
  if (comments.length === 0) return;

  let newIndex = state.focusedCommentIndex + direction;

  // Wrap around
  if (newIndex < 0) newIndex = comments.length - 1;
  if (newIndex >= comments.length) newIndex = 0;

  state.focusedCommentIndex = newIndex;
  const comment = comments[newIndex];

  onFocusChange?.(comment, newIndex);
  scrollToComment(comment);
}

function navigateFile(direction: 1 | -1): void {
  const store = useReviewStore.getState();
  const fileReviews = store.fileReviews;
  if (fileReviews.length === 0) return;

  const comments = getAllComments();
  if (comments.length === 0) return;

  // Find which file the current comment belongs to
  const currentComment = state.focusedCommentIndex >= 0
    ? comments[state.focusedCommentIndex]
    : null;

  const currentFileIndex = currentComment
    ? fileReviews.findIndex((fr) => fr.filePath === currentComment.filePath)
    : -1;

  let newFileIndex = currentFileIndex + direction;
  if (newFileIndex < 0) newFileIndex = fileReviews.length - 1;
  if (newFileIndex >= fileReviews.length) newFileIndex = 0;

  // Jump to the first comment in the target file
  const targetFile = fileReviews[newFileIndex];
  if (targetFile.comments.length === 0) return;

  const firstCommentInFile = targetFile.comments[0];
  const globalIndex = comments.findIndex((c) => c.id === firstCommentInFile.id);

  if (globalIndex >= 0) {
    state.focusedCommentIndex = globalIndex;
    onFocusChange?.(firstCommentInFile, globalIndex);
    scrollToComment(firstCommentInFile);
  }
}

function actOnFocused(status: 'accepted' | 'dismissed'): void {
  const comments = getAllComments();
  if (state.focusedCommentIndex < 0 || state.focusedCommentIndex >= comments.length) return;

  const comment = comments[state.focusedCommentIndex];
  if (comment.status === status) return; // Already in this state

  const store = useReviewStore.getState();
  store.updateCommentStatus(comment.id, status);

  // If accepting, copy to clipboard (same behavior as ReviewActions)
  if (status === 'accepted') {
    const textToCopy = comment.suggestionSummary || comment.body;
    navigator.clipboard.writeText(textToCopy).catch(() => {});
  }

  // Auto-advance to next comment
  navigateComment(1);
}

function editFocused(): void {
  const comments = getAllComments();
  if (state.focusedCommentIndex < 0 || state.focusedCommentIndex >= comments.length) return;
  onEditComment?.(comments[state.focusedCommentIndex]);
}

function chatAboutFocused(): void {
  const comments = getAllComments();
  if (state.focusedCommentIndex < 0 || state.focusedCommentIndex >= comments.length) return;
  onOpenChat?.(comments[state.focusedCommentIndex]);
}

function clearFocus(): void {
  if (state.helpVisible) {
    state.helpVisible = false;
    onToggleHelp?.(false);
    return;
  }

  state.focusedCommentIndex = -1;
  onFocusChange?.(null, -1);
}

function toggleHelp(): void {
  state.helpVisible = !state.helpVisible;
  onToggleHelp?.(state.helpVisible);
}

/**
 * Scroll to a comment in the diff view.
 * Finds the Otto inline comment or file footer comment by data attribute.
 */
function scrollToComment(comment: ReviewComment): void {
  // Try to find the inline comment element first
  const selector = `[data-otto-comment-id="${comment.id}"]`;
  const el = document.querySelector(selector)
    // Also check inside shadow roots
    ?? findInShadowRoots(selector);

  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Brief highlight
    const htmlEl = el as HTMLElement;
    const originalOutline = htmlEl.style.outline;
    htmlEl.style.outline = '2px solid #6366f1';
    htmlEl.style.outlineOffset = '2px';
    setTimeout(() => {
      htmlEl.style.outline = originalOutline;
      htmlEl.style.outlineOffset = '';
    }, 1500);
    return;
  }

  // Fallback: scroll to the file in the diff
  if (comment.filePath) {
    const fileEl = document.querySelector(`[data-path="${comment.filePath}"]`)
      ?? document.getElementById(`diff-content-${comment.filePath.replace(/[/.]/g, '-')}`);
    if (fileEl) {
      fileEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

/**
 * Search for an element inside shadow roots (Otto injects into shadow DOM).
 */
function findInShadowRoots(selector: string): Element | null {
  const shadowHosts = document.querySelectorAll('[data-otto-shadow]');
  for (const host of shadowHosts) {
    if (host.shadowRoot) {
      const found = host.shadowRoot.querySelector(selector);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Check if the user is currently typing in an input field.
 */
function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;

  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
  if (target.isContentEditable) return true;

  // Also check if we're inside a shadow root input
  const composed = event.composedPath();
  for (const el of composed) {
    if (el instanceof HTMLElement) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return true;
      if (el.isContentEditable) return true;
    }
  }

  return false;
}

/**
 * Get the current keyboard shortcut map for display in a help overlay.
 */
export const SHORTCUT_MAP = [
  { key: 'j', description: 'Next comment' },
  { key: 'k', description: 'Previous comment' },
  { key: 'J', description: 'Next file' },
  { key: 'K', description: 'Previous file' },
  { key: 'a', description: 'Accept comment' },
  { key: 'd', description: 'Dismiss comment' },
  { key: 'e', description: 'Edit comment' },
  { key: 'c', description: 'Chat about comment' },
  { key: 'Esc', description: 'Clear focus / close' },
  { key: '?', description: 'Toggle this help' },
] as const;
