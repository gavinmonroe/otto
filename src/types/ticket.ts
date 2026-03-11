// ---------------------------------------------------------------------------
// Ticket types — data structures for external issue tracker integration.
//
// Design decisions:
// - Generic TicketInfo type works for Jira, Linear, GitLab Issues, etc.
// - Only stores the fields useful for AI context (title, description,
//   acceptance criteria, labels, status). No full Jira object graph.
// - TicketProvider config supports multiple providers (e.g., Jira Cloud
//   + Jira Server for different projects).
// ---------------------------------------------------------------------------

export type TicketProvider = {
  id: string;
  type: 'jira';
  label: string;           // User-friendly name, e.g., "Work Jira"
  baseUrl: string;         // e.g., "https://mycompany.atlassian.net"
  email: string;           // Jira Cloud requires email for basic auth
  apiToken: string;        // Jira API token (not password)
  projectPrefixes: string[]; // e.g., ["PROJ", "TEAM"] — used to match ticket refs
};

export type TicketInfo = {
  key: string;             // e.g., "PROJ-1234"
  title: string;
  description: string | null;
  status: string;          // e.g., "In Progress", "Code Review"
  type: string;            // e.g., "Story", "Bug", "Task"
  priority: string | null; // e.g., "High", "Medium"
  labels: string[];
  acceptanceCriteria: string | null;
  assignee: string | null;
  reporter: string | null;
  parentKey: string | null; // Epic or parent issue key
  linkedIssueKeys: string[];
};

export type CachedTicket = {
  version: 1;
  ticketKey: string;
  providerBaseUrl: string;
  timestamp: number;
  ticket: TicketInfo;
};
