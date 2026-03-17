// ---------------------------------------------------------------------------
// GuidedReviewSidebar — compact item list alongside the slide viewer.
//
// Shows all slides in priority order with:
// - Kind icon (comment severity, edge case, thread)
// - Truncated title / first line
// - File name
// - Checkmark for completed items
// - Active highlight for the current slide
//
// Completed items are visually muted but still clickable (user chose
// "skip but show in sidebar list" — navigation skips them, but they
// can revisit by clicking).
// ---------------------------------------------------------------------------

import { useRef, useEffect } from 'react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import {
  AlertCircle, AlertTriangle, Lightbulb, Info,
  MessageSquare, Check, Zap,
} from 'lucide-react';
import type { ReviewSlide, SlideCompletionMap } from '@/types/guided-review';

type Props = {
  slides: ReviewSlide[];
  completionMap: SlideCompletionMap;
  activeIndex: number;
  onJumpTo: (index: number) => void;
};

export function GuidedReviewSidebar({ slides, completionMap, activeIndex, onJumpTo }: Props) {
  const theme = useTheme();
  const activeRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll the active item into view when it changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  const completedCount = slides.filter((s) => completionMap[s.id]).length;

  return (
    <div style={{
      width: '220px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      borderRight: `1px solid ${theme.borderSubtle}`,
      background: theme.bgSubtle,
      overflow: 'hidden',
    }}>
      {/* Header with progress */}
      <div style={{
        padding: '10px 12px 8px',
        borderBottom: `1px solid ${theme.borderSubtle}`,
      }}>
        <div style={{
          fontSize: '11px',
          fontWeight: 600,
          color: theme.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '6px',
        }}>
          Items
        </div>
        {/* Progress bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <div style={{
            flex: 1,
            height: '3px',
            borderRadius: '2px',
            background: theme.bgMuted,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: slides.length > 0 ? `${(completedCount / slides.length) * 100}%` : '0%',
              borderRadius: '2px',
              background: completedCount === slides.length ? theme.success : theme.brand,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            color: completedCount === slides.length ? theme.success : theme.textMuted,
            flexShrink: 0,
          }}>
            {completedCount}/{slides.length}
          </span>
        </div>
      </div>

      {/* Scrollable item list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}>
        {slides.map((slide, index) => {
          const isActive = index === activeIndex;
          const isCompleted = completionMap[slide.id] ?? false;

          return (
            <SidebarItem
              key={slide.id}
              ref={isActive ? activeRef : undefined}
              slide={slide}
              index={index}
              isActive={isActive}
              isCompleted={isCompleted}
              theme={theme}
              onClick={() => onJumpTo(index)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar item
// ---------------------------------------------------------------------------

import { forwardRef } from 'react';

const SidebarItem = forwardRef<HTMLButtonElement, {
  slide: ReviewSlide;
  index: number;
  isActive: boolean;
  isCompleted: boolean;
  theme: OttoTheme;
  onClick: () => void;
}>(function SidebarItem({ slide, index, isActive, isCompleted, theme, onClick }, ref) {
  const { icon: Icon, color } = getSlideIcon(slide, theme);
  const title = getSlideTitle(slide);
  const fileName = getSlideFileName(slide);

  return (
    <button
      ref={ref}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '6px',
        width: '100%',
        padding: '6px 10px',
        background: isActive
          ? theme.infoBg
          : 'transparent',
        border: 'none',
        borderLeft: isActive ? `2px solid ${theme.brand}` : '2px solid transparent',
        borderBottom: `1px solid ${theme.borderSubtle}`,
        cursor: 'pointer',
        textAlign: 'left',
        opacity: isCompleted ? 0.5 : 1,
        transition: 'background 0.1s, opacity 0.2s',
      }}
    >
      {/* Icon */}
      <div style={{
        flexShrink: 0,
        marginTop: '2px',
        color,
      }}>
        {isCompleted ? (
          <Check size={12} style={{ color: theme.success }} />
        ) : (
          <Icon size={12} />
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{
          fontSize: '12px',
          fontWeight: isActive ? 600 : 400,
          color: isActive ? theme.text : theme.textSecondary,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          lineHeight: '1.4',
        }}>
          {title}
        </div>
        {fileName && (
          <div style={{
            fontSize: '10px',
            color: theme.textMuted,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {fileName}
          </div>
        )}
      </div>

      {/* Index number */}
      <span style={{
        fontSize: '10px',
        color: theme.textMuted,
        flexShrink: 0,
        marginTop: '2px',
      }}>
        {index + 1}
      </span>
    </button>
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSlideIcon(slide: ReviewSlide, theme: OttoTheme): { icon: typeof AlertCircle; color: string } {
  switch (slide.kind) {
    case 'comment': {
      const colors = {
        critical: { icon: AlertCircle, color: theme.error },
        warning: { icon: AlertTriangle, color: theme.warning },
        suggestion: { icon: Lightbulb, color: theme.info },
        info: { icon: Info, color: theme.info },
      };
      return colors[slide.comment.severity] ?? colors.info;
    }
    case 'edgeCase':
      return { icon: Zap, color: theme.warning };
    case 'thread':
      return { icon: MessageSquare, color: theme.warning };
  }
}

function getSlideTitle(slide: ReviewSlide): string {
  switch (slide.kind) {
    case 'comment':
      return slide.comment.title;
    case 'edgeCase':
      return slide.edgeCase.title;
    case 'thread': {
      const firstNote = slide.discussion.notes.find((n) => !n.system);
      if (!firstNote) return 'Discussion';
      // Truncate the body to a reasonable preview
      const body = firstNote.body.replace(/\n/g, ' ').trim();
      return body.length > 60 ? body.slice(0, 57) + '\u2026' : body;
    }
  }
}

function getSlideFileName(slide: ReviewSlide): string | null {
  let filePath: string | null = null;
  switch (slide.kind) {
    case 'comment':
      filePath = slide.comment.filePath;
      break;
    case 'edgeCase':
      filePath = slide.edgeCase.filePath;
      break;
    case 'thread':
      filePath = slide.filePath;
      break;
  }
  return filePath ? filePath.split('/').pop() ?? null : null;
}
