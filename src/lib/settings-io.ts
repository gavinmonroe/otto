// ---------------------------------------------------------------------------
// Settings Import/Export — team-shareable config without secrets.
//
// Design decisions:
// - Export strips all 4 sensitive fields (ai.apiKey, gitlab.hosts[].pat,
//   tickets.providers[].apiToken, botto?.apiKey) and writes a versioned
//   JSON envelope to a downloaded file.
// - Import merges by URL for array fields (gitlab.hosts by url,
//   tickets.providers by baseUrl). Matched entries get non-sensitive fields
//   updated while preserving the user's existing secrets. Unmatched entries
//   from the import are appended with empty secrets. Existing entries not
//   in the import are kept (never deletes user's hosts/providers).
// - Scalar secrets that are empty in the import are preserved from current.
// - Validation is structural (are the expected shapes present?) not
//   exhaustive — we trust the user isn't hand-editing garbage into the file.
// ---------------------------------------------------------------------------

import type { OttoSettings, GitLabHost, BottoConfig } from '@/types/settings';
import type { TicketProvider } from '@/types/ticket';
import { DEFAULT_SETTINGS } from '@/types/settings';

// ---------------------------------------------------------------------------
// Export envelope
// ---------------------------------------------------------------------------

export type ConfigEnvelope = {
  otto: true;           // magic marker so we can identify our files
  version: 1;
  exportedAt: string;   // ISO 8601
  settings: OttoSettings;
};

// ---------------------------------------------------------------------------
// Strip secrets — returns a deep clone with all sensitive fields blanked.
// ---------------------------------------------------------------------------

export function stripSecrets(settings: OttoSettings): OttoSettings {
  const clone: OttoSettings = structuredClone(settings);

  // AI API key
  clone.ai.apiKey = '';

  // GitLab PATs
  for (const host of clone.gitlab.hosts) {
    host.pat = '';
  }

  // Jira API tokens
  for (const provider of clone.tickets.providers) {
    provider.apiToken = '';
  }

  // Botto API key
  if (clone.botto) {
    clone.botto.apiKey = '';
  }

  return clone;
}

// ---------------------------------------------------------------------------
// Export — triggers a JSON file download in the browser.
// ---------------------------------------------------------------------------

export function exportConfig(settings: OttoSettings): void {
  const envelope: ConfigEnvelope = {
    otto: true,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: stripSecrets(settings),
  };

  const json = JSON.stringify(envelope, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const a = document.createElement('a');
  a.href = url;
  a.download = `otto-config-${date}.json`;
  a.click();

  // Cleanup — small delay so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Import — reads a file, validates, and merges into current settings.
// Returns the merged settings (caller is responsible for saving).
// ---------------------------------------------------------------------------

export type ImportResult =
  | { ok: true; settings: OttoSettings; warnings: string[] }
  | { ok: false; error: string };

export async function importConfig(
  file: File,
  currentSettings: OttoSettings,
): Promise<ImportResult> {
  // --- Parse ---
  let raw: unknown;
  try {
    const text = await file.text();
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Invalid JSON file.' };
  }

  // --- Validate envelope ---
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'File does not contain a valid object.' };
  }

  const envelope = raw as Record<string, unknown>;

  if (envelope.otto !== true) {
    return { ok: false, error: 'Not an Otto config file (missing otto marker).' };
  }

  if (envelope.version !== 1) {
    return {
      ok: false,
      error: `Unsupported config version: ${envelope.version}. This version of Otto supports version 1.`,
    };
  }

  const imported = envelope.settings;
  if (!imported || typeof imported !== 'object') {
    return { ok: false, error: 'Config file is missing the settings object.' };
  }

  // --- Validate settings shape (loose) ---
  const s = imported as Record<string, unknown>;
  const shapeError = validateSettingsShape(s);
  if (shapeError) {
    return { ok: false, error: shapeError };
  }

  // --- Merge ---
  const importedSettings = imported as OttoSettings;
  const warnings: string[] = [];
  const merged = structuredClone(currentSettings);

  // AI config — merge fields, preserve apiKey if import is blank
  if (importedSettings.ai) {
    merged.ai.baseUrl = importedSettings.ai.baseUrl || merged.ai.baseUrl;
    merged.ai.apiKey = importedSettings.ai.apiKey || merged.ai.apiKey;

    if (importedSettings.ai.models) {
      merged.ai.models = { ...merged.ai.models, ...importedSettings.ai.models };
    }
    if (importedSettings.ai.temperatures) {
      merged.ai.temperatures = { ...merged.ai.temperatures, ...importedSettings.ai.temperatures };
    }
    if (importedSettings.ai.maxTokens) {
      merged.ai.maxTokens = { ...merged.ai.maxTokens, ...importedSettings.ai.maxTokens };
    }
    if (importedSettings.ai.customPrompts) {
      merged.ai.customPrompts = { ...merged.ai.customPrompts, ...importedSettings.ai.customPrompts };
    }
  }

  // GitLab hosts — merge by normalized URL
  if (importedSettings.gitlab?.hosts) {
    merged.gitlab.hosts = mergeByUrl(
      merged.gitlab.hosts,
      importedSettings.gitlab.hosts,
      (existing, incoming) => {
        const mergedHost: GitLabHost = {
          id: existing.id,                                    // keep stable ID
          url: incoming.url || existing.url,
          pat: incoming.pat || existing.pat,                  // preserve secret
          label: incoming.label || existing.label,
          username: existing.username || incoming.username,    // keep resolved username
        };
        return mergedHost;
      },
      (incoming) => {
        if (!incoming.pat) {
          warnings.push(`GitLab host "${incoming.label || incoming.url}" imported without a PAT — you'll need to add one.`);
        }
        return incoming;
      },
      (host) => host.url,
    );
  }

  // Ticket providers — merge by normalized baseUrl
  if (importedSettings.tickets?.providers) {
    merged.tickets.providers = mergeByUrl(
      merged.tickets.providers,
      importedSettings.tickets.providers,
      (existing, incoming) => {
        const mergedProvider: TicketProvider = {
          id: existing.id,
          type: incoming.type || existing.type,
          label: incoming.label || existing.label,
          baseUrl: incoming.baseUrl || existing.baseUrl,
          email: incoming.email || existing.email,
          apiToken: incoming.apiToken || existing.apiToken,   // preserve secret
          projectPrefixes: incoming.projectPrefixes?.length
            ? incoming.projectPrefixes
            : existing.projectPrefixes,
        };
        return mergedProvider;
      },
      (incoming) => {
        if (!incoming.apiToken) {
          warnings.push(`Jira provider "${incoming.label || incoming.baseUrl}" imported without an API token — you'll need to add one.`);
        }
        return incoming;
      },
      (provider) => provider.baseUrl,
    );
  }

  // Preferences — shallow merge, imported values win
  if (importedSettings.preferences) {
    merged.preferences = {
      ...merged.preferences,
      ...importedSettings.preferences,
      // enabledFeatures needs its own merge so partial imports don't wipe toggles
      enabledFeatures: {
        ...merged.preferences.enabledFeatures,
        ...(importedSettings.preferences.enabledFeatures || {}),
      },
    };
  }

  // Botto — merge if present in import, preserve apiKey if blank
  if (importedSettings.botto) {
    const currentBotto = merged.botto || { enabled: false, serverUrl: '', apiKey: '' };
    merged.botto = {
      enabled: importedSettings.botto.enabled ?? currentBotto.enabled,
      serverUrl: importedSettings.botto.serverUrl || currentBotto.serverUrl,
      apiKey: importedSettings.botto.apiKey || currentBotto.apiKey,
    } satisfies BottoConfig;

    if (!merged.botto.apiKey) {
      warnings.push('Botto imported without an API key — you\'ll need to add one.');
    }
  }
  // If import doesn't have botto at all, keep current (don't wipe it)

  return { ok: true, settings: merged, warnings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a URL for comparison: lowercase, strip trailing slash and protocol.
 * "https://GitLab.com/" and "https://gitlab.com" should match.
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.toLowerCase());
    return u.host + u.pathname.replace(/\/+$/, '');
  } catch {
    // If it's not a valid URL, just lowercase and strip slashes
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Generic merge-by-URL for array fields (hosts, providers).
 * - Matched items (same normalized URL): merged via `onMatch`
 * - Import-only items (no match in current): added via `onNew`
 * - Current-only items (no match in import): kept as-is
 */
function mergeByUrl<T>(
  current: T[],
  imported: T[],
  onMatch: (existing: T, incoming: T) => T,
  onNew: (incoming: T) => T,
  getUrl: (item: T) => string,
): T[] {
  const currentByUrl = new Map<string, T>();
  for (const item of current) {
    currentByUrl.set(normalizeUrl(getUrl(item)), item);
  }

  const seenUrls = new Set<string>();
  const result: T[] = [];

  // First pass: walk imported items, merge or add
  for (const incoming of imported) {
    const key = normalizeUrl(getUrl(incoming));
    seenUrls.add(key);

    const existing = currentByUrl.get(key);
    if (existing) {
      result.push(onMatch(existing, incoming));
    } else {
      result.push(onNew(incoming));
    }
  }

  // Second pass: keep current items not in import
  for (const item of current) {
    const key = normalizeUrl(getUrl(item));
    if (!seenUrls.has(key)) {
      result.push(item);
    }
  }

  return result;
}

/**
 * Loose structural validation — checks that the top-level shape looks like
 * OttoSettings. We don't validate every nested field because the merge
 * handles missing fields gracefully (falls back to current values).
 */
function validateSettingsShape(s: Record<string, unknown>): string | null {
  // At least one recognized top-level key must be present
  const knownKeys = ['ai', 'gitlab', 'tickets', 'preferences', 'botto'];
  const hasAny = knownKeys.some((k) => k in s);
  if (!hasAny) {
    return 'Settings object has no recognized fields (expected ai, gitlab, tickets, preferences, or botto).';
  }

  // If present, top-level keys should be objects (not strings, numbers, etc.)
  for (const key of knownKeys) {
    if (key in s && s[key] !== undefined && s[key] !== null && typeof s[key] !== 'object') {
      return `Expected "${key}" to be an object, got ${typeof s[key]}.`;
    }
  }

  return null;
}
