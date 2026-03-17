// ---------------------------------------------------------------------------
// InquiryGutterDot — indicator in the line number gutter showing that
// a team inquiry exists for this line range (saved via Botto).
//
// Design decisions:
// - Plain DOM element (no shadow DOM needed).
// - 18x18px brand-colored pill with slide count — matches the local
//   inquiry indicator and the gutter trigger icon sizing.
// - Users icon distinguishes it from local inquiry dots.
// - Tooltip shows author + question preview.
// - Click opens the inquiry carousel at that location.
// ---------------------------------------------------------------------------

import type { TeamInquiryIndicator } from '@/types/inquiry';
import type { InjectorColors } from '@/lib/palette';

/**
 * Create a gutter dot element for a team inquiry indicator.
 * Returns the DOM element to be appended to the line number cell.
 */
export function createGutterDot(
  indicator: TeamInquiryIndicator,
  colors: InjectorColors,
  onClick: (indicator: TeamInquiryIndicator) => void,
): HTMLElement {
  const dot = document.createElement('span');
  dot.setAttribute('data-otto-team-inquiry', indicator.inquiryId);

  const preview = indicator.previewQuestion.length > 50
    ? indicator.previewQuestion.slice(0, 50) + '…'
    : indicator.previewQuestion;
  dot.title = `Team inquiry by ${indicator.author} (${indicator.slideCount} Q&A): "${preview}" — click to open`;

  dot.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    background: ${colors.brand};
    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    margin-left: 3px;
    vertical-align: middle;
    cursor: pointer;
    opacity: 0.75;
    transition: opacity 0.15s, transform 0.15s;
    flex-shrink: 0;
  `;

  // Users icon (simplified) to distinguish from local inquiry dots
  dot.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>`;

  dot.addEventListener('mouseenter', () => {
    dot.style.opacity = '1';
    dot.style.transform = 'scale(1.15)';
  });

  dot.addEventListener('mouseleave', () => {
    dot.style.opacity = '0.75';
    dot.style.transform = 'scale(1)';
  });

  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClick(indicator);
  });

  return dot;
}
