// ---------------------------------------------------------------------------
// Cross-MR Cluster types — groups of related MRs by ticket or file overlap.
//
// These types match Botto's wire format (types/cluster.rs MrCluster).
// Used by the cluster store and UI components to show unified views
// across related merge requests.
// ---------------------------------------------------------------------------

/** Why MRs were grouped into a cluster. */
export type ClusterSignal =
  | { type: 'shared_ticket'; ticketKey: string }
  | { type: 'file_overlap'; jaccard: number; sharedFiles: string[] };

/** A member MR within a cluster. */
export type ClusterMember = {
  mrIid: number;
  mrTitle: string;
  author: string;
  /** AI-assigned role within the cluster (e.g., "API layer", "frontend"). */
  role: string | null;
};

/** A group of related MRs. */
export type MrCluster = {
  /** Deterministic ID: djb2 hash of sorted MR IIDs + project_id. */
  id: string;
  projectId: number;
  ticketKey: string | null;
  memberMrs: ClusterMember[];
  relevanceScore: number;
  signals: ClusterSignal[];
  /** AI-generated unified summary (populated on demand, not eagerly). */
  summary: ClusterSummaryData | null;
  /** AI-generated review order for guided cross-MR walkthrough. */
  reviewOrder: ClusterReviewOrder | null;
};

/** AI-generated unified narrative across clustered MRs. */
export type ClusterSummaryData = {
  /** Unified narrative: "MR !42 adds the API, !43 adds the frontend..." */
  narrative: string;
  /** What each MR contributes to the cluster. */
  perMrRoles: MrRole[];
  riskAssessment: string;
  integrationConcerns: string[];
};

/** What a single MR contributes within a cluster. */
export type MrRole = {
  mrIid: number;
  role: string;
  keyChanges: string[];
};

/** AI-generated review order for cross-MR guided walkthrough. */
export type ClusterReviewOrder = {
  phases: ReviewPhase[];
};

/** A single phase in a cross-MR guided review. */
export type ReviewPhase = {
  /** Human-readable label: "API Layer", "Frontend", "Tests". */
  label: string;
  mrIid: number;
  files: string[];
  rationale: string;
};
