// ---------------------------------------------------------------------------
// File Reference Parser — extracts [[filePath:line]] references from AI
// chat responses and provides utilities for rendering them.
//
// Design decisions:
// - The [[...]] syntax was chosen because it doesn't conflict with markdown
//   (no standard markdown uses double brackets), and it's easy to regex.
// - The parser returns FileReference objects with the raw match text so the
//   UI can do string replacement for rendering.
// - Supports three formats:
//   [[filePath]]           — file-level reference (no line)
//   [[filePath:line]]      — single line reference
//   [[filePath:start-end]] — line range reference
// - The strip function removes the [[ ]] wrapper for display in streaming
//   deltas where we haven't yet rendered the full component.
// ---------------------------------------------------------------------------

import type { FileReference } from '@/types/chat';

/**
 * Regex for matching file references in AI responses.
 * Matches: [[path/to/file.ts]], [[path/to/file.ts:42]], [[path/to/file.ts:42-58]]
 *
 * Breakdown:
 * - \[\[          — opening double brackets
 * - ([^\]:]+)     — file path (anything except ] and :)
 * - (?::(\d+)     — optional colon + line number
 *   (?:-(\d+))?   — optional dash + end line number
 * )?
 * - \]\]          — closing double brackets
 */
const FILE_REF_REGEX = /\[\[([^\]:\s]+?)(?::(\d+)(?:-(\d+))?)?\]\]/g;

/**
 * Parse all file references from a markdown string.
 * Returns an array of FileReference objects with their positions.
 */
export function parseFileReferences(text: string): FileReference[] {
  const refs: FileReference[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex since we're reusing the regex
  FILE_REF_REGEX.lastIndex = 0;

  while ((match = FILE_REF_REGEX.exec(text)) !== null) {
    const filePath = match[1];
    const line = match[2] ? parseInt(match[2], 10) : undefined;
    const lineEnd = match[3] ? parseInt(match[3], 10) : undefined;

    refs.push({
      filePath,
      line,
      lineEnd,
      raw: match[0],
    });
  }

  return refs;
}

/**
 * Split markdown text into segments of plain text and file references.
 * Used by the chat message renderer to interleave text with clickable
 * DiffReference components.
 *
 * Returns an array of segments where each is either:
 * - { type: 'text', content: string }
 * - { type: 'ref', ref: FileReference }
 */
export type TextSegment = { type: 'text'; content: string };
export type RefSegment = { type: 'ref'; ref: FileReference };
export type MessageSegment = TextSegment | RefSegment;

export function splitIntoSegments(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  FILE_REF_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FILE_REF_REGEX.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    // Add the reference
    const filePath = match[1];
    const line = match[2] ? parseInt(match[2], 10) : undefined;
    const lineEnd = match[3] ? parseInt(match[3], 10) : undefined;

    segments.push({
      type: 'ref',
      ref: { filePath, line, lineEnd, raw: match[0] },
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments;
}

/**
 * Strip file reference syntax for plain-text display.
 * Converts [[src/foo.ts:42]] → src/foo.ts:42
 * Used during streaming where we show raw text before rendering components.
 */
export function stripFileRefSyntax(text: string): string {
  FILE_REF_REGEX.lastIndex = 0;
  return text.replace(FILE_REF_REGEX, (_match, filePath, line, lineEnd) => {
    if (line && lineEnd) return `${filePath}:${line}-${lineEnd}`;
    if (line) return `${filePath}:${line}`;
    return filePath;
  });
}

/**
 * Convert [[filePath:line]] references into markdown links with a custom
 * protocol: [displayText](otto-ref://filePath:line-lineEnd)
 *
 * This allows the entire content to be rendered through a single Markdown
 * pass without breaking markdown context (bold, lists, etc.). The custom
 * `otto-ref://` protocol is detected by a custom link renderer that swaps
 * in DiffReference components.
 */
export function convertRefsToMarkdownLinks(text: string): string {
  FILE_REF_REGEX.lastIndex = 0;
  return text.replace(FILE_REF_REGEX, (_match, filePath, line, lineEnd) => {
    const fileName = filePath.split('/').pop() || filePath;
    let displayText = fileName;
    let refUrl = `otto-ref://${filePath}`;

    if (line && lineEnd) {
      displayText += `:${line}-${lineEnd}`;
      refUrl += `:${line}-${lineEnd}`;
    } else if (line) {
      displayText += `:${line}`;
      refUrl += `:${line}`;
    }

    // Escape characters that break markdown link syntax:
    // - ] in display text closes the link text prematurely
    // - ) in URL closes the link URL prematurely
    const safeDisplay = displayText.replace(/\]/g, '\\]');
    const safeUrl = refUrl.replace(/\)/g, '%29');

    return `[${safeDisplay}](${safeUrl})`;
  });
}

/**
 * Parse an otto-ref:// URL back into a FileReference.
 * Returns null if the URL doesn't match the expected format.
 */
export function parseOttoRefUrl(url: string): FileReference | null {
  if (!url.startsWith('otto-ref://')) return null;

  // Decode any URL-encoded characters (e.g., %29 for parentheses)
  const ref = decodeURIComponent(url.slice('otto-ref://'.length));
  // Format: filePath or filePath:line or filePath:line-lineEnd
  const match = ref.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
  if (!match) return null;

  return {
    filePath: match[1],
    line: match[2] ? parseInt(match[2], 10) : undefined,
    lineEnd: match[3] ? parseInt(match[3], 10) : undefined,
    raw: url,
  };
}
