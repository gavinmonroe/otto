// ---------------------------------------------------------------------------
// ChatPill — the floating trigger button for the MR Q&A chat.
//
// Matches the secondary button style from MrOverviewPanel — flat, compact,
// with a subtle border. Not a bubble.
// ---------------------------------------------------------------------------

import { useTheme } from '@/components/ThemeContext';
import { useChatStore } from '@/services/chat/chat-store';
import { MessageSquare } from 'lucide-react';

export function ChatPill() {
  const theme = useTheme();
  const { isOpen, toggleOpen, messages, status } = useChatStore();

  // Don't render the pill when the panel is open
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
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 14px',
        borderRadius: '6px',
        border: `1px solid ${theme.btnSecondaryBorder}`,
        background: theme.btnSecondaryBg,
        color: theme.btnSecondaryText,
        cursor: 'pointer',
        zIndex: 999998,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '13px',
        fontWeight: 500,
        boxShadow: theme.isDark
          ? '0 2px 8px rgba(0, 0, 0, 0.3)'
          : '0 2px 8px rgba(0, 0, 0, 0.08)',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = theme.brand;
        el.style.color = theme.brand;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = theme.btnSecondaryBorder;
        el.style.color = theme.btnSecondaryText;
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
      {/* Unread indicator */}
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
