# ClaudeOrchestra — Implementation Plan

## Purpose

This document is the build plan for the orchestration engine.
It references the spec documents in `docs/` as sources of
truth for roles, pipeline flow, state machine, and operations.

**This plan covers the engine only.** The dashboard was built
as Phase 5 (live dashboard with SSE streaming, REST API,
browser UI).

---

## Decisions

- **Language:** TypeScript
- **Engine approach:** Deterministic code-driven pipeline —
  no Supervisor LLM, no tick loop
- **Agent runtime:** Each agent is a Claude Agent SDK `query()`
  session with warm `PromptChannel` for streaming input
- **Communication:** Direct SDK sessions — no filesystem
  message bus during pipeline execution
- **Role instructions:** Separate CLAUDE.md file per role
  (4 roles: Worker, Security, Reviewer)
- **Pipeline modes:** Simple (Worker-1 only) and Standard
  (Security + Worker-1 + Worker-2 + Reviewer)
- **Complexity routing:** Heuristic classifier + Security
  reclassification

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│            PIPELINE ORCHESTRATOR                  │
│  (TypeScript — deterministic code-driven)         │
│                                                   │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │ Complexity │  │  Phase     │  │  State      │ │
│  │ Router     │  │  Controller│  │  Persistence│ │
│  │ (heuristic │  │  (state    │  │  (team      │ │
│  │  classify) │  │   machine) │  │   state.json│ │
│  └────────────┘  └────────────┘  └─────────────┘ │
│         │               │               │         │
│         ▼               ▼               ▼         │
│  ┌─────────────────────────────────────────────┐  │
│  │           Agent Sessions (SDK query)        │  │
│  │  (warm PromptChannel, parallel cold-start)  │  │
│  └─────────────────────────────────────────────┘  │
└──────────┬───────────┬───────────┬────────────────┘
           │           │           │
     ┌─────▼──┐  ┌─────▼──┐  ┌────▼────┐
     │Security│  │Worker-1│  │Worker-2 │  + Reviewer
     │ query()│  │ query()│  │ query() │    query()
     └────────┘  └────────┘  └─────────┘
```

The orchestrator is a single TypeScript process that:
1. Creates SDK `query()` sessions (one per agent role)
2. Sends prompts sequentially through the pipeline
3. Parses agent responses for verdicts (regex-based)
4. Manages workflow phase transitions deterministically
5. Persists team state inside each project's `.claude-orchestra/`
   directory for the dashboard to read
6. Maintains a lightweight `registry.json` with pointers to all
   active teams across projects

---

## Project Structure

### Engine Repo

```
claude-orchestra/
├── package.json
├── tsconfig.json
├── registry.json                 # Lightweight pointers to active teams
├── src/
│   ├── index.ts                  # Entry point
│   ├── pipeline-orchestrator.ts  # Main orchestrator (code-driven pipeline)
│   │
│   ├── spawner/
│   │   ├── agent-spawner.ts      # Default models, tools config
│   │   ├── agent-process.ts      # PromptChannel + SDK query wrapper
│   │   └── frontmatter-parser.ts # YAML frontmatter parser for agent files
│   │
│   ├── router/
│   │   └── complexity-router.ts  # Heuristic task classifier
│   │
│   ├── state/
│   │   ├── team-state.ts         # In-memory team state + transitions
│   │   └── persistence.ts        # Filesystem persistence layer
│   │
│   ├── dashboard/
│   │   ├── dashboard-server.ts   # HTTP + SSE server
│   │   ├── dashboard-ui.ts       # Single-page HTML/CSS/JS builder
│   │   └── index.ts              # Dashboard exports
│   │
│   ├── logger/
│   │   └── logger.ts             # Structured logging with rotation
│   │
│   ├── roles/
│   │   └── role-types.ts         # Role enum, instance types
│   │
│   ├── git.ts                    # GitOps — auto-commits, branch mgmt
│   ├── registry.ts               # Team registry management
│   │
│   └── types/
│       └── index.ts              # Shared types
│
├── agents/                       # Agent prompt files (YAML frontmatter + markdown)
│   ├── worker.agent.md
│   ├── security.agent.md
│   ├── reviewer.agent.md
│   └── security-review.agent.md
│
└── tests/
    └── *.test.ts                 # 7 test files, 204 tests (Vitest)
```

### Target Project (created by engine on attach)

```
{project-root}/
├── .claude-orchestra/            # Runtime data (gitignored)
│   └── teams/
│       └── {team-id}/
│           └── state.json        # Team state snapshot
├── .gitignore                    # Engine adds .claude-orchestra/ here
├── src/                          # (project's own source code)
└── ...
```

### Registry (engine repo)

The engine maintains a lightweight `registry.json` with pointers
to active teams — no runtime data, only references. The dashboard
reads this on load to discover all active teams across projects.

```json
{
  "teams": [
    {
      "teamId": "uuid",
      "teamName": "string",
      "projectPath": "/absolute/path/to/local/repo",
      "createdAt": "ISO-8601",
      "lastActiveAt": "ISO-8601"
    }
  ]
}
```

---

## Build Order

Build in this exact sequence. Each milestone is independently
testable. Do not skip ahead.

### Milestone 1: Types

**Goal:** All TypeScript types defined.

**Build:**
- `src/types/index.ts` — shared enums and base types
- `src/roles/role-types.ts` — role enum, role instance types

**Validate:** Types compile.

**Note:** The original plan included message-types.ts and flag-enums.ts for a filesystem message bus. These were eliminated — the pipeline communicates via direct SDK sessions instead.

---

### Milestone 2: (Eliminated — Message Bus)

The filesystem-based message bus was designed for the original Supervisor architecture. It was superseded by direct SDK sessions via `AgentSession.send()`. See [ADR-002](docs/architecture-decisions/002-message-bus-architecture.md) for the design reference.

---

### Milestone 3: Team State Store

**Goal:** Team state is tracked in memory and persisted to
disk.

**Build:**
- `src/state/team-state.ts`
  - `TeamState` class: teamId, teamName, projectPath,
    currentPhase, agents map, currentTask, counters
  - Phase transitions with precondition enforcement
  - Loop counter management (auto-increment on backward
    transitions, limit checking)
  - Agent state transitions
- `src/state/persistence.ts`
  - Writes `state.json` to `.claude-orchestra/teams/{team-id}/`
  - Atomic writes via temp file + rename
  - Forced writes on phase transitions, debounced otherwise

**Validate:** Unit tests — create state, transition phases,
verify invalid transitions rejected, verify loop limits
enforced, persist and recover.

**Reference:** [`docs/state-machine.md`](docs/state-machine.md)

---

### Milestone 4: Agent Spawner + SDK Sessions

**Goal:** Agent sessions can be created via the Claude Agent
SDK `query()` API with warm `PromptChannel` input.

**Build:**
- `src/spawner/agent-process.ts`
  - `PromptChannel` class — bridges sync `push()` to async
    iterable for SDK `query()`
  - `AgentSession` wrapper — send prompts, receive results,
    track activity
- `src/spawner/agent-spawner.ts`
  - Default model configuration
  - Allowed/disallowed tools lists
  - Max turns configuration

**Validate:** Integration test — create a single SDK session,
send a prompt, verify response received.

**Reference:**
[`docs/context-management.md`](docs/context-management.md) —
SDK session model, warm sessions, context budgets.

---

### Milestone 5: Agent Prompt Files + Dashboard

**Goal:** Each role has an agent prompt file that instructs the SDK
session on its identity and behavior. Dashboard provides
real-time visibility.

**Build 4 agent files in `agents/`:**
- `agents/worker.agent.md` — implementation instructions for
  Worker-1, verification instructions for Worker-2
- `agents/security.agent.md` — pre-scan and sweep procedures
- `agents/reviewer.agent.md` — evaluation framework
- `agents/security-review.agent.md` — final security review (on-demand)

**Also build:**
- `src/dashboard.ts` — HTTP server with SSE for real-time
  updates, REST API for team status/feedback
- Browser UI for project monitoring, phase tracking, feedback

**Reference:**
[`docs/roles-and-jtbd.md`](docs/roles-and-jtbd.md) — JTBD
per role, prompt guidelines, verdict formats.

---

### Milestone 6: Complexity Router

**Goal:** Complexity router classifies tasks for pipeline selection.

**Build:**
- `src/router/complexity-router.ts` — heuristic classifier

**Note:** The original plan included a separate `src/phases/` directory with 5 files (phase-controller.ts, pre-work.ts, work.ts, handoff.ts, review.ts). Phase evaluation logic was consolidated into `src/pipeline-orchestrator.ts` instead.

**Validate:** Unit test the complexity classifier. Phase transitions are tested via pipeline-orchestrator tests.

**Reference:** [`docs/state-machine.md`](docs/state-machine.md)

---

### Milestone 7: Pipeline Orchestrator (Integration)

**Goal:** The main `PipelineOrchestrator` class ties everything
together. Accepts a task, creates sessions, runs the pipeline.

**Build:**
- `src/pipeline-orchestrator.ts`
  - `createTeam(name, projectPath)` — creates team directory,
    adds `.claude-orchestra/` to `.gitignore`, registers team
  - `assignTask(teamId, description, images?)` — classifies
    complexity, creates sessions, runs pipeline
  - `runSimplePipeline()` — Worker-1 only
  - `runStandardPipeline()` — full pipeline with loops
  - `terminateTeam(teamId)` — close sessions, persist state
  - Verdict parsers: `parseSecurityVerdict()`,
    `parseReviewVerdict()`, `parseVerifyVerdict()`
  - Feedback system: `notifyUser()` (non-blocking),
    `askUser()` (blocking)
  - Auto-commits at safety checkpoints via `GitOps`

**Validate:** Full integration test — create a team, assign
a task, watch it flow through the pipeline to completion.

**Reference:** [`docs/architecture.md`](docs/architecture.md)

---

### Milestone 8: Logger + Observability

**Goal:** Structured, readable log output and event emission
for dashboard SSE.

**Build:**
- Event emission throughout the pipeline for real-time
  dashboard updates
- Structured logging with role-specific colors
- Log files for post-run analysis

**Validate:** Run a full cycle and verify the dashboard shows
a coherent story of what happened.

**Reference:** [`docs/operations.md`](docs/operations.md)

---

## End-to-End Validation

After all milestones are complete, the full cycle test is:

1. Human opens the dashboard in a browser
2. Human creates a team attached to a local project
3. Human assigns a task with a description
4. Engine classifies complexity (simple or standard)
5. **Simple:** Worker-1 implements → Done
6. **Standard:**
   a. **PreWork:** Security scans → clearance report
   b. **Work:** Worker-1 implements → Worker-2 verifies
      (up to 2 passes)
   c. **Handoff:** Security sweeps → verdict
   d. **Review:** Reviewer evaluates → verdict
   e. **Done:** Sessions kept alive for Q&A
7. Dashboard shows real-time progress, verdicts, and
   feedback notifications
8. Human can push & merge completed work from dashboard

---

## Resolved Design Decisions

1. **No Supervisor LLM:** The original spec defined a
   Supervisor as an LLM agent that coordinated other agents.
   This was replaced with deterministic TypeScript code
   (`PipelineOrchestrator`) that drives the pipeline directly.
   Rationale: eliminates an expensive, unpredictable LLM call
   from the coordination path; makes the pipeline faster and
   more reliable.

2. **SDK sessions, not CLI child processes:** Agents use the
   Claude Agent SDK `query()` API with warm `PromptChannel`
   sessions instead of spawning Claude Code CLI instances as
   child processes. Rationale: lower latency (~2-3s warm vs
   ~12s cold per message), simpler process management, direct
   programmatic control.

3. **Worker-2 as verifier, not implementer:** Worker-2 was
   originally a second implementation worker. It now acts as
   a requirements verifier — checking Worker-1's output
   against the task requirements. Rationale: catches
   requirement gaps before they reach review, reduces
   revision loops.

4. **Two pipeline modes:** Simple tasks (short description,
   no complexity keywords) skip Security, Worker-2, and
   Reviewer entirely. Rationale: avoids unnecessary overhead
   for trivial tasks.

5. **Auto-commits:** The engine automatically commits at
   safety checkpoints (after Work phase, after Security
   sweep, on completion). Rationale: preserves progress in
   case of failure; enables easy rollback.

6. **Runtime data locality:** Runtime data (state.json)
   lives inside each target project's `.claude-orchestra/`
   directory, not the engine repo. The engine maintains
   a lightweight `registry.json` with pointers. The engine
   does not create projects — it attaches teams to existing
   local repos.

7. **Feedback system:** The pipeline supports blocking and
   non-blocking feedback to the dashboard. Blocking questions
   pause the pipeline until the user responds. Non-blocking
   notifications are fire-and-forget.

---

## Error Handling

### SDK Session Errors

When an SDK `query()` call rejects (session crash, timeout):
- The pipeline catches the error
- Transitions the team to `errored` state
- Closes all sessions
- Surfaces the error to the dashboard

### Loop Limit Exceeded

When backward transitions exceed configured limits:
- The `TeamState.transitionPhase()` method throws a
  `TransitionError`
- The pipeline catches it and transitions to `errored`

### Verdict Parse Failures

- Security verdict: fails explicitly if no verdict found
- Review verdict: defaults to `REVISION_NEEDED` (conservative)
- Verify verdict: defaults to `COMPLETE` if ambiguous

### Loop Limits (Defaults)

- Max 3 revision loops (Handoff→Work or Review→Work)
- Max 2 rejection loops (Review→PreWork)
- Max 5 total backward transitions per task
- Max 2 verification passes per Work phase entry
- Exceeding any limit transitions to `errored` state

See [State Machine — Loop Limits](docs/state-machine.md#loop-limits).

---

## Configuration

All settings are configurable via `orchestra.config.json` with
CLI flag overrides. See
[Operations — Configuration Reference](docs/operations.md#configuration-reference)
for the full schema.

Key settings:
- `models.*` — model selection per role
- `limits.*` — max revisions, rejections, verify passes
- `costBudget.*` — warning and hard limit thresholds

Required environment variable: `ANTHROPIC_API_KEY` (unless
using Claude Max subscription)

---

## Testing Strategy

### Unit Tests (Per Milestone)

Each milestone's "Validate" section defines unit test criteria.

### Integration Tests

| Test | What It Validates |
|------|------------------|
| Happy path (simple) | Worker-1 only pipeline, no errors |
| Happy path (standard) | Full 4-phase pipeline, no errors |
| Security block | Handoff→Work backward transition |
| Reviewer revise | Review→Work backward transition |
| Reviewer reject | Review→PreWork backward transition |
| Loop limit | Trigger max revisions, verify errored state |
| Security reclassify | Standard→Simple downgrade during pre-scan |
| Verification gaps | Worker-2 finds gaps, Worker-1 fixes |

### Test Commands

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration
```

---

## Document References

- **Architecture:** [`docs/architecture.md`](docs/architecture.md) —
  pipeline topology, agent roles, authority model
- **Roles & JTBD:** [`docs/roles-and-jtbd.md`](docs/roles-and-jtbd.md) —
  role definitions, prompt guidelines (Milestone 5)
- **State Machine:** [`docs/state-machine.md`](docs/state-machine.md) —
  workflow states, transitions, loop limits (Milestone 6)
- **Context Management:** [`docs/context-management.md`](docs/context-management.md) —
  SDK sessions, context budgets, model selection (Milestone 4-5)
- **Operations:** [`docs/operations.md`](docs/operations.md) —
  health monitoring, shutdown, logging (Milestone 8)
- **Architecture Decisions:** [`docs/architecture-decisions/`](docs/architecture-decisions/) —
  ADRs including message bus reference design
- **README:** [`README.md`](README.md) — product context,
  dashboard requirements
- **Workflow Diagram:** [`orchestration-workflow.html`](orchestration-workflow.html) —
  visual reference for the full lifecycle flow
