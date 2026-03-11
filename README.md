# Otto — AI Code Review for GitLab
Otto is a Chrome extension that injects AI-powered code review tooling directly into GitLab merge request diff pages. It surfaces MR summaries, per-file review comments, related file discovery, edge case analysis, and comment follow-up suggestions — all rendered inline within the GitLab UI.

All AI suggestions are drafts you can accept, edit, or dismiss. Nothing is auto-posted.

Works with gitlab.com, self-hosted GitLab instances, and any OpenAI-compatible API endpoint (OpenRouter, Ollama, etc.).

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) package manager

## Setup

```bash
# Install dependencies
pnpm install
```

## Build

```bash
# Production build (Chrome)
pnpm build

# Production build (Firefox)
pnpm build:firefox
```

The build output will be in `.output/chrome-mv3/` (or `.output/firefox-mv2/` for Firefox).

### Development

For development with hot module reloading:

```bash
pnpm dev
```

This launches a dev browser instance with the extension loaded automatically.

## Load into Chrome

1. Run `pnpm build` to generate the production build
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `.output/chrome-mv3` directory from the project root
6. The Otto extension icon should appear in your toolbar

## Configuration

After loading the extension:

1. Click the Otto icon in the toolbar, or right-click it and select **Options**
2. Add your GitLab connection (instance URL + personal access token)
3. Configure your AI provider (API endpoint, API key, model selection)

Then navigate to any GitLab merge request diff page — Otto will activate automatically.
