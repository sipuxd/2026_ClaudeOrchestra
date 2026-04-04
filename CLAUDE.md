# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

ClaudeOrchestra is a deterministic multi-agent orchestration engine. It spawns multiple Claude Code agent sessions via the `@anthropic-ai/claude-agent-sdk` and drives them through a fixed pipeline: **Security Scan → Build (Worker-1 implements, Worker-2 verifies) → Security Sweep → Code Review → Done**. No LLM makes routing decisions — pure TypeScript code controls the flow.

A browser dashboard at `localhost:3460` provides real-time visibility via SSE.

## Commands

```bash
npm run build          # Compile TypeScript (required before running dashboard)
npm run dashboard      # Start dashboard + engine at localhost:3460
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode
npx vitest run tests/pipeline-orchestrator.test.ts  # Run a single test file
```

**Important:** After editing source files, you must `npm run build` before `npm run dashboard` — the dashboard runs from `dist/`.

## Architecture

### Core Pipeline (`src/pipeline-orchestrator.ts`, ~1,570 lines)

The `PipelineOrchestrator` is the brain. It wraps Claude Agent SDK `query()` calls in `AgentSession` objects (warm sessions with `PromptChannel` for streaming input). It:
- Calls each agent's `send()` sequentially
- Parses verdicts from agent responses with regex (`parseSecurityVerdict`, `parseVerifyVerdict`, `parseReviewVerdict`)
- Drives phase transitions deterministically
- Manages loop-back logic (review → work for revisions, review → pre_work for rejections) with configurable limits

### Agent Roles (4 per team)

| Agent | What it does | Tools it CANNOT use |
|-------|-------------|-------------------|
| Security-1 | Pre-scan + post-sweep, classifies task complexity | Write, Edit, Bash |
| Worker-1 | Implements the task | (full access) |
| Worker-2 | Verifies requirements only, never writes code | (full access) |
| Reviewer-1 | Code review, verdict: APPROVED/REVISION_NEEDED/REJECTED | Write, Edit, Bash |

Agent prompts live in `agents/*.agent.md`.

### State Machine (`src/state/team-state.ts`)

Phases: `pre_work → work → handoff → review → done` (plus `errored`, `cancelled`). Backward transitions are counted against limits (`maxRevisions: 3`, `maxRejections: 2`, `maxTotalBackwardTransitions: 5`).

### Dashboard (`src/dashboard/`)

- `dashboard-server.ts`: Node.js built-in `http` server with REST API + SSE streaming (13 event types)
- `dashboard-ui.ts`: Single-file SPA (~2,550 lines) — all HTML/CSS/JS returned by `buildDashboardHTML()`. No framework, no build toolchain.

### Data Locality

Runtime data lives in the **target project** (not this repo):
```
target-project/.claude-orchestra/teams/{teamId}/state.json
```
This repo only keeps `registry.json` (pointers to active teams) and `logs/`.

### Key Files

- `src/index.ts` — CLI entry point, config loading, signal handling
- `src/pipeline-orchestrator.ts` — Agent sessions, verdict parsing, pipeline loops
- `src/git.ts` — Auto-commit at phase boundaries, push & merge workflow
- `src/registry.ts` — Lightweight JSON registry of active teams
- `src/router/complexity-router.ts` — Heuristic task classifier (simple vs standard)
- `src/spawner/agent-process.ts` — Dual-mode agent wrapper (SDK + child_process for testing)

## Design Constraints

- **Zero production dependencies** besides `@anthropic-ai/claude-agent-sdk`. Dashboard uses Node.js built-in `http`. No Express, no React, no WebSocket.
- **ESM-only** (`"type": "module"` in package.json). All imports use `.js` extension.
- **Sandbox must be disabled** for running the engine or integration tests — the engine spawns child processes via `child_process.spawn()`. Toggle with `/sandbox` in Claude Code CLI.
- **Dashboard HTML is cached in memory** on server start. Source changes require `npm run build` + server restart.

## Testing

Tests use vitest with mocked SDK (`tests/mocks/mock-sdk.ts`). The mock replaces `query()` to simulate agent responses without real API calls. Test files mirror source structure (e.g., `tests/pipeline-orchestrator.test.ts` tests `src/pipeline-orchestrator.ts`).

## Document Map

- `PRD.md` — Comprehensive product requirements (architecture, API, agent roles, state machine, dashboard, data model)
- `implementation-plan.md` — Original 8-milestone build plan
- `docs/` — Design specs (message contract, state machine, roles, operations, architecture)
