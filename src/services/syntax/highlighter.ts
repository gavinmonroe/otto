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

// Explicit language imports (tree-shakeable) — broad coverage for real-world repos
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
// Frontend frameworks
import langVue from 'shiki/langs/vue.mjs';
import langSvelte from 'shiki/langs/svelte.mjs';
import langScss from 'shiki/langs/scss.mjs';
import langLess from 'shiki/langs/less.mjs';
// Systems / native
import langC from 'shiki/langs/c.mjs';
import langCpp from 'shiki/langs/cpp.mjs';
import langSwift from 'shiki/langs/swift.mjs';
import langKotlin from 'shiki/langs/kotlin.mjs';
import langDart from 'shiki/langs/dart.mjs';
import langObjectiveC from 'shiki/langs/objective-c.mjs';
// Backend / scripting
import langPhp from 'shiki/langs/php.mjs';
import langPerl from 'shiki/langs/perl.mjs';
import langLua from 'shiki/langs/lua.mjs';
import langR from 'shiki/langs/r.mjs';
import langElixir from 'shiki/langs/elixir.mjs';
import langScala from 'shiki/langs/scala.mjs';
import langClojure from 'shiki/langs/clojure.mjs';
import langHaskell from 'shiki/langs/haskell.mjs';
import langErlang from 'shiki/langs/erlang.mjs';
// Config / infra
import langToml from 'shiki/langs/toml.mjs';
import langXml from 'shiki/langs/xml.mjs';
import langDockerfile from 'shiki/langs/dockerfile.mjs';
import langGraphql from 'shiki/langs/graphql.mjs';
import langTerraform from 'shiki/langs/terraform.mjs';
import langNginx from 'shiki/langs/nginx.mjs';
import langPowershell from 'shiki/langs/powershell.mjs';
// Data / misc
import langCsv from 'shiki/langs/csv.mjs';
import langDiff from 'shiki/langs/diff.mjs';
import langLatex from 'shiki/langs/latex.mjs';

const LIGHT_THEME = 'github-light';
const DARK_THEME = 'github-dark';

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubLight, githubDark],
      langs: [
        // Web core
        langTypescript, langTsx, langJavascript, langJsx,
        langJson, langYaml, langHtml, langCss,
        // Frontend frameworks
        langVue, langSvelte, langScss, langLess,
        // Backend / scripting
        langPython, langGo, langRust, langJava, langRuby,
        langCsharp, langPhp, langPerl, langLua, langR,
        langElixir, langScala, langClojure, langHaskell, langErlang,
        // Systems / native
        langC, langCpp, langSwift, langKotlin, langDart, langObjectiveC,
        // Config / infra
        langBash, langSql, langMarkdown,
        langToml, langXml, langDockerfile, langGraphql,
        langTerraform, langNginx, langPowershell,
        // Data / misc
        langCsv, langDiff, langLatex,
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
