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

## Verification Layer

When you click **Review MR**, Otto runs its standard review (summary, per-file comments, edge cases, related files) and then automatically runs three verification analyses on the changed code. No extra configuration needed — it uses the same AI provider you already set up.

### What you'll see

After the core review completes, three new collapsible sections appear in the Otto panel:

#### Behavioral Delta

Shows up first because it's the most useful. Instead of telling you what lines changed, it tells you what *behaviors* changed:

- **Changed Behaviors** — what the MR intentionally altered ("the function now validates input before processing")
- **Preserved Behaviors** — existing behavior the diff touches but shouldn't break (regression risks)
- **Unexpected Changes** — behavior that changed but doesn't match the MR's stated intent (the most valuable finding)

Each behavior has a test scenario in Given/When/Then format. Click "Show test scenario" to see it.

For a 47-file MR, instead of reading 47 diffs, you see: "3 behaviors changed, 14 preserved, 1 unexpected." Click the unexpected one, see what happened, leave a comment in 30 seconds.

#### Stress Tests

AI-generated property-based tests that try to break the changed code. Each test targets a specific function and checks a property that should hold:

- **Held** (green) — the property was validated
- **Counterexample** (red) — the AI found an input that violates the property, with the minimal failing input shown
- **Not run** — the test was generated but not executed (AI-only mode)

Click "Show test code" on any test to see the generated TypeScript/fast-check code. Edge cases from the earlier analysis are fed as hints to make the tests sharper.

#### Inferred Contracts

For each changed function, the AI infers what the code *promises*:

- **PRE** — preconditions (what must be true before the function runs)
- **POST** — postconditions (what the function guarantees after it runs)
- **INV** — invariants (what stays true throughout)

Each contract is verified by AI reasoning:
- **Verified** (green) — all code paths satisfy the postconditions given the preconditions
- **Violation possible** (red) — the AI found a path that breaks a contract, with the violation path described
- **Unknown** (yellow) — too complex to reason about fully

Click "Show assertions" to see the contracts expressed as TypeScript assertions or Zod schemas.

### Trust Score

Above the verification sections, a **Confidence** badge shows how much you should trust the results:

- **HIGH (65%+)** — strong properties tested, counterexamples found, diverse test targets
- **MEDIUM (40-65%)** — directional but not conclusive
- **LOW (<40%)** — tests may be too weak to catch real bugs

Click the badge to expand the signal breakdown: mutation score estimate, counterexample quality, test independence, and whether the results are AI-reasoned or execution-backed.

In AI-only mode (no verification server), the score is capped at 65% — without real execution, we can't claim high confidence.

### Model Configuration

Each verification task has its own model, temperature, and custom prompt settings in **Otto Settings > AI Provider**:

- **Adversarial Tests** — generates property-based tests (default: claude-sonnet-4-5, temp 0.3)
- **Contract Inference** — infers function contracts (default: claude-sonnet-4-5, temp 0.2)
- **Behavioral Delta** — analyzes behavior changes (default: claude-sonnet-4-5, temp 0.3)

You can override the system prompt for each task under **Custom System Prompts** if you want to tune the output for your codebase.

### Optional: Verification Server

By default, verification runs in AI-only mode — the AI reasons about whether tests would pass and contracts hold, but doesn't execute anything. This is useful and catches real issues, but the trust score reflects the limitation.

For teams that want execution-backed verification, Otto supports two execution modes:

**GitLab CI** — Otto triggers a pipeline on your existing runners with the generated tests. Requires a `.gitlab-ci.yml` template with an `otto-verify` job. Zero new infrastructure — your runners do the compute.

**Verification Server** — a lightweight Node.js service that receives test payloads, runs them in a sandbox, and returns results with mutation scores and coverage data. Configure the server URL in Otto settings.

Both modes feed real execution metrics into the trust score, unlocking scores above 65%.

### Architecture

The verification layer follows Otto's existing patterns:

```
Diff → AI generates verification artifacts → Results stream to UI → Trust score computed
         (prompts/)                           (stream-dispatcher)    (trust-calibrator)
```

- Prompts: `src/services/ai/prompts/adversarial-tests.ts`, `contracts.ts`, `behavioral-delta.ts`
- AI methods: `src/services/ai/ai-service.ts` (generateAdversarialTests, generateContracts, generateBehavioralDelta)
- Orchestration: `src/services/review/review-orchestrator.ts` (runs after core review, feeds edge cases → tests, summary → behavioral delta)
- Trust: `src/services/verification/trust-calibrator.ts` (composite score from mutation estimate, counterexample quality, test independence)
- Execution: `src/services/verification/verification-client.ts` (server), `verification-ci.ts` (GitLab CI)
- Types: `src/types/verification.ts`
- UI: `src/components/review/BehavioralDeltaPanel.tsx`, `AdversarialTestsPanel.tsx`, `ContractsPanel.tsx`, `TrustBadge.tsx`
