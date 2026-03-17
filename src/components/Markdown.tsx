// ---------------------------------------------------------------------------
// Markdown renderer — renders AI-generated markdown content with proper
// syntax highlighting, code blocks, lists, tables, etc.
//
// Used by all components that display AI-generated text (review comments,
// summaries, edge case descriptions, etc.)
//
// Design decisions:
// - Uses react-markdown with remark-gfm for GitHub-flavored markdown
// - Custom renderers for code blocks with syntax-aware styling
// - Theme-aware: all colors come from the ThemeContext
// - Compact styling to fit within the diff page context
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme } from '@/components/ThemeContext';
import type { OttoTheme } from '@/components/ThemeContext';
import type { Components } from 'react-markdown';
import { highlight } from '@/services/syntax/highlight-client';

type MarkdownProps = {
  content: string;
  compact?: boolean;  // Tighter spacing for inline use (e.g., comment bodies)
};

export function Markdown({ content, compact = false }: MarkdownProps) {
  const theme = useTheme();
  const components = buildComponents(theme, compact);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}

function buildComponents(t: OttoTheme, compact: boolean): Components {
  const spacing = compact ? '4px' : '8px';

  return {
    // Paragraphs
    p: ({ children }) => (
      <p style={{ margin: `0 0 ${spacing}`, lineHeight: '1.6', color: t.text }}>
        {children}
      </p>
    ),

    // Headings
    h1: ({ children }) => (
      <h1 style={{ margin: `${spacing} 0`, fontSize: '16px', fontWeight: 700, color: t.text }}>
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 style={{ margin: `${spacing} 0`, fontSize: '15px', fontWeight: 700, color: t.text }}>
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 style={{ margin: `${spacing} 0`, fontSize: '14px', fontWeight: 600, color: t.text }}>
        {children}
      </h3>
    ),

    // Inline code
    code: ({ children, className }) => {
      const isBlock = className?.startsWith('language-');
      if (isBlock) {
        const lang = className?.replace('language-', '') || '';
        const code = extractText(children);
        return <ShikiCodeBlock code={code} lang={lang} theme={t} />;
      }
      // Inline code
      return (
        <code style={{
          padding: '1px 5px',
          borderRadius: '4px',
          fontSize: '0.9em',
          fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
          background: t.bgMuted,
          color: t.text,
          border: `1px solid ${t.border}`,
        }}>
          {children}
        </code>
      );
    },

    // Code blocks (pre wraps code)
    pre: ({ children }) => (
      <pre style={{
        margin: `${spacing} 0`,
        padding: '10px 12px',
        borderRadius: '6px',
        background: t.bgSubtle,
        border: `1px solid ${t.border}`,
        overflow: 'auto',
        maxHeight: '300px',
        fontSize: '12px',
        lineHeight: '1.5',
      }}>
        {children}
      </pre>
    ),

    // Lists
    ul: ({ children }) => (
      <ul style={{
        margin: `0 0 ${spacing}`,
        paddingLeft: '20px',
        color: t.text,
      }}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol style={{
        margin: `0 0 ${spacing}`,
        paddingLeft: '20px',
        color: t.text,
      }}>
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li style={{ marginBottom: '2px', lineHeight: '1.5' }}>
        {children}
      </li>
    ),

    // Bold / italic
    strong: ({ children }) => (
      <strong style={{ fontWeight: 600, color: t.text }}>{children}</strong>
    ),
    em: ({ children }) => (
      <em style={{ color: t.textSecondary }}>{children}</em>
    ),

    // Links
    a: ({ children, href }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: t.brand, textDecoration: 'underline' }}
      >
        {children}
      </a>
    ),

    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote style={{
        margin: `${spacing} 0`,
        padding: '4px 12px',
        borderLeft: `3px solid ${t.brand}`,
        color: t.textSecondary,
        background: t.bgSubtle,
        borderRadius: '0 6px 6px 0',
      }}>
        {children}
      </blockquote>
    ),

    // Tables (GFM)
    table: ({ children }) => (
      <div style={{ overflow: 'auto', margin: `${spacing} 0` }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '12px',
          color: t.text,
        }}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead style={{ background: t.bgSubtle }}>
        {children}
      </thead>
    ),
    th: ({ children }) => (
      <th style={{
        padding: '6px 10px',
        textAlign: 'left',
        fontWeight: 600,
        borderBottom: `2px solid ${t.border}`,
      }}>
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td style={{
        padding: '6px 10px',
        borderBottom: `1px solid ${t.borderSubtle}`,
      }}>
        {children}
      </td>
    ),

    // Horizontal rule
    hr: () => (
      <hr style={{
        margin: `${spacing} 0`,
        border: 'none',
        borderTop: `1px solid ${t.border}`,
      }} />
    ),
  };
}

// ---------------------------------------------------------------------------
// ShikiCodeBlock — async syntax-highlighted code block
// ---------------------------------------------------------------------------

export function ShikiCodeBlock({ code, lang, theme }: { code: string; lang: string; theme: OttoTheme }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlight(code, lang || null, theme.isDark).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [code, lang, theme.isDark]);

  if (html) {
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }

  // Fallback while Shiki loads
  return (
    <code style={{
      display: 'block',
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: '12px',
      lineHeight: '1.5',
      color: theme.text,
    }}>
      {code}
    </code>
  );
}

// ---------------------------------------------------------------------------
// Extract plain text from React children (react-markdown passes nodes)
// ---------------------------------------------------------------------------

export function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return String(children ?? '');
}
