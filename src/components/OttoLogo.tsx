// ---------------------------------------------------------------------------
// OttoLogo — the official Otto logo as a React component.
//
// Uses the real Otto SVG with `currentColor` for the lightning bolt paths
// so they adapt to light/dark mode automatically. The brand-colored paths
// use the theme's logoColor by default (via ThemeContext), or an explicit
// `brandColor` prop if provided.
//
// Props:
// - size: pixel dimension (square), defaults to 24
// - className: optional CSS class
// - brandColor: optional override — if omitted, reads from ThemeContext
// ---------------------------------------------------------------------------

import { useContext } from 'react';
import { useTheme } from '@/components/ThemeContext';

type OttoLogoProps = {
  size?: number;
  className?: string;
  brandColor?: string;
};

export function OttoLogo({ size = 24, className, brandColor }: OttoLogoProps) {
  // Read from theme context if no explicit brandColor was passed.
  // Falls back to #40C4F5 if used outside a ThemeProvider (e.g., loading states).
  let fill: string;
  try {
    const theme = useTheme();
    fill = brandColor ?? theme.logoColor ?? '#40C4F5';
  } catch {
    fill = brandColor ?? '#40C4F5';
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 240 240"
      className={className}
      aria-label="Otto logo"
      role="img"
    >
      <path
        d="m118.4 6c-18.62 0-34.25 3.25-47.21 10.22-19.74 10.41-33.86 25.89-41.04 47.45-0.72 2.25-0.04 3.3 2.14 3.3h13.71c2.17 0 3.33-1.21 4.25-3.11 5.63-11.59 13.53-21.7 25.62-28.75 12.09-7.04 26.8-10.37 42.53-10.37 44.71 0 78.8 34.07 78.8 75.57 0 23.81-11.45 40.75-26.2 58.73-11.95 14.45-20.2 24.34-20.2 39.65v33.12c0 1.94 0.96 2.68 2.46 2.68h13.64c1.86 0 2.51-1.15 2.51-2.97v-35.16c0-10.33 9.51-18.7 16.78-27.39 15.53-18.98 29.85-37.41 29.57-68.26-0.5-46.16-34.61-94.71-97.36-94.71z"
        fill={fill}
      />
      <path
        d="m94.95 193.3h-36.57c-7.58 0-11.96-5.35-11.96-12.14v-15.41c0-1.89-1.25-2.82-2.75-2.82h-13.48c-1.97 0-2.97 1.05-2.97 2.82v14.6c0 15.78 10.99 31.18 30.39 31.18h19.2c2.26 0 3.04 1.15 3.04 3.13v16.03c0 2.04 1.06 3.19 2.77 3.19h12.47c1.81 0 2.62-1.15 2.62-3.19v-34.51c0-1.89-0.93-2.88-2.76-2.88z"
        fill={fill}
      />
      <path
        d="m24.61 83.01c-1.02 0-2.61 0.76-2.61 2.42v14.48c0 1.44 0.88 2.45 2.41 2.45h19.58c2.08 0 2.42 1.48 1.4 3.37l-18.43 31.89c-1.17 2.19-0.47 3.09 1.66 3.09h15.99c1.74 0 2.52-0.98 3.65-2.96l27.67-47.66c2.13-3.74-0.1-7.21-3.7-7.21l-47.62 0.13z"
        fill="currentColor"
      />
      <path
        d="m145.2 83.12c-0.83-1.26-1.6-1.13-3.1-0.98l-55.93 0.55c-3.69 0-4.99 4.42-2.87 7.51l6.73 11.34 61.83-0.42c2.86 0 3.34-1.74 2.21-3.85l-8.87-14.15z"
        fill="currentColor"
      />
    </svg>
  );
}
