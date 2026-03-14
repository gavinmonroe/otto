// ---------------------------------------------------------------------------
// HealthWarningToast — subtle floating toast that warns the user when
// Otto detects the tab is under performance pressure.
//
// Design decisions:
// - Uses inline styles via useTheme() (same pattern as all injected UI).
// - Positioned fixed, bottom-left to avoid overlapping the chat pill
//   (which lives bottom-right).
// - Shows different severity levels: degraded (amber) and critical (red).
// - Auto-hides with a fade-out when health returns to normal.
// - Minimal DOM footprint — just text + icon, no heavy components.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, XCircle, X } from 'lucide-react';
import { useTheme, type OttoTheme } from '@/components/ThemeContext';
import { useReviewStore } from '@/services/review/review-store';
import type { HealthLevel } from '@/services/review/health-monitor';

export function HealthWarningToast() {
  const theme = useTheme();
  const healthLevel = useReviewStore((s) => s.healthLevel);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup fade timer on unmount
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  // Show toast when health degrades, hide when it recovers
  useEffect(() => {
    if (healthLevel === 'normal') {
      if (visible) {
        // Fade out, then hide
        setFadingOut(true);
        fadeTimerRef.current = setTimeout(() => {
          fadeTimerRef.current = null;
          setVisible(false);
          setFadingOut(false);
          setDismissed(false); // Reset dismiss so it can show again next time
        }, 400);
        return () => {
          if (fadeTimerRef.current) {
            clearTimeout(fadeTimerRef.current);
            fadeTimerRef.current = null;
          }
        };
      }
    } else {
      // Health degraded — show unless user dismissed this occurrence
      if (!dismissed) {
        setVisible(true);
        setFadingOut(false);
      }
    }
  }, [healthLevel, visible, dismissed]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setFadingOut(true);
    fadeTimerRef.current = setTimeout(() => {
      fadeTimerRef.current = null;
      setVisible(false);
      setFadingOut(false);
    }, 300);
  }, []);

  if (!visible) return null;

  const isCritical = healthLevel === 'critical';
  const s = buildStyles(theme, isCritical, fadingOut);

  return (
    <div style={s.container} role="status" aria-live="polite">
      <div style={s.inner}>
        <div style={s.iconWrap}>
          {isCritical
            ? <XCircle size={15} style={{ color: theme.error }} />
            : <AlertTriangle size={15} style={{ color: theme.warning }} />
          }
        </div>
        <div style={s.content}>
          <div style={s.title}>
            {isCritical ? 'Tab under heavy load' : 'Performance pressure detected'}
          </div>
          <div style={s.message}>
            {isCritical
              ? 'Otto has paused streaming to prevent a crash. Results will appear when the tab recovers.'
              : 'Otto is throttling updates to keep the page responsive.'
            }
          </div>
        </div>
        <button
          onClick={handleDismiss}
          style={s.closeBtn}
          aria-label="Dismiss warning"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — matches the existing design system
// ---------------------------------------------------------------------------

function buildStyles(t: OttoTheme, isCritical: boolean, fadingOut: boolean) {
  const accentColor = isCritical ? t.error : t.warning;
  const bgColor = isCritical
    ? (t.isDark ? '#2d1215' : '#fef2f2')
    : (t.isDark ? '#2d2305' : '#fffbeb');
  const borderColor = isCritical
    ? (t.isDark ? '#7f1d1d' : '#fecaca')
    : (t.isDark ? '#78350f' : '#fde68a');

  return {
    container: {
      position: 'fixed' as const,
      bottom: '16px',
      left: '16px',
      zIndex: 2147483646, // Just below max, above GitLab but below browser UI
      maxWidth: '360px',
      opacity: fadingOut ? 0 : 1,
      transform: fadingOut ? 'translateY(8px)' : 'translateY(0)',
      transition: 'opacity 0.3s ease, transform 0.3s ease',
      pointerEvents: 'auto' as const,
    },
    inner: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '10px',
      padding: '10px 12px',
      background: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: '8px',
      boxShadow: t.isDark
        ? '0 4px 12px rgba(0, 0, 0, 0.4)'
        : '0 4px 12px rgba(0, 0, 0, 0.08)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
      lineHeight: '1.5',
    },
    iconWrap: {
      flexShrink: 0,
      marginTop: '1px',
    },
    content: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontWeight: 600,
      fontSize: '12px',
      color: accentColor,
      marginBottom: '2px',
    },
    message: {
      fontSize: '11px',
      color: t.textSecondary,
      lineHeight: '1.4',
    },
    closeBtn: {
      flexShrink: 0,
      background: 'none',
      border: 'none',
      padding: '2px',
      cursor: 'pointer',
      color: t.textMuted,
      borderRadius: '4px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  };
}
