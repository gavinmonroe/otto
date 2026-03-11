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

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme } from '@/components/ThemeContext';
import type { OttoTheme } from '@/components/ThemeContext';
import type { Components } from 'react-markdown';

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
        return (
          <code style={{
            display: 'block',
            fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
            fontSize: '12px',
            lineHeight: '1.5',
            color: t.isDark ? '#e2e8f0' : '#334155',
          }}>
            {children}
          </code>
        );
      }
      // Inline code
      return (
        <code style={{
          padding: '1px 5px',
          borderRadius: '3px',
          fontSize: '0.9em',
          fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
          background: t.isDark ? '#1e293b' : '#f1f5f9',
          color: t.isDark ? '#e2e8f0' : '#334155',
          border: `1px solid ${t.isDark ? '#334155' : '#e2e8f0'}`,
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
        background: t.isDark ? '#0f172a' : '#f8fafc',
        border: `1px solid ${t.isDark ? '#1e293b' : '#e2e8f0'}`,
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
        background: t.isDark ? '#1e293b' : '#f8fafc',
        borderRadius: '0 4px 4px 0',
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
