// ---------------------------------------------------------------------------
// Syntax Highlighting Service — shared Shiki highlighter for Otto.
//
// Uses Shiki's core API with explicit language/theme imports to keep the
// bundle small. Only loads common web dev languages (~200KB vs ~10MB).
//
// Design decisions:
// - Singleton highlighter, lazily initialized on first use.
// - Uses createHighlighterCore + explicit imports (tree-shakeable).
// - Two themes: github-light + github-dark. Caller picks via isDark.
// - Returns raw HTML strings with inline styles — no external CSS needed.
// - Falls back gracefully: if highlighting fails, returns escaped plain text.
// ---------------------------------------------------------------------------

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// Explicit theme imports (tree-shakeable)
import githubLight from 'shiki/themes/github-light.mjs';
import githubDark from 'shiki/themes/github-dark.mjs';

// Explicit language imports (tree-shakeable) — only common web/backend langs
import langTypescript from 'shiki/langs/typescript.mjs';
import langTsx from 'shiki/langs/tsx.mjs';
import langJavascript from 'shiki/langs/javascript.mjs';
import langJsx from 'shiki/langs/jsx.mjs';
import langJson from 'shiki/langs/json.mjs';
import langYaml from 'shiki/langs/yaml.mjs';
import langHtml from 'shiki/langs/html.mjs';
import langCss from 'shiki/langs/css.mjs';
import langPython from 'shiki/langs/python.mjs';
import langGo from 'shiki/langs/go.mjs';
import langRust from 'shiki/langs/rust.mjs';
import langJava from 'shiki/langs/java.mjs';
import langRuby from 'shiki/langs/ruby.mjs';
import langCsharp from 'shiki/langs/csharp.mjs';
import langBash from 'shiki/langs/bash.mjs';
import langSql from 'shiki/langs/sql.mjs';
import langMarkdown from 'shiki/langs/markdown.mjs';

const LIGHT_THEME = 'github-light';
const DARK_THEME = 'github-dark';

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubLight, githubDark],
      langs: [
        langTypescript, langTsx, langJavascript, langJsx,
        langJson, langYaml, langHtml, langCss,
        langPython, langGo, langRust, langJava, langRuby,
        langCsharp, langBash, langSql, langMarkdown,
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

/**
 * Map file extension to Shiki language ID.
 * Returns null for unknown extensions (caller should fall back).
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
    cs: 'csharp', csx: 'csharp',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    sql: 'sql',
    md: 'markdown', mdx: 'markdown',
  };
  return map[ext] ?? null;
}

/**
 * Highlight a code string and return HTML with inline styles.
 */
export async function highlight(
  code: string,
  lang: string | null,
  isDark: boolean,
): Promise<string> {
  try {
    const highlighter = await getHighlighter();
    const theme = isDark ? DARK_THEME : LIGHT_THEME;
    const loadedLangs = highlighter.getLoadedLanguages();
    const resolvedLang = lang && loadedLangs.includes(lang) ? lang : 'text';

    return highlighter.codeToHtml(code, {
      lang: resolvedLang as any,
      theme,
    });
  } catch {
    return `<pre style="margin:0;padding:8px;overflow:auto"><code>${escapeHtml(code)}</code></pre>`;
  }
}

/**
 * Highlight individual lines and return an array of HTML strings.
 * Used by SuggestionDiff to colorize each line independently.
 */
export async function highlightLines(
  lines: string[],
  lang: string | null,
  isDark: boolean,
): Promise<string[]> {
  try {
    const highlighter = await getHighlighter();
    const theme = isDark ? DARK_THEME : LIGHT_THEME;
    const loadedLangs = highlighter.getLoadedLanguages();
    const resolvedLang = lang && loadedLangs.includes(lang) ? lang : 'text';

    const fullCode = lines.join('\n');
    const tokens = highlighter.codeToTokensBase(fullCode, {
      lang: resolvedLang as any,
      theme,
    });

    return tokens.map((lineTokens) => {
      return lineTokens
        .map((token) => {
          const style = token.color ? `color:${token.color}` : '';
          const escaped = escapeHtml(token.content);
          return style ? `<span style="${style}">${escaped}</span>` : escaped;
        })
        .join('');
    });
  } catch {
    return lines.map(escapeHtml);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
