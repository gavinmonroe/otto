// ---------------------------------------------------------------------------
// Health Monitor — detects tab performance degradation before a crash.
//
// Runs a lightweight heartbeat that measures:
// 1. Event loop lag — setTimeout(0) drift reveals main thread saturation
// 2. Frame rate — requestAnimationFrame timing detects rendering stalls
// 3. Long tasks — PerformanceObserver('longtask') counts >50ms tasks
//
// Computes a rolling health score over a 5-second window and emits
// throttle level transitions: normal → degraded → critical.
//
// Design decisions:
// - Standalone singleton, NOT inside Zustand. The monitor must be readable
//   synchronously from injectors (getHealthLevel()) without subscriptions.
// - Only pushes to the review store on level transitions, not every tick.
// - Recovery requires 3+ seconds of healthy metrics to step down, preventing
//   flapping between levels.
// - The heartbeat interval (1s) and rAF probe are extremely cheap — they
//   add negligible overhead even on stressed tabs.
// ---------------------------------------------------------------------------

import { useReviewStore } from '@/services/review/review-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthLevel = 'normal' | 'degraded' | 'critical';

type HealthSnapshot = {
  timestamp: number;
  eventLoopLagMs: number;
  frameDurationMs: number;
  longTaskCount: number;
};

type LevelChangeCallback = (level: HealthLevel) => void;

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const THRESHOLDS = {
  degraded: {
    eventLoopLagMs: 100,
    minFrameDurationMs: 33,  // < 30fps
    longTasksInWindow: 3,
  },
  critical: {
    eventLoopLagMs: 300,
    minFrameDurationMs: 66,  // < 15fps
    longTasksInWindow: 5,
  },
} as const;

/** How many seconds of healthy metrics before stepping down a level */
const RECOVERY_SECONDS = 3;

/** Rolling window size in seconds */
const WINDOW_SIZE = 5;

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let currentLevel: HealthLevel = 'normal';
let snapshots: HealthSnapshot[] = [];
let healthySince: number | null = null;
let started = false;

// Probes
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let rafHandle: number | null = null;
let lastRafTime: number | null = null;
let currentFrameDuration = 16; // assume 60fps initially
const recentFrameDurations: number[] = []; // rolling buffer of last N frame durations
const MAX_FRAME_SAMPLES = 10;
let longTaskCount = 0;
let longTaskObserver: PerformanceObserver | null = null;

// Callbacks
const levelChangeCallbacks = new Set<LevelChangeCallback>();
const cleanupNotifiers = new Set<() => void>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the current health level synchronously. Zero-cost read. */
export function getHealthLevel(): HealthLevel {
  return currentLevel;
}

/** Register a callback for level transitions. Returns unsubscribe fn.
 *  Also accepts an optional onCleanup callback that fires when the monitor
 *  shuts down, so the caller can reset its own tracking state. */
export function onHealthLevelChange(cb: LevelChangeCallback, onCleanup?: () => void): () => void {
  levelChangeCallbacks.add(cb);
  if (onCleanup) cleanupNotifiers.add(onCleanup);
  return () => {
    levelChangeCallbacks.delete(cb);
    if (onCleanup) cleanupNotifiers.delete(onCleanup);
  };
}

/**
 * Start the health monitor. Safe to call multiple times — only starts once.
 * Returns a cleanup function.
 */
export function startHealthMonitor(signal?: AbortSignal): () => void {
  if (started) return cleanup;
  started = true;

  // Reset state
  currentLevel = 'normal';
  snapshots = [];
  healthySince = null;
  longTaskCount = 0;

  // 1. Long task observer (Chrome 58+)
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        longTaskCount += list.getEntries().length;
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      // longtask not supported in this browser — non-fatal
      longTaskObserver = null;
    }
  }

  // 2. Frame rate probe via rAF
  // Ignores samples when the tab is hidden — browsers throttle rAF to ~1fps
  // for background tabs, which would cause false critical readings.
  // Maintains a rolling buffer of recent frame durations to smooth out
  // single-frame spikes (e.g., GitLab doing a heavy Vue render).
  function rafProbe(now: number) {
    if (lastRafTime !== null && document.visibilityState === 'visible') {
      const duration = now - lastRafTime;
      recentFrameDurations.push(duration);
      if (recentFrameDurations.length > MAX_FRAME_SAMPLES) {
        recentFrameDurations.shift();
      }
      // Use median of recent samples — resistant to single-frame outliers
      const sorted = [...recentFrameDurations].sort((a, b) => a - b);
      currentFrameDuration = sorted[Math.floor(sorted.length / 2)];
    }
    lastRafTime = now;
    rafHandle = requestAnimationFrame(rafProbe);
  }
  rafHandle = requestAnimationFrame(rafProbe);

  // 3. Heartbeat — measures event loop lag + evaluates health
  function heartbeat() {
    const scheduledAt = Date.now();

    heartbeatTimer = setTimeout(() => {
      const actualDelay = Date.now() - scheduledAt;
      // Subtract the intended 1000ms to get pure lag
      const eventLoopLagMs = Math.max(0, actualDelay - 1000);

      const snapshot: HealthSnapshot = {
        timestamp: Date.now(),
        eventLoopLagMs,
        frameDurationMs: currentFrameDuration,
        longTaskCount,
      };

      // Reset long task counter for next interval
      longTaskCount = 0;

      // Add to rolling window
      snapshots.push(snapshot);
      const cutoff = Date.now() - WINDOW_SIZE * 1000;
      snapshots = snapshots.filter((s) => s.timestamp > cutoff);

      evaluateHealth();
      heartbeat(); // Schedule next
    }, 1000);
  }

  heartbeat();

  if (signal) {
    signal.addEventListener('abort', cleanup, { once: true });
  }

  return cleanup;
}

// ---------------------------------------------------------------------------
// Health evaluation
// ---------------------------------------------------------------------------

function evaluateHealth(): void {
  if (snapshots.length === 0) return;

  const now = Date.now();
  const newLevel = computeLevel();

  if (newLevel === currentLevel) {
    // No change — reset recovery tracking since we're stable at this level
    healthySince = null;
    return;
  }

  // Escalation is immediate (don't wait for recovery)
  if (isWorse(newLevel, currentLevel)) {
    healthySince = null;
    setLevel(newLevel);
    return;
  }

  // De-escalation requires sustained recovery (RECOVERY_SECONDS of better metrics).
  // Step down one level at a time to prevent flapping.
  if (healthySince === null) {
    healthySince = now;
  } else if (now - healthySince >= RECOVERY_SECONDS * 1000) {
    healthySince = null;
    const nextLevel: HealthLevel = currentLevel === 'critical' ? 'degraded' : 'normal';
    setLevel(nextLevel);
  }
}

function computeLevel(): HealthLevel {
  if (snapshots.length === 0) return 'normal';

  // Aggregate metrics across the window
  const totalLongTasks = snapshots.reduce((sum, s) => sum + s.longTaskCount, 0);
  const maxLag = Math.max(...snapshots.map((s) => s.eventLoopLagMs));
  const avgFrameDuration = snapshots.reduce((sum, s) => sum + s.frameDurationMs, 0) / snapshots.length;

  // Check critical first
  if (
    maxLag >= THRESHOLDS.critical.eventLoopLagMs ||
    avgFrameDuration >= THRESHOLDS.critical.minFrameDurationMs ||
    totalLongTasks >= THRESHOLDS.critical.longTasksInWindow
  ) {
    return 'critical';
  }

  // Check degraded
  if (
    maxLag >= THRESHOLDS.degraded.eventLoopLagMs ||
    avgFrameDuration >= THRESHOLDS.degraded.minFrameDurationMs ||
    totalLongTasks >= THRESHOLDS.degraded.longTasksInWindow
  ) {
    return 'degraded';
  }

  return 'normal';
}

function isWorse(a: HealthLevel, b: HealthLevel): boolean {
  const rank: Record<HealthLevel, number> = { normal: 0, degraded: 1, critical: 2 };
  return rank[a] > rank[b];
}

function setLevel(level: HealthLevel): void {
  if (level === currentLevel) return;
  const prev = currentLevel;
  currentLevel = level;

  // Push to store for UI (only on transitions — not every heartbeat)
  try {
    useReviewStore.getState().setHealthLevel(level);
  } catch {
    // Store may not be initialized yet — non-fatal
  }

  // Notify callbacks (stream dispatcher, injectors)
  for (const cb of levelChangeCallbacks) {
    try {
      cb(level);
    } catch {
      // Don't let a bad callback break the monitor
    }
  }

  console.warn(`[Otto] Health: ${prev} → ${level}`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanup(): void {
  started = false;

  if (heartbeatTimer !== null) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }

  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  if (longTaskObserver) {
    longTaskObserver.disconnect();
    longTaskObserver = null;
  }

  lastRafTime = null;
  currentFrameDuration = 16;
  recentFrameDurations.length = 0;
  longTaskCount = 0;
  snapshots = [];
  healthySince = null;

  // Notify callbacks of shutdown (back to normal) BEFORE clearing them,
  // so subscribers like the stream dispatcher can flush buffered deltas.
  if (currentLevel !== 'normal') {
    currentLevel = 'normal';
    for (const cb of levelChangeCallbacks) {
      try { cb('normal'); } catch { /* non-fatal */ }
    }
  }
  currentLevel = 'normal';

  // Clear callbacks — subscribers must re-register after restart.
  // We call the cleanup functions registered via onCleanup so external
  // modules (like stream-dispatcher) can reset their tracking state.
  for (const fn of cleanupNotifiers) {
    try { fn(); } catch { /* non-fatal */ }
  }
  cleanupNotifiers.clear();
  levelChangeCallbacks.clear();

  // Reset store level
  try {
    useReviewStore.getState().setHealthLevel('normal');
  } catch {
    // Non-fatal
  }
}
