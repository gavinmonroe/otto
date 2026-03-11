// ---------------------------------------------------------------------------
// useGitLabContext hook — provides the current GitLab page context.
//
// Parses the current URL to extract project path, MR IID, and host URL.
// Also resolves the configured GitLab host (if any) for API access.
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { parseMrUrl } from '@/lib/dom-observer';
import { sendMessage } from '@/lib/messaging';
import type { GitLabHost } from '@/types/settings';

type GitLabContext = {
  hostUrl: string;
  projectPath: string;
  mrIid: number;
  host: GitLabHost | null;
  isConfigured: boolean;
};

export function useGitLabContext() {
  const [context, setContext] = useState<GitLabContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function resolve() {
      const urlInfo = parseMrUrl(window.location.href);
      if (!urlInfo) {
        setLoading(false);
        return;
      }

      const hostResult = await sendMessage({
        type: 'RESOLVE_GITLAB_HOST',
        payload: { pageUrl: urlInfo.hostUrl },
      });

      setContext({
        hostUrl: urlInfo.hostUrl,
        projectPath: urlInfo.projectPath,
        mrIid: urlInfo.mrIid,
        host: hostResult.ok ? hostResult.data : null,
        isConfigured: hostResult.ok && hostResult.data !== null,
      });
      setLoading(false);
    }

    resolve();
  }, []);

  return { context, loading };
}
