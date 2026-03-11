import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Otto — AI Code Review for GitLab',
    description: 'AI-powered code review tooling injected directly into GitLab merge request diff pages.',
    version: '0.1.0',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['*://*/*'],
    icons: {
      16: '/icon-16.png',
      48: '/icon-48.png',
      128: '/icon-128.png',
    },
  },
});
