# AGENTS.md

Shared coding-agent guidance for this repository. Codex reads this file directly. Claude Code reads it through `CLAUDE.md`.

## What This Is

ClaudeOrchestra is a deterministic multi-agent orchestration engine. It spawns multiple provider-backed agent sessions via either `@anthropic-ai/claude-agent-sdk` or `@openai/codex-sdk` and drives them through a fixed pipeline: **Security Scan -> Build (Worker-1 implements, Worker-2 verifies) -> Security Sweep -> Code Review -> Done**. No LLM makes routing decisions; pure TypeScript code controls the flow.

A browser dashboard at `localhost:3460` provides real-time visibility via SSE.

## Commands

```bash
npm run build          # Compile TypeScript (required before running dashboard)
npm run dashboard      # Start dashboard + engine at localhost:3460
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode
npx vitest run tests/pipeline-orchestrator.test.ts  # Run a single test file
```

Important: after editing source files, run `npm run build` before `npm run dashboard`; the dashboard runs from `dist/`.

## Architecture

### Core Pipeline (`src/pipeline-orchestrator.ts`)

The `PipelineOrchestrator` is the brain. It creates provider-agnostic `AgentSession` objects through `src/agent-runtime/factory.ts`; SDK-specific behavior lives in `claude-session.ts` and `codex-session.ts`. It:

- Calls each agent's `send()` sequentially
- Parses verdicts from agent responses with regex (`parseSecurityVerdict`, `parseVerifyVerdict`, `parseReviewVerdict`)
- Drives phase transitions deterministically
- Manages loop-back logic (review -> work for revisions, review -> pre_work for rejections) with configurable limits

### Agent Roles

| Agent | What it does | Tools it cannot use |
|-------|-------------|---------------------|
| Security-1 | Pre-scan + post-sweep, classifies task complexity | Write, Edit, Bash |
| Worker-1 | Implements the task (prompt: `agents/worker-1.agent.md`) | Full access |
| Worker-2 | Verifies requirements only — read-only at the SDK boundary (prompt: `agents/worker-2.agent.md`) | Write, Edit, Bash |
| Reviewer-1 | Code review, verdict: APPROVED/REVISION_NEEDED/REJECTED | Write, Edit, Bash |

Agent prompts live in `agents/*.agent.md`.

### State Machine (`src/state/team-state.ts`)

Phases: `pre_work -> work -> handoff -> review -> done` plus `errored` and `cancelled`. Backward transitions are counted against limits (`maxRevisions: 3`, `maxRejections: 2`, `maxTotalBackwardTransitions: 5`).

### Dashboard (`src/dashboard/`)

- `dashboard-server.ts`: Node.js built-in `http` server with REST API + SSE streaming.
- `dashboard-ui.ts`: Single-file SPA returned by `buildDashboardHTML()`. No framework, no build toolchain.

### Data Locality

Runtime data lives in the target project, not this repo:

```text
target-project/.claude-orchestra/teams/{teamId}/state.json
```

This repo only keeps `registry.json` pointers to active teams and optional `logs/`.

## Runtime Model

- The agent runtime is global: configure `agentRuntime.provider` as either `claude` or `codex`.
- `auth: "subscription"` means OAuth subscription credentials, not API key billing.
- Claude runtime uses `@anthropic-ai/claude-agent-sdk`.
- Codex runtime uses `@openai/codex-sdk`.
- SDK-specific calls stay inside `src/agent-runtime/*-session.ts`; the orchestrator only talks to the shared `AgentSession` interface.

## Effort Names

Effort names are adapter-owned:

- Codex SDK/config accepts `minimal | low | medium | high | xhigh`, though the VS Code dropdown may only show Low, Medium, High, and Extra High.
- Claude Agent SDK uses `low | medium | high | max`.
- Keep provider translation in `src/agent-runtime/effort.ts`.

For this project, prefer Codex `xhigh` / VS Code "Extra High" while working on runtime, auth, orchestration, or provider-switching code. Use `high` for less risky routine edits.

## Design Constraints

- Minimal production dependencies: Claude Agent SDK, Codex SDK, and Node built-ins for the dashboard.
- ESM-only (`"type": "module"` in `package.json`). All relative TypeScript imports use `.js` extension.
- The dashboard HTML is cached in memory on server start. Source changes require `npm run build` plus server restart.
- Running the engine or integration tests may require sandbox restrictions to be disabled because the engine spawns child processes.
- Do not assume this file controls ClaudeOrchestra's spawned runtime agents. Runtime agents receive explicit role prompts from `agents/*.agent.md`; shared project instructions must be added there deliberately if needed.

## Testing

Tests use Vitest with mocked SDK behavior. The pipeline tests simulate agent sessions without real provider calls. Test files mirror source structure where practical.

## Key Files

- `src/index.ts` - CLI entry point, command routing, signal handling
- `src/config.ts` - config file loading and CLI override merging
- `src/pipeline-orchestrator.ts` - deterministic pipeline engine
- `src/agent-runtime/` - provider abstraction, auth guards, SDK adapters, effort mapping
- `src/dashboard/` - HTTP/SSE dashboard
- `src/git.ts` - commit, push, and merge workflow
- `src/registry.ts` - lightweight JSON registry of active teams
- `src/router/complexity-router.ts` - heuristic task classifier
- `agents/*.agent.md` - role prompts sent to spawned runtime agents

## Document Map

- `README.md` - human-facing project overview, setup, and runtime switching
- `CLAUDE.md` - Claude Code wrapper that imports this file
- `PRD.md` - product requirements
- `implementation-plan.md` - original milestone plan
- `docs/` - design specs
