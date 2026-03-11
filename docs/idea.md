# Otto — Idea

## Problem Statement

Code reviews on GitLab merge requests are time-consuming and inconsistent. Reviewers spend significant effort understanding what changed, why it changed, and what might break — before they can even provide meaningful feedback. Context-switching between the diff view and the actual codebase to trace logic flow, check edge cases, and understand dependencies adds friction that slows teams down.

There is no native tooling in GitLab that provides AI-assisted review context directly in the diff view where reviewers are already working.

## Vision

Otto is a Chrome extension that injects AI-powered code review tooling directly into GitLab merge request diff pages. It acts as a senior engineer sitting beside you — surfacing a concise summary of the MR, generating draft review comments per file, identifying related files not in the diff that may be affected, and analyzing edge cases and potential failure modes.

Otto does not replace the reviewer. It accelerates them. Every AI suggestion is a draft that the reviewer can accept, edit, or dismiss. The goal is to help reviewers spend their time on high-value judgment calls instead of mechanical comprehension.

## Target Users

- Software engineers who review merge requests on GitLab (gitlab.com or self-hosted)
- Tech leads who want to ensure consistent review quality across their team
- Individual contributors who want to self-review before requesting peer review

## Core Features (v1)

### 1. MR Summary
- Auto-generated overview of the merge request changes
- Injected as a banner above the diff file list
- Covers: what changed, why (inferred from commit messages + diff), risk assessment

### 2. Per-File Code Review
- AI-generated review comments for each changed file
- Injected into each file's header area in the diff view
- Line-level specificity where possible (references specific line ranges)
- Categories: bugs, logic errors, style, performance, security, readability

### 3. Related File Discovery
- Identifies files NOT in the diff that are relevant to the changes
- Uses import/dependency analysis + AI reasoning over the project file tree
- Displays the related files with explanations of why they matter
- Fetches and shows the actual file content for reviewer reference

### 4. Edge Case & Stack Trace Analysis
- Analyzes changed logic paths for potential failure modes
- Generates hypothetical stack traces for error scenarios
- Identifies missing error handling, boundary conditions, race conditions
- Provides concrete "what if" scenarios with code references

### 5. Configurable AI Backend
- Connects to any OpenAI-compatible API endpoint
- Per-task model selection (different models for summary vs. code review vs. edge cases)
- Supports streaming responses for real-time feedback
- Example backends: kiro-gateway, OpenRouter, Ollama, any OpenAI-spec server

### 6. GitLab Integration
- Supports gitlab.com and self-hosted GitLab instances
- Uses GitLab REST API v4 with Personal Access Token for repo context
- Multiple GitLab host configurations for users working across instances
- Fetches file trees, file contents, blame data, MR metadata

## User Stories

### Setup
- As a user, I can configure my AI provider (base URL + API key) so Otto knows where to send requests
- As a user, I can add multiple GitLab hosts with their PATs so Otto works across my gitlab.com and self-hosted instances
- As a user, I can choose which AI model to use for each task (summary, review, edge cases, related files)

### Review Flow
- As a reviewer, when I open an MR's Changes tab, I see an Otto banner with a "Review" button
- As a reviewer, I can trigger a full review and see results stream in as they complete
- As a reviewer, I can trigger a review for a single file without reviewing the entire MR
- As a reviewer, I can see AI-generated comments on each file with specific line references
- As a reviewer, I can accept an AI suggestion (copies to clipboard or opens GitLab's comment form)
- As a reviewer, I can dismiss suggestions I disagree with
- As a reviewer, I can edit AI suggestions before accepting them

### Context
- As a reviewer, I can see a concise summary of the entire MR before diving into individual files
- As a reviewer, I can see which files outside the diff are affected by the changes
- As a reviewer, I can view the content of related files without leaving the MR page
- As a reviewer, I can see potential edge cases and failure modes for the changed code

## Success Metrics

- Time to first meaningful review comment is reduced
- Reviewers report higher confidence in review completeness
- Edge cases caught by Otto that would have been missed manually
- Adoption: daily active users on MR diff pages

## Non-Goals (v1)

- Otto does NOT auto-post comments to GitLab (all suggestions are drafts)
- Otto does NOT support GitHub, Bitbucket, or other platforms (GitLab only)
- Otto does NOT run tests or static analysis (it reasons about code, not executes it)
- Otto does NOT require a backend server (all logic runs in the extension + configured AI endpoint)
