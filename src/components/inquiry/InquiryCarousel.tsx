// ---------------------------------------------------------------------------
// InquiryCarousel — slide-based response viewer for line inquiries.
//
// Collapsible like InlineCommentThread. Collapsed shows a compact header
// with line range, question preview, and slide count. Expanded shows the
// full Q&A slide, follow-up input, and team save button.
//
// Auto-expands when streaming so the user sees the response arriving.
// ---------------------------------------------------------------------------

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, ChevronLeft, X, Send, Zap, RotateCcw, Users, AlertCircle } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import type { OttoTheme } from '@/components/ThemeContext';
import { OttoLogo } from '@/components/OttoLogo';
import { InquirySlide } from './InquirySlide';
import { useInquiryStore } from '@/services/inquiry/inquiry-store';
import {
  sendInquiryQuestion,
  retryInquiryQuestion,
  cancelInquiryStream,
} from '@/services/inquiry/inquiry-stream-dispatcher';
import { getBottoClient } from '@/lib/botto-client';

type InquiryCarouselProps = {
  inquiryId: string;
};

export function InquiryCarousel({ inquiryId }: InquiryCarouselProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(true);
  const [followUp, setFollowUp] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const inquiry = useInquiryStore((s) => s.inquiries[inquiryId]);
  const closeInquiry = useInquiryStore((s) => s.closeInquiry);
  const navigateSlide = useInquiryStore((s) => s.navigateSlide);
  const markSavedForTeam = useInquiryStore((s) => s.markSavedForTeam);

  // Auto-focus the container so keyboard nav works immediately.
  useEffect(() => {
    if (expanded) {
      setTimeout(() => containerRef.current?.focus(), 50);
    }
  }, [expanded]);

  // Auto-expand when streaming starts (user submitted a question while collapsed)
  useEffect(() => {
    if (inquiry?.status === 'streaming' && !expanded) {
      setExpanded(true);
    }
  }, [inquiry?.status, expanded]);

  // Auto-scroll to bottom when streaming
  useEffect(() => {
    if (inquiry?.status === 'streaming' && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [inquiry?.currentDelta, inquiry?.status]);

  // Auto-resize follow-up textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 80)}px`;
  }, [followUp]);

  // Keyboard navigation scoped to the carousel container — NOT global.
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.target === inputRef.current) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      navigateSlide(inquiryId, 'prev');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      navigateSlide(inquiryId, 'next');
    }
  }, [inquiryId, navigateSlide]);

  const handleSubmitFollowUp = useCallback(() => {
    const trimmed = followUp.trim();
    if (!trimmed || inquiry?.status === 'streaming') return;
    sendInquiryQuestion(inquiryId, trimmed);
    setFollowUp('');
  }, [inquiryId, followUp, inquiry?.status]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitFollowUp();
    }
  }, [handleSubmitFollowUp]);

  const handleRetry = useCallback(() => {
    retryInquiryQuestion(inquiryId);
  }, [inquiryId]);

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    cancelInquiryStream();
    closeInquiry();
  }, [closeInquiry]);

  const handleSaveForTeam = useCallback(() => {
    markSavedForTeam(inquiryId);
  }, [inquiryId, markSavedForTeam]);

  if (!inquiry || inquiry.slides.length === 0) return null;

  const currentSlide = inquiry.slides[inquiry.currentSlideIndex];
  const isFirst = inquiry.currentSlideIndex === 0;
  const isLast = inquiry.currentSlideIndex === inquiry.slides.length - 1;
  const isStreaming = inquiry.status === 'streaming';
  const isError = inquiry.status === 'error';
  const slideCount = inquiry.slides.length;

  const lineRange = inquiry.startLine === inquiry.endLine
    ? `L${inquiry.startLine}`
    : `L${inquiry.startLine}-${inquiry.endLine}`;
  const fileName = inquiry.filePath.split('/').pop() || inquiry.filePath;

  // Preview text for collapsed state — show current question truncated
  const previewQuestion = currentSlide?.question
    ? (currentSlide.question.length > 60
      ? currentSlide.question.slice(0, 60) + '…'
      : currentSlide.question)
    : '';

  // Check if Botto is connected for the "Save for team" button
  let bottoConnected = false;
  try {
    const client = getBottoClient((globalThis as any).__ottoSettings);
    bottoConnected = !!client?.isConnected();
  } catch { /* not available */ }

  const s = buildStyles(theme);

  return (
    <div ref={containerRef} style={s.container} tabIndex={-1} onKeyDown={handleContainerKeyDown}>
      {/* Header — clickable toggle, matches InlineCommentThread pattern */}
      <button onClick={() => setExpanded(!expanded)} style={s.header}>
        <div style={s.headerLeft}>
          <OttoLogo size={14} />
          {expanded
            ? <ChevronDown size={14} style={{ color: theme.textMuted }} />
            : <ChevronRight size={14} style={{ color: theme.textMuted }} />
          }
          <Zap size={12} style={{ color: theme.brand, flexShrink: 0 }} />
          <span style={s.headerLabel}>
            {lineRange} · {fileName}
          </span>
          {/* Collapsed: show question preview + slide count badge */}
          {!expanded && previewQuestion && (
            <span style={s.questionPreview}>{previewQuestion}</span>
          )}
          {!expanded && slideCount > 0 && (
            <span style={s.slideBadge}>{slideCount}</span>
          )}
        </div>

        <div style={s.headerRight}>
          {/* Slide navigation — only in expanded mode, stop propagation to avoid toggle */}
          {expanded && slideCount > 1 && (
            <div style={s.nav} onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => navigateSlide(inquiryId, 'prev')}
                disabled={isFirst}
                style={{
                  ...s.navBtn,
                  opacity: isFirst ? 0.3 : 1,
                  cursor: isFirst ? 'default' : 'pointer',
                }}
                title="Previous"
              >
                <ChevronLeft size={14} />
              </button>
              <span style={s.navCounter}>
                {inquiry.currentSlideIndex + 1} / {slideCount}
              </span>
              <button
                onClick={() => navigateSlide(inquiryId, 'next')}
                disabled={isLast}
                style={{
                  ...s.navBtn,
                  opacity: isLast ? 0.3 : 1,
                  cursor: isLast ? 'default' : 'pointer',
                }}
                title="Next"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          <button onClick={handleClose} style={s.closeBtn} title="Close">
            <X size={14} />
          </button>
        </div>
      </button>

      {/* Expanded: slide body + footer */}
      {expanded && (
        <>
          {/* Slide body */}
          <div ref={bodyRef} style={s.body}>
            {currentSlide && (
              <InquirySlide
                slide={currentSlide}
                streamingDelta={isLast ? inquiry.currentDelta : ''}
                isStreaming={isStreaming && isLast}
              />
            )}

            {/* Error state */}
            {isError && isLast && (
              <div style={s.error}>
                <AlertCircle size={14} style={{ color: theme.error, flexShrink: 0 }} />
                <span style={{ color: theme.error, fontSize: '12px', flex: 1 }}>
                  {inquiry.error || 'Something went wrong.'}
                </span>
                <button onClick={handleRetry} style={s.retryBtn} title="Retry">
                  <RotateCcw size={12} />
                  <span>Retry</span>
                </button>
              </div>
            )}
          </div>

          {/* Footer: follow-up input + actions */}
          <div style={s.footer}>
            <div style={s.inputRow}>
              <textarea
                ref={inputRef}
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Ask a follow-up..."
                rows={1}
                disabled={isStreaming}
                style={{
                  ...s.textarea,
                  opacity: isStreaming ? 0.5 : 1,
                }}
              />
              <button
                onClick={handleSubmitFollowUp}
                disabled={!followUp.trim() || isStreaming}
                style={{
                  ...s.submitBtn,
                  opacity: followUp.trim() && !isStreaming ? 1 : 0.4,
                  cursor: followUp.trim() && !isStreaming ? 'pointer' : 'default',
                }}
                title="Submit"
              >
                <Send size={13} />
              </button>
            </div>

            {/* Save for team (Botto) */}
            {bottoConnected && !inquiry.savedForTeam && (
              <button
                onClick={handleSaveForTeam}
                style={s.teamBtn}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = theme.brand; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; }}
              >
                <Users size={12} />
                <span>Save for team</span>
              </button>
            )}
            {inquiry.savedForTeam && (
              <span style={s.teamSaved}>
                <Users size={11} />
                <span>Saved for team</span>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — mirrors InlineCommentThread conventions.
// ---------------------------------------------------------------------------

function buildStyles(t: OttoTheme) {
  return {
    container: {
      borderLeft: `3px solid ${t.brand}`,
      background: t.bgInset,
      borderBottom: `1px solid ${t.border}`,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex',
      flexDirection: 'column' as const,
      outline: 'none',
    } as React.CSSProperties,

    // Clickable header — matches InlineCommentThread toggle button
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      padding: '6px 12px',
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      textAlign: 'left' as const,
    } as React.CSSProperties,

    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flex: 1,
      minWidth: 0,
    } as React.CSSProperties,

    headerLabel: {
      fontSize: '12px',
      color: t.textSecondary,
      fontWeight: 500,
      flexShrink: 0,
    } as React.CSSProperties,

    // Truncated question preview in collapsed state
    questionPreview: {
      fontSize: '12px',
      color: t.textMuted,
      overflow: 'hidden' as const,
      textOverflow: 'ellipsis' as const,
      whiteSpace: 'nowrap' as const,
      minWidth: 0,
    } as React.CSSProperties,

    // Slide count badge — matches InlineCommentThread severity badge pattern
    slideBadge: {
      fontSize: '11px',
      padding: '1px 6px',
      borderRadius: '6px',
      background: t.infoBg,
      color: t.brand,
      fontWeight: 600,
      flexShrink: 0,
    } as React.CSSProperties,

    headerRight: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flexShrink: 0,
    } as React.CSSProperties,

    nav: {
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
    } as React.CSSProperties,

    navBtn: {
      width: '22px',
      height: '22px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '6px',
      border: `1px solid ${t.border}`,
      background: t.bgSubtle,
      color: t.textSecondary,
      fontSize: '12px',
      lineHeight: 1,
      cursor: 'pointer',
    } as React.CSSProperties,

    navCounter: {
      fontSize: '11px',
      color: t.textMuted,
      fontWeight: 500,
      minWidth: '28px',
      textAlign: 'center' as const,
      fontVariantNumeric: 'tabular-nums',
    } as React.CSSProperties,

    closeBtn: {
      width: '22px',
      height: '22px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '6px',
      border: 'none',
      background: 'transparent',
      color: t.textMuted,
      cursor: 'pointer',
    } as React.CSSProperties,

    body: {
      padding: '10px 12px',
      maxHeight: '360px',
      overflowY: 'auto' as const,
    } as React.CSSProperties,

    error: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 10px',
      marginTop: '8px',
      borderRadius: '6px',
      background: t.errorBg,
      border: `1px solid ${t.errorBorder}`,
    } as React.CSSProperties,

    retryBtn: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '3px 10px',
      borderRadius: '6px',
      border: `1px solid ${t.errorBorder}`,
      background: 'transparent',
      color: t.error,
      fontSize: '12px',
      fontWeight: 500,
      cursor: 'pointer',
      flexShrink: 0,
      fontFamily: 'inherit',
    } as React.CSSProperties,

    footer: {
      padding: '8px 12px 10px',
      borderTop: `1px solid ${t.borderSubtle}`,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '6px',
    } as React.CSSProperties,

    inputRow: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '8px',
    } as React.CSSProperties,

    textarea: {
      flex: 1,
      minHeight: '30px',
      maxHeight: '80px',
      padding: '5px 10px',
      borderRadius: '6px',
      border: `1px solid ${t.border}`,
      background: t.bgSubtle,
      color: t.text,
      fontSize: '12px',
      lineHeight: '1.5',
      resize: 'none' as const,
      outline: 'none',
      fontFamily: 'inherit',
    } as React.CSSProperties,

    submitBtn: {
      width: '30px',
      height: '30px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '6px',
      border: 'none',
      background: t.btnPrimaryBg,
      color: t.btnPrimaryText,
      flexShrink: 0,
    } as React.CSSProperties,

    teamBtn: {
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      alignSelf: 'flex-start',
      padding: '4px 10px',
      borderRadius: '6px',
      border: `1px solid ${t.border}`,
      background: t.bgSubtle,
      color: t.textSecondary,
      fontSize: '11px',
      fontWeight: 500,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'border-color 0.15s',
    } as React.CSSProperties,

    teamSaved: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: '11px',
      color: t.success,
      fontWeight: 500,
    } as React.CSSProperties,
  };
}
