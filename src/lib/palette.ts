// ---------------------------------------------------------------------------
// Palette Generator — derives the entire Otto color system from a single hue.
//
// Design decisions:
// - One hue value (0-360) controls the entire brand palette, dark/light
//   surface tints, CSS custom properties, and logo color.
// - The default hue is 207 (Otto's midnight blue). All existing hardcoded
//   colors were reverse-engineered to extract their S/L curves, which are
//   now parameterized by hue.
// - Dark-mode surfaces get a subtle tint of the brand hue (low saturation)
//   so the whole UI feels cohesive regardless of chosen color.
// - Semantic colors (red, green, amber, indigo) are NOT affected by hue.
//   They stay fixed because their meaning is tied to their color.
// - All color math is pure functions with zero side effects.
// ---------------------------------------------------------------------------

import type { OttoTheme } from '@/components/ThemeContext';

/** The default Otto brand hue — midnight blue. */
export const DEFAULT_HUE = 207;

// ---------------------------------------------------------------------------
// Global brand hue — set once by the content script at startup.
// ThemeProvider uses this as its fallback when no explicit `hue` prop is
// passed, so every shadow DOM mount automatically gets the user's configured
// hue without manual threading.
// ---------------------------------------------------------------------------
let globalBrandHue: number | undefined;

/** Set the global brand hue. Call once from the content script after reading settings. */
export function setGlobalBrandHue(hue: number): void {
  globalBrandHue = hue;
}

/** Get the global brand hue, falling back to DEFAULT_HUE if not set. */
export function getGlobalBrandHue(): number {
  return globalBrandHue ?? DEFAULT_HUE;
}

// ---------------------------------------------------------------------------
// HSL ↔ Hex conversion
// ---------------------------------------------------------------------------

/** Convert HSL (h: 0-360, s: 0-100, l: 0-100) to hex string. */
export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = ln - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.max(0, Math.min(1, color)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Format as CSS hsl() string. */
function hsl(h: number, s: number, l: number): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** Format as CSS hsla() string. */
function hsla(h: number, s: number, l: number, a: number): string {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

// ---------------------------------------------------------------------------
// Brand ramp — the otto-50 through otto-950 equivalent for any hue.
//
// These S/L pairs were extracted from the original otto-* palette at hue 207.
// The pattern: high lightness + low saturation at the light end, low lightness
// + moderate saturation at the dark end, with peak saturation at 500.
// ---------------------------------------------------------------------------

type RampStep = { s: number; l: number };

const RAMP_CURVES: Record<string, RampStep> = {
  '50':  { s: 100, l: 97 },
  '100': { s: 97,  l: 94 },
  '200': { s: 96,  l: 86 },
  '300': { s: 95,  l: 74 },
  '400': { s: 92,  l: 59 },
  '500': { s: 90,  l: 48 },
  '600': { s: 100, l: 39 },
  '700': { s: 100, l: 31 },
  '800': { s: 90,  l: 27 },
  '900': { s: 82,  l: 24 },
  '950': { s: 82,  l: 16 },
};

export type BrandRamp = Record<string, string>;

/** Generate the full 50-950 brand color ramp for a given hue. */
export function generateBrandRamp(hue: number): BrandRamp {
  const ramp: BrandRamp = {};
  for (const [step, { s, l }] of Object.entries(RAMP_CURVES)) {
    ramp[step] = hslToHex(hue, s, l);
  }
  return ramp;
}

// ---------------------------------------------------------------------------
// Theme generation — produces a full OttoTheme from hue + dark/light.
//
// Brand-derived colors shift with the hue. Semantic colors stay fixed.
// Dark-mode surfaces use the brand hue at very low saturation for tinting.
// ---------------------------------------------------------------------------

/** Get the primary brand hex for a given hue and mode. */
export function getBrandColor(hue: number, isDark: boolean): string {
  // Light: otto-500 equivalent. Dark: lighter, more vivid variant.
  return isDark ? hslToHex(hue, 85, 61) : hslToHex(hue, 90, 48);
}

/** Get the logo SVG fill color for a given hue. */
export function getLogoColor(hue: number): string {
  // The logo uses the bright/vivid variant (#40C4F5 at hue 207 = hsl(193, 90%, 61%))
  // Actually the logo color is a slightly different hue — it's shifted ~14° cooler.
  // We preserve that offset: logo hue = brand hue - 14, clamped to 0-360.
  const logoHue = ((hue - 14) % 360 + 360) % 360;
  return hslToHex(logoHue, 90, 61);
}

export function generateTheme(hue: number, isDark: boolean): OttoTheme {
  const ramp = generateBrandRamp(hue);

  if (isDark) {
    return {
      isDark: true,
      // Surfaces — brand-tinted dark grays
      bg:          hslToHex(hue, 20, 17),   // was #1f2937 (hsl(215, 28%, 17%))
      bgSubtle:    hslToHex(hue, 30, 11),   // was #111827 (hsl(222, 47%, 11%))
      bgMuted:     hslToHex(hue, 14, 27),   // was #374151 (hsl(218, 20%, 27%))
      bgInset:     hslToHex(hue, 22, 17),   // was #1e293b (hsl(217, 33%, 17%))
      // Text — neutral, not tinted (readability)
      text:        '#e5e7eb',
      textSecondary: '#9ca3af',
      textMuted:   '#6b7280',
      // Borders — subtle brand tint
      border:      hslToHex(hue, 14, 27),   // matches bgMuted
      borderSubtle: hslToHex(hue, 20, 17),  // matches bg
      // Brand
      brand:       hslToHex(hue, 85, 61),   // was #40C4F5
      brandHover:  hslToHex(hue, 90, 48),   // was #0c93e7
      brandText:   hslToHex(hue, 95, 82),   // was #93c5fd
      logoColor:   getLogoColor(hue),
      // Semantic — fixed, not hue-shifted
      error:       '#fca5a5',
      errorBg:     '#450a0a',
      errorBorder: '#7f1d1d',
      success:     '#4ade80',
      successBg:   '#064e3b',
      successBorder: '#14532d',
      warning:     '#fbbf24',
      warningBg:   '#451a03',
      warningBorder: '#78350f',
      info:        '#93c5fd',
      infoBg:      '#1e3a5f',
      infoBorder:  '#1e40af',
      // Interactive
      btnPrimaryBg:      hslToHex(hue, 90, 48),
      btnPrimaryText:    '#ffffff',
      btnSecondaryBg:    hslToHex(hue, 14, 27),
      btnSecondaryText:  '#e5e7eb',
      btnSecondaryBorder: hslToHex(hue, 12, 35),
    };
  }

  return {
    isDark: false,
    // Surfaces — white/near-white (no tint in light mode)
    bg:          '#ffffff',
    bgSubtle:    '#f9fafb',
    bgMuted:     '#f3f4f6',
    bgInset:     '#f8fafc',
    // Text
    text:        hslToHex(hue, 20, 17),     // was #1f2937 — subtle brand tint
    textSecondary: '#6b7280',
    textMuted:   '#9ca3af',
    // Borders
    border:      '#e5e7eb',
    borderSubtle: '#f3f4f6',
    // Brand
    brand:       hslToHex(hue, 90, 48),     // was #0c93e7
    brandHover:  hslToHex(hue, 100, 39),    // was #0074c5
    brandText:   hslToHex(hue, 100, 39),    // was #0074c5
    logoColor:   getLogoColor(hue),
    // Semantic — fixed
    error:       '#991b1b',
    errorBg:     '#fef2f2',
    errorBorder: '#fecaca',
    success:     '#16a34a',
    successBg:   '#f0fdf4',
    successBorder: '#bbf7d0',
    warning:     '#d97706',
    warningBg:   '#fffbeb',
    warningBorder: '#fde68a',
    info:        '#2563eb',
    infoBg:      '#eff6ff',
    infoBorder:  '#bfdbfe',
    // Interactive
    btnPrimaryBg:      hslToHex(hue, 90, 48),
    btnPrimaryText:    '#ffffff',
    btnSecondaryBg:    '#f3f4f6',
    btnSecondaryText:  hslToHex(hue, 14, 27),
    btnSecondaryBorder: '#e5e7eb',
  };
}

// ---------------------------------------------------------------------------
// CSS custom properties — for the shadow DOM style.css overrides.
// Returns raw HSL triplets (without the hsl() wrapper) matching the
// shadcn convention used in style.css.
// ---------------------------------------------------------------------------

export type CssVariableMap = Record<string, string>;

export function generateCssVariables(hue: number, isDark: boolean): CssVariableMap {
  if (isDark) {
    return {
      '--background':             `${hue} 30 4.9`,
      '--foreground':             '210 40 98',
      '--card':                   `${hue} 30 4.9`,
      '--card-foreground':        '210 40 98',
      '--popover':                `${hue} 30 4.9`,
      '--popover-foreground':     '210 40 98',
      '--primary':                `${hue} 90 54`,
      '--primary-foreground':     `${hue} 47.4 11.2`,
      '--secondary':              `${hue} 25 17.5`,
      '--secondary-foreground':   '210 40 98',
      '--muted':                  `${hue} 25 17.5`,
      '--muted-foreground':       `${hue} 20.2 65.1`,
      '--accent':                 `${hue} 25 17.5`,
      '--accent-foreground':      '210 40 98',
      '--destructive':            '0 62.8 30.6',
      '--destructive-foreground': '210 40 98',
      '--border':                 `${hue} 25 17.5`,
      '--input':                  `${hue} 25 17.5`,
      '--ring':                   `${hue} 90 54`,
    };
  }

  return {
    '--background':             '0 0 100',
    '--foreground':             `${hue} 84 4.9`,
    '--card':                   '0 0 100',
    '--card-foreground':        `${hue} 84 4.9`,
    '--popover':                '0 0 100',
    '--popover-foreground':     `${hue} 84 4.9`,
    '--primary':                `${hue} 90 54`,
    '--primary-foreground':     '210 40 98',
    '--secondary':              '210 40 96.1',
    '--secondary-foreground':   `${hue} 47.4 11.2`,
    '--muted':                  '210 40 96.1',
    '--muted-foreground':       `${hue} 16.3 46.9`,
    '--accent':                 '210 40 96.1',
    '--accent-foreground':      `${hue} 47.4 11.2`,
    '--destructive':            '0 84.2 60.2',
    '--destructive-foreground': '210 40 98',
    '--border':                 `${hue} 31.8 91.4`,
    '--input':                  `${hue} 31.8 91.4`,
    '--ring':                   `${hue} 90 54`,
  };
}

// ---------------------------------------------------------------------------
// Helpers for non-React injectors that need a few brand-derived colors
// without importing the full theme.
// ---------------------------------------------------------------------------

export type InjectorColors = {
  brand: string;
  brandHover: string;
  brandTintBg: string;    // very subtle brand background (for hover states)
  brandBorder: string;    // brand-tinted border
  surfaceDark: string;    // dark surface (for dark mode containers)
  surfaceDarkBorder: string;
  textOnDark: string;     // light text for dark surfaces
};

export function getInjectorColors(hue: number, isDark: boolean): InjectorColors {
  if (isDark) {
    return {
      brand:            hslToHex(hue, 85, 61),
      brandHover:       hslToHex(hue, 90, 48),
      brandTintBg:      hsla(hue, 85, 61, 0.1),
      brandBorder:      hslToHex(hue, 14, 27),
      surfaceDark:      hslToHex(hue, 20, 17),
      surfaceDarkBorder: hslToHex(hue, 14, 27),
      textOnDark:       '#e5e7eb',
    };
  }
  return {
    brand:            hslToHex(hue, 90, 48),
    brandHover:       hslToHex(hue, 100, 39),
    brandTintBg:      hsla(hue, 90, 48, 0.08),
    brandBorder:      hslToHex(hue, 96, 86),
    surfaceDark:      '#f9fafb',
    surfaceDarkBorder: '#e5e7eb',
    textOnDark:       hslToHex(hue, 14, 27),
  };
}

// ---------------------------------------------------------------------------
// Options page theme — separate from OttoTheme because the options page
// uses its own simpler theme structure.
// ---------------------------------------------------------------------------

export type OptionsThemeColors = {
  bg: string;
  text: string;
  textMuted: string;
  border: string;
  cardBg: string;
  subtleBg: string;
  inputBg: string;
  error: string;
  errorBg: string;
  errorBorder: string;
};

export function generateOptionsTheme(hue: number, isDark: boolean): OptionsThemeColors {
  if (isDark) {
    return {
      bg:          hslToHex(hue, 30, 11),
      text:        '#f3f4f6',
      textMuted:   '#9ca3af',
      border:      hslToHex(hue, 14, 27),
      cardBg:      hslToHex(hue, 20, 17),
      subtleBg:    hslToHex(hue, 25, 14),
      inputBg:     hslToHex(hue, 14, 27),
      error:       '#fca5a5',
      errorBg:     '#450a0a',
      errorBorder: '#7f1d1d',
    };
  }
  return {
    bg:          '#ffffff',
    text:        '#111827',
    textMuted:   '#6b7280',
    border:      '#e5e7eb',
    cardBg:      '#ffffff',
    subtleBg:    '#f9fafb',
    inputBg:     '#ffffff',
    error:       '#991b1b',
    errorBg:     '#fef2f2',
    errorBorder: '#fecaca',
  };
}
