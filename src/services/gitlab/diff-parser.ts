// ---------------------------------------------------------------------------
// Diff parser — extracts structured diff data from the GitLab MR page DOM.
//
// This runs in the content script context. It reads the DOM to extract
// diff information that we can send to the AI for review.
//
// Design decisions:
// - We parse from the DOM rather than relying solely on the API because:
//   1. The DOM is already loaded (no extra API call)
//   2. It reflects exactly what the user sees (including any filters)
//   3. The API's /changes endpoint can be slow for large MRs
// - However, we also support parsing from API data (GitLabDiffFile[]) for
//   cases where we need the full diff text (DOM may truncate large files).
// - The DiffFileData type is shared between DOM-parsed and API-parsed data.
// ---------------------------------------------------------------------------

import type { DiffFileData } from '@/types/review';
import type { GitLabDiffFile } from '@/types/gitlab';

/**
 * Extract diff file data from the DOM.
 * Reads all .diff-file elements currently in the page.
 *
 * Note: GitLab lazy-loads diffs, so this may not capture all files
 * if called before loading completes. The content script should call
 * this after observing all files, or use the API fallback.
 */
export function parseDiffFilesFromDom(): DiffFileData[] {
  const fileElements = document.querySelectorAll('.diff-file.file-holder');
  const files: DiffFileData[] = [];

  for (const el of fileElements) {
    const filePath = el.getAttribute('data-path');
    if (!filePath) continue;

    // Determine file status from CSS classes and header badges
    const isNew = el.querySelector('.file-title-name')?.closest('.diff-file')
      ?.querySelector('.badge-new') !== null
      || el.querySelector('[data-testid="file-title"]')?.textContent?.includes('new file') === true;

    const isDeleted = el.querySelector('.badge-deleted') !== null
      || el.querySelector('[data-testid="file-title"]')?.textContent?.includes('deleted') === true;

    const isRenamed = el.querySelector('.badge-renamed') !== null
      || el.querySelector('[data-testid="file-title"]')?.textContent?.includes('renamed') === true;

    // Extract the diff text from line content elements
    const diffLines: string[] = [];
    let addedLines = 0;
    let removedLines = 0;

    const lineRows = el.querySelectorAll('.diff-grid-row.diff-tr.line_holder');
    for (const row of lineRows) {
      const leftContent = row.querySelector('.diff-grid-left .line_content');
      const rightContent = row.querySelector('.diff-grid-right .line_content');

      // Inline view: single content cell
      const inlineContent = row.querySelector('.line_content:not(.parallel)');

      if (inlineContent) {
        const text = inlineContent.textContent || '';
        if (inlineContent.classList.contains('new')) {
          diffLines.push(`+${text}`);
          addedLines++;
        } else if (inlineContent.classList.contains('old')) {
          diffLines.push(`-${text}`);
          removedLines++;
        } else {
          diffLines.push(` ${text}`);
        }
      } else {
        // Parallel view: left (old) and right (new) content cells
        if (leftContent?.classList.contains('old')) {
          diffLines.push(`-${leftContent.textContent || ''}`);
          removedLines++;
        }
        if (rightContent?.classList.contains('new')) {
          diffLines.push(`+${rightContent.textContent || ''}`);
          addedLines++;
        }
        if (leftContent && !leftContent.classList.contains('old') && !leftContent.classList.contains('empty-cell')) {
          diffLines.push(` ${leftContent.textContent || ''}`);
        }
      }
    }

    files.push({
      filePath,
      oldPath: isRenamed ? null : null, // DOM doesn't reliably expose old path
      isNew,
      isDeleted,
      isRenamed,
      diff: diffLines.join('\n'),
      addedLines,
      removedLines,
    });
  }

  return files;
}

/**
 * Convert GitLab API diff files to our DiffFileData format.
 * Used when we fetch diffs via the API (more reliable for full diff text).
 */
export function parseDiffFilesFromApi(apiFiles: GitLabDiffFile[]): DiffFileData[] {
  return apiFiles.map((file) => {
    let addedLines = 0;
    let removedLines = 0;

    // Count added/removed lines from the unified diff
    const lines = file.diff.split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) addedLines++;
      if (line.startsWith('-') && !line.startsWith('---')) removedLines++;
    }

    return {
      filePath: file.new_path,
      oldPath: file.renamed_file ? file.old_path : null,
      isNew: file.new_file,
      isDeleted: file.deleted_file,
      isRenamed: file.renamed_file,
      diff: file.diff,
      addedLines,
      removedLines,
    };
  });
}
