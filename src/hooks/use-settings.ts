// ---------------------------------------------------------------------------
// useSettings hook — reads and writes Otto settings from the content script
// or extension pages.
//
// In extension pages (popup, options): reads directly from chrome.storage.
// In content scripts: reads via message passing to the service worker.
//
// Design decisions:
// - Settings are loaded once on mount and refreshed on storage changes.
// - The hook provides both the current settings and update functions.
// - Updates are optimistic: local state updates immediately, then persists.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback } from 'react';
import type { OttoSettings } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { loadSettings, saveSettings, onSettingsChange } from '@/lib/storage';

export function useSettings() {
  const [settings, setSettings] = useState<OttoSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load settings on mount
  useEffect(() => {
    loadSettings()
      .then((s) => {
        setSettings(s);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load settings');
        setLoading(false);
      });
  }, []);

  // Listen for external changes (e.g., options page saves while popup is open)
  useEffect(() => {
    const unsubscribe = onSettingsChange((newSettings) => {
      setSettings(newSettings);
    });
    return unsubscribe;
  }, []);

  const updateSettings = useCallback(async (updates: Partial<OttoSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    try {
      await saveSettings(newSettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    }
  }, [settings]);

  const updateAiConfig = useCallback(async (updates: Partial<OttoSettings['ai']>) => {
    const newSettings = { ...settings, ai: { ...settings.ai, ...updates } };
    setSettings(newSettings);
    try {
      await saveSettings(newSettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    }
  }, [settings]);

  const updatePreferences = useCallback(async (updates: Partial<OttoSettings['preferences']>) => {
    const newSettings = { ...settings, preferences: { ...settings.preferences, ...updates } };
    setSettings(newSettings);
    try {
      await saveSettings(newSettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    }
  }, [settings]);

  return {
    settings,
    loading,
    error,
    updateSettings,
    updateAiConfig,
    updatePreferences,
  };
}
