// ---------------------------------------------------------------------------
// Theme context — provides dark/light mode colors to all Otto components
// injected into the GitLab page.
//
// Why a context instead of CSS variables:
// - Our components use inline styles (necessary in shadow DOM where
//   Tailwind classes may not be available for the overview panel).
// - Inline styles can't respond to a `.dark` CSS class.
// - A React context lets every component read the current palette
//   without prop drilling.
//
// The content script detects GitLab's dark mode once and wraps the
// component tree in <ThemeProvider>.
// ---------------------------------------------------------------------------

import { createContext, useContext, type ReactNode } from 'react';

export type OttoTheme = {
  isDark: boolean;
  // Surfaces
  bg: string;
  bgSubtle: string;
  bgMuted: string;
  // Text
  text: string;
  textSecondary: string;
  textMuted: string;
  // Borders
  border: string;
  borderSubtle: string;
  // Brand
  brand: string;
  brandHover: string;
  brandText: string;
  // Semantic
  error: string;
  errorBg: string;
  errorBorder: string;
  success: string;
  warning: string;
  // Interactive
  btnPrimaryBg: string;
  btnPrimaryText: string;
  btnSecondaryBg: string;
  btnSecondaryText: string;
  btnSecondaryBorder: string;
};

const LIGHT_THEME: OttoTheme = {
  isDark: false,
  bg: '#ffffff',
  bgSubtle: '#f9fafb',
  bgMuted: '#f3f4f6',
  text: '#1f2937',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  border: '#e5e7eb',
  borderSubtle: '#f3f4f6',
  brand: '#0c93e7',
  brandHover: '#0074c5',
  brandText: '#0074c5',
  error: '#991b1b',
  errorBg: '#fef2f2',
  errorBorder: '#fecaca',
  success: '#16a34a',
  warning: '#d97706',
  btnPrimaryBg: '#0c93e7',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f4f6',
  btnSecondaryText: '#374151',
  btnSecondaryBorder: '#e5e7eb',
};

const DARK_THEME: OttoTheme = {
  isDark: true,
  bg: '#1f2937',
  bgSubtle: '#111827',
  bgMuted: '#374151',
  text: '#e5e7eb',
  textSecondary: '#9ca3af',
  textMuted: '#6b7280',
  border: '#374151',
  borderSubtle: '#1f2937',
  brand: '#40C4F5',
  brandHover: '#0c93e7',
  brandText: '#93c5fd',
  error: '#fca5a5',
  errorBg: '#450a0a',
  errorBorder: '#7f1d1d',
  success: '#4ade80',
  warning: '#fbbf24',
  btnPrimaryBg: '#0c93e7',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#374151',
  btnSecondaryText: '#e5e7eb',
  btnSecondaryBorder: '#4b5563',
};

const ThemeContext = createContext<OttoTheme>(LIGHT_THEME);

export function ThemeProvider({ isDark, children }: { isDark: boolean; children: ReactNode }) {
  return (
    <ThemeContext.Provider value={isDark ? DARK_THEME : LIGHT_THEME}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): OttoTheme {
  return useContext(ThemeContext);
}
