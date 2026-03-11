# Otto — Coding Standards

## Language & Formatting

- TypeScript strict mode (`"strict": true`) — no `any` unless explicitly justified with a comment
- All files use `.ts` or `.tsx` extensions (no `.js`)
- Use `type` over `interface` for object shapes unless extending is needed
- Prefer `const` over `let`, never use `var`
- Use template literals over string concatenation
- Use optional chaining (`?.`) and nullish coalescing (`??`) over manual checks
- No default exports except for WXT entrypoints (which require them)
- Named exports everywhere else — makes refactoring and tree-shaking reliable

## File Naming

| Type | Convention | Example |
|---|---|---|
| React components | PascalCase.tsx | `FileReviewCard.tsx` |
| Hooks | use-kebab-case.ts | `use-settings.ts` |
| Services/utilities | kebab-case.ts | `ai-client.ts` |
| Types | kebab-case.ts | `gitlab.ts` |
| Prompt templates | kebab-case.ts | `code-review.ts` |
| Constants | kebab-case.ts | `defaults.ts` |

## React Components

### Structure
```tsx
// 1. Imports (external, then internal, then types)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ReviewComment } from '@/types/review';

// 2. Types for this component
type FileReviewCardProps = {
  filePath: string;
  comments: ReviewComment[];
  onAccept: (commentId: string) => void;
  onDismiss: (commentId: string) => void;
};

// 3. Component (named export)
export function FileReviewCard({ filePath, comments, onAccept, onDismiss }: FileReviewCardProps) {
  // hooks first
  // derived state
  // handlers
  // render
}
```

### Rules
- One component per file (colocated sub-components are fine if they're small and private)
- Props types defined in the same file, above the component
- No `React.FC` — use plain function declarations with typed props
- Hooks at the top of the component, no conditional hooks
- Event handlers prefixed with `handle` (e.g., `handleAccept`)
- Callback props prefixed with `on` (e.g., `onAccept`)
- Use `cn()` utility for conditional class merging (from shadcn pattern)

## State Management

### Zustand Stores
- One store per domain (review, settings)
- Stores live in `services/` next to their domain logic
- Actions are defined inside the store, not as external functions
- Selectors are exported as hooks: `useReviewStore((s) => s.summary)`
- Never put the entire store in a component — always select specific slices

### chrome.storage
- All reads/writes go through the typed wrapper in `lib/storage.ts`
- The wrapper validates data shape on read (runtime type checking)
- Settings are never cached in memory in the service worker (it can be terminated)
- Content scripts request settings via message passing, not direct storage access

## Message Passing

### Protocol
- All messages use a discriminated union type keyed on `type`
- Request types are `SCREAMING_SNAKE_CASE`
- Each message type has a corresponding response type
- The message handler in `background.ts` is a single switch statement (or map)

```typescript
// messages.ts
type Message =
  | { type: 'FETCH_MR_METADATA'; payload: { projectId: string; mrIid: number } }
  | { type: 'REQUEST_REVIEW'; payload: { mrContext: MrContext } }
  | { type: 'GET_SETTINGS' };

type MessageResponse<T extends Message['type']> =
  T extends 'FETCH_MR_METADATA' ? MrMetadata :
  T extends 'GET_SETTINGS' ? OttoSettings :
  never;
```

### Rules
- Content scripts NEVER make HTTP requests directly
- All API calls (GitLab, AI) go through the service worker
- Streaming uses `chrome.runtime.connect()` with named ports
- Non-streaming uses `chrome.runtime.sendMessage()` with typed responses

## Services

### Single Responsibility
- `ai-client.ts` — HTTP communication with OpenAI-compatible API (knows nothing about reviews)
- `ai-service.ts` — Orchestrates AI calls, selects models, formats prompts (knows nothing about HTTP)
- `gitlab-client.ts` — HTTP communication with GitLab API (knows nothing about MRs specifically)
- `repo-service.ts` — Higher-level repo operations (file trees, content fetching)
- `review-orchestrator.ts` — Coordinates the full review pipeline (calls AI service + GitLab service)

### Rules
- Services are plain functions or classes, not React components or hooks
- Services that run in the service worker must not import React
- Services accept dependencies as parameters (dependency injection) for testability
- All service functions return typed results, never `any`
- Errors are returned as typed results, not thrown (except for truly exceptional cases)

## Prompt Templates

- Each prompt is a function that takes structured data and returns `ChatCompletionMessageParam[]`
- Prompts never contain business logic — they are pure data transformations
- System prompts define the AI's role and constraints
- User prompts contain the actual data to analyze
- Prompts include output format instructions (JSON schema when structured output is needed)

```typescript
// prompts/code-review.ts
export function buildCodeReviewPrompt(input: CodeReviewInput): ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: formatUserPrompt(input) },
  ];
}
```

## Error Handling

- Use a `Result<T, E>` pattern for operations that can fail predictably
- `Result` is either `{ ok: true; data: T }` or `{ ok: false; error: E }`
- HTTP errors include status code, message, and the original response
- AI errors distinguish between network errors, auth errors, and model errors
- GitLab errors distinguish between auth errors, not-found, and rate limiting
- User-facing error messages are human-readable, not raw API responses

## CSS / Tailwind

- All Otto UI lives inside shadow DOM — styles are fully isolated
- Use Tailwind utility classes, avoid custom CSS unless absolutely necessary
- Component variants use `cva` (class-variance-authority) from shadcn pattern
- Dark mode support via `class` strategy on the shadow root container
- No `!important` — if you need it, the architecture is wrong

## Git Conventions

- Commit messages: `type(scope): description` (conventional commits)
- Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`
- Scopes: `content`, `background`, `popup`, `options`, `ai`, `gitlab`, `review`, `lib`
- Branch names: `feat/description`, `fix/description`
- One logical change per commit

## Testing (Future)

- Unit tests for services and utilities (vitest)
- Component tests for React components (vitest + testing-library)
- Integration tests for message passing (WXT test utils)
- No tests for prompt templates (they change too frequently, test the service layer instead)
