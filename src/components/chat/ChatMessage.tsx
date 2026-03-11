// ---------------------------------------------------------------------------
// ChatMessage — renders a single message in the chat conversation.
//
// Redesigned to match Otto's panel design language:
// - User messages: flat block with subtle brand-tinted left border
// - Assistant messages: flat block with markdown rendering
// - No chat bubbles — messages are full-width sections like review panels
// - File references rendered inline via otto-ref:// protocol
// ---------------------------------------------------------------------------

import { useMemo, useCallback } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme } from '@/components/ThemeContext';
import type { OttoTheme } from '@/components/ThemeContext';
import { Markdown } from '@/components/Markdown';
import { DiffReference } from './DiffReference';
import { convertRefsToMarkdownLinks, parseOttoRefUrl, stripFileRefSyntax } from '@/lib/file-reference-parser';
import type { ChatMessage as ChatMessageType } from '@/types/chat';
import type { Components } from 'react-markdown';

type ChatMessageProps = {
  message: ChatMessageType;
};

/**
 * Render a completed chat message (already in the messages array).
 */
export function ChatMessage({ message }: ChatMessageProps) {
  if (message.role === 'user') {
    return <UserBlock content={message.content} />;
  }

  return <AssistantBlock content={message.content} />;
}

/**
 * Render the in-progress streaming delta.
 */
export function StreamingMessage({ delta }: { delta: string }) {
  const theme = useTheme();

  // Strip the suggestions comment if it's partially streamed in
  const cleaned = delta
    .replace(/<!--\s*suggestions:[\s\S]*$/, '')
    .trimEnd();

  // Strip [[filePath:line]] syntax to plain text during streaming
  const displayText = stripFileRefSyntax(cleaned);

  if (!displayText) {
    return (
      <div style={{
        padding: '8px 14px',
        color: theme.textMuted,
        fontSize: '13px',
      }}>
        <span style={{
          display: 'inline-block',
          width: '6px',
          height: '14px',
          background: theme.brand,
          borderRadius: '1px',
          animation: 'otto-chat-cursor 1s step-end infinite',
          verticalAlign: 'text-bottom',
        }} />
      </div>
    );
  }

  return (
    <div style={{
      padding: '8px 14px',
      borderBottom: `1px solid ${theme.borderSubtle}`,
      fontSize: '13px',
      lineHeight: '1.5',
    }}>
      <Markdown content={displayText} compact />
      <span style={{
        display: 'inline-block',
        width: '6px',
        height: '14px',
        background: theme.brand,
        borderRadius: '1px',
        animation: 'otto-chat-cursor 1s step-end infinite',
        verticalAlign: 'text-bottom',
        marginLeft: '2px',
      }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal components
// ---------------------------------------------------------------------------

function UserBlock({ content }: { content: string }) {
  const theme = useTheme();

  return (
    <div style={{
      padding: '8px 14px',
      borderBottom: `1px solid ${theme.borderSubtle}`,
      borderLeft: `3px solid ${theme.brand}`,
      background: theme.isDark ? 'rgba(64, 196, 245, 0.04)' : 'rgba(12, 147, 231, 0.03)',
    }}>
      <div style={{
        fontSize: '11px',
        fontWeight: 600,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        color: theme.textMuted,
        marginBottom: '4px',
      }}>
        You
      </div>
      <div style={{
        fontSize: '13px',
        lineHeight: '1.5',
        color: theme.text,
        wordBreak: 'break-word',
      }}>
        {content}
      </div>
    </div>
  );
}

function AssistantBlock({ content }: { content: string }) {
  const theme = useTheme();

  // Convert [[filePath:line]] references to markdown links with otto-ref:// protocol
  const processedContent = useMemo(() => convertRefsToMarkdownLinks(content), [content]);

  return (
    <div style={{
      padding: '8px 14px',
      borderBottom: `1px solid ${theme.borderSubtle}`,
      fontSize: '13px',
      lineHeight: '1.5',
    }}>
      <ChatMarkdown content={processedContent} />
    </div>
  );
}

/**
 * Chat-specific markdown renderer that intercepts otto-ref:// links
 * and renders them as DiffReference components.
 */
function ChatMarkdown({ content }: { content: string }) {
  const theme = useTheme();

  const urlTransform = useCallback((url: string) => {
    if (url.startsWith('otto-ref://')) return url;
    return defaultUrlTransform(url);
  }, []);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={urlTransform}
      components={buildChatComponents(theme)}
    >
      {content}
    </ReactMarkdown>
  );
}

/**
 * Build react-markdown component overrides for chat messages.
 */
function buildChatComponents(t: OttoTheme): Components {
  return {
    p: ({ children }) => (
      <p style={{ margin: '0 0 4px', lineHeight: '1.6', color: t.text }}>
        {children}
      </p>
    ),
    h1: ({ children }) => (
      <h1 style={{ margin: '4px 0', fontSize: '16px', fontWeight: 700, color: t.text }}>{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 style={{ margin: '4px 0', fontSize: '15px', fontWeight: 700, color: t.text }}>{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 style={{ margin: '4px 0', fontSize: '14px', fontWeight: 600, color: t.text }}>{children}</h3>
    ),
    code: ({ children, className }) => {
      const isBlock = className?.startsWith('language-');
      if (isBlock) {
        return (
          <code style={{
            display: 'block',
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            fontSize: '12px',
            lineHeight: '1.5',
            color: t.isDark ? '#e2e8f0' : '#334155',
          }}>
            {children}
          </code>
        );
      }
      return (
        <code style={{
          padding: '1px 5px',
          borderRadius: '3px',
          fontSize: '0.9em',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          background: t.isDark ? '#1e293b' : '#f1f5f9',
          color: t.isDark ? '#e2e8f0' : '#334155',
          border: `1px solid ${t.isDark ? '#334155' : '#e2e8f0'}`,
        }}>
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre style={{
        margin: '4px 0',
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
    ul: ({ children }) => (
      <ul style={{ margin: '0 0 4px', paddingLeft: '20px', color: t.text }}>{children}</ul>
    ),
    ol: ({ children }) => (
      <ol style={{ margin: '0 0 4px', paddingLeft: '20px', color: t.text }}>{children}</ol>
    ),
    li: ({ children }) => (
      <li style={{ marginBottom: '2px', lineHeight: '1.5' }}>{children}</li>
    ),
    strong: ({ children }) => (
      <strong style={{ fontWeight: 600, color: t.text }}>{children}</strong>
    ),
    em: ({ children }) => (
      <em style={{ color: t.textSecondary }}>{children}</em>
    ),
    blockquote: ({ children }) => (
      <blockquote style={{
        margin: '4px 0',
        padding: '4px 12px',
        borderLeft: `3px solid ${t.brand}`,
        color: t.textSecondary,
        background: t.isDark ? '#1e293b' : '#f8fafc',
        borderRadius: '0 4px 4px 0',
      }}>
        {children}
      </blockquote>
    ),
    hr: () => (
      <hr style={{ margin: '4px 0', border: 'none', borderTop: `1px solid ${t.border}` }} />
    ),
    // Custom link handler — intercepts otto-ref:// URLs for DiffReference
    a: ({ children, href }) => {
      if (href) {
        const ref = parseOttoRefUrl(href);
        if (ref) {
          return <DiffReference reference={ref} />;
        }
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: t.brand, textDecoration: 'underline' }}
        >
          {children}
        </a>
      );
    },
  };
}
