// ---------------------------------------------------------------------------
// SuggestedQuestions — clickable pill buttons for follow-up questions.
//
// Shown in two contexts:
// 1. Initial state (empty conversation) — hardcoded starter questions
// 2. After each AI response — contextual suggestions from the AI
//
// Each pill auto-fills and sends the question when clicked.
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
            background: theme.isDark ? 'rgba(64, 196, 245, 0.08)' : 'rgba(12, 147, 231, 0.06)',
            border: `1px solid ${theme.isDark ? 'rgba(64, 196, 245, 0.2)' : 'rgba(12, 147, 231, 0.15)'}`,
            borderRadius: '16px',
            padding: '5px 12px',
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
            el.style.background = theme.isDark ? 'rgba(64, 196, 245, 0.15)' : 'rgba(12, 147, 231, 0.12)';
            el.style.borderColor = theme.isDark ? 'rgba(64, 196, 245, 0.35)' : 'rgba(12, 147, 231, 0.3)';
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget;
            el.style.background = theme.isDark ? 'rgba(64, 196, 245, 0.08)' : 'rgba(12, 147, 231, 0.06)';
            el.style.borderColor = theme.isDark ? 'rgba(64, 196, 245, 0.2)' : 'rgba(12, 147, 231, 0.15)';
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
 * These are always available regardless of review state.
 */
export const STARTER_QUESTIONS: SuggestedQuestion[] = [
  { label: 'Where should I start reviewing?', question: 'Where should I start reviewing this MR? Point me to the most important files and changes.' },
  { label: 'What is the biggest risk?', question: 'What is the biggest risk in this MR? Are there any changes that could cause issues in production?' },
  { label: 'Summarize the key changes', question: 'What are the most significant changes in this MR? Give me a quick overview of what matters.' },
];
