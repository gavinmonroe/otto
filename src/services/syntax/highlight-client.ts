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
    // Web core
    ts: 'typescript', tsx: 'tsx',
    js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
    json: 'json', jsonc: 'json', json5: 'json',
    yaml: 'yaml', yml: 'yaml',
    html: 'html', htm: 'html',
    css: 'css',
    // Frontend frameworks
    vue: 'vue',
    svelte: 'svelte',
    scss: 'scss', sass: 'scss',
    less: 'less',
    // Backend / scripting
    py: 'python', pyw: 'python', pyi: 'python',
    rb: 'ruby', rake: 'ruby', gemspec: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cs: 'csharp', csx: 'csharp',
    php: 'php',
    pl: 'perl', pm: 'perl',
    lua: 'lua',
    r: 'r', R: 'r',
    ex: 'elixir', exs: 'elixir', heex: 'elixir',
    scala: 'scala', sc: 'scala',
    clj: 'clojure', cljs: 'clojure', cljc: 'clojure', edn: 'clojure',
    hs: 'haskell', lhs: 'haskell',
    erl: 'erlang', hrl: 'erlang',
    // Systems / native
    c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp', hh: 'cpp',
    swift: 'swift',
    kt: 'kotlin', kts: 'kotlin',
    dart: 'dart',
    m: 'objective-c', mm: 'objective-c',
    // Config / infra
    sh: 'bash', bash: 'bash', zsh: 'bash',
    sql: 'sql',
    md: 'markdown', mdx: 'markdown',
    toml: 'toml',
    xml: 'xml', xsl: 'xml', xslt: 'xml', svg: 'xml', plist: 'xml',
    dockerfile: 'dockerfile',
    graphql: 'graphql', gql: 'graphql',
    tf: 'terraform', tfvars: 'terraform', hcl: 'terraform',
    nginx: 'nginx', conf: 'nginx',
    ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
    // Data / misc
    csv: 'csv', tsv: 'csv',
    diff: 'diff', patch: 'diff',
    tex: 'latex', latex: 'latex',
  };
  return map[ext] ?? null;
}

/**
 * Resolve the effective language for syntax highlighting.
 *
 * For most files, this is just `extToLang`. But for multi-language files
 * like Vue and Svelte, diff hunks are fragments that lack the full
 * `<template>`/`<script>`/`<style>` structure. Shiki's Vue grammar can't
 * determine the section from a fragment, producing unhighlighted output.
 *
 * This function inspects the code content to detect which section the
 * fragment belongs to and returns the appropriate sub-language.
 */
export function resolveEffectiveLang(filePath: string, codeLines: string[]): string | null {
  const baseLang = extToLang(filePath);

  // Only apply section detection for multi-language file types
  if (baseLang !== 'vue' && baseLang !== 'svelte') return baseLang;

  // Scan the lines to detect which section this fragment is in.
  // Check for section tags in the content (including diff context lines).
  let lastSection: 'template' | 'script' | 'style' | null = null;

  for (const line of codeLines) {
    const trimmed = line.trim();

    if (trimmed.match(/^<template[\s>]/)) { lastSection = 'template'; }
    else if (trimmed.match(/^<script[\s>]/)) { lastSection = 'script'; }
    else if (trimmed.match(/^<style[\s>]/)) { lastSection = 'style'; }
    else if (trimmed === '</template>') { lastSection = null; }
    else if (trimmed === '</script>') { lastSection = null; }
    else if (trimmed === '</style>') { lastSection = null; }
  }

  // If we found a section tag, use the last one we saw
  if (lastSection === 'template') return 'html';
  if (lastSection === 'script') return 'typescript';
  if (lastSection === 'style') return 'css';

  // No section tags found — use heuristic detection from content.
  // Score each language based on pattern matches.
  const joined = codeLines.join('\n');

  let templateScore = 0;
  let scriptScore = 0;
  let styleScore = 0;

  // Template indicators — Vue/Svelte directives and HTML structure
  const templatePatterns = [
    /v-if\b/, /v-for\b/, /v-else\b/, /v-show\b/, /v-model\b/, /v-bind\b/, /v-on\b/,
    /v-slot\b/, /v-html\b/, /v-text\b/,
    /:[a-z-]+="/, /@[a-z]+="/, /\{\{.*\}\}/,  // :prop, @event, {{ interpolation }}
    /<\/?\w+[^>]*>/, // HTML tags
    /class="/, /style="/, /id="/,
    /\{#if\b/, /\{#each\b/, /\{:else\b/, /\{\/if\b/, /\{\/each\b/, // Svelte blocks
    /on:[a-z]+\b/, // Svelte events
  ];

  // Script indicators — JS/TS code patterns
  const scriptPatterns = [
    /\bimport\s/, /\bexport\s/, /\bfrom\s+['"]/, /\brequire\s*\(/,
    /\bconst\s/, /\blet\s/, /\bvar\s/, /\bfunction\s/, /\bclass\s/,
    /\binterface\s/, /\btype\s+\w/, /\benum\s/,
    /\breturn\s/, /\bawait\s/, /\basync\s/,
    /\bthis\./, /\bthis\$/, /\bself\./,
    /\bconsole\./, /\bwindow\./, /\bdocument\./,
    /=>\s*\{/, /\bif\s*\(/, /\bfor\s*\(/, /\bwhile\s*\(/,
    /\bnew\s+\w/, /\btry\s*\{/, /\bcatch\s*\(/,
    /\bdefineComponent\b/, /\bdefineProps\b/, /\bdefineEmits\b/, /\bref\s*\(/, /\bcomputed\s*\(/,
    /\breactive\s*\(/, /\bwatch\s*\(/, /\bonMounted\b/, /\bonUnmounted\b/,
    /\bdata\s*\(\)/, /\bmethods\s*:/, /\bcomputed\s*:/, /\bprops\s*:/, /\bwatch\s*:/,
    /\bmounted\s*\(\)/, /\bcreated\s*\(\)/, /\bemits\s*:/,
    /\.\$emit\b/, /\.\$refs\b/, /\.\$route\b/, /\.\$store\b/, /\.\$nextTick\b/,
  ];

  // Style indicators — CSS patterns
  const stylePatterns = [
    /[{};].*[{};]/, // Multiple braces/semicolons
    /:\s*[^;]+;/, // property: value;
    /\.\w+\s*\{/, // .class {
    /#\w+\s*\{/, // #id {
    /@media\b/, /@import\b/, /@keyframes\b/,
    /\bmargin\b/, /\bpadding\b/, /\bdisplay\b/, /\bposition\b/, /\bcolor\b/,
    /\bflex\b/, /\bgrid\b/, /\bwidth\b/, /\bheight\b/,
  ];

  for (const p of templatePatterns) { if (p.test(joined)) templateScore++; }
  for (const p of scriptPatterns) { if (p.test(joined)) scriptScore++; }
  for (const p of stylePatterns) { if (p.test(joined)) styleScore++; }

  // Pick the highest-scoring language
  if (scriptScore >= templateScore && scriptScore >= styleScore) return 'typescript';
  if (templateScore >= styleScore) return 'html';
  if (styleScore > 0) return 'css';

  // Default to typescript for Vue/Svelte — script sections are the most common
  // diff target and TS grammar handles JS fine
  return 'typescript';
}
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
