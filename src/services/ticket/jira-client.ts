// ---------------------------------------------------------------------------
// Jira Client — fetches ticket data from Jira's REST API.
//
// Design decisions:
// - Uses Jira REST API v3 (Cloud) with Basic Auth (email:apiToken).
// - Only fetches the fields we need for AI context — not the full issue.
// - Extracts acceptance criteria from common custom field locations:
//   the "Acceptance Criteria" custom field, or a heading in the description.
// - Returns a normalized TicketInfo regardless of Jira's response shape.
// - Linked issues are fetched shallowly (keys only, no recursion).
// ---------------------------------------------------------------------------

import type { TicketProvider, TicketInfo } from '@/types/ticket';
import type { Result } from '@/types/messages';

/**
 * Fetch a single Jira ticket by key.
 */
export async function fetchJiraTicket(
  provider: TicketProvider,
  ticketKey: string,
): Promise<Result<TicketInfo>> {
  const url = `${provider.baseUrl}/rest/api/3/issue/${encodeURIComponent(ticketKey)}` +
    `?fields=summary,description,status,issuetype,priority,labels,assignee,reporter,parent,issuelinks,customfield_*`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${btoa(`${provider.email}:${provider.apiToken}`)}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { ok: false, error: `Ticket ${ticketKey} not found` };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: `Authentication failed for Jira. Check your email and API token.` };
      }
      return { ok: false, error: `Jira API error: ${response.status} ${response.statusText}` };
    }

    const data = await response.json();
    const ticket = parseJiraIssue(data, ticketKey);
    return { ok: true, data: ticket };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : `Failed to fetch ${ticketKey}`,
    };
  }
}

/**
 * Test the Jira connection by fetching the current user.
 */
export async function testJiraConnection(
  provider: TicketProvider,
): Promise<Result<{ displayName: string }>> {
  const url = `${provider.baseUrl}/rest/api/3/myself`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${btoa(`${provider.email}:${provider.apiToken}`)}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'Authentication failed. Check your email and API token.' };
      }
      return { ok: false, error: `Jira API error: ${response.status} ${response.statusText}` };
    }

    const data = await response.json();
    return { ok: true, data: { displayName: data.displayName || data.emailAddress || 'Connected' } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to connect to Jira',
    };
  }
}

// ---------------------------------------------------------------------------
// Jira response parsing
// ---------------------------------------------------------------------------

function parseJiraIssue(data: any, ticketKey: string): TicketInfo {
  const fields = data.fields || {};

  return {
    key: data.key || ticketKey,
    title: fields.summary || '',
    description: extractDescription(fields.description),
    status: fields.status?.name || 'Unknown',
    type: fields.issuetype?.name || 'Unknown',
    priority: fields.priority?.name || null,
    labels: fields.labels || [],
    acceptanceCriteria: extractAcceptanceCriteria(fields),
    assignee: fields.assignee?.displayName || null,
    reporter: fields.reporter?.displayName || null,
    parentKey: fields.parent?.key || null,
    linkedIssueKeys: extractLinkedIssueKeys(fields.issuelinks),
  };
}

/**
 * Extract plain text from Jira's ADF (Atlassian Document Format) description.
 * Jira v3 returns description as ADF JSON, not plain text.
 */
function extractDescription(description: any): string | null {
  if (!description) return null;

  // If it's already a string (Jira Server / v2), return as-is
  if (typeof description === 'string') return description;

  // ADF format — recursively extract text nodes
  return extractAdfText(description).trim() || null;
}

function extractAdfText(node: any): string {
  if (!node) return '';

  if (node.type === 'text') {
    return node.text || '';
  }

  if (Array.isArray(node.content)) {
    const parts = node.content.map(extractAdfText);
    // Add newlines between block-level elements
    const blockTypes = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'blockquote'];
    if (blockTypes.includes(node.type)) {
      return parts.join('') + '\n';
    }
    return parts.join('');
  }

  return '';
}

/**
 * Extract acceptance criteria from Jira fields.
 * Checks common locations:
 * 1. Custom fields with "acceptance" in the name
 * 2. A section in the description starting with "Acceptance Criteria"
 */
function extractAcceptanceCriteria(fields: any): string | null {
  // Check custom fields — Jira stores them as customfield_XXXXX
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('customfield_') && value) {
      // We can't know the field name from the key alone, but common AC fields
      // contain structured text. Check if the value looks like AC content.
      if (typeof value === 'string' && value.length > 10 && value.length < 5000) {
        // Heuristic: if the field value contains checkbox-like patterns, it's likely AC
        if (/(\[[ x]\]|given|when|then|should|must|acceptance)/i.test(value)) {
          return value;
        }
      }
      // ADF format
      if (typeof value === 'object' && value !== null && 'type' in value && (value as any).type === 'doc') {
        const text = extractAdfText(value);
        if (text && /(\[[ x]\]|given|when|then|should|must|acceptance)/i.test(text)) {
          return text.trim();
        }
      }
    }
  }

  // Fall back to extracting from description
  const desc = extractDescription(fields.description);
  if (desc) {
    const acMatch = desc.match(/(?:acceptance\s+criteria|ac)[:\s]*\n([\s\S]*?)(?:\n\n|\n(?=[A-Z#])|$)/i);
    if (acMatch) return acMatch[1].trim();
  }

  return null;
}

function extractLinkedIssueKeys(issuelinks: any[]): string[] {
  if (!Array.isArray(issuelinks)) return [];

  const keys: string[] = [];
  for (const link of issuelinks) {
    if (link.outwardIssue?.key) keys.push(link.outwardIssue.key);
    if (link.inwardIssue?.key) keys.push(link.inwardIssue.key);
  }
  return keys;
}
