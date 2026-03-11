// ---------------------------------------------------------------------------
// Syntax Highlight Client — content script side.
//
// Delegates all highlighting to the service worker via message passing.
// Shiki runs in the service worker (which has no UTF-8 content script
// restriction), and returns HTML strings with inline styles.
//
// This module exposes the same API as the highlighter service so
// consumers don't need to know about the message passing.
// ---------------------------------------------------------------------------

import { sendMessage } from '@/lib/messaging';

/**
 * Map file extension to language ID.
 * Duplicated here to avoid importing the service worker module.
 */
export function extToLang(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx',
    js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
    json: 'json', jsonc: 'json',
    yaml: 'yaml', yml: 'yaml',
    html: 'html', htm: 'html', vue: 'html', svelte: 'html',
    css: 'css', scss: 'css',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    sql: 'sql',
    md: 'markdown', mdx: 'markdown',
  };
  return map[ext] ?? null;
}

/**
 * Highlight a code string via the service worker.
 * Returns HTML with inline styles, or escaped plain text on failure.
 */
export async function highlight(
  code: string,
  lang: string | null,
  isDark: boolean,
): Promise<string> {
  const result = await sendMessage({
    type: 'HIGHLIGHT_CODE',
    payload: { code, lang, isDark },
  });
  if (result.ok) return result.data;
  // Fallback
  return `<pre style="margin:0;padding:8px;overflow:auto"><code>${escapeHtml(code)}</code></pre>`;
}

/**
 * Highlight individual lines via the service worker.
 * Returns an array of HTML strings for each line.
 */
export async function highlightLines(
  lines: string[],
  lang: string | null,
  isDark: boolean,
): Promise<string[]> {
  const result = await sendMessage({
    type: 'HIGHLIGHT_LINES',
    payload: { lines, lang, isDark },
  });
  if (result.ok) return result.data;
  return lines.map(escapeHtml);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
