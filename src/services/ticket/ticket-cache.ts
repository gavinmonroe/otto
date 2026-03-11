// ---------------------------------------------------------------------------
// Ticket Cache — persists fetched ticket data in chrome.storage.local.
//
// Cache key: `otto_ticket:{ticketKey}`
// Tickets rarely change, so a 24-hour TTL is appropriate.
//
// Design decisions:
// - Keyed by ticket key (e.g., "PROJ-1234") — simple and unique.
// - Max 200 cached tickets — tickets are small (~1KB each).
// - 24-hour TTL — tickets change infrequently during a review cycle.
// - Cache is checked before every Jira API call.
// ---------------------------------------------------------------------------

import type { TicketInfo, CachedTicket } from '@/types/ticket';

const CACHE_PREFIX = 'otto_ticket:';
const MAX_CACHED_TICKETS = 200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Load a cached ticket. Returns null if not cached or expired.
 */
export async function loadCachedTicket(ticketKey: string): Promise<TicketInfo | null> {
  try {
    const key = `${CACHE_PREFIX}${ticketKey}`;
    const result = await chrome.storage.local.get(key);
    const cached = result[key] as CachedTicket | undefined;

    if (!cached) return null;
    if (cached.version !== 1) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null;

    return cached.ticket;
  } catch {
    return null;
  }
}

/**
 * Save a ticket to the cache.
 */
export async function saveCachedTicket(
  ticketKey: string,
  providerBaseUrl: string,
  ticket: TicketInfo,
): Promise<void> {
  try {
    const key = `${CACHE_PREFIX}${ticketKey}`;
    const entry: CachedTicket = {
      version: 1,
      ticketKey,
      providerBaseUrl,
      timestamp: Date.now(),
      ticket,
    };
    await chrome.storage.local.set({ [key]: entry });
    await evictOldEntries();
  } catch {
    // Non-fatal — caching is best-effort
  }
}

/**
 * Load multiple tickets from cache at once.
 * Returns a map of ticketKey → TicketInfo for cache hits.
 */
export async function loadCachedTickets(ticketKeys: string[]): Promise<Map<string, TicketInfo>> {
  const result = new Map<string, TicketInfo>();
  if (ticketKeys.length === 0) return result;

  try {
    const storageKeys = ticketKeys.map((k) => `${CACHE_PREFIX}${k}`);
    const stored = await chrome.storage.local.get(storageKeys);

    for (const ticketKey of ticketKeys) {
      const cached = stored[`${CACHE_PREFIX}${ticketKey}`] as CachedTicket | undefined;
      if (cached && cached.version === 1 && Date.now() - cached.timestamp <= CACHE_TTL_MS) {
        result.set(ticketKey, cached.ticket);
      }
    }
  } catch {
    // Non-fatal
  }

  return result;
}

/**
 * Evict oldest cached tickets if we exceed the max count.
 */
async function evictOldEntries(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null);
    const entries: Array<{ key: string; timestamp: number }> = [];

    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(CACHE_PREFIX) && value && typeof value === 'object' && 'timestamp' in value) {
        entries.push({ key, timestamp: (value as CachedTicket).timestamp });
      }
    }

    if (entries.length <= MAX_CACHED_TICKETS) return;

    entries.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = entries.slice(0, entries.length - MAX_CACHED_TICKETS);
    await chrome.storage.local.remove(toRemove.map((e) => e.key));
  } catch {
    // Non-fatal
  }
}
