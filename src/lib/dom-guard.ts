// ---------------------------------------------------------------------------
// DOM Guard — prevents MutationObserver feedback loops.
//
// When Otto injects its own DOM elements (inline comments, risk dots, follow-up
// buttons), it triggers other MutationObserver callbacks on the same subtree.
// Those callbacks then scan the DOM and potentially inject more elements,
// creating a cascading feedback loop that saturates CPU.
//
// Usage:
//   import { guardedMutation, isOttoMutating } from '@/lib/dom-guard';
//
//   // Wrap DOM injections:
//   guardedMutation(() => container.appendChild(element));
//
//   // In MutationObserver callbacks:
//   if (isOttoMutating()) return;
// ---------------------------------------------------------------------------

let mutationDepth = 0;

/**
 * Returns true if Otto is currently performing DOM mutations.
 * MutationObserver callbacks should check this and skip if true.
 */
export function isOttoMutating(): boolean {
  return mutationDepth > 0;
}

/**
 * Execute a DOM mutation inside a guard. Nested calls are safe —
 * the guard uses a depth counter, not a boolean flag.
 *
 * The decrement is deferred to a microtask so that MutationObserver
 * callbacks (which the browser delivers as microtasks after DOM writes)
 * still see isOttoMutating() === true and skip. Without this, the guard
 * was already released by the time observers fired, defeating the purpose.
 */
export function guardedMutation(fn: () => void): void {
  mutationDepth++;
  try {
    fn();
  } finally {
    // Defer decrement so MutationObserver callbacks triggered by fn()
    // still see the guard as active when they run.
    queueMicrotask(() => { mutationDepth--; });
  }
}

// ---------------------------------------------------------------------------
// Injection cooldown — shared across all injectors.
//
// After a bulk injection (e.g., cache hydration), periodic rescans are
// redundant because MutationObserver-driven retries already handle
// newly-appeared files. The cooldown suppresses those rescans to avoid
// piling DOM queries on top of the injection burst.
// ---------------------------------------------------------------------------

let cooldownUntil = 0;

/** Start a cooldown window. Periodic rescans should skip during this time. */
export function startInjectionCooldown(durationMs: number): void {
  cooldownUntil = Date.now() + durationMs;
}

/** Returns true if we're inside an injection cooldown window. */
export function isInjectionCooldown(): boolean {
  return Date.now() < cooldownUntil;
}
