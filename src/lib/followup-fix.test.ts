// ---------------------------------------------------------------------------
// Tests for the follow-up fix flow — verifies the data contract between
// Otto and Botto for fix requests originating from follow-up comment analysis.
//
// These are pure logic tests (no DOM, no React) that validate:
// 1. Fix key generation pattern for follow-up changes
// 2. GitLab note ID resolution from follow-up commentId
// 3. REQUEST_FIX message shape matches what Botto expects
// 4. Backward compatibility — review comment fixes still work
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import type { FileChange, FollowUpAnalysis } from '@/types/followup';

// ---------------------------------------------------------------------------
// Helpers — extracted logic that mirrors what FollowUpFixButton does.
// These are the same computations the component performs inline.
// ---------------------------------------------------------------------------

/** Generate the fix job tracking key for a follow-up change. */
function makeFollowUpFixKey(commentId: string, changeIndex: number): string {
  return `followup-${commentId}-${changeIndex}`;
}

/** Resolve the GitLab note ID from a follow-up commentId string. */
function resolveGitlabNoteId(commentId: string): number | undefined {
  const parsed = parseInt(commentId, 10);
  return isNaN(parsed) ? undefined : parsed;
}

/** Build the REQUEST_FIX payload that Otto sends to Botto. */
function buildFollowUpFixPayload(
  change: FileChange,
  commentId: string,
  changeIndex: number,
  mrContext: { projectPath: string; mrIid: number; sourceBranch: string; targetBranch: string },
) {
  const fixKey = makeFollowUpFixKey(commentId, changeIndex);
  const gitlabNoteId = resolveGitlabNoteId(commentId);

  return {
    type: 'REQUEST_FIX' as const,
    project_path: mrContext.projectPath,
    mr_iid: mrContext.mrIid,
    comment_id: fixKey,
    suggestion: change.suggestedCode,
    file_path: change.filePath,
    original_code: change.originalCode,
    source_branch: mrContext.sourceBranch,
    comment_body: change.explanation,
    comment_title: `Follow-up fix: ${change.filePath}`,
    severity: null,
    target_branch: mrContext.targetBranch,
    start_line: change.startLine > 0 ? change.startLine : null,
    end_line: change.endLine > 0 ? change.endLine : null,
    gitlab_note_id: gitlabNoteId ?? null,
  };
}

/** Build the REQUEST_FIX payload for a regular review comment fix. */
function buildReviewFixPayload(
  comment: { id: string; suggestion: string; filePath: string; originalCode: string; body: string; title: string; severity: string; startLine?: number; endLine?: number },
  mrContext: { projectPath: string; mrIid: number; sourceBranch: string; targetBranch: string },
) {
  return {
    type: 'REQUEST_FIX' as const,
    project_path: mrContext.projectPath,
    mr_iid: mrContext.mrIid,
    comment_id: comment.id,
    suggestion: comment.suggestion,
    file_path: comment.filePath,
    original_code: comment.originalCode,
    source_branch: mrContext.sourceBranch,
    comment_body: comment.body,
    comment_title: comment.title,
    severity: comment.severity,
    target_branch: mrContext.targetBranch,
    start_line: comment.startLine ?? null,
    end_line: comment.endLine ?? null,
    gitlab_note_id: null, // review comments don't set this
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MR_CONTEXT = {
  projectPath: 'mygroup/myproject',
  mrIid: 42,
  sourceBranch: 'feature-branch',
  targetBranch: 'main',
};

const SAMPLE_CHANGE: FileChange = {
  filePath: 'src/utils/parser.ts',
  startLine: 15,
  endLine: 20,
  originalCode: 'function parse(input: string) {\n  return JSON.parse(input);\n}',
  suggestedCode: 'function parse(input: string) {\n  try {\n    return JSON.parse(input);\n  } catch {\n    return null;\n  }\n}',
  explanation: 'Wrap JSON.parse in try-catch to handle malformed input gracefully.',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Follow-up fix key generation', () => {
  it('produces a unique key per change index', () => {
    const key0 = makeFollowUpFixKey('12345', 0);
    const key1 = makeFollowUpFixKey('12345', 1);
    expect(key0).toBe('followup-12345-0');
    expect(key1).toBe('followup-12345-1');
    expect(key0).not.toBe(key1);
  });

  it('does not collide with review comment IDs', () => {
    // Review comment IDs are UUIDs or numeric strings like "55443322"
    const followUpKey = makeFollowUpFixKey('55443322', 0);
    const reviewCommentId = '55443322';
    expect(followUpKey).not.toBe(reviewCommentId);
    expect(followUpKey).toBe('followup-55443322-0');
  });

  it('handles non-numeric comment IDs', () => {
    const key = makeFollowUpFixKey('abc-def-ghi', 2);
    expect(key).toBe('followup-abc-def-ghi-2');
  });
});

describe('GitLab note ID resolution', () => {
  it('parses numeric comment IDs', () => {
    expect(resolveGitlabNoteId('99887766')).toBe(99887766);
  });

  it('returns undefined for non-numeric IDs', () => {
    expect(resolveGitlabNoteId('abc-def')).toBeUndefined();
    expect(resolveGitlabNoteId('followup-123-0')).toBeUndefined();
  });

  it('handles edge cases', () => {
    expect(resolveGitlabNoteId('')).toBeUndefined();
    expect(resolveGitlabNoteId('0')).toBe(0);
    expect(resolveGitlabNoteId('1')).toBe(1);
  });
});

describe('Follow-up fix REQUEST_FIX payload', () => {
  it('builds correct payload for a single change', () => {
    const payload = buildFollowUpFixPayload(SAMPLE_CHANGE, '99887766', 0, MR_CONTEXT);

    expect(payload.type).toBe('REQUEST_FIX');
    expect(payload.project_path).toBe('mygroup/myproject');
    expect(payload.mr_iid).toBe(42);
    expect(payload.comment_id).toBe('followup-99887766-0');
    expect(payload.suggestion).toBe(SAMPLE_CHANGE.suggestedCode);
    expect(payload.file_path).toBe('src/utils/parser.ts');
    expect(payload.original_code).toBe(SAMPLE_CHANGE.originalCode);
    expect(payload.source_branch).toBe('feature-branch');
    expect(payload.target_branch).toBe('main');
    expect(payload.comment_body).toBe(SAMPLE_CHANGE.explanation);
    expect(payload.comment_title).toBe('Follow-up fix: src/utils/parser.ts');
    expect(payload.start_line).toBe(15);
    expect(payload.end_line).toBe(20);
    expect(payload.gitlab_note_id).toBe(99887766);
  });

  it('sets gitlab_note_id to null for non-numeric comment IDs', () => {
    const payload = buildFollowUpFixPayload(SAMPLE_CHANGE, 'abc-def', 0, MR_CONTEXT);
    expect(payload.gitlab_note_id).toBeNull();
    expect(payload.comment_id).toBe('followup-abc-def-0');
  });

  it('nulls out start/end line when zero', () => {
    const change: FileChange = { ...SAMPLE_CHANGE, startLine: 0, endLine: 0 };
    const payload = buildFollowUpFixPayload(change, '12345', 0, MR_CONTEXT);
    expect(payload.start_line).toBeNull();
    expect(payload.end_line).toBeNull();
  });

  it('handles multiple changes from the same follow-up', () => {
    const change2: FileChange = {
      filePath: 'src/utils/validator.ts',
      startLine: 5,
      endLine: 8,
      originalCode: 'return true;',
      suggestedCode: 'return isValid(input);',
      explanation: 'Actually validate the input.',
    };

    const payload0 = buildFollowUpFixPayload(SAMPLE_CHANGE, '12345', 0, MR_CONTEXT);
    const payload1 = buildFollowUpFixPayload(change2, '12345', 1, MR_CONTEXT);

    // Different tracking keys
    expect(payload0.comment_id).toBe('followup-12345-0');
    expect(payload1.comment_id).toBe('followup-12345-1');

    // Same gitlab_note_id (both from the same follow-up thread)
    expect(payload0.gitlab_note_id).toBe(12345);
    expect(payload1.gitlab_note_id).toBe(12345);

    // Different file paths
    expect(payload0.file_path).toBe('src/utils/parser.ts');
    expect(payload1.file_path).toBe('src/utils/validator.ts');
  });
});

describe('Backward compatibility — review comment fix payload', () => {
  it('sends null gitlab_note_id for review comment fixes', () => {
    const payload = buildReviewFixPayload(
      {
        id: '55443322',
        suggestion: 'let x = 1;',
        filePath: 'src/main.rs',
        originalCode: 'let x = 0;',
        body: 'Use 1 instead of 0',
        title: 'Wrong initial value',
        severity: 'warning',
        startLine: 10,
        endLine: 10,
      },
      MR_CONTEXT,
    );

    expect(payload.comment_id).toBe('55443322');
    expect(payload.gitlab_note_id).toBeNull();
    // Botto router resolves: gitlab_note_id.or_else(|| comment_id.parse().ok())
    // => Some(55443322) — backward compatible
  });

  it('uses comment.id directly as comment_id (not wrapped)', () => {
    const payload = buildReviewFixPayload(
      {
        id: 'uuid-abc-123',
        suggestion: 'fix()',
        filePath: 'lib.rs',
        originalCode: 'broken()',
        body: 'Fix it',
        title: 'Bug',
        severity: 'error',
      },
      MR_CONTEXT,
    );

    expect(payload.comment_id).toBe('uuid-abc-123');
    expect(payload.gitlab_note_id).toBeNull();
  });
});

describe('Fix job store key isolation', () => {
  it('follow-up fix keys never collide with review comment IDs', () => {
    // Simulate a store with both review and follow-up fix jobs
    const fixJobs: Record<string, { status: string }> = {};

    // Review comment fix
    const reviewCommentId = '55443322';
    fixJobs[reviewCommentId] = { status: 'running' };

    // Follow-up fix from the same GitLab note
    const followUpKey = makeFollowUpFixKey('55443322', 0);
    fixJobs[followUpKey] = { status: 'testing' };

    expect(Object.keys(fixJobs)).toHaveLength(2);
    expect(fixJobs[reviewCommentId]!.status).toBe('running');
    expect(fixJobs[followUpKey]!.status).toBe('testing');
  });

  it('multiple follow-up changes track independently', () => {
    const fixJobs: Record<string, { status: string }> = {};

    fixJobs[makeFollowUpFixKey('12345', 0)] = { status: 'complete' };
    fixJobs[makeFollowUpFixKey('12345', 1)] = { status: 'failed' };
    fixJobs[makeFollowUpFixKey('12345', 2)] = { status: 'running' };

    expect(Object.keys(fixJobs)).toHaveLength(3);
    expect(fixJobs['followup-12345-0']!.status).toBe('complete');
    expect(fixJobs['followup-12345-1']!.status).toBe('failed');
    expect(fixJobs['followup-12345-2']!.status).toBe('running');
  });
});
