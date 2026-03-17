// ---------------------------------------------------------------------------
// InquiryComposer — the inline input form shown when the user selects lines
// in the diff and wants to ask a question about them.
//
// Design decisions:
// - Inline styles only (shadow DOM, no Tailwind).
// - Uses ThemeContext for all colors — matches InlineCommentThread styling.
// - Brand accent left border (3px) matches InlineCommentThread pattern.
// - Quick action chips use borderRadius: 6px and brand color text, matching
//   the SuggestedQuestions component pattern exactly.
// - Textarea auto-resizes, Enter to submit, Shift+Enter for newline.
// - Close button tears down the composer via the store.
// - Compact: designed to feel like a natural part of the diff, not a modal.
// ---------------------------------------------------------------------------

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Zap } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import type { OttoTheme } from '@/components/ThemeContext';
import { OttoLogo } from '@/components/OttoLogo';
import { useInquiryStore } from '@/services/inquiry/inquiry-store';
import { sendInquiryQuestion } from '@/services/inquiry/inquiry-stream-dispatcher';
import { INQUIRY_QUICK_ACTIONS } from '@/types/inquiry';

type InquiryComposerProps = {
  inquiryId: string;
};

export function InquiryComposer({ inquiryId }: InquiryComposerProps) {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inquiry = useInquiryStore((s) => s.inquiries[inquiryId]);

  // Auto-focus the textarea on mount
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    sendInquiryQuestion(inquiryId, trimmed);
    setValue('');
  }, [inquiryId, value]);

  const handleQuickAction = useCallback((prompt: string) => {
    sendInquiryQuestion(inquiryId, prompt);
  }, [inquiryId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleClose = useCallback(() => {
    useInquiryStore.getState().closeInquiry();
  }, []);

  if (!inquiry) return null;

  const lineRange = inquiry.startLine === inquiry.endLine
    ? `L${inquiry.startLine}`
    : `L${inquiry.startLine}-${inquiry.endLine}`;

  const fileName = inquiry.filePath.split('/').pop() || inquiry.filePath;

  const s = buildStyles(theme);

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <OttoLogo size={14} />
          <Zap size={12} style={{ color: theme.brand }} />
          <span style={s.headerLabel}>
            Ask about <span style={{ fontWeight: 600, color: theme.text }}>{lineRange}</span> in{' '}
            <span style={{ fontWeight: 600, color: theme.text }}>{fileName}</span>
          </span>
        </div>
        <button onClick={handleClose} style={s.closeBtn} title="Close">
          <X size={14} />
        </button>
      </div>

      {/* Input area */}
      <div style={s.inputArea}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What would you like to know?"
          rows={1}
          style={s.textarea}
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim()}
          style={{
            ...s.submitBtn,
            opacity: value.trim() ? 1 : 0.4,
            cursor: value.trim() ? 'pointer' : 'default',
          }}
          title="Submit"
        >
          <Send size={14} />
        </button>
      </div>

      {/* Quick action chips — matches SuggestedQuestions pattern exactly */}
      <div style={s.chipsRow}>
        {INQUIRY_QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            onClick={() => handleQuickAction(action.prompt)}
            style={s.chip}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.style.background = theme.bgMuted;
              el.style.borderColor = theme.brand;
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.background = theme.bgSubtle;
              el.style.borderColor = theme.border;
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — mirrors InlineCommentThread buildStyles pattern.
// Font sizes: 11px labels/badges, 12px secondary text, 13px body text.
// Border radius: 4px buttons, 6px inputs/chips/cards.
// Spacing: 6px gaps, 12px padding, 8px vertical rhythm.
// ---------------------------------------------------------------------------

function buildStyles(t: OttoTheme) {
  return {
    container: {
      borderLeft: `3px solid ${t.brand}`,
      background: t.bgInset,
      borderBottom: `1px solid ${t.border}`,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    } as React.CSSProperties,

    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 12px 4px',
    } as React.CSSProperties,

    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    } as React.CSSProperties,

    headerLabel: {
      fontSize: '12px',
      color: t.textSecondary,
    } as React.CSSProperties,

    closeBtn: {
      width: '24px',
      height: '24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '6px',
      border: 'none',
      background: 'transparent',
      color: t.textMuted,
      cursor: 'pointer',
    } as React.CSSProperties,

    inputArea: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '8px',
      padding: '4px 12px',
    } as React.CSSProperties,

    textarea: {
      flex: 1,
      minHeight: '32px',
      maxHeight: '120px',
      padding: '6px 10px',
      borderRadius: '6px',
      border: `1px solid ${t.border}`,
      background: t.bgSubtle,
      color: t.text,
      fontSize: '13px',
      lineHeight: '1.5',
      resize: 'none' as const,
      outline: 'none',
      fontFamily: 'inherit',
    } as React.CSSProperties,

    submitBtn: {
      width: '32px',
      height: '32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '6px',
      border: 'none',
      background: t.btnPrimaryBg,
      color: t.btnPrimaryText,
      flexShrink: 0,
    } as React.CSSProperties,

    chipsRow: {
      display: 'flex',
      flexWrap: 'wrap' as const,
      gap: '6px',
      padding: '6px 12px 10px',
    } as React.CSSProperties,

    // Matches SuggestedQuestions: borderRadius 6px, brand color text, bgSubtle bg
    chip: {
      background: t.bgSubtle,
      border: `1px solid ${t.border}`,
      borderRadius: '6px',
      padding: '4px 10px',
      fontSize: '12px',
      color: t.brand,
      cursor: 'pointer',
      lineHeight: '1.4',
      textAlign: 'left' as const,
      fontFamily: 'inherit',
      transition: 'background 0.15s, border-color 0.15s',
      whiteSpace: 'nowrap' as const,
    } as React.CSSProperties,
  };
}
