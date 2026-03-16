// ---------------------------------------------------------------------------
// Settings: Brand Color Form
//
// Hue slider (0-360) that controls the entire Otto color palette.
// Includes live preview mockups showing what an inline comment and
// MR overview header would look like at the selected hue.
//
// The preview uses the same generateTheme() function that the real
// injected UI uses, so what you see here is exactly what you get.
// ---------------------------------------------------------------------------

import { useState, useMemo, useCallback } from 'react';
import type { OttoSettings, Preferences } from '@/types/settings';
import { generateTheme, getLogoColor, DEFAULT_HUE, hslToHex } from '@/lib/palette';
import type { OttoTheme } from '@/components/ThemeContext';
import { OttoLogo } from '@/components/OttoLogo';

type BrandColorFormProps = {
  settings: OttoSettings;
  onUpdate: (updates: Partial<Preferences>) => Promise<void>;
  isDark: boolean;
  optionsTheme: {
    text: string;
    textMuted: string;
    border: string;
    cardBg: string;
  };
};

export function BrandColorForm({ settings, onUpdate, isDark, optionsTheme: ot }: BrandColorFormProps) {
  const savedHue = settings.preferences.brandHue ?? DEFAULT_HUE;
  // Local state for instant slider feedback — only persists on change end
  const [liveHue, setLiveHue] = useState(savedHue);
  const [isDragging, setIsDragging] = useState(false);

  const activeHue = isDragging ? liveHue : savedHue;
  const theme = useMemo(() => generateTheme(activeHue, isDark), [activeHue, isDark]);
  const logoColor = useMemo(() => getLogoColor(activeHue), [activeHue]);

  const handleInput = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    setLiveHue(parseInt((e.target as HTMLInputElement).value, 10));
    setIsDragging(true);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const hue = parseInt(e.target.value, 10);
    setLiveHue(hue);
    setIsDragging(false);
    onUpdate({ brandHue: hue });
  }, [onUpdate]);

  const handleReset = useCallback(() => {
    setLiveHue(DEFAULT_HUE);
    setIsDragging(false);
    onUpdate({ brandHue: DEFAULT_HUE });
  }, [onUpdate]);

  const isDefault = activeHue === DEFAULT_HUE;

  return (
    <div style={{
      marginBottom: '24px',
      padding: '16px',
      border: `1px solid ${ot.border}`,
      borderRadius: '8px',
      background: ot.cardBg,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: ot.text }}>
          Brand Color
        </h3>
        <div style={{
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          background: theme.brand,
          flexShrink: 0,
          border: `1px solid ${ot.border}`,
        }} />
      </div>
      <p style={{ margin: '0 0 16px', fontSize: '13px', color: ot.textMuted }}>
        Shift the entire Otto palette by changing the base hue. Affects brand colors,
        dark mode surfaces, buttons, and the logo.
      </p>

      {/* Slider */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, color: ot.text }}>
            Hue: {activeHue}°
          </label>
          {!isDefault && (
            <button
              onClick={handleReset}
              style={{
                background: 'none',
                border: 'none',
                color: theme.brand,
                fontSize: '12px',
                cursor: 'pointer',
                padding: '0',
                fontWeight: 500,
              }}
            >
              Reset to default (207°)
            </button>
          )}
        </div>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={activeHue}
          onInput={handleInput}
          onChange={handleChange}
          style={{
            width: '100%',
            cursor: 'pointer',
            height: '6px',
            borderRadius: '3px',
            appearance: 'none',
            WebkitAppearance: 'none',
            background: 'linear-gradient(to right, hsl(0,90%,48%), hsl(30,90%,48%), hsl(60,90%,48%), hsl(90,90%,48%), hsl(120,90%,48%), hsl(150,90%,48%), hsl(180,90%,48%), hsl(210,90%,48%), hsl(240,90%,48%), hsl(270,90%,48%), hsl(300,90%,48%), hsl(330,90%,48%), hsl(360,90%,48%))',
            outline: 'none',
          }}
        />
      </div>

      {/* Color swatches row */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {[
          { label: 'Brand', color: theme.brand },
          { label: 'Hover', color: theme.brandHover },
          { label: 'Text', color: theme.brandText },
          { label: 'Surface', color: theme.bg },
          { label: 'Border', color: theme.border },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '12px',
              height: '12px',
              borderRadius: '3px',
              background: color,
              border: `1px solid ${ot.border}`,
              flexShrink: 0,
            }} />
            <span style={{ fontSize: '11px', color: ot.textMuted }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Live Preview */}
      <div style={{ fontSize: '12px', fontWeight: 500, color: ot.textMuted, marginBottom: '8px' }}>
        Preview
      </div>
      <div style={{
        display: 'flex',
        gap: '12px',
        flexWrap: 'wrap',
      }}>
        <InlineCommentPreview theme={theme} logoColor={logoColor} />
        <OverviewPreview theme={theme} logoColor={logoColor} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview: Inline Comment
// ---------------------------------------------------------------------------

function InlineCommentPreview({ theme: t, logoColor }: { theme: OttoTheme; logoColor: string }) {
  return (
    <div style={{
      flex: '1 1 280px',
      minWidth: '260px',
      background: t.bg,
      border: `1px solid ${t.border}`,
      borderRadius: '8px',
      overflow: 'hidden',
      fontSize: '12px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 10px',
        borderBottom: `1px solid ${t.border}`,
        background: t.bgSubtle,
      }}>
        <OttoLogo size={14} brandColor={logoColor} />
        <span style={{ fontWeight: 600, color: t.text, fontSize: '11px' }}>Otto</span>
        <span style={{
          marginLeft: 'auto',
          padding: '1px 6px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: 600,
          background: t.warningBg,
          color: t.warning,
        }}>
          warning
        </span>
      </div>
      {/* Body */}
      <div style={{ padding: '8px 10px' }}>
        <p style={{ margin: '0 0 6px', color: t.text, lineHeight: '1.4' }}>
          Consider adding null check before accessing <code style={{
            padding: '1px 4px',
            borderRadius: '3px',
            background: t.bgMuted,
            fontSize: '11px',
            color: t.brandText,
          }}>user.settings</code> — this could throw if the user object is undefined.
        </p>
        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: 500,
            background: t.successBg,
            color: t.success,
            border: `1px solid ${t.isDark ? '#065f46' : '#86efac'}`,
          }}>
            Accept
          </span>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: 500,
            background: t.errorBg,
            color: t.error,
            border: `1px solid ${t.errorBorder}`,
          }}>
            Dismiss
          </span>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: 500,
            background: t.btnPrimaryBg,
            color: t.btnPrimaryText,
          }}>
            Follow Up
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview: MR Overview Header
// ---------------------------------------------------------------------------

function OverviewPreview({ theme: t, logoColor }: { theme: OttoTheme; logoColor: string }) {
  return (
    <div style={{
      flex: '1 1 280px',
      minWidth: '260px',
      background: t.bg,
      border: `1px solid ${t.border}`,
      borderRadius: '8px',
      overflow: 'hidden',
      fontSize: '12px',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 10px',
        borderBottom: `1px solid ${t.border}`,
        background: t.bgSubtle,
      }}>
        <OttoLogo size={16} brandColor={logoColor} />
        <span style={{ fontWeight: 600, color: t.text, fontSize: '12px' }}>MR Review</span>
        <span style={{
          marginLeft: 'auto',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: 600,
          background: t.btnPrimaryBg,
          color: t.btnPrimaryText,
        }}>
          Review MR
        </span>
      </div>
      {/* Stats row */}
      <div style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
          {[
            { label: 'Files', value: '12' },
            { label: 'Issues', value: '3' },
            { label: 'Score', value: '7.2' },
          ].map(({ label, value }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 600, color: t.text, fontSize: '13px' }}>{value}</div>
              <div style={{ color: t.textMuted, fontSize: '10px' }}>{label}</div>
            </div>
          ))}
        </div>
        {/* Task dots */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {['Summary', 'Review', 'Edge Cases'].map((task, i) => (
            <div key={task} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: i === 0 ? t.success : i === 1 ? t.brand : t.bgMuted,
              }} />
              <span style={{ fontSize: '10px', color: t.textSecondary }}>{task}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
