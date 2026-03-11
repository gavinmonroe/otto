// ---------------------------------------------------------------------------
// SuggestedQuestions — clickable question chips.
//
// Redesigned to match Otto's design language:
// - Uses secondary button style (flat, bordered) instead of rounded pills
// - Consistent with the tag/badge patterns in MrOverviewPanel
// ---------------------------------------------------------------------------

import { useTheme } from '@/components/ThemeContext';
import type { SuggestedQuestion } from '@/types/chat';

type SuggestedQuestionsProps = {
  questions: SuggestedQuestion[];
  onSelect: (question: string) => void;
  disabled?: boolean;
};

export function SuggestedQuestions({ questions, onSelect, disabled }: SuggestedQuestionsProps) {
  const theme = useTheme();

  if (questions.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      padding: '4px 0',
    }}>
      {questions.map((q, i) => (
        <button
          key={i}
          onClick={() => onSelect(q.question)}
          disabled={disabled}
          style={{
            background: theme.bgSubtle,
            border: `1px solid ${theme.border}`,
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '12px',
            color: theme.brand,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            lineHeight: '1.4',
            textAlign: 'left',
            fontFamily: 'inherit',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => {
            if (disabled) return;
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
          {q.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Default starter questions shown when the chat is first opened.
 */
export const STARTER_QUESTIONS: SuggestedQuestion[] = [
  { label: 'Where should I start reviewing?', question: 'Where should I start reviewing this MR? Point me to the most important files and changes.' },
  { label: 'What is the biggest risk?', question: 'What is the biggest risk in this MR? Are there any changes that could cause issues in production?' },
  { label: 'Summarize the key changes', question: 'What are the most significant changes in this MR? Give me a quick overview of what matters.' },
];
