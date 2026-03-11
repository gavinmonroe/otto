// ---------------------------------------------------------------------------
// Typed chrome.storage wrapper.
//
// Design decisions:
// - Single source of truth for reading/writing OttoSettings.
// - Validates shape on read (returns defaults if storage is empty or corrupt).
// - Never caches in memory — always reads fresh from storage. This is critical
//   because the service worker can be terminated and restarted at any time.
//   In-memory caches would be stale after restart.
// - Uses chrome.storage.local (not sync) because PATs and API keys should
//   not be synced across devices.
// ---------------------------------------------------------------------------

import type { OttoSettings } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';

const STORAGE_KEY = 'otto_settings';

/**
 * Read settings from chrome.storage.local.
 * Returns DEFAULT_SETTINGS if nothing is stored yet.
 * Merges stored values over defaults so new fields added in updates
 * get their default values without losing existing user config.
 */
export async function loadSettings(): Promise<OttoSettings> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (!stored || typeof stored !== 'object') {
      return DEFAULT_SETTINGS;
    }
    // Deep merge: stored values override defaults, but missing keys get defaults.
    // This handles extension updates that add new settings fields.
    return deepMerge(DEFAULT_SETTINGS, stored) as OttoSettings;
  } catch {
    // Storage access can fail in rare cases (e.g., extension context invalidated)
    return DEFAULT_SETTINGS;
  }
}

/**
 * Write settings to chrome.storage.local.
 * Overwrites the entire settings object (not a partial update).
 */
export async function saveSettings(settings: OttoSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

/**
 * Listen for settings changes. Returns an unsubscribe function.
 * Used by the content script to react to settings changes made in the options page.
 */
export function onSettingsChange(callback: (settings: OttoSettings) => void): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
    if (changes[STORAGE_KEY]) {
      const newValue = changes[STORAGE_KEY].newValue;
      if (newValue) {
        callback(deepMerge(DEFAULT_SETTINGS, newValue) as OttoSettings);
      }
    }
  };
  chrome.storage.local.onChanged.addListener(listener);
  return () => chrome.storage.local.onChanged.removeListener(listener);
}

// ---------------------------------------------------------------------------
// Deep merge utility — merges source into target recursively.
// Arrays are replaced, not merged (we want the stored array, not a concat).
// ---------------------------------------------------------------------------

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}
