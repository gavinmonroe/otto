// ---------------------------------------------------------------------------
// Ticket Grouper — groups MRs by shared ticket references.
//
// Scans MR titles and branch names for Jira-style ticket keys (e.g., PROJ-1234)
// and groups MRs that share a key. This creates the tree-view structure on the
// MR list page where related MRs appear as children under a ticket header.
//
// Design decisions:
// - Uses the same JIRA_KEY_PATTERN as ticket-parser.ts but doesn't import it
//   directly. ticket-parser.ts requires TicketProvider[] which may not be
//   available in all contexts. We duplicate the regex (it's 1 line) to avoid
//   coupling the grouper to the ticket provider system.
// - An MR can appear in multiple groups if it references multiple tickets.
//   This is intentional — a single MR can implement parts of multiple tickets.
// - Groups are sorted by the highest-priority MR within them, so the most
//   urgent ticket group appears first.
// - Ungrouped MRs (no ticket ref) are returned separately so the caller
//   can render them as flat rows below the grouped ones.
//
// Callers:
// - Content script (gitlab-mr-list.content) for display grouping
// - No background callers — grouping is a UI concern
// ---------------------------------------------------------------------------

import type { TicketGroup } from '@/types/review-queue';

// Same pattern as ticket-parser.ts — duplicated to avoid provider dependency
const JIRA_KEY_PATTERN = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/g;

// ---------------------------------------------------------------------------
// Input type — minimal MR metadata needed for grouping
// ---------------------------------------------------------------------------

export type GroupableMr = {
  mrIid: number;
  title: string;
  sourceBranch: string;
  /** Priority score for sorting within groups. Higher = first. */
  priorityScore: number;
};

// ---------------------------------------------------------------------------
// Main grouper
// ---------------------------------------------------------------------------

export type GroupingResult = {
  /** Ticket groups with their MR IIDs, sorted by highest-priority MR */
  groups: TicketGroup[];
  /** MR IIDs that don't belong to any ticket group */
  ungroupedIids: number[];
};

/**
 * Group MRs by shared ticket references.
 *
 * Extracts Jira-style ticket keys from each MR's title and branch name,
 * then groups MRs that share any key. Returns groups sorted by the
 * highest-priority MR within each group.
 *
 * @param mrs - MR metadata to group
 * @param allowedPrefixes - Optional set of allowed ticket prefixes (e.g., ["PROJ", "TEAM"]).
 *   If empty or not provided, all Jira-style keys are accepted.
 *   Pass the project prefixes from configured TicketProviders if available.
 */
export function groupMrsByTicket(
  mrs: GroupableMr[],
  allowedPrefixes?: string[],
): GroupingResult {
  const prefixSet = new Set(
    (allowedPrefixes ?? []).map((p) => p.toUpperCase()),
  );

  // Step 1: Extract ticket keys for each MR
  const mrTickets = new Map<number, Set<string>>(); // mrIid → ticket keys
  const ticketMrs = new Map<string, Set<number>>();  // ticket key → mrIids

  for (const mr of mrs) {
    const keys = extractKeys(mr.title, mr.sourceBranch, prefixSet);
    if (keys.size > 0) {
      mrTickets.set(mr.mrIid, keys);
      for (const key of keys) {
        let iids = ticketMrs.get(key);
        if (!iids) {
          iids = new Set();
          ticketMrs.set(key, iids);
        }
        iids.add(mr.mrIid);
      }
    }
  }

  // Step 2: Build groups. Each ticket key with 1+ MRs becomes a group.
  // Single-MR "groups" are still created — they show the ticket context
  // even for lone MRs, which is useful when the user has Jira enrichment.
  const mrPriorityMap = new Map(mrs.map((mr) => [mr.mrIid, mr.priorityScore]));
  const groups: TicketGroup[] = [];

  for (const [ticketKey, iids] of ticketMrs) {
    // Sort MR IIDs by priority (highest first)
    const sortedIids = Array.from(iids).sort((a, b) => {
      const pa = mrPriorityMap.get(a) ?? 0;
      const pb = mrPriorityMap.get(b) ?? 0;
      return pb - pa;
    });

    groups.push({
      ticketKey,
      ticketTitle: null,   // Enriched later via FETCH_TICKET_BATCH
      ticketStatus: null,  // Enriched later via FETCH_TICKET_BATCH
      mrIids: sortedIids,
      expanded: true,      // Default expanded
    });
  }

  // Step 3: Sort groups by highest-priority MR within each group
  groups.sort((a, b) => {
    const pa = mrPriorityMap.get(a.mrIids[0]) ?? 0;
    const pb = mrPriorityMap.get(b.mrIids[0]) ?? 0;
    return pb - pa;
  });

  // Step 4: Identify ungrouped MRs
  const groupedIids = new Set<number>();
  for (const group of groups) {
    for (const iid of group.mrIids) {
      groupedIids.add(iid);
    }
  }

  const ungroupedIids = mrs
    .filter((mr) => !groupedIids.has(mr.mrIid))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .map((mr) => mr.mrIid);

  return { groups, ungroupedIids };
}

/**
 * Enrich ticket groups with Jira data.
 * Call this after fetching ticket details via FETCH_TICKET_BATCH.
 *
 * Returns a new array (doesn't mutate the input) so React can detect changes.
 */
export function enrichGroups(
  groups: TicketGroup[],
  ticketData: Record<string, { title?: string; status?: string }>,
): TicketGroup[] {
  return groups.map((group) => {
    const data = ticketData[group.ticketKey];
    if (!data) return group;

    return {
      ...group,
      ticketTitle: data.title ?? group.ticketTitle,
      ticketStatus: data.status ?? group.ticketStatus,
    };
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract Jira-style ticket keys from MR title and branch name.
 * Branch names are normalized (/ and _ replaced with spaces) before scanning.
 */
function extractKeys(
  title: string,
  sourceBranch: string,
  allowedPrefixes: Set<string>,
): Set<string> {
  const keys = new Set<string>();
  const text = `${title} ${sourceBranch.replace(/[/_]/g, ' ')}`;

  for (const match of text.matchAll(JIRA_KEY_PATTERN)) {
    const key = match[1].toUpperCase();
    const prefix = key.split('-')[0];

    // If prefixes are configured, filter by them. Otherwise accept all.
    if (allowedPrefixes.size === 0 || allowedPrefixes.has(prefix)) {
      keys.add(key);
    }
  }

  return keys;
}
