// ---------------------------------------------------------------------------
// Follow-Up domain types — data structures for GitLab comment follow-up.
//
// Design decisions:
// - CommentIntent classifies what the commenter wants so the UI can adapt
//   the recommended action (emoji vs reply vs code changes).
// - ThreadNote is a minimal representation of a GitLab discussion note,
//   extracted from either the DOM or the API.
// - FollowUpAction is a discriminated union — the UI switches on `type`
//   to render the appropriate response format.
// - FileChange mirrors the existing ReviewComment suggestion pattern
//   (originalCode + suggestedCode) so we can reuse SuggestionDiff.
// ---------------------------------------------------------------------------

export type CommentIntent =
  | 'question'
  | 'suggestion'
  | 'nitpick'
  | 'required-change'
  | 'praise'
  | 'discussion'
  | 'emoji-reaction';

export type ThreadNote = {
  id: string;              // GitLab note ID (from DOM data attribute or API)
  author: string;          // Username or display name
  body: string;            // Raw markdown body
  timestamp: string;       // ISO string or relative (e.g., "2 days ago")
};

export type ThreadContext = {
  discussionId: string;    // GitLab discussion ID (groups notes in a thread)
  notes: ThreadNote[];     // All notes in the thread, in order
  filePath: string | null; // Non-null if this is an inline diff comment
  lineRange: { start: number; end: number } | null; // Line range for inline comments
  diffSnippet: string | null; // The diff hunk surrounding the comment, if inline
};

export type FileChange = {
  filePath: string;
  startLine: number;
  endLine: number;
  originalCode: string;
  suggestedCode: string;
  explanation: string;
};

export type FollowUpAction =
  | { type: 'emoji'; emoji: string; reason: string }
  | { type: 'reply'; draft: string; tone: string }
  | { type: 'code-change'; changes: FileChange[]; summary: string };

export type FollowUpAnalysis = {
  commentId: string;       // The note ID this analysis is for
  intent: CommentIntent;
  perspective: string;     // "Where the commenter is coming from"
  interpretation: string;  // "What the comment is concretely asking"
  recommendedAction: FollowUpAction;
};

export type FollowUpStatus = 'idle' | 'loading' | 'complete' | 'error';
