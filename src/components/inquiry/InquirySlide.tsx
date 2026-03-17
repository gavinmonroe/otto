// ---------------------------------------------------------------------------
// InquirySlide — renders a single Q&A turn within the inquiry carousel.
//
// Design decisions:
// - Flat left-aligned layout (not chat bubbles) — matches ChatMessage style.
// - Question shown with brand-colored "Q:" label + left border, matching
//   the UserBlock pattern in ChatMessage.tsx.
// - Answer rendered via the shared Markdown component with compact mode.
// - Streaming state shows the delta with a blinking cursor (same cursor
//   style as ChatMessage's StreamingMessage: 6px wide brand-colored bar).
// - Font sizes: 11px labels, 12px secondary, 13px body — matches system.
// ---------------------------------------------------------------------------

import { useTheme } from '@/components/ThemeContext';
import type { OttoTheme } from '@/components/ThemeContext';
import { Markdown } from '@/components/Markdown';
import type { InquirySlide as InquirySlideType } from '@/types/inquiry';

type InquirySlideProps = {
  slide: InquirySlideType;
  /** Streaming delta for the in-flight slide (empty string if not streaming). */
  streamingDelta: string;
  isStreaming: boolean;
};

export function InquirySlide({ slide, streamingDelta, isStreaming }: InquirySlideProps) {
  const theme = useTheme();
  const s = buildStyles(theme);

  // The content to display: completed answer, or streaming delta
  const displayContent = slide.answer || streamingDelta;
  const showCursor = isStreaming && !slide.answer;

  return (
    <div style={s.container}>
      {/* Question — matches UserBlock pattern: brand left border + bgInset */}
      <div style={s.question}>
        <div style={s.questionLabel}>Q</div>
        <div style={s.questionText}>{slide.question}</div>
      </div>

      {/* Answer */}
      <div style={s.answer}>
        {displayContent ? (
          <div>
            <Markdown content={displayContent} compact />
            {showCursor && (
              <span style={{
                display: 'inline-block',
                width: '6px',
                height: '14px',
                background: theme.brand,
                borderRadius: '1px',
                animation: 'otto-inquiry-cursor 1s step-end infinite',
                verticalAlign: 'text-bottom',
                marginLeft: '2px',
              }} />
            )}
          </div>
        ) : isStreaming ? (
          <div style={s.loading}>
            <span style={{
              display: 'inline-block',
              width: '6px',
              height: '14px',
              background: theme.brand,
              borderRadius: '1px',
              animation: 'otto-inquiry-cursor 1s step-end infinite',
              verticalAlign: 'text-bottom',
            }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — follows the ChatMessage / InlineCommentThread conventions.
// ---------------------------------------------------------------------------

function buildStyles(t: OttoTheme) {
  return {
    container: {
      padding: '0',
    } as React.CSSProperties,

    // Matches UserBlock: brand left border, bgInset background
    question: {
      display: 'flex',
      alignItems: 'baseline',
      gap: '8px',
      padding: '6px 10px',
      borderLeft: `3px solid ${t.brand}`,
      background: t.bgInset,
      borderRadius: '0 4px 4px 0',
      marginBottom: '8px',
    } as React.CSSProperties,

    questionLabel: {
      fontSize: '11px',
      fontWeight: 600,
      color: t.brand,
      flexShrink: 0,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
    } as React.CSSProperties,

    questionText: {
      fontSize: '13px',
      fontWeight: 500,
      color: t.text,
      lineHeight: '1.5',
      wordBreak: 'break-word' as const,
    } as React.CSSProperties,

    answer: {
      fontSize: '13px',
      lineHeight: '1.5',
      color: t.text,
    } as React.CSSProperties,

    loading: {
      padding: '4px 0',
    } as React.CSSProperties,
  };
}
