# Otto — Technical Facts & Constraints

This document captures hard technical facts that the codebase depends on. If GitLab changes their DOM structure or Chrome changes extension APIs, update this file first — then update the code.

## GitLab MR Page — DOM Structure

### URL Patterns

```
# MR Changes/Diffs tab
https://<host>/<namespace>/<project>/-/merge_requests/<iid>/diffs

# With specific commit
.../-/merge_requests/<iid>/diffs?commit_id=<sha>

# With specific file hash
.../-/merge_requests/<iid>/diffs#diff-content-<file_hash>
```

The `<iid>` is the project-scoped MR number (not the global database ID).

### URL Detection Regex

```
/^https?:\/\/[^/]+\/(.+)\/-\/merge_requests\/(\d+)\/diffs/
```

Captures: `[1]` = namespace/project path, `[2]` = MR IID.

For SPA navigation (GitLab uses Vue router), the diffs tab can also activate via hash `#diffs` without a full page load.

### Top-Level Selectors

| Selector | Element | Notes |
|---|---|---|
| `#diffs` | Changes tab pane | Has class `active` when visible |
| `.diff-files-holder` | Container for all diff files | Injection point for MR overview panel |
| `.diff-file.file-holder` | Individual file diff container | One per changed file |
| `[data-path="<filepath>"]` | File diff container | Attribute contains the file path |
| `.file-title.js-file-title` | File header bar | Contains filename + actions |
| `.file-actions` | Right side of file header | Injection point for per-file review button |
| `.file-title-name` | Filename text element | Contains the display path |
| `.diff-content` | File diff content area | Contains the actual code diff |

### Per-File Identification

Each `.diff-file` has:
- `id` attribute = file hash (SHA of the file path)
- `data-path` attribute = the file's new path (e.g., `src/components/Button.tsx`)

The `data-path` attribute is the most reliable way to identify which file a diff block represents.

### Line-Level Selectors

| Selector | Element |
|---|---|
| `.diff-grid` / `.diff-table` | Diff grid container (CSS grid, not `<table>`) |
| `.diff-grid-row.diff-tr.line_holder` | Each line row |
| `.diff-td.diff-line-num` | Line number cell |
| `.diff-td.line_content` | Code content cell |
| `.diff-grid-left.left-side` | Old file side (parallel view) |
| `.diff-grid-right.right-side` | New file side (parallel view) |

### Line Type Classes

| Class | Meaning |
|---|---|
| `new` | Added line (green) |
| `old` | Removed line (red) |
| `match` | Expansion/context separator |
| `context` | Unchanged context line |

### View Modes

- `inline` (unified): class `.inline-diff-view` on the grid, single column
- `parallel` (side-by-side): class `parallel` on content cells, two columns

Stored in cookie `diff_view`.

### Critical Behaviors

1. **Lazy loading**: GitLab loads diff files in batches (`fetchDiffFilesBatch`). New `.diff-file` elements appear asynchronously. Must use `MutationObserver` to detect them.

2. **Virtual scrolling**: When enabled (class `is-virtual-scrolling`), off-screen diff files are destroyed and re-created on scroll. Injected UI will be lost. Must re-inject on scroll.

3. **File-by-file mode**: Shows only one file at a time with pagination. DOM contains a single `.diff-file`. Must handle pagination events.

4. **SPA navigation**: GitLab is a Vue SPA. Navigating between MR tabs doesn't trigger a full page load. Use WXT's `wxt:locationchange` event or `MutationObserver` on the content wrapper.

## GitLab REST API v4

### Authentication

All requests require a Personal Access Token with `read_api` scope (minimum).

```
Header: PRIVATE-TOKEN: <pat>
```

### Key Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v4/projects/:id` | GET | Project metadata |
| `/api/v4/projects/:id/merge_requests/:iid` | GET | MR metadata (title, description, author, labels, etc.) |
| `/api/v4/projects/:id/merge_requests/:iid/changes` | GET | MR diff data (file paths, diffs) |
| `/api/v4/projects/:id/merge_requests/:iid/diffs` | GET | MR diff versions |
| `/api/v4/projects/:id/repository/tree` | GET | File tree (paginated, supports `path` and `ref` params) |
| `/api/v4/projects/:id/repository/files/:file_path/raw` | GET | Raw file content (URL-encode the path) |
| `/api/v4/projects/:id/repository/files/:file_path/blame` | GET | Git blame for a file |

### Project ID Resolution

The project ID can be obtained from:
1. The DOM: GitLab pages include `<body data-project-id="123">` or similar meta tags
2. The API: `GET /api/v4/projects/:namespace%2Fproject` (URL-encoded path)

The namespace/project path is extracted from the URL.

### Rate Limiting

GitLab.com enforces rate limits:
- Authenticated: 2000 requests per minute
- File content requests count against this limit
- Paginated endpoints return max 100 items per page

Self-hosted instances may have different limits.

### Pagination

List endpoints use keyset or offset pagination:
```
Link: <next_url>; rel="next"
X-Total: 150
X-Total-Pages: 2
X-Per-Page: 100
X-Page: 1
```

## Chrome Extension (Manifest V3) Constraints

### Service Worker

- No DOM access, no `window`, no `localStorage`
- Can be terminated after ~30 seconds of inactivity
- Must not rely on in-memory state — use `chrome.storage` for persistence
- All state must be reconstructable from storage
- `fetch()` is available and has no CORS restrictions

### Content Scripts

- Run in an "isolated world" — separate JS context from the page
- Can read/modify the page DOM
- Limited `chrome.*` API access: `storage`, `runtime.sendMessage`, `i18n`
- Cannot make cross-origin fetch requests (subject to page's CSP)
- Must route all API calls through the service worker

### Message Passing

- `chrome.runtime.sendMessage()` — one-shot request/response, max 64MB per message
- `chrome.runtime.connect()` — long-lived port for streaming
- Ports are disconnected when the service worker goes idle (must handle reconnection)
- Messages are serialized as JSON (no functions, no DOM nodes, no circular refs)

### Shadow DOM in Content Scripts

- WXT's `createShadowRootUi()` creates an isolated shadow root
- `cssInjectionMode: 'ui'` injects CSS into the shadow root, not the page `<head>`
- shadcn components using Radix portals (Dialog, Dropdown, Popover, Tooltip) render to `document.body` by default — must pass `container` prop to render inside shadow root
- No HMR in shadow DOM mode during development (full reload required)

### Permissions

- `storage` — required for `chrome.storage.local`
- `activeTab` — access to the current tab when user interacts with the extension
- `host_permissions: *://*/*` — required for service worker to fetch from any GitLab host and any AI endpoint

### Content Security Policy

The extension's own CSP (for popup/options pages) allows:
- `script-src 'self'` — only bundled scripts
- `style-src 'self' 'unsafe-inline'` — needed for Tailwind's runtime styles

## OpenAI-Compatible API Contract

### Chat Completions Endpoint

```
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "model": "string",
  "messages": [{ "role": "system"|"user"|"assistant", "content": "string" }],
  "stream": true|false,
  "temperature": 0.0-2.0,
  "max_tokens": number
}
```

### Streaming Response (SSE)

```
data: {"id":"...","choices":[{"delta":{"content":"token"},"index":0}]}
data: {"id":"...","choices":[{"delta":{},"finish_reason":"stop","index":0}]}
data: [DONE]
```

### Non-Streaming Response

```json
{
  "id": "...",
  "choices": [{
    "message": { "role": "assistant", "content": "full response" },
    "finish_reason": "stop",
    "index": 0
  }],
  "usage": { "prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150 }
}
```

### Models Endpoint

```
GET {baseUrl}/models
Authorization: Bearer {apiKey}

Response: { "data": [{ "id": "model-name", "object": "model" }] }
```

This endpoint is used to populate the model selector in settings. Not all providers implement it — the UI should allow manual model name entry as a fallback.
