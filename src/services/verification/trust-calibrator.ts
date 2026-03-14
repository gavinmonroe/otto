// ---------------------------------------------------------------------------
// Trust Calibrator — computes confidence scores for verification results.
//
// The trust layer wraps every verification output with a calibrated
// confidence assessment. This prevents the "all tests pass" false
// confidence problem — a test suite that can't catch deliberate bugs
// (mutations) is worse than no tests at all.
//
// Design decisions:
// - When execution data is available (server/CI), trust is computed from
//   real metrics: mutation score, coverage delta, counterexample quality.
// - When only AI reasoning is available, trust is computed from heuristics:
//   how many properties were tested, how specific the tests are, whether
//   the AI found any issues at all (a clean bill of health is suspicious).
// - The composite score is weighted: mutation score dominates because it's
//   the most honest signal.
// - "canStrengthen" is true when re-generation with feedback could improve
//   the score (e.g., surviving mutants can be fed back to the AI).
// ---------------------------------------------------------------------------

import type {
  TrustAssessment,
  TrustLevel,
  TrustSignals,
  AdversarialTestData,
  ContractData,
  BehavioralDeltaData,
  CiExecutionResult,
  PropertyTestResult,
} from '@/types/verification';

// ---------------------------------------------------------------------------
// Weights for composite score
// ---------------------------------------------------------------------------

const WEIGHTS = {
  mutationScore: 0.40,
  coverageDelta: 0.20,
  counterexampleQuality: 0.20,
  testIndependence: 0.10,
  nonTautological: 0.10,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a trust assessment from verification results.
 *
 * Called after all verification layers complete. Uses execution data
 * when available, falls back to AI-reasoning heuristics otherwise.
 */
export function computeTrustAssessment(
  tests: AdversarialTestData | null,
  contracts: ContractData | null,
  behavioral: BehavioralDeltaData | null,
  execution: CiExecutionResult | null,
): TrustAssessment {
  const signals = computeSignals(tests, contracts, behavioral, execution);
  const score = computeCompositeScore(signals);
  const level = scoreToLevel(score);
  const explanation = buildExplanation(signals, level, execution !== null);
  const survivingMutants = extractSurvivingMutants(tests, execution);
  const canStrengthen = level !== 'high' && (tests?.totalTests ?? 0) > 0;

  return {
    level,
    score,
    signals,
    explanation,
    survivingMutants,
    canStrengthen,
  };
}

// ---------------------------------------------------------------------------
// Signal computation
// ---------------------------------------------------------------------------

function computeSignals(
  tests: AdversarialTestData | null,
  contracts: ContractData | null,
  behavioral: BehavioralDeltaData | null,
  execution: CiExecutionResult | null,
): TrustSignals {
  return {
    mutationScore: computeMutationScore(tests, execution),
    coverageDelta: computeCoverageDelta(execution),
    counterexampleQuality: computeCounterexampleQuality(tests),
    testIndependence: computeTestIndependence(tests, execution),
    nonTautological: computeNonTautological(tests, contracts, behavioral),
  };
}

/**
 * Mutation score: the gold standard.
 * From execution if available, otherwise estimated from AI results.
 *
 * Semantics: a test that "held" (property was not violated) validates correct
 * behavior — it would catch a mutation that breaks that behavior. A test that
 * found a "counterexample" means the original code already has a bug, which
 * is valuable but tells us less about mutation-catching ability.
 */
function computeMutationScore(
  tests: AdversarialTestData | null,
  execution: CiExecutionResult | null,
): number | null {
  // Real mutation score from execution
  if (execution?.mutationScore != null) {
    return execution.mutationScore;
  }

  // No tests at all
  if (!tests || tests.totalTests === 0) return null;

  // Estimate from AI results:
  // - Held tests (property validated) are strong mutation killers (weight 1.0)
  // - Counterexamples found bugs but don't tell us about mutation catching (weight 0.3)
  // - Errored/not-run tests contribute nothing
  const total = tests.totalTests;
  const effective = tests.totalHeld * 1.0 + tests.totalCounterexamples * 0.3;
  return Math.min(1, effective / Math.max(1, total));
}

/**
 * Coverage delta: how much new ground do these tests cover?
 * Only available from execution.
 */
function computeCoverageDelta(execution: CiExecutionResult | null): number | null {
  return execution?.coverageDelta ?? null;
}

/**
 * Counterexample quality: are the failing inputs minimal and reproducible?
 * Higher score = more counterexamples found with concrete inputs.
 * Uses ALL results as denominator so errored/not-run tests dilute the score.
 */
function computeCounterexampleQuality(tests: AdversarialTestData | null): number {
  if (!tests || tests.totalTests === 0) return 0;

  const results = tests.files.flatMap((f) => f.results);
  if (results.length === 0) return 0;

  let qualitySum = 0;

  for (const result of results) {
    if (result.status === 'counterexample' && result.counterexample) {
      // Shorter counterexamples are better (more minimal)
      const length = result.counterexample.length;
      const minimalityScore = length < 50 ? 1.0 : length < 200 ? 0.7 : 0.4;
      qualitySum += minimalityScore;
    } else if (result.status === 'held') {
      // Tests that held with many iterations are more trustworthy
      const iterations = result.iterations ?? 0;
      qualitySum += iterations >= 100 ? 0.8 : iterations >= 10 ? 0.5 : 0.2;
    }
    // 'error' and 'not-run' contribute 0 — they dilute the score via the denominator
  }

  // Denominator is ALL results, not just scored ones — errored tests reduce quality
  return qualitySum / results.length;
}

/**
 * Test independence: do tests pass/fail independently?
 * From execution if available, otherwise assume independent (AI generates atomic tests).
 *
 * All tests passing is the NORMAL case for correct code — it doesn't indicate
 * dependence. Only all tests FAILING together suggests correlation.
 */
function computeTestIndependence(
  tests: AdversarialTestData | null,
  execution: CiExecutionResult | null,
): number {
  if (!tests || tests.totalTests === 0) return 1;

  // If we have execution data, check for correlated failures
  if (execution) {
    const results = execution.testResults;
    const failures = results.filter((r) => r.status === 'counterexample' || r.status === 'error');
    // All tests failing together suggests dependence (shared setup issue, etc.)
    if (failures.length === results.length && results.length > 1) {
      return 0.4;
    }
    // All tests passing is normal — no independence concern
    if (failures.length === 0) {
      return 1.0;
    }
    // Mixed results strongly suggest independence
    return 0.9;
  }

  // AI-generated tests are designed to be independent
  return 0.8;
}

/**
 * Non-tautological: do the tests assert meaningful things?
 * Estimated from the diversity and specificity of test properties.
 */
function computeNonTautological(
  tests: AdversarialTestData | null,
  contracts: ContractData | null,
  behavioral: BehavioralDeltaData | null,
): number {
  let score = 0;
  let factors = 0;

  // Tests: more diverse target functions = less likely tautological
  if (tests && tests.totalTests > 0) {
    const uniqueFunctions = new Set(tests.files.flatMap((f) => f.tests.map((t) => t.targetFunction)));
    const diversityRatio = uniqueFunctions.size / tests.totalTests;
    score += Math.min(1, diversityRatio + 0.3); // Bonus for any diversity
    factors++;
  }

  // Contracts: violations found = non-trivial analysis
  if (contracts) {
    const total = contracts.contracts.length;
    if (total > 0) {
      const nonTrivial = contracts.totalViolations + contracts.totalVerified * 0.5;
      score += Math.min(1, nonTrivial / total);
      factors++;
    }
  }

  // Behavioral: unexpected changes found = thorough analysis
  if (behavioral) {
    const total = behavioral.changed.length + behavioral.preserved.length + behavioral.unexpected.length;
    if (total > 0) {
      // Finding unexpected changes is a strong signal of non-trivial analysis
      const depth = behavioral.unexpected.length > 0 ? 0.9 : behavioral.preserved.length > 0 ? 0.6 : 0.3;
      score += depth;
      factors++;
    }
  }

  return factors > 0 ? score / factors : 0;
}

// ---------------------------------------------------------------------------
// Composite score
// ---------------------------------------------------------------------------

function computeCompositeScore(signals: TrustSignals): number {
  let score = 0;
  let totalWeight = 0;
  const hasExecution = signals.mutationScore != null || signals.coverageDelta != null;

  // Mutation score (may be null if no execution)
  if (signals.mutationScore != null) {
    score += signals.mutationScore * WEIGHTS.mutationScore * 100;
    totalWeight += WEIGHTS.mutationScore;
  }

  // Coverage delta (may be null if no execution)
  if (signals.coverageDelta != null) {
    score += signals.coverageDelta * WEIGHTS.coverageDelta * 100;
    totalWeight += WEIGHTS.coverageDelta;
  }

  // Always-available signals
  score += signals.counterexampleQuality * WEIGHTS.counterexampleQuality * 100;
  totalWeight += WEIGHTS.counterexampleQuality;

  score += signals.testIndependence * WEIGHTS.testIndependence * 100;
  totalWeight += WEIGHTS.testIndependence;

  score += signals.nonTautological * WEIGHTS.nonTautological * 100;
  totalWeight += WEIGHTS.nonTautological;

  // Normalize to 0-100 based on available weights
  const raw = totalWeight > 0 ? Math.round(score / totalWeight) : 0;

  // Cap AI-only scores — without execution data, we can't claim high confidence
  if (!hasExecution) {
    return Math.min(raw, 65);
  }

  return raw;
}

function scoreToLevel(score: number): TrustLevel {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Explanation
// ---------------------------------------------------------------------------

function buildExplanation(signals: TrustSignals, level: TrustLevel, hasExecution: boolean): string {
  const parts: string[] = [];

  if (signals.mutationScore != null) {
    const pct = Math.round(signals.mutationScore * 100);
    parts.push(`Mutation score: ${pct}%`);
  }

  if (signals.coverageDelta != null) {
    const pct = Math.round(signals.coverageDelta * 100);
    parts.push(`Coverage delta: +${pct}%`);
  }

  if (signals.counterexampleQuality > 0.7) {
    parts.push('Strong counterexamples found');
  } else if (signals.counterexampleQuality > 0.3) {
    parts.push('Some counterexamples found');
  }

  if (!hasExecution) {
    parts.push('AI-reasoned only (no execution)');
  }

  if (level === 'low') {
    parts.push('Tests may be too weak to catch real bugs');
  }

  return parts.join('. ') + '.';
}

/**
 * Extract descriptions of verification gaps.
 * When execution data exists, reports tests that errored (couldn't run).
 * When AI-only, reports tests that weren't executed.
 */
function extractSurvivingMutants(
  tests: AdversarialTestData | null,
  execution: CiExecutionResult | null,
): string[] {
  if (!tests) return [];

  // From execution: tests that errored (couldn't validate the property)
  if (execution) {
    return execution.testResults
      .filter((r) => r.status === 'error' && r.errorMessage)
      .map((r) => `Test error: ${r.errorMessage}`)
      .slice(0, 5);
  }

  // From AI-only: all tests are not-run, report the properties that weren't verified
  const allTests = tests.files.flatMap((f) => f.tests);
  return allTests
    .slice(0, 5)
    .map((t) => `Not executed: "${t.property}" on ${t.targetFunction}()`);
}
