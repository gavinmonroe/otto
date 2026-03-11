// ---------------------------------------------------------------------------
// useAiStream hook — generic hook for consuming AI streaming responses.
//
// This is a lower-level hook used by components that need to display
// streaming text (e.g., the summary panel showing tokens as they arrive).
// It takes a delta string (from the store) and provides a display-ready
// version with a blinking cursor effect.
// ---------------------------------------------------------------------------

import { useState, useEffect, useRef } from 'react';

type UseAiStreamOptions = {
  /** The accumulated delta text from the store */
  delta: string;
  /** Whether this stream is currently active */
  isStreaming: boolean;
  /** The final parsed result (when streaming completes) */
  finalContent: string | null;
};

export function useAiStream({ delta, isStreaming, finalContent }: UseAiStreamOptions) {
  const [displayText, setDisplayText] = useState('');
  const [showCursor, setShowCursor] = useState(false);

  // Update display text from delta or final content
  useEffect(() => {
    if (finalContent) {
      setDisplayText(finalContent);
      setShowCursor(false);
    } else if (delta) {
      setDisplayText(delta);
      setShowCursor(isStreaming);
    } else {
      setDisplayText('');
      setShowCursor(isStreaming);
    }
  }, [delta, isStreaming, finalContent]);

  // Blink cursor effect
  useEffect(() => {
    if (!showCursor) return;
    const interval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 530);
    return () => clearInterval(interval);
  }, [showCursor]);

  return {
    displayText,
    showCursor: isStreaming, // Always show cursor while streaming
    isEmpty: !displayText && !isStreaming,
  };
}
