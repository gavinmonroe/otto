// ---------------------------------------------------------------------------
// Reviewer Preferences — learns from accept/dismiss patterns across MRs.
//
// Stored per GitLab host so different orgs can have different learned
// preferences. Also supports per-repo custom facts (user-provided context
// that gets injected into AI prompts).
//
// Storage key: `otto_reviewer_prefs:{hostUrl}`
// ---------------------------------------------------------------------------

import type { ReviewCommentCategory, ReviewCommentSeverity } from '@/types/review';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewerSignal = {
  category: ReviewCommentCategory;
  severity: ReviewCommentSeverity;
  action: 'accepted' | 'dismissed';
};

/** Per category:severity pair — how many times accepted vs dismissed. */
export type SignalStats = {
  accepted: number;
  dismissed: number;
};

/** Per-repo custom facts the user can provide for additional AI context. */
export type RepoFact = {
  projectPath: string;   // e.g. "radialogica-llc/fullaccess/fullAccess"
  facts: string;         // Free-text context, e.g. "This is a .NET 8 project using Clean Architecture..."
};

export type ReviewerPreferences = {
  version: 1;
  totalReviews: number;
  signals: Record<string, SignalStats>;  // key = "category:severity"
  repoFacts: RepoFact[];
  updatedAt: number;
};

const STORAGE_PREFIX = 'otto_reviewer_prefs:';
const MIN_SIGNALS_FOR_PREFERENCE = 2;
const DISMISS_THRESHOLD = 0.7;   // >70% dismissed = low priority
const ACCEPT_THRESHOLD = 0.3;    // <30% dismissed = high priority

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function storageKey(hostUrl: string): string {
  return `${STORAGE_PREFIX}${hostUrl.replace(/\/+$/, '').toLowerCase()}`;
}

function defaultPrefs(): ReviewerPreferences {
  return {
    version: 1,
    totalReviews: 0,
    signals: {},
    repoFacts: [],
    updatedAt: Date.now(),
  };
}

export async function loadPreferences(hostUrl: string): Promise<ReviewerPreferences> {
  const key = storageKey(hostUrl);
  const result = await chrome.storage.local.get(key);
  const stored = result[key] as ReviewerPreferences | undefined;
  return stored ?? defaultPrefs();
}

export async function savePreferences(hostUrl: string, prefs: ReviewerPreferences): Promise<void> {
  const key = storageKey(hostUrl);
  prefs.updatedAt = Date.now();
  await chrome.storage.local.set({ [key]: prefs });
}

export async function resetPreferences(hostUrl: string): Promise<void> {
  const key = storageKey(hostUrl);
  await chrome.storage.local.remove(key);
}

// ---------------------------------------------------------------------------
// Signal recording
// ---------------------------------------------------------------------------

function signalKey(category: ReviewCommentCategory, severity: ReviewCommentSeverity): string {
  return `${category}:${severity}`;
}

export async function recordSignal(hostUrl: string, signal: ReviewerSignal): Promise<void> {
  const prefs = await loadPreferences(hostUrl);
  const key = signalKey(signal.category, signal.severity);

  if (!prefs.signals[key]) {
    prefs.signals[key] = { accepted: 0, dismissed: 0 };
  }

  if (signal.action === 'accepted') {
    prefs.signals[key].accepted++;
  } else {
    prefs.signals[key].dismissed++;
  }

  await savePreferences(hostUrl, prefs);
}

export async function incrementReviewCount(hostUrl: string): Promise<void> {
  const prefs = await loadPreferences(hostUrl);
  prefs.totalReviews++;
  await savePreferences(hostUrl, prefs);
}

// ---------------------------------------------------------------------------
// Repo facts management
// ---------------------------------------------------------------------------

export async function setRepoFact(hostUrl: string, projectPath: string, facts: string): Promise<void> {
  const prefs = await loadPreferences(hostUrl);
  const existing = prefs.repoFacts.findIndex((f) => f.projectPath === projectPath);

  if (facts.trim()) {
    if (existing >= 0) {
      prefs.repoFacts[existing].facts = facts.trim();
    } else {
      prefs.repoFacts.push({ projectPath, facts: facts.trim() });
    }
  } else if (existing >= 0) {
    prefs.repoFacts.splice(existing, 1);
  }

  await savePreferences(hostUrl, prefs);
}

export function getRepoFact(prefs: ReviewerPreferences, projectPath: string): string | null {
  const fact = prefs.repoFacts.find((f) => f.projectPath === projectPath);
  return fact?.facts ?? null;
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

type PreferenceEntry = {
  key: string;
  category: string;
  severity: string;
  total: number;
  dismissRate: number;
};

function computePreferenceEntries(prefs: ReviewerPreferences): {
  lowPriority: PreferenceEntry[];
  highPriority: PreferenceEntry[];
} {
  const lowPriority: PreferenceEntry[] = [];
  const highPriority: PreferenceEntry[] = [];

  for (const [key, stats] of Object.entries(prefs.signals)) {
    const total = stats.accepted + stats.dismissed;
    if (total < MIN_SIGNALS_FOR_PREFERENCE) continue;

    const dismissRate = stats.dismissed / total;
    const [category, severity] = key.split(':');
    const entry: PreferenceEntry = { key, category, severity, total, dismissRate };

    if (dismissRate >= DISMISS_THRESHOLD) {
      lowPriority.push(entry);
    } else if (dismissRate <= ACCEPT_THRESHOLD) {
      highPriority.push(entry);
    }
  }

  // Sort by strength of signal
  lowPriority.sort((a, b) => b.dismissRate - a.dismissRate);
  highPriority.sort((a, b) => a.dismissRate - b.dismissRate);

  return { lowPriority, highPriority };
}

/**
 * Format reviewer preferences as a prompt section for the AI.
 * Returns null if there are no meaningful preferences yet.
 */
export function formatPreferencesForPrompt(
  prefs: ReviewerPreferences,
  projectPath?: string,
): string | null {
  const { lowPriority, highPriority } = computePreferenceEntries(prefs);
  const repoFact = projectPath ? getRepoFact(prefs, projectPath) : null;

  if (lowPriority.length === 0 && highPriority.length === 0 && !repoFact) {
    return null;
  }

  const sections: string[] = [];

  if (repoFact) {
    sections.push(`## Repository Context (provided by the reviewer)\n${repoFact}`);
  }

  if (lowPriority.length > 0 || highPriority.length > 0) {
    sections.push('## Reviewer Preferences (learned from past reviews)');

    if (lowPriority.length > 0) {
      sections.push(
        'This reviewer tends to dismiss these types of comments — only flag them if truly important:',
        ...lowPriority.map((e) =>
          `- ${e.category} (${e.severity}): dismissed ${Math.round(e.dismissRate * 100)}% of the time (${e.total} reviews)`,
        ),
      );
    }

    if (highPriority.length > 0) {
      sections.push(
        '\nThis reviewer values these types of comments — be thorough here:',
        ...highPriority.map((e) =>
          `- ${e.category} (${e.severity}): accepted ${Math.round((1 - e.dismissRate) * 100)}% of the time (${e.total} reviews)`,
        ),
      );
    }
  }

  return sections.join('\n');
}

/**
 * Get a summary of preferences for the settings UI.
 */
export function getPreferencesSummary(prefs: ReviewerPreferences): {
  totalReviews: number;
  totalSignals: number;
  lowPriority: Array<{ label: string; dismissRate: number; total: number }>;
  highPriority: Array<{ label: string; acceptRate: number; total: number }>;
} {
  const { lowPriority, highPriority } = computePreferenceEntries(prefs);
  const totalSignals = Object.values(prefs.signals).reduce(
    (sum, s) => sum + s.accepted + s.dismissed, 0,
  );

  return {
    totalReviews: prefs.totalReviews,
    totalSignals,
    lowPriority: lowPriority.map((e) => ({
      label: `${e.category} (${e.severity})`,
      dismissRate: e.dismissRate,
      total: e.total,
    })),
    highPriority: highPriority.map((e) => ({
      label: `${e.category} (${e.severity})`,
      acceptRate: 1 - e.dismissRate,
      total: e.total,
    })),
  };
}
