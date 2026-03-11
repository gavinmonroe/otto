// ---------------------------------------------------------------------------
// ChatPill — the floating trigger button for the MR Q&A chat.
//
// Design: A small, elegant bookmark-shaped pill fixed to the bottom-right
// of the viewport. Not a bubble — more of a slim, modern tab/bookmark.
//
// Behavior:
// - Appears once the review has started (or there's MR context available)
// - Click toggles the ChatPanel open/closed
// - Shows a subtle unread indicator when there are new messages and the
//   panel is closed
//
// The pill is intentionally minimal — it shouldn't compete with GitLab's
// own UI elements for attention.
// ---------------------------------------------------------------------------

import { useTheme } from '@/components/ThemeContext';
import { useChatStore } from '@/services/chat/chat-store';
import { MessageSquare } from 'lucide-react';

export function ChatPill() {
  const theme = useTheme();
  const { isOpen, toggleOpen, messages, status } = useChatStore();

  // Don't render the pill when the panel is open — the panel has its own close button
  if (isOpen) return null;

  const hasMessages = messages.length > 0;
  const isStreaming = status === 'streaming';

  return (
    <button
      onClick={toggleOpen}
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 14px',
        borderRadius: '20px',
        border: `1px solid ${theme.isDark ? 'rgba(64, 196, 245, 0.3)' : 'rgba(12, 147, 231, 0.2)'}`,
        background: theme.isDark
          ? 'rgba(31, 41, 55, 0.95)'
          : 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(8px)',
        boxShadow: theme.isDark
          ? '0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2)'
          : '0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04)',
        cursor: 'pointer',
        zIndex: 999998,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '12px',
        fontWeight: 500,
        color: theme.brand,
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.transform = 'translateY(-1px)';
        el.style.boxShadow = theme.isDark
          ? '0 6px 20px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3)'
          : '0 6px 20px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06)';
        el.style.borderColor = theme.brand;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.transform = 'translateY(0)';
        el.style.boxShadow = theme.isDark
          ? '0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2)'
          : '0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04)';
        el.style.borderColor = theme.isDark ? 'rgba(64, 196, 245, 0.3)' : 'rgba(12, 147, 231, 0.2)';
      }}
      title="Ask about this MR"
    >
      <MessageSquare size={14} />
      <span>Ask Otto</span>
      {/* Streaming indicator */}
      {isStreaming && (
        <span style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: theme.brand,
          animation: 'otto-chat-pulse 1.4s ease-in-out infinite',
          flexShrink: 0,
        }} />
      )}
      {/* Unread indicator — show when there are messages and panel was closed */}
      {hasMessages && !isStreaming && (
        <span style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: theme.success,
          flexShrink: 0,
        }} />
      )}
    </button>
  );
}
