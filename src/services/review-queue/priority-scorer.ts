// ---------------------------------------------------------------------------
// Priority Scorer — computes review urgency for MR queue ordering.
//
// Pure function: takes MR metadata + preview data, returns a priority score.
// No API calls, no side effects, no dependencies on Chrome APIs.
//
// Scoring philosophy:
// - Higher score = should be reviewed first.
// - Weights are tuned so that a "normal" MR scores ~30-40, while a
//   high-risk, stale, urgent MR can reach 85-95.
// - No MR should ever hit exactly 100 — that would imply perfect certainty
//   about urgency, which doesn't exist.
// - Staleness is the strongest signal because stale MRs block other work.
//   Risk is second because high-risk changes need careful review.
//
// Callers:
// - Queue manager (background) calls this at enqueue time.
// - Content script calls this for display-only sorting (before enqueue).
// - Both paths use the same function — no divergence.
// ---------------------------------------------------------------------------

import type { ReviewPriority, PrioritySignal } from '@/types/review-queue';

// ---------------------------------------------------------------------------
// Input type — everything the scorer can use.
// All fields are optional because different callers have different data
// available. The scorer degrades gracefully with missing data.
// ---------------------------------------------------------------------------

export type PriorityScorerInput = {
  /** Number of files changed in the MR */
  filesChanged?: number;
  /** Total lines added */
  linesAdded?: number;
  /** Total lines removed */
  linesRemoved?: number;
  /** Risk level from a previous Otto review (if cached) */
  riskLevel?: 'low' | 'medium' | 'high';
  /** MR labels from GitLab */
  labels?: string[];
  /** ISO 8601 timestamp when the MR was created */
  createdAt?: string;
  /** ISO 8601 timestamp when the MR was last updated */
  updatedAt?: string;
  /** MR state */
  mrState?: 'opened' | 'closed' | 'merged' | 'locked';
};

// ---------------------------------------------------------------------------
// Weight configuration
// ---------------------------------------------------------------------------

/** Maximum contribution of each category to the composite score (out of 100) */
const MAX_WEIGHTS = {
  risk: 30,
  size: 20,
  staleness: 25,
  labels: 15,
  state: 10,
} as const;

/** Labels that signal urgency. Case-insensitive matching. */
const URGENT_LABELS = new Set([
  'urgent',
  'critical',
  'security',
  'hotfix',
  'p0',
  'p1',
  'priority::1',
  'priority::2',
  'severity::1',
  'severity::2',
  'bug',
  'incident',
]);

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

/**
 * Compute a review priority score for an MR.
 *
 * Returns a ReviewPriority with a 0-100 composite score, an overall
 * risk level, and human-readable signal explanations.
 *
 * The score is deterministic for the same inputs — no randomness.
 */
export function computePriority(input: PriorityScorerInput): ReviewPriority {
  const signals: PrioritySignal[] = [];
  let totalScore = 0;

  // --- Risk (0-30) ---
  const riskScore = scoreRisk(input, signals);
  totalScore += riskScore;

  // --- Size (0-20) ---
  const sizeScore = scoreSize(input, signals);
  totalScore += sizeScore;

  // --- Staleness (0-25) ---
  const stalenessScore = scoreStaleness(input, signals);
  totalScore += stalenessScore;

  // --- Label signals (0-15) ---
  const labelScore = scoreLabels(input, signals);
  totalScore += labelScore;

  // --- State bonus (0-10) ---
  const stateScore = scoreState(input, signals);
  totalScore += stateScore;

  // Clamp to 0-99 (never 100 — see header comment)
  const score = Math.min(99, Math.max(0, Math.round(totalScore)));

  // Derive overall risk level from the score + explicit risk if available
  const riskLevel = deriveRiskLevel(score, input.riskLevel);

  return { score, riskLevel, signals };
}

// ---------------------------------------------------------------------------
// Individual scoring functions
// ---------------------------------------------------------------------------

function scoreRisk(input: PriorityScorerInput, signals: PrioritySignal[]): number {
  if (!input.riskLevel) {
    // No cached review — estimate from diff size
    const totalLines = (input.linesAdded ?? 0) + (input.linesRemoved ?? 0);
    if (totalLines > 500) {
      signals.push({ label: 'Large diff (estimated high risk)', weight: 20, category: 'risk' });
      return 20;
    }
    if (totalLines > 200) {
      signals.push({ label: 'Medium diff (estimated medium risk)', weight: 12, category: 'risk' });
      return 12;
    }
    // Small diff, no risk data — minimal contribution
    return 0;
  }

  switch (input.riskLevel) {
    case 'high':
      signals.push({ label: 'High risk (from previous review)', weight: MAX_WEIGHTS.risk, category: 'risk' });
      return MAX_WEIGHTS.risk;
    case 'medium':
      signals.push({ label: 'Medium risk (from previous review)', weight: 15, category: 'risk' });
      return 15;
    case 'low':
      signals.push({ label: 'Low risk (from previous review)', weight: 5, category: 'risk' });
      return 5;
  }
}

function scoreSize(input: PriorityScorerInput, signals: PrioritySignal[]): number {
  const totalLines = (input.linesAdded ?? 0) + (input.linesRemoved ?? 0);
  const filesChanged = input.filesChanged ?? 0;

  if (totalLines === 0 && filesChanged === 0) return 0;

  // Logarithmic scaling: diminishing returns past ~500 lines.
  // log2(1) = 0, log2(32) = 5, log2(512) = 9, log2(1024) = 10
  // Normalize to 0-1 range, then scale to max weight.
  const lineScore = totalLines > 0
    ? Math.min(1, Math.log2(Math.max(1, totalLines)) / 10)
    : 0;

  // File count adds a small bonus — many files = more review surface
  const fileBonus = filesChanged > 10 ? 0.2 : filesChanged > 5 ? 0.1 : 0;

  const raw = (lineScore + fileBonus) * MAX_WEIGHTS.size;
  const score = Math.min(MAX_WEIGHTS.size, raw);

  if (score > 10) {
    signals.push({
      label: `Large diff (${totalLines} lines, ${filesChanged} files)`,
      weight: Math.round(score),
      category: 'size',
    });
  } else if (score > 5) {
    signals.push({
      label: `Medium diff (${totalLines} lines, ${filesChanged} files)`,
      weight: Math.round(score),
      category: 'size',
    });
  }

  return score;
}

function scoreStaleness(input: PriorityScorerInput, signals: PrioritySignal[]): number {
  // Prefer updatedAt (last activity), fall back to createdAt
  const dateStr = input.updatedAt ?? input.createdAt;
  if (!dateStr) return 0;

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 0;

  const daysOld = (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);

  if (daysOld < 1) return 0; // Fresh — no staleness penalty/bonus

  // Linear scaling: 1 day = ~1.8 points, 7 days = ~12.5, 14+ days = 25 (max)
  const score = Math.min(MAX_WEIGHTS.staleness, daysOld * (MAX_WEIGHTS.staleness / 14));

  if (daysOld >= 7) {
    signals.push({
      label: `Stale (${Math.round(daysOld)} days since last update)`,
      weight: Math.round(score),
      category: 'staleness',
    });
  } else if (daysOld >= 3) {
    signals.push({
      label: `Aging (${Math.round(daysOld)} days since last update)`,
      weight: Math.round(score),
      category: 'staleness',
    });
  }

  return score;
}

function scoreLabels(input: PriorityScorerInput, signals: PrioritySignal[]): number {
  if (!input.labels || input.labels.length === 0) return 0;

  const matchedLabels: string[] = [];
  for (const label of input.labels) {
    if (URGENT_LABELS.has(label.toLowerCase())) {
      matchedLabels.push(label);
    }
  }

  if (matchedLabels.length === 0) return 0;

  // First urgent label gives full weight, additional labels add diminishing returns
  const score = Math.min(
    MAX_WEIGHTS.labels,
    MAX_WEIGHTS.labels * (1 - Math.pow(0.5, matchedLabels.length)),
  );

  signals.push({
    label: `Urgent labels: ${matchedLabels.join(', ')}`,
    weight: Math.round(score),
    category: 'labels',
  });

  return score;
}

function scoreState(input: PriorityScorerInput, signals: PrioritySignal[]): number {
  // Open MRs get a bonus — they're the ones that need review.
  // Merged/closed MRs are deprioritized (user might still want to review for learning).
  if (!input.mrState || input.mrState === 'opened') {
    // Default: open MR, give full state bonus
    signals.push({ label: 'Open MR (needs review)', weight: MAX_WEIGHTS.state, category: 'approvals' });
    return MAX_WEIGHTS.state;
  }

  if (input.mrState === 'merged') {
    // Already merged — lower priority but not zero (post-merge review is valid)
    return 2;
  }

  // Closed or locked — minimal priority
  return 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive an overall risk level from the composite score and explicit risk data.
 * If we have an explicit risk level from a cached review, prefer that.
 * Otherwise, derive from the score.
 */
function deriveRiskLevel(
  score: number,
  explicitRisk?: 'low' | 'medium' | 'high',
): 'low' | 'medium' | 'high' {
  if (explicitRisk) return explicitRisk;

  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}
