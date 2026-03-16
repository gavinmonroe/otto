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
//
// The theme is now generated dynamically from a brand hue (0-360) via
// the palette generator. The default hue (207) produces the original
// midnight blue palette, so existing behavior is preserved when no
// hue is specified.
// ---------------------------------------------------------------------------

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { generateTheme, DEFAULT_HUE } from '@/lib/palette';

export type OttoTheme = {
  isDark: boolean;
  // Surfaces
  bg: string;
  bgSubtle: string;
  bgMuted: string;
  bgInset: string;
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
  logoColor: string;
  // Semantic
  error: string;
  errorBg: string;
  errorBorder: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  info: string;
  infoBg: string;
  // Interactive
  btnPrimaryBg: string;
  btnPrimaryText: string;
  btnSecondaryBg: string;
  btnSecondaryText: string;
  btnSecondaryBorder: string;
};

// Static defaults for the context initial value and non-React consumers.
// Generated once at module load — identical to the old hardcoded LIGHT_THEME.
const DEFAULT_THEME = generateTheme(DEFAULT_HUE, false);

const ThemeContext = createContext<OttoTheme>(DEFAULT_THEME);

type ThemeProviderProps = {
  isDark: boolean;
  /** Brand hue (0-360). Defaults to 207 (midnight blue). */
  hue?: number;
  children: ReactNode;
};

export function ThemeProvider({ isDark, hue, children }: ThemeProviderProps) {
  const resolvedHue = hue ?? DEFAULT_HUE;
  const theme = useMemo(() => generateTheme(resolvedHue, isDark), [resolvedHue, isDark]);

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): OttoTheme {
  return useContext(ThemeContext);
}
