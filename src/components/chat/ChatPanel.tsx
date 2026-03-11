// ---------------------------------------------------------------------------
// ChatPanel — the main chat interface for MR Q&A.
//
// Redesigned to match Otto's panel design language:
// - 8px border-radius, flat card style (not bubbly)
// - bgSubtle header with borderSubtle dividers
// - Section-based layout matching MrOverviewPanel
// - Messages use flat left-aligned blocks, not chat bubbles
// ---------------------------------------------------------------------------

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, MessageSquare, AlertCircle, RotateCcw } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import type { OttoTheme } from '@/components/ThemeContext';
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
    focusedComment,
    setOpen,
    setPanelX,
    clearFocusedComment,
  } = useChatStore();

  const [inputValue, setInputValue] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startPanelX: number } | null>(null);

  const isStreaming = status === 'streaming';
  const hasMessages = messages.length > 0;
  const s = buildStyles(theme);

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

  // When a focused comment is set, pre-fill the input with a starter question
  useEffect(() => {
    if (focusedComment && isOpen) {
      setInputValue(`What does this suggestion do and is it the right approach?`);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [focusedComment, isOpen]);

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
        ...s.panel,
        left: `${left}px`,
      }}
    >
      {/* Header — draggable */}
      <div
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        style={{
          ...s.header,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <MessageSquare size={15} style={{ color: theme.brand }} />
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Ask Otto</span>
          {hasMessages && (
            <span style={{ fontSize: '12px', color: theme.textSecondary }}>
              {messages.length} messages
            </span>
          )}
        </div>
        <button
          onClick={() => {
            cancelChatStream();
            clearFocusedComment();
            setOpen(false);
          }}
          style={s.iconButton}
          title="Close chat"
        >
          <X size={14} />
        </button>
      </div>

      {/* Focused comment banner */}
      {focusedComment && (
        <div style={{
          padding: '6px 14px',
          background: theme.isDark ? '#1e3a5f' : '#eff6ff',
          borderBottom: `1px solid ${theme.borderSubtle}`,
          fontSize: '12px',
          color: theme.textSecondary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Asking about: <span style={{ color: theme.text, fontWeight: 500 }}>{focusedComment.title}</span>
            <span style={{ color: theme.textMuted }}> in {focusedComment.filePath}{focusedComment.startLine ? `:${focusedComment.startLine}` : ''}</span>
          </span>
          <button
            onClick={clearFocusedComment}
            style={{ ...s.iconButton, flexShrink: 0 }}
            title="Remove context"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Messages area */}
      <div style={s.messagesArea}>
        {/* Empty state */}
        {!hasMessages && !isStreaming && (
          <div style={s.emptyState}>
            <div style={{
              fontSize: '13px',
              color: theme.textSecondary,
              lineHeight: '1.5',
              marginBottom: '12px',
            }}>
              Ask anything about this merge request. The AI has access to all diffs and review findings.
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
            padding: '8px 14px',
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
          <div style={s.error}>
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{error}</span>
            <button
              onClick={handleRetry}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'inherit',
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
          <div style={{ padding: '4px 14px 8px' }}>
            <SuggestedQuestions
              questions={displayedSuggestions}
              onSelect={handleSuggestedQuestion}
              disabled={isStreaming}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={s.inputArea}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this MR..."
            disabled={isStreaming}
            rows={1}
            style={s.textarea}
            onFocus={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = theme.brand;
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = theme.border;
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 80) + 'px';
            }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isStreaming}
            style={{
              ...s.sendButton,
              background: inputValue.trim() && !isStreaming ? theme.btnPrimaryBg : theme.bgMuted,
              color: inputValue.trim() && !isStreaming ? theme.btnPrimaryText : theme.textMuted,
              cursor: inputValue.trim() && !isStreaming ? 'pointer' : 'not-allowed',
            }}
            title="Send message"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theme-aware styles — matches MrOverviewPanel design language
// ---------------------------------------------------------------------------

function buildStyles(t: OttoTheme) {
  return {
    panel: {
      position: 'fixed' as const,
      bottom: `${PANEL_MARGIN}px`,
      width: `${PANEL_WIDTH}px`,
      height: `${PANEL_HEIGHT}px`,
      background: t.bg,
      border: `1px solid ${t.border}`,
      borderRadius: '8px',
      boxShadow: t.isDark
        ? '0 4px 16px rgba(0, 0, 0, 0.4)'
        : '0 4px 16px rgba(0, 0, 0, 0.1)',
      display: 'flex',
      flexDirection: 'column' as const,
      overflow: 'hidden',
      zIndex: 999999,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '14px',
      color: t.text,
    } as React.CSSProperties,

    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 14px',
      borderBottom: `1px solid ${t.borderSubtle}`,
      background: t.bgSubtle,
      userSelect: 'none' as const,
      flexShrink: 0,
    } as React.CSSProperties,

    iconButton: {
      padding: '4px',
      borderRadius: '4px',
      background: 'transparent',
      border: 'none',
      color: t.textSecondary,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
    } as React.CSSProperties,

    messagesArea: {
      flex: 1,
      overflowY: 'auto' as const,
      display: 'flex',
      flexDirection: 'column' as const,
    } as React.CSSProperties,

    emptyState: {
      padding: '20px 14px',
      flex: 1,
      display: 'flex',
      flexDirection: 'column' as const,
      justifyContent: 'center',
    } as React.CSSProperties,

    error: {
      padding: '8px 14px',
      background: t.errorBg,
      color: t.error,
      fontSize: '12px',
      borderBottom: `1px solid ${t.errorBorder}`,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    } as React.CSSProperties,

    inputArea: {
      padding: '10px 14px',
      borderTop: `1px solid ${t.borderSubtle}`,
      flexShrink: 0,
      background: t.bgSubtle,
    } as React.CSSProperties,

    textarea: {
      flex: 1,
      resize: 'none' as const,
      border: `1px solid ${t.border}`,
      borderRadius: '6px',
      padding: '8px 10px',
      fontSize: '13px',
      lineHeight: '1.4',
      fontFamily: 'inherit',
      color: t.text,
      background: t.bg,
      outline: 'none',
      maxHeight: '80px',
      overflow: 'auto' as const,
    } as React.CSSProperties,

    sendButton: {
      border: 'none',
      borderRadius: '6px',
      padding: '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    } as React.CSSProperties,
  };
}
