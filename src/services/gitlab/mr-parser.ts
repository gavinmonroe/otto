// ---------------------------------------------------------------------------
// MR Parser — extracts MR context from the page DOM and enriches it with
// API data.
//
// This runs in the content script. It combines DOM-parsed data with
// API-fetched data (via messaging to the service worker) to build
// the complete MrContext that the review pipeline needs.
//
// Design decisions:
// - DOM parsing is the primary source for what the user sees.
// - API data enriches with full diff text, MR metadata, and branch info.
// - The parser is tolerant of missing data — it returns what it can find.
// - Project ID resolution: we try the DOM first (data attributes), then API.
// ---------------------------------------------------------------------------

import type { MrContext, DiffFileData } from '@/types/review';
import { parseMrUrl } from '@/lib/dom-observer';
import { parseDiffFilesFromDom, parseDiffFilesFromApi } from './diff-parser';
import { sendMessage } from '@/lib/messaging';

/**
 * Build the MR context from the current page.
 * Combines DOM data with API data for a complete picture.
 *
 * @param useApi - If true, fetches diff data from the API (more reliable).
 *                 If false, parses from the DOM only (faster, no API call).
 */
export async function buildMrContext(useApi = true): Promise<MrContext | null> {
  const urlInfo = parseMrUrl(window.location.href);
  if (!urlInfo) return null;

  const { hostUrl, projectPath, mrIid } = urlInfo;

  // Resolve the GitLab host configuration
  const hostResult = await sendMessage({
    type: 'RESOLVE_GITLAB_HOST',
    payload: { pageUrl: hostUrl },
  });

  // Start with DOM-parsed diff data
  let diffFiles: DiffFileData[] = parseDiffFilesFromDom();

  // Default MR metadata from what we can infer from the DOM
  let title = extractTitleFromDom();
  let description: string | null = extractDescriptionFromDom();
  let sourceBranch = extractBranchFromDom('source');
  let targetBranch = extractBranchFromDom('target');
  let projectId: number | null = null;
  let authorUsername: string | null = null;

  // Try to get project ID from the DOM
  const bodyEl = document.querySelector('body');
  const domProjectId = bodyEl?.getAttribute('data-project-id');
  if (domProjectId) {
    projectId = parseInt(domProjectId, 10);
  }

  // If we have a configured host, enrich with API data
  if (hostResult.ok && hostResult.data) {
    const host = hostResult.data;

    // Resolve project ID if we don't have it from the DOM
    if (!projectId) {
      const projectResult = await sendMessage({
        type: 'FETCH_PROJECT',
        payload: { hostId: host.id, projectPath },
      });
      if (projectResult.ok) {
        projectId = projectResult.data.id;
      }
    }

    // Fetch MR metadata + optionally full diffs from API
    if (projectId) {
      if (useApi) {
        const changesResult = await sendMessage({
          type: 'FETCH_MR_CHANGES',
          payload: { hostId: host.id, projectId, mrIid },
        });
        if (changesResult.ok) {
          title = changesResult.data.mr.title;
          description = changesResult.data.mr.description;
          sourceBranch = changesResult.data.mr.source_branch;
          targetBranch = changesResult.data.mr.target_branch;
          authorUsername = changesResult.data.mr.author?.username ?? null;
          // API diffs are more reliable (full text, not truncated)
          diffFiles = parseDiffFilesFromApi(changesResult.data.changes);
        }
      } else {
        // Just fetch metadata, use DOM diffs
        const mrResult = await sendMessage({
          type: 'FETCH_MR_METADATA',
          payload: { hostId: host.id, projectId, mrIid },
        });
        if (mrResult.ok) {
          title = mrResult.data.title;
          description = mrResult.data.description;
          sourceBranch = mrResult.data.source_branch;
          targetBranch = mrResult.data.target_branch;
          authorUsername = mrResult.data.author?.username ?? null;
        }
      }
    }
  }

  return {
    projectPath,
    projectId,
    mrIid,
    hostUrl,
    title,
    description,
    sourceBranch,
    targetBranch,
    authorUsername,
    diffFiles,
  };
}

// ---------------------------------------------------------------------------
// DOM extraction helpers — used when no GitLab PAT is configured.
// These parse MR metadata directly from the page DOM.
// GitLab's DOM varies across versions, so we try multiple selectors.
// ---------------------------------------------------------------------------

function extractTitleFromDom(): string {
  // Modern GitLab (16+)
  const titleEl = document.querySelector('[data-testid="title-content"]')
    // Older GitLab
    || document.querySelector('.merge-request .detail-page-header-body .title')
    || document.querySelector('.merge-request-details .title')
    // Fallback: page title often contains "MR Title (!123)"
    || document.querySelector('.page-title');

  if (titleEl) {
    return titleEl.textContent?.trim() || '';
  }

  // Last resort: parse from document.title — format is "Title (!123) · MRs · Project · GitLab"
  const docTitle = document.title;
  const match = docTitle.match(/^(.+?)\s*\(!?\d+\)/);
  return match ? match[1].trim() : '';
}

function extractDescriptionFromDom(): string | null {
  const descEl = document.querySelector('[data-testid="description-content"]')
    || document.querySelector('.merge-request-details .description .md');

  const text = descEl?.textContent?.trim();
  return text || null;
}

function extractBranchFromDom(type: 'source' | 'target'): string {
  // GitLab shows branch names in the MR header with clipboard buttons
  if (type === 'source') {
    const sourceEl = document.querySelector('[data-testid="source-branch-copy"]')
      || document.querySelector('.mr-source-branch .ref-name')
      || document.querySelector('.js-source-branch');
    return sourceEl?.textContent?.trim() || '';
  }

  const targetEl = document.querySelector('[data-testid="target-branch-copy"]')
    || document.querySelector('.mr-target-branch .ref-name')
    || document.querySelector('.js-target-branch');
  return targetEl?.textContent?.trim() || '';
}
