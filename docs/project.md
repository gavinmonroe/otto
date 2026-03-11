# Otto — Project Architecture

## Tech Stack

| Layer | Technology | Version | Rationale |
|---|---|---|---|
| Extension Framework | WXT | 0.20+ | Best-maintained MV3 framework, Vite-based, file-based entrypoints, shadow DOM helpers |
| UI Framework | React | 19 | Industry standard, rich ecosystem, concurrent features |
| Language | TypeScript | 5.x | Type safety across all layers, discriminated unions for messages |
| Components | shadcn/ui | latest | Composable unstyled primitives, full styling control, copy-paste ownership |
| Styling | Tailwind CSS | 4.x | Utility-first, works in shadow DOM with proper config |
| CSS Isolation | Shadow DOM | native | `createShadowRootUi` from WXT, prevents style leakage both directions |
| State Management | Zustand | 5.x | Lightweight, no boilerplate, works in content script lifecycle |
| Persistent Storage | chrome.storage.local | MV3 | Survives service worker termination, syncs across extension contexts |
| AI Client | openai (npm) | 4.x | Official SDK, works with any OpenAI-compatible endpoint |
| HTTP Client | fetch | native | No extra deps for GitLab API, typed wrapper |
| Bundler | Vite (via WXT) | 6.x | Fast builds, tree-shaking, HMR for extension pages |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     GitLab MR Page (DOM)                     │
│                                                              │
│  ┌─────────────── Shadow DOM (Otto UI) ───────────────────┐ │
│  │                                                         │ │
│  │  ┌─────────────────┐  ┌──────────────────────────────┐ │ │
│  │  │ MrOverviewPanel  │  │ FileReviewCard (per .diff-file)│ │ │
│  │  │ - MR summary     │  │ - AI review comments          │ │ │
│  │  │ - Risk assessment│  │ - Accept/dismiss/edit actions  │ │ │
│  │  │ - Review trigger │  │ - Per-file review trigger      │ │ │
│  │  └─────────────────┘  └──────────────────────────────────┘ │ │
│  │  ┌─────────────────┐  ┌──────────────────────────────┐ │ │
│  │  │RelatedFilesPanel │  │ EdgeCaseAnalysis              │ │ │
│  │  │ - Discovered files│  │ - Failure modes               │ │ │
│  │  │ - File content   │  │ - Stack traces                │ │ │
│  │  │ - Why it matters │  │ - Missing error handling      │ │ │
│  │  └─────────────────┘  └──────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
│                              │                                │
│                   Content Script Context                      │
│                   (gitlab-mr.content)                         │
└──────────────────────────────┼────────────────────────────────┘
                               │
                chrome.runtime.sendMessage (typed)
                               │
              ┌────────────────▼────────────────┐
              │       Service Worker             │
              │       (background.ts)            │
              │                                  │
              │  Message Router                  │
              │    │                             │
              │    ├── AI Service ──────────────►│ OpenAI-compatible API
              │    │   (configurable endpoint)   │ (kiro-gateway, OpenRouter,
              │    │                             │  Ollama, etc.)
              │    ├── GitLab Service ──────────►│ GitLab REST API v4
              │    │   (PAT auth, multi-host)    │ (gitlab.com or self-hosted)
              │    │                             │
              │    └── Storage Service           │
              │        (chrome.storage.local)    │
              └─────────────────────────────────┘
```

## Why API Calls Go Through the Service Worker

Content scripts run in the context of the web page and face CORS restrictions. GitLab's CSP headers would block requests to arbitrary AI endpoints. The service worker has no CORS restrictions — it can call any URL. All HTTP calls (GitLab API, AI API) are routed through the service worker via typed message passing.

This also centralizes error handling, retry logic, and token management in one place.

## Project Structure

```
otto/
├── src/
│   ├── entrypoints/                       # WXT entrypoints (auto-discovered)
│   │   ├── background.ts                  # Service worker: message router
│   │   ├── popup/                          # Browser action popup
│   │   │   ├── index.html
│   │   │   ├── main.tsx
│   │   │   └── App.tsx
│   │   ├── options/                        # Full settings page
│   │   │   ├── index.html
│   │   │   ├── main.tsx
│   │   │   └── App.tsx
│   │   └── gitlab-mr.content/             # Content script for MR diffs
│   │       ├── index.tsx                   # Entry: detection, observer, mount
│   │       ├── App.tsx                     # Root injected component
│   │       ├── index.tsx                   # Entry: detection, observer, mount
│   │       └── style.css                   # Tailwind entry for shadow DOM
│   │
│   ├── components/                         # Shared React components
│   │   ├── OttoLogo.tsx                    # Brand logo (currentColor for dark mode)
│   │   ├── Markdown.tsx                    # Markdown renderer (react-markdown + GFM)
│   │   ├── ThemeContext.tsx                # Dark/light theme provider + useTheme hook
│   │   ├── ui/                             # shadcn/ui primitives (button, card, etc.)
│   │   ├── review/                         # Review-specific components
│   │   │   ├── MrOverviewPanel.tsx         # Summary banner above diffs
│   │   │   ├── FileReviewCard.tsx          # Compact button in diff file header
│   │   │   ├── FileReviewFooter.tsx        # Collapsible review sections in diff footer
│   │   │   ├── ReviewComment.tsx           # Single review comment (used in footer)
│   │   │   ├── RelatedFilesPanel.tsx       # Related files not in the diff
│   │   │   ├── EdgeCaseAnalysis.tsx        # Edge case / stack trace analysis
│   │   │   └── ReviewActions.tsx           # Accept/dismiss/edit actions
│   │   └── settings/                       # Settings form components
│   │       ├── AiProviderForm.tsx
│   │       ├── GitLabConnectionForm.tsx
│   │       └── ModelSelector.tsx
│   │
│   ├── services/                           # Business logic layer
│   │   ├── ai/
│   │   │   ├── ai-client.ts               # Raw fetch OpenAI-compatible client
│   │   │   ├── ai-service.ts              # Orchestrates AI calls + model routing
│   │   │   └── prompts/                    # Prompt templates (data, not logic)
│   │   │       ├── summary.ts
│   │   │       ├── code-review.ts
│   │   │       ├── edge-cases.ts
│   │   │       └── related-files.ts
│   │   ├── gitlab/
│   │   │   ├── gitlab-client.ts            # GitLab REST API v4 typed client
│   │   │   ├── mr-parser.ts               # Extracts MR context from DOM + API
│   │   │   ├── diff-parser.ts             # Parses structured diff data from DOM
│   │   │   └── repo-service.ts            # File tree, file content, blame
│   │   └── review/
│   │       ├── review-orchestrator.ts      # Coordinates the full review pipeline
│   │       ├── review-store.ts            # Zustand store for review state
│   │       ├── review-types.ts            # Shared review domain types
│   │       └── stream-dispatcher.ts       # Shared chunk→store dispatch logic
│   │
│   ├── lib/                                # Pure utilities (no side effects)
│   │   ├── utils.ts                        # cn() helper, general utils
│   │   ├── storage.ts                      # Typed chrome.storage wrapper
│   │   ├── messaging.ts                    # Typed message passing system
│   │   └── dom-observer.ts                # MutationObserver helpers
│   │
│   ├── hooks/                              # Shared React hooks
│   │   ├── use-settings.ts
│   │   ├── use-review.ts
│   │   ├── use-gitlab-context.ts
│   │   └── use-ai-stream.ts
│   │
│   └── types/                              # Global type definitions
│       ├── gitlab.ts                       # GitLab API response types
│       ├── review.ts                       # Review domain types
│       ├── settings.ts                     # Settings schema
│       └── messages.ts                     # Extension message protocol
│
├── public/                                 # Static assets
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
│
├── docs/                                   # Project documentation
│   ├── idea.md
│   ├── project.md
│   ├── standards.md
│   └── facts.md
│
├── components.json                         # shadcn/ui configuration
├── tailwind.config.ts                      # Tailwind configuration
├── tsconfig.json                           # TypeScript configuration
├── wxt.config.ts                           # WXT extension configuration
└── package.json
```

## Data Flow

### 1. Settings Configuration

```
Options Page → chrome.storage.local → Service Worker reads on demand
                                    → Content Script reads via messaging
```

Settings are written by the options page directly to `chrome.storage.local`. The service worker reads them when handling API requests. The content script requests settings via message passing (it cannot read storage directly in all contexts).

### 2. MR Review Pipeline

```
Content Script                    Service Worker                External APIs
     │                                 │                             │
     │ 1. Parse MR context from DOM    │                             │
     │    (project, MR IID, diff data) │                             │
     │                                 │                             │
     │ 2. FETCH_MR_METADATA ──────────►│                             │
     │                                 │ 3. GET /projects/:id/       │
     │                                 │    merge_requests/:iid ────►│ GitLab API
     │                                 │◄────────────────────────────│
     │◄──── MR metadata ──────────────│                             │
     │                                 │                             │
     │ 4. REQUEST_REVIEW ─────────────►│                             │
     │    (diff data + MR context)     │                             │
     │                                 │ 5. Fetch file contents ────►│ GitLab API
     │                                 │◄────────────────────────────│
     │                                 │                             │
     │                                 │ 6. AI: summary ────────────►│ AI API
     │◄──── stream: summary ──────────│◄──── stream ────────────────│
     │                                 │                             │
     │                                 │ 7. AI: per-file review ────►│ AI API
     │◄──── stream: file reviews ─────│◄──── stream ────────────────│
     │                                 │                             │
     │                                 │ 8. AI: related files ──────►│ AI API
     │                                 │◄────────────────────────────│
     │                                 │ 9. Fetch related files ────►│ GitLab API
     │◄──── related files + content ──│◄────────────────────────────│
     │                                 │                             │
     │                                 │10. AI: edge cases ─────────►│ AI API
     │◄──── stream: edge cases ───────│◄──── stream ────────────────│
```

### 3. Streaming Strategy

AI responses stream from the service worker to the content script using `chrome.runtime.connect()` (long-lived port). This allows incremental rendering as tokens arrive, rather than waiting for the full response.

The port-based approach is necessary because `sendMessage` is request-response (one shot). Streaming requires a persistent channel.

```typescript
// Content script opens a port
const port = chrome.runtime.connect({ name: 'ai-stream' });
port.postMessage({ type: 'STREAM_REVIEW', payload: { ... } });
port.onMessage.addListener((chunk) => {
  // Render incrementally
});

// Service worker handles the port
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'ai-stream') {
    port.onMessage.addListener(async (msg) => {
      // Stream AI response, forwarding chunks via port.postMessage
    });
  }
});
```

## Settings Schema

```typescript
interface OttoSettings {
  ai: {
    baseUrl: string;           // OpenAI-compatible endpoint base URL
    apiKey: string;            // API key for the endpoint
    models: {
      summary: string;         // Model for MR summaries
      codeReview: string;      // Model for per-file code review
      edgeCases: string;       // Model for edge case analysis
      relatedFiles: string;    // Model for related file discovery
    };
    temperature: {
      summary: number;
      codeReview: number;
      edgeCases: number;
      relatedFiles: number;
    };
  };
  gitlab: {
    hosts: Array<{
      id: string;              // UUID for stable reference
      url: string;             // e.g., "https://gitlab.com"
      pat: string;             // Personal Access Token
      label: string;           // User-friendly display name
    }>;
  };
  preferences: {
    autoReview: boolean;       // Auto-trigger review on page load
    streamResponses: boolean;  // Show streaming AI responses
    theme: 'light' | 'dark' | 'auto';
  };
}
```

## Security Considerations

- PATs and API keys are stored in `chrome.storage.local` (not synced across devices)
- Content scripts never hold credentials — they request data via messaging
- The service worker adds auth headers only when making outbound requests
- No credentials are ever injected into the page DOM
- `web_accessible_resources` are scoped to minimize exposure

## Extension Permissions

```json
{
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["*://*/*"]
}
```

`host_permissions: *://*/*` is required because:
1. Self-hosted GitLab can be on any domain
2. AI endpoints can be on any domain
3. The service worker needs to make fetch requests to both

Users grant this on install. A future optimization could use optional permissions to request specific hosts at runtime.
