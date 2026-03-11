// ---------------------------------------------------------------------------
// ChatPanel — the main chat interface that expands from the ChatPill.
//
// Features:
// - Message list with auto-scroll on new content
// - Text input with Enter to send, Shift+Enter for newline
// - Suggested questions (starters or AI-generated)
// - Draggable on x-axis along the bottom edge
// - Streaming indicator with blinking cursor
// - Error display with retry
//
// Design decisions:
// - Fixed position, anchored to bottom of viewport. The panelX value
//   controls horizontal position (stored in chat store).
// - Drag uses pointer events (not mouse events) for better touch support
//   and pointer capture for smooth dragging.
// - Auto-scroll uses a ref + useEffect that triggers on delta/message changes.
// - The panel renders inside shadow DOM (mounted by content script), so
//   all styles are inline via useTheme().
// ---------------------------------------------------------------------------

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, MessageSquare, AlertCircle, RotateCcw } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { useChatStore } from '@/services/chat/chat-store';
import { sendChatMessage, cancelChatStream, retryChatMessage } from '@/services/chat/chat-stream-dispatcher';
import { ChatMessage, StreamingMessage } from './ChatMessage';
import { SuggestedQuestions, STARTER_QUESTIONS } from './SuggestedQuestions';

const PANEL_WIDTH = 400;
const PANEL_HEIGHT = 520;
const PANEL_MARGIN = 16;

export function ChatPanel() {
  const theme = useTheme();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    currentDelta,
    status,
    error,
    suggestedQuestions,
    isOpen,
    panelX,
    setOpen,
    setPanelX,
  } = useChatStore();

  const [inputValue, setInputValue] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startPanelX: number } | null>(null);

  const isStreaming = status === 'streaming';
  const hasMessages = messages.length > 0;

  // Auto-scroll to bottom on new messages or streaming deltas
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, currentDelta]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;

    setInputValue('');
    sendChatMessage(trimmed);
  }, [inputValue, isStreaming]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleSuggestedQuestion = useCallback((question: string) => {
    if (isStreaming) return;
    sendChatMessage(question);
  }, [isStreaming]);

  const handleRetry = useCallback(() => {
    retryChatMessage();
  }, []);

  // ---------------------------------------------------------------------------
  // Drag handling (x-axis only)
  // ---------------------------------------------------------------------------

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    // Only drag from the header area
    if ((e.target as HTMLElement).closest('button')) return;

    setIsDragging(true);
    const currentX = panelX ?? (window.innerWidth - PANEL_WIDTH - PANEL_MARGIN);
    dragStartRef.current = { startX: e.clientX, startPanelX: currentX };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [panelX]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;

    const deltaX = e.clientX - dragStartRef.current.startX;
    const newX = dragStartRef.current.startPanelX + deltaX;

    // Clamp to viewport
    const minX = PANEL_MARGIN;
    const maxX = window.innerWidth - PANEL_WIDTH - PANEL_MARGIN;
    setPanelX(Math.max(minX, Math.min(maxX, newX)));
  }, [isDragging, setPanelX]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  if (!isOpen) return null;

  // Compute position — clamp to viewport in case window was resized after drag
  const defaultX = window.innerWidth - PANEL_WIDTH - PANEL_MARGIN;
  const maxX = Math.max(PANEL_MARGIN, window.innerWidth - PANEL_WIDTH - PANEL_MARGIN);
  const left = Math.max(PANEL_MARGIN, Math.min(panelX ?? defaultX, maxX));

  // Determine which suggestions to show
  const displayedSuggestions = hasMessages ? suggestedQuestions : STARTER_QUESTIONS;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        bottom: PANEL_MARGIN,
        left: `${left}px`,
        width: `${PANEL_WIDTH}px`,
        height: `${PANEL_HEIGHT}px`,
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: '12px',
        boxShadow: theme.isDark
          ? '0 8px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3)'
          : '0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 999999,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '13px',
        color: theme.text,
      }}
    >
      {/* Header — draggable */}
      <div
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: `1px solid ${theme.border}`,
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          flexShrink: 0,
          background: theme.bgSubtle,
          borderRadius: '12px 12px 0 0',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          fontWeight: 600,
          color: theme.text,
        }}>
          <MessageSquare size={15} style={{ color: theme.brand }} />
          Ask about this MR
        </div>
        <button
          onClick={() => {
            cancelChatStream();
            setOpen(false);
          }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: theme.textMuted,
            display: 'flex',
            alignItems: 'center',
            padding: '4px',
            borderRadius: '4px',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = theme.text;
            (e.currentTarget as HTMLElement).style.background = theme.bgMuted;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = theme.textMuted;
            (e.currentTarget as HTMLElement).style.background = 'none';
          }}
          title="Close chat"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
        {/* Empty state */}
        {!hasMessages && !isStreaming && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            gap: '12px',
            padding: '20px 0',
          }}>
            <MessageSquare size={28} style={{ color: theme.textMuted, opacity: 0.5 }} />
            <div style={{
              textAlign: 'center',
              color: theme.textSecondary,
              fontSize: '13px',
              lineHeight: '1.5',
            }}>
              Ask anything about this merge request.
              <br />
              <span style={{ fontSize: '12px', color: theme.textMuted }}>
                The AI has access to all diffs and review findings.
              </span>
            </div>
            <SuggestedQuestions
              questions={STARTER_QUESTIONS}
              onSelect={handleSuggestedQuestion}
              disabled={isStreaming}
            />
          </div>
        )}

        {/* Message list */}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* Streaming delta */}
        {isStreaming && currentDelta && (
          <StreamingMessage delta={currentDelta} />
        )}

        {/* Streaming indicator (no delta yet) */}
        {isStreaming && !currentDelta && (
          <div style={{
            padding: '10px 14px',
            color: theme.textMuted,
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <span style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: theme.brand,
              animation: 'otto-chat-pulse 1.4s ease-in-out infinite',
            }} />
            Thinking...
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: theme.errorBg,
            border: `1px solid ${theme.errorBorder}`,
            color: theme.error,
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{error}</span>
            <button
              onClick={handleRetry}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: theme.error,
                display: 'flex',
                alignItems: 'center',
                padding: '2px',
              }}
              title="Retry"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        )}

        {/* Post-response suggestions */}
        {hasMessages && !isStreaming && displayedSuggestions.length > 0 && (
          <SuggestedQuestions
            questions={displayedSuggestions}
            onSelect={handleSuggestedQuestion}
            disabled={isStreaming}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={{
        padding: '10px 14px',
        borderTop: `1px solid ${theme.border}`,
        flexShrink: 0,
        background: theme.bgSubtle,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '8px',
        }}>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this MR..."
            disabled={isStreaming}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              border: `1px solid ${theme.border}`,
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '13px',
              lineHeight: '1.4',
              fontFamily: 'inherit',
              color: theme.text,
              background: theme.bg,
              outline: 'none',
              maxHeight: '80px',
              overflow: 'auto',
            }}
            onFocus={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = theme.brand;
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = theme.border;
            }}
            onInput={(e) => {
              // Auto-resize textarea
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 80) + 'px';
            }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isStreaming}
            style={{
              background: inputValue.trim() && !isStreaming ? theme.btnPrimaryBg : theme.bgMuted,
              color: inputValue.trim() && !isStreaming ? theme.btnPrimaryText : theme.textMuted,
              border: 'none',
              borderRadius: '8px',
              padding: '8px',
              cursor: inputValue.trim() && !isStreaming ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.15s',
            }}
            title="Send message"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
