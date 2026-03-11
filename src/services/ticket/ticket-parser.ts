// ---------------------------------------------------------------------------
// Ticket Parser — extracts ticket/issue references from MR metadata.
//
// Scans the MR title, description, and branch name for patterns like
// PROJ-1234, #456, etc. Returns deduplicated ticket keys.
//
// Design decisions:
// - Supports Jira-style keys (PROJ-1234) out of the box.
// - Optional project prefix filter — if configured, only matches keys
//   whose prefix is in the allowed list. Otherwise matches any UPPER-1234.
// - Branch name parsing handles common conventions:
//   feature/PROJ-1234-description, bugfix/PROJ-1234, PROJ-1234-foo, etc.
// ---------------------------------------------------------------------------

import type { TicketProvider } from '@/types/ticket';

// Jira key pattern: 2+ letters, dash, 1+ digits (case-insensitive)
const JIRA_KEY_PATTERN = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/g;

/**
 * Extract ticket references from MR metadata.
 * Returns deduplicated ticket keys sorted alphabetically.
 */
export function extractTicketRefs(
  mrTitle: string,
  mrDescription: string | null,
  sourceBranch: string,
  providers: TicketProvider[],
): string[] {
  const sources = [
    mrTitle,
    mrDescription ?? '',
    // Branch names use / and - as separators; normalize for matching
    sourceBranch.replace(/[/_]/g, ' '),
  ];

  const allText = sources.join(' ');
  const matches = new Set<string>();

  // Collect all known prefixes from configured providers
  const allowedPrefixes = new Set<string>();
  for (const provider of providers) {
    for (const prefix of provider.projectPrefixes) {
      allowedPrefixes.add(prefix.toUpperCase());
    }
  }

  // Extract Jira-style keys
  for (const match of allText.matchAll(JIRA_KEY_PATTERN)) {
    const key = match[1].toUpperCase(); // Normalize to uppercase
    const prefix = key.split('-')[0];

    // If providers have prefixes configured, filter by them.
    // If no prefixes configured at all, accept any match.
    if (allowedPrefixes.size === 0 || allowedPrefixes.has(prefix)) {
      matches.add(key);
    }
  }

  return Array.from(matches).sort();
}

/**
 * Find the provider that owns a given ticket key based on project prefixes.
 * Returns null if no provider matches.
 */
export function findProviderForKey(
  ticketKey: string,
  providers: TicketProvider[],
): TicketProvider | null {
  const prefix = ticketKey.split('-')[0].toUpperCase();

  for (const provider of providers) {
    if (provider.projectPrefixes.length === 0) {
      // Provider with no prefix filter is a catch-all
      return provider;
    }
    if (provider.projectPrefixes.some((p) => p.toUpperCase() === prefix)) {
      return provider;
    }
  }

  // Fall back to first provider if only one exists
  if (providers.length === 1) return providers[0];

  return null;
}
