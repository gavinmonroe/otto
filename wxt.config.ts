import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Otto — AI Code Review for GitLab',
    description: 'AI-powered code review tooling injected directly into GitLab merge request diff pages.',
    version: '0.1.1',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['*://*/*'],
    icons: {
      16: '/icon-16.png',
      48: '/icon-48.png',
      128: '/icon-128.png',
    },
  },
  // Force options page to open in a full tab instead of an embedded popup.
  // The embedded popup closes on any focus loss, making forms unusable.
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      if (manifest.options_ui) {
        manifest.options_ui.open_in_tab = true;
      }
    },
  },
});
