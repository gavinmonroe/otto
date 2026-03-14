# Otto — AI Code Review for GitLab

Otto is an open-source Chrome extension that injects AI-powered code review tooling directly into GitLab merge request pages. It surfaces MR summaries, per-file review comments, edge case analysis, related file discovery, behavioral verification, and more — all rendered inline within the GitLab UI.

All AI suggestions are drafts you can accept, edit, or dismiss. Nothing is auto-posted to GitLab.

Works with gitlab.com, self-hosted GitLab instances, and any OpenAI-compatible API endpoint (OpenRouter, Ollama, local models, etc.).

## Why Otto?

- **Zero context switching** — reviews appear inside GitLab, not in a separate tool
- **Privacy first** — your code goes to your chosen AI provider, not to Otto's servers. There is no Otto backend.
- **Works with any model** — OpenAI, Anthropic, Mistral, Ollama, or any OpenAI-compatible endpoint
- **Learns your style** — tracks which suggestions you accept/dismiss and adapts over time
- **Multi-host** — configure multiple GitLab instances (work + personal, etc.)
- **Incremental** — re-reviews only re-process files that changed since the last review
- **Offline-capable** — cached reviews persist across browser restarts

## Features

### Core Review

| Feature | Description |
|---------|-------------|
| **MR Summary** | Overview of what changed and why, risk assessment, key changes, affected areas |
| **Per-File Review** | Comments with severity (critical/warning/suggestion/info), category labels, code suggestions with inline diffs |
| **Edge Case Analysis** | Identifies boundary conditions, race conditions, null safety issues, resource leaks — with hypothetical failure traces |
| **Related Files** | Discovers files not in the diff that are relevant (importers, shared types, tests, configs) with fetched content |
| **File Activity** | Cross-MR awareness — shows recently-merged MRs that touched the same files (30-day lookback) |
| **Acceptance Criteria** | Validates the diff against Jira ticket acceptance criteria (satisfied/unclear/not-found per criterion) |

### Guided Review Mode

A slide-based presentation that replaces GitLab's diff view with a prioritized walkthrough:

- Slides sorted by priority: unresolved GitLab threads > critical comments > warnings > edge cases > suggestions
- Each slide shows the file diff with relevant lines highlighted, file activity, related files with collapsible diffs and content previews
- Keyboard navigation: arrow keys (prev/next), `a` (accept), `d` (dismiss)
- Completion tracking with progress bar and sidebar checklist
- Toggle between Default (list) and Guided (slides) modes after review completes

### Verification Layer

Three AI-powered verification analyses run automatically after the core review:

- **Behavioral Delta** — identifies what behaviors changed, were preserved, or changed unexpectedly. Each behavior has a Given/When/Then test scenario.
- **Stress Tests** — property-based tests that try to break changed code. Shows held properties (green), counterexamples (red), and generated test code.
- **Inferred Contracts** — preconditions, postconditions, and invariants for changed functions. Verified by AI reasoning with violation paths.
- **Trust Score** — composite confidence badge (0-100) based on mutation score, counterexample quality, test independence. AI-only mode capped at 65%.

### MR List Command Center

Enhances GitLab's merge request list page:

- **Priority Sorting** — auto-sorts MRs by computed priority (risk, diff size, staleness, urgent labels, approval status)
- **Ticket Grouping** — groups related MRs by Jira ticket key in a tree view with collapsible headers
- **Queue Reviews** — batch-enqueue MR reviews from the list page. Reviews run one at a time in the background.
- **Live Progress** — segmented progress bars per MR, real-time status updates
- **Pause/Resume** — pause any review mid-flight, resume later from where it left off
- **Cross-Page Sync** — navigate to a queued MR and see live results streaming in

### Chat

Context-aware Q&A about the merge request:

- Understands the full diff, review comments, edge cases, and file context
- Suggested quick-action questions ("Where should I start reviewing?", "What's the riskiest change?")
- Clickable file:line references in responses that scroll to the code
- Draggable panel, conversation history cached per MR

### Comment Follow-Up

One-click analysis on any GitLab comment thread:

- Classifies the comment's intent (bug report, question, style suggestion, etc.)
- Provides the reviewer's perspective and recommended action
- Injected as a button in GitLab's comment action bar
- Cached per thread with hash-based invalidation

### Inline Integration

Otto injects UI elements throughout GitLab's native interface:

- **Risk dots** in the file tree sidebar (red/amber/green per file)
- **Review buttons** in each diff file header
- **Comment cards** below each diff file with collapsible suggestions
- **Inline comments** injected into specific diff lines
- **Related files panel** in GitLab's sidebar
- **Keyboard shortcuts** for navigating comments (j/k), files (J/K), accepting (a), dismissing (d)

### Syntax Highlighting

50 languages supported via Shiki with GitHub light/dark themes:

TypeScript, JavaScript, Vue, Svelte, Python, Go, Rust, Java, Ruby, C#, C, C++, Swift, Kotlin, Dart, Objective-C, PHP, Perl, Lua, R, Elixir, Scala, Clojure, Haskell, Erlang, HTML, CSS, SCSS, Less, JSON, YAML, TOML, XML, SQL, Bash, PowerShell, Dockerfile, GraphQL, Terraform/HCL, Nginx, Markdown, LaTeX, and more.

Vue and Svelte diff fragments use automatic sub-language detection (template → HTML, script → TypeScript, style → CSS).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [WXT](https://wxt.dev/) (Web Extension Toolkit) |
| UI | React 19, inline styles (shadow DOM compatible) |
| State | Zustand 5 |
| Styling | Tailwind CSS 3 (options/popup), inline styles (content scripts) |
| Syntax | Shiki 4 (50 languages, GitHub themes) |
| Icons | Lucide React |
| Markdown | react-markdown + remark-gfm |
| Build | Vite 7 |
| Language | TypeScript 5 (strict) |

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) package manager

## Setup

```bash
git clone https://github.com/user/otto.git
cd otto
pnpm install
```

## Build

```bash
# Production build (Chrome)
pnpm build

# Production build (Firefox)
pnpm build:firefox
```

Output: `.output/chrome-mv3/` or `.output/firefox-mv2/`

## Development

```bash
pnpm dev
```

Launches a dev browser with the extension loaded and hot module reloading.

## Load into Chrome

1. Run `pnpm build`
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `.output/chrome-mv3` directory
6. The Otto icon appears in your toolbar

## Configuration

### AI Provider

1. Click the Otto icon → **Options** (or right-click → Options)
2. Under **AI Provider**, enter your OpenAI-compatible endpoint URL and API key
3. Select models per task (summary, code review, edge cases, etc.)
4. Optionally adjust temperature and max tokens per task

Works with any OpenAI-compatible API: OpenAI, Anthropic (via proxy), OpenRouter, Ollama, vLLM, LM Studio, etc.

### GitLab Connection

1. In Options, under **GitLab**, click **Add Host**
2. Enter your GitLab instance URL and a Personal Access Token (PAT)
3. The PAT needs `read_api` scope (for file content, discussions, file tree)
4. Multiple hosts supported — Otto auto-detects which host you're on

Without a PAT, Otto still works but with limited context (no file content fetching, no related files, no file activity).

### Jira Integration (Optional)

1. In Options, under **Ticket Providers**, add your Jira instance
2. Enter the base URL, email, and API token
3. Otto extracts ticket keys from MR titles/branches and fetches acceptance criteria

### Per-Task Model Configuration

Each AI task can use a different model, temperature, and custom system prompt:

| Task | Default Model | Default Temp |
|------|--------------|-------------|
| Summary | claude-sonnet-4-5 | 0.3 |
| Code Review | claude-sonnet-4-5 | 0.2 |
| Edge Cases | claude-sonnet-4-5 | 0.3 |
| Related Files | claude-haiku-4-5 | 0.1 |
| Follow-Up | claude-sonnet-4-5 | 0.3 |
| Chat | claude-sonnet-4-5 | 0.4 |
| AC Validation | claude-sonnet-4-5 | 0.2 |
| Adversarial Tests | claude-sonnet-4-5 | 0.3 |
| Contracts | claude-sonnet-4-5 | 0.2 |
| Behavioral Delta | claude-sonnet-4-5 | 0.3 |

### Feature Toggles

Every feature can be individually enabled/disabled in Settings:

- Summary, Code Review, Edge Cases, Related Files
- Follow-Up Analysis, Chat, AC Validation
- MR List Preview, MR Review Queue
- Adversarial Tests, Contracts, Behavioral Delta (disabled by default)

## Repo-Level Configuration

Teams can place a `.otto.json` in their repository root:

```json
{
  "context": "E-commerce platform built with Vue 3 + Node.js. Uses event sourcing for order processing.",
  "focus": ["security", "error-handling", "performance"],
  "ignore": ["style", "naming"],
  "reviewTemplate": "Check for SQL injection, validate all user inputs, ensure error boundaries exist.",
  "acceptanceCriteriaField": "customfield_10042"
}
```

| Field | Purpose |
|-------|---------|
| `context` | Project description injected into all AI prompts |
| `focus` | Review categories to prioritize (up to 20) |
| `ignore` | Categories to deprioritize (up to 20) |
| `reviewTemplate` | Custom review checklist |
| `acceptanceCriteriaField` | Jira custom field ID for acceptance criteria |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous comment |
| `J` / `K` | Next / previous file |
| `a` | Accept current suggestion |
| `d` | Dismiss current suggestion |
| `e` | Edit current suggestion |
| `c` | Open chat focused on current comment |
| `Esc` | Clear selection |
| `?` | Show keyboard help |

In Guided Review mode: `←` / `→` for slide navigation.

## Architecture

```
┌─ Content Scripts ──────────────────────────────────────┐
│  gitlab-mr.content     → MR diff page UI + injections  │
│  gitlab-mr-list.content → MR list page enhancements    │
└────────────────────────────────────────────────────────┘
         │ chrome.runtime messages + ports
         ▼
┌─ Background Service Worker ────────────────────────────┐
│  Message router (25+ handlers)                         │
│  Review orchestrator (parallel task pipeline)           │
│  Queue manager (background review execution)           │
│  AI service (10 generation methods)                    │
│  GitLab client (REST API v4)                           │
│  Syntax highlighter (Shiki, 50 languages)              │
│  Jira client                                           │
└────────────────────────────────────────────────────────┘
         │
         ▼
┌─ External ─────────────────────────────────────────────┐
│  Any OpenAI-compatible API                             │
│  GitLab REST API v4                                    │
│  Jira REST API (optional)                              │
│  Verification server (optional)                        │
└────────────────────────────────────────────────────────┘
```

### Review Pipeline

```
MR Diff → Parse Context → [Parallel]
                           ├─ Summary (+ ticket context)
                           ├─ File Activity (API only)
                           ├─ Context Enrichment (imports, callers, file tree)
                           └─ Ticket Fetch (Jira)
                                    ↓
                          [Parallel, after context ready]
                           ├─ Code Review (batches of 3, incremental)
                           ├─ Edge Cases
                           ├─ Related Files
                           └─ AC Validation
                                    ↓
                          [After core complete]
                           ├─ Adversarial Tests (uses edge cases as hints)
                           ├─ Contracts
                           └─ Behavioral Delta (uses summary for intent)
                                    ↓
                           Trust Score Computation
                                    ↓
                           STREAM_ALL_COMPLETE
```

### Caching Strategy

All caches use `chrome.storage.local` with TTL-based expiration:

| Cache | TTL | Max Entries | Invalidation |
|-------|-----|-------------|-------------|
| Review results | 7 days | 20 | Diff hash change |
| Chat messages | 7 days | 30 | Per-MR key |
| Follow-up analyses | 14 days | 100 | Thread hash change |
| MR changed paths | 30 days | 200 | Per-MR key |
| Reviewer preferences | No expiry | Per-host | Manual reset |
| Queue state | No expiry | Per-project | Manual clear |

Reviews are incremental — only files whose diff hash changed since the last review are re-processed. Unchanged files reuse cached results instantly.

### Streaming Protocol

Otto uses a port-based streaming protocol over `chrome.runtime.connect()`:

1. Content script opens a port with name `otto-stream:{mrIid}`
2. Sends a `StreamRequest` with the task list
3. Background runs the orchestrator, sends `StreamChunk` messages back
4. Content script dispatches chunks to the Zustand store
5. React components re-render from store updates
6. Delta batching at 60fps via `requestAnimationFrame` prevents UI jank

30+ chunk types cover every data flow: summary deltas, file review deltas, edge cases, related files, verification results, progress messages, errors, and completion signals.

## Reviewer Learning

Otto learns from your accept/dismiss patterns:

- Tracks per-host, per-category statistics (e.g., "user dismisses 80% of style suggestions")
- Categories with >70% dismiss rate are deprioritized in future reviews
- Categories with >30% accept rate are boosted
- Per-repo custom facts can be added in Settings ("We use snake_case in this repo")
- Preferences are formatted and injected into AI prompts automatically

## Performance

- **Health monitor** tracks event loop lag, frame rate, and long tasks
- Three performance levels: normal → degraded → critical
- In degraded mode, streaming is throttled to reduce UI pressure
- Recovery requires 3 seconds of healthy metrics
- Warning toast appears when performance degrades

## Optional: Verification Server

By default, verification runs in AI-only mode. For execution-backed verification:

**GitLab CI** — triggers a pipeline with generated tests on your existing runners. Requires an `otto-verify` job in `.gitlab-ci.yml`.

**Verification Server** — lightweight Node.js service that runs tests in a sandbox and returns mutation scores + coverage data. Configure the URL in Otto settings.

Both modes feed real execution metrics into the trust score, unlocking scores above 65%.

## Project Structure

```
src/
├── entrypoints/
│   ├── background.ts              # Service worker (message router, orchestrator)
│   ├── gitlab-mr.content/         # MR diff page content script
│   ├── gitlab-mr-list.content/    # MR list page content script
│   ├── popup/                     # Extension popup
│   └── options/                   # Settings page
├── components/
│   ├── review/                    # Core review UI (15 components)
│   ├── guided-review/             # Guided mode (4 components)
│   ├── mr-list/                   # MR list enhancements (7 components)
│   ├── chat/                      # Chat UI (5 components)
│   ├── followup/                  # Follow-up UI (2 components)
│   ├── settings/                  # Settings forms (7 components)
│   └── ui/                        # Shared primitives (6 components)
├── services/
│   ├── ai/                        # AI client + 11 prompt templates
│   ├── review/                    # Review engine (14 files)
│   ├── review-queue/              # Background queue manager
│   ├── gitlab/                    # GitLab API + context enrichment
│   ├── verification/              # Trust calibration + execution bridges
│   ├── chat/                      # Chat store + streaming + cache
│   ├── followup/                  # Follow-up injection + cache
│   ├── ticket/                    # Jira client + ticket parsing
│   ├── syntax/                    # Shiki highlighting (50 languages)
│   └── guided-review/             # Slide queue builder
├── hooks/                         # React hooks (4)
├── types/                         # TypeScript types (11 files)
└── lib/                           # Utilities (messaging, storage, utils)
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `pnpm build` to verify the build passes
5. Commit with a descriptive message
6. Open a pull request

### Development Tips

- Content scripts use inline styles (shadow DOM isolation) — no Tailwind in injected UI
- The background service worker can be killed by Chrome after 5 minutes of inactivity — all state must be persisted to `chrome.storage.local`
- Use `sendMessage()` for request/response, `chrome.runtime.connect()` for streaming
- New AI tasks need: prompt file, AI service method, orchestrator wiring, stream chunk types, store state, UI component
- Test with both light and dark GitLab themes — all colors come from `ThemeContext.tsx`

## License

MIT
