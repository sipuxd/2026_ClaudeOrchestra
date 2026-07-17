# ClaudeOrchestra - System Architecture

> Source of truth for system structure, pipeline topology, provider runtime,
> authority model, and coordination patterns.
>
> Cross-references:
> - [Roles & JTBD](./roles-and-jtbd.md) - role definitions and prompt rules
> - [State Machine](./state-machine.md) - workflow model and transitions
> - [Context Management](./context-management.md) - runtime context strategy
> - [Operations](./operations.md) - configuration, health, and shutdown
> - [ADR 001](./architecture-decisions/001-eliminate-supervisor-llm.md) - why the Supervisor LLM was removed

---

## System Overview

ClaudeOrchestra is a deterministic, code-driven orchestration engine for AI coding agents. It governs autonomous code generation with security scanning, requirements verification, code review, git checkpoints, and a live dashboard.

There is no Supervisor LLM. The `PipelineOrchestrator` class drives the workflow directly:

```text
Security scan
  -> Worker-1 implementation
  -> Worker-2 requirements verification
  -> Security sweep
  -> Reviewer quality gate
  -> Done
```

The orchestrator is plain TypeScript. It sends prompts to runtime agents, parses verdicts with deterministic functions, and moves the team through a validated state machine.

---

## High-Level Structure

```text
CLI / Dashboard
    |
    v
PipelineOrchestrator
    |-- Complexity Router
    |-- Requirements Extractor
    |-- Team State Machine
    |-- Registry + Persistence
    |-- GitOps
    |-- Provider-backed AgentSession interface
            |-- ClaudeAgentSession -> @anthropic-ai/claude-agent-sdk query()
            |-- CodexAgentSession  -> @openai/codex-sdk thread/runStreamed()
```

Primary modules:

| Area | Files | Responsibility |
|------|-------|----------------|
| CLI | `src/index.ts` | CLI commands, dashboard startup, signal handling |
| Config | `src/config.ts` | Config loading, config path priority, CLI override merging |
| Orchestration | `src/pipeline-orchestrator.ts` | Pipeline flow, verdict parsing, feedback, Q&A, session creation |
| Runtime adapters | `src/agent-runtime/` | Claude/Codex adapter boundary, auth guards, effort mapping |
| State | `src/state/` | Validated phase transitions, persistence to target projects |
| Dashboard | `src/dashboard/` | HTTP API, SSE, single-page UI |
| Git | `src/git.ts` | Team branches, auto-commits, PR creation/polling |
| Registry | `src/registry.ts` | Engine-local index of active teams |
| Roles | `agents/*.agent.md` | Runtime prompts sent to spawned agents |

---

## Global Agent Runtime

The agent runtime is global for one orchestrator process. It is all Claude or all Codex:

```json
{
  "agentRuntime": {
    "provider": "codex",
    "auth": "subscription",
    "model": "gpt-5.5"
  }
}
```

Supported providers:

| Provider | Adapter | SDK surface | Auth mode |
|----------|---------|-------------|-----------|
| `claude` | `ClaudeAgentSession` | Claude Agent SDK `query()` | Claude subscription OAuth |
| `codex` | `CodexAgentSession` | Codex SDK/CLI thread API | ChatGPT/Codex subscription OAuth |

`auth: "subscription"` means subscription/OAuth credentials, not API-key billing. The runtime refuses to start if environment variables are set that would switch the provider into API-key or external-provider billing:

- Claude guarded vars: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`
- Codex guarded vars: `CODEX_API_KEY`, `OPENAI_API_KEY`, `OPENAI_AUTH_TOKEN`

Provider-specific differences stay inside `src/agent-runtime/`:

- `auth.ts` normalizes runtime config and strips guarded env vars.
- `factory.ts` chooses the active adapter.
- `effort.ts` maps provider-specific effort names.
- `claude-session.ts` owns Claude SDK `query()` behavior.
- `codex-session.ts` owns Codex SDK thread behavior.

---

## Effort And Model Selection

`agentRuntime.model`, when set, is a global model override for every role. If omitted or set to `"default"`, the active provider chooses its default, except Claude can still use role prompt frontmatter/per-role `models` for tuning.

Effort names differ by provider:

| Provider | Native effort names |
|----------|---------------------|
| Codex | `minimal`, `low`, `medium`, `high`, `xhigh` |
| Claude Agent SDK | `low`, `medium`, `high`, `max` |

Codex VS Code may show Low, Medium, High, and Extra High; Extra High maps to config value `xhigh`. Compatibility aliases are handled at the adapter boundary: `max` maps to Codex `xhigh`, `xhigh` maps to Claude `max`, and Codex-only `minimal` maps to Claude `low`.

---

## Agent Topology

ClaudeOrchestra uses up to four runtime agent sessions per team:

| Role | Instances | Purpose |
|------|-----------|---------|
| Worker | `Worker-1`, `Worker-2` | Worker-1 implements; Worker-2 verifies requirements |
| Security | `Security-1` | Pre-scan clearance and post-work security sweep |
| Reviewer | `Reviewer-1` | Quality and correctness review |

Agents do not communicate directly. The orchestrator is the sole coordinator:

1. Engine sends a prompt to one agent session.
2. Agent returns output and/or progress events.
3. Engine parses the output for a verdict.
4. Engine decides the next step.
5. Engine prompts the next agent.

Runtime agents receive explicit role prompts from `agents/*.agent.md`. They do not automatically inherit `AGENTS.md` or `CLAUDE.md`; those files guide interactive coding assistants in this repo, not the spawned runtime agents unless their content is deliberately included in role prompts.

---

## Pipeline Modes

### Simple Pipeline

Used for short, low-risk tasks classified as simple by the heuristic router or reclassified by Security:

```text
Worker-1 implements -> Done
```

Only Worker-1 participates. There is no security sweep or review.

### Standard Pipeline

Used for standard or complex tasks:

```text
Security-1 pre-scan
    |
    v
Worker-1 implements -> Worker-2 verifies requirements
    |                      |
    |                      +-- GAPS_FOUND -> Worker-1 fixes, then Worker-2 re-checks
    v
Security-1 post-work sweep
    |
    +-- BLOCKED -> Work
    |
    v
Reviewer-1 quality review
    |
    +-- REVISION_NEEDED -> Work
    +-- REJECTED -> PreWork
    +-- APPROVED -> Done
```

Worker-2 has an inner verification loop capped at two passes. Phase-level backward transitions are counted by `TeamState` and bounded by loop limits.

---

## Authority Model

| Authority | Verdicts | Effect |
|-----------|----------|--------|
| Security | `APPROVED`, `FLAGGED`, `BLOCKED` | Blocks or clears work for review |
| Worker-2 | `COMPLETE`, `GAPS_FOUND` | Drives the requirements gap loop |
| Reviewer | `APPROVED`, `REVISION_NEEDED`, `REJECTED` | Completes, revises, or restarts the task |
| Human | Dashboard feedback actions | Can approve requirements, cancel, ask questions, run security review, create PR |

The engine never lets an LLM choose routing. LLMs produce findings and verdicts; TypeScript decides the next step.

---

## Requirements Extraction

Before the pipeline starts, a disposable provider-backed session extracts explicit requirements from the user task. The dashboard shows the checklist as blocking feedback:

- Approve: requirements become Worker-2's verification target.
- Skip: pipeline proceeds without an approved requirements list.
- Extraction failure: pipeline proceeds and shows a warning.

This step is bypassed when `skipRequirements: true` is set, primarily for tests.

---

## State And Persistence

Team runtime state lives in the target project:

```text
target-project/
└── .claude-orchestra/
    └── teams/
        └── {teamId}/
            └── state.json
```

The engine repo keeps only `registry.json`, a lightweight pointer list of active teams and target project paths.

Persistence properties:

- Phase transitions force immediate writes.
- Non-phase state changes are debounced.
- Writes use temp-file + rename for atomicity.
- `.claude-orchestra/` is added to the target project's `.gitignore`.

---

## Dashboard And API

The dashboard is served by `src/dashboard/dashboard-server.ts` using Node's built-in `http` module. It serves one cached HTML page generated by `buildDashboardHTML()` and streams events through Server-Sent Events.

Core API surface:

| Route | Purpose |
|-------|---------|
| `GET /` | Dashboard HTML |
| `GET /events` | SSE stream with team/runtime state |
| `GET /api/runtime` | Active provider/auth/model |
| `GET /api/teams` | Team list |
| `POST /api/teams` | Create team, optionally with initial task |
| `POST /api/teams/:id/task` | Assign task |
| `POST /api/teams/:id/feedback` | Resolve blocking feedback |
| `POST /api/teams/:id/ask` | Ask a warm session a question |
| `POST /api/teams/:id/security-review` | Run final diff security review |
| `POST /api/teams/:id/create-pr` | Push branch and create GitHub PR |
| `GET /preview/:id/...` | Preview generated HTML files from target project |

---

## Git Workflow

Each team gets a dedicated branch:

```text
team/{slugified-team-name}
```

Automatic engine checkpoints:

| Checkpoint | Commit message |
|------------|----------------|
| Work phase complete | `WIP: work phase complete` |
| Security sweep passed | `WIP: security sweep passed` |
| Pipeline success | First 72 characters of task description |

User-initiated git actions:

- Create PR via `gh pr create`.
- Poll PR state every 60 seconds while a team is in `pr_open`.
- Archive merged teams by closing sessions, deleting local branch, removing registry entry, and transitioning to `merged`.

The legacy direct-merge-to-main flow was removed in July 2026; `createPr()` is the only merge path.

---

## Instruction Files

| File | Reader | Purpose |
|------|--------|---------|
| `AGENTS.md` | Codex and imported by Claude Code | Shared instructions for interactive repo work |
| `CLAUDE.md` | Claude Code | Thin wrapper that imports `AGENTS.md` |
| `agents/*.agent.md` | ClaudeOrchestra runtime agents | Role prompts sent to spawned agents |

Do not duplicate shared repo instructions across `AGENTS.md` and `CLAUDE.md`. Keep shared guidance in `AGENTS.md`; keep only Claude-specific notes in `CLAUDE.md`.

---

## Historical Architecture

The original design used a Supervisor LLM and a filesystem message bus. That design is preserved only for historical reference:

- `multi-agent-orchestration-spec.md` is deprecated.
- `docs/architecture-decisions/message-bus-reference/` is reference material, not active runtime code.
- `src/spawner/agent-process.ts` and `src/spawner/agent-spawner.ts` are retained from older flows/tests; the active pipeline creates sessions through `src/agent-runtime/factory.ts`.
