// ---------------------------------------------------------------------------
// Chat Cache — persists recent chat messages in chrome.storage.local.
//
// Cache key: `otto_chat:{projectPath}:{mrIid}`
//
// Design decisions:
// - Keyed by projectPath + mrIid (NOT diffHash). Chat history is useful
//   even after new commits — the conversation is about the MR, not a
//   specific diff snapshot. Users can ask "what changed since last time?"
// - Stores the last 10 messages (5 turns) to keep storage small.
// - Suggested questions from the last AI response are cached too so the
//   UI can show them immediately on reload.
// - Max 30 cached chats — oldest are evicted on save.
// - TTL of 7 days, same as review cache.
// ---------------------------------------------------------------------------

import type { ChatMessage, SuggestedQuestion } from '@/types/chat';

const CHAT_CACHE_PREFIX = 'otto_chat:';
const MAX_CACHED_CHATS = 30;
const MAX_CACHED_MESSAGES = 10;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type CachedChat = {
  version: 1;
  projectPath: string;
  mrIid: number;
  timestamp: number;
  messages: ChatMessage[];
  suggestedQuestions: SuggestedQuestion[];
};

function buildChatCacheKey(projectPath: string, mrIid: number): string {
  return `${CHAT_CACHE_PREFIX}${projectPath}:${mrIid}`;
}

/**
 * Load cached chat messages for an MR.
 * Returns null if no cache exists or cache is expired.
 */
export async function loadCachedChat(
  projectPath: string,
  mrIid: number,
): Promise<CachedChat | null> {
  try {
    const key = buildChatCacheKey(projectPath, mrIid);
    const result = await chrome.storage.local.get(key);
    const cached = result[key] as CachedChat | undefined;

    if (!cached) return null;
    if (cached.version !== 1) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null;

    return cached;
  } catch {
    return null;
  }
}

/**
 * Save chat messages to the cache.
 * Only stores the last MAX_CACHED_MESSAGES messages.
 */
export async function saveCachedChat(
  projectPath: string,
  mrIid: number,
  messages: ChatMessage[],
  suggestedQuestions: SuggestedQuestion[],
): Promise<void> {
  try {
    const key = buildChatCacheKey(projectPath, mrIid);
    const cached: CachedChat = {
      version: 1,
      projectPath,
      mrIid,
      timestamp: Date.now(),
      messages: messages.slice(-MAX_CACHED_MESSAGES),
      suggestedQuestions,
    };
    await chrome.storage.local.set({ [key]: cached });
    await evictOldChatEntries();
  } catch {
    // Non-fatal — caching is best-effort
  }
}

/**
 * Delete cached chat for an MR.
 */
export async function deleteCachedChat(
  projectPath: string,
  mrIid: number,
): Promise<void> {
  try {
    const key = buildChatCacheKey(projectPath, mrIid);
    await chrome.storage.local.remove(key);
  } catch {
    // Non-fatal
  }
}

/**
 * Evict oldest cached chats if we exceed the max count.
 */
async function evictOldChatEntries(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null);
    const entries: Array<{ key: string; timestamp: number }> = [];

    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(CHAT_CACHE_PREFIX) && value && typeof value === 'object' && 'timestamp' in value) {
        entries.push({ key, timestamp: (value as CachedChat).timestamp });
      }
    }

    if (entries.length <= MAX_CACHED_CHATS) return;

    entries.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = entries.slice(0, entries.length - MAX_CACHED_CHATS);
    await chrome.storage.local.remove(toRemove.map((e) => e.key));
  } catch {
    // Non-fatal
  }
}
