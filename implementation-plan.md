# ClaudeOrchestra — Implementation Plan

## Purpose

This document is the build plan for the orchestration engine. 
It is structured for Claude Code CLI to consume as actionable 
build instructions. It references the spec 
(`multi-agent-orchestration-spec.md`) as the source of truth 
for roles, JTBD, message contracts, flag enums, and workflow 
phases. It references the README (`README.md`) for product 
context and dashboard requirements.

**This plan covers the engine only.** The dashboard is a 
separate build phase that comes after the engine is validated.

---

## Decisions

- **Language:** TypeScript
- **Engine approach:** Fully custom — no dependency on Claude 
  Code's experimental agent teams feature
- **Agent runtime:** Each agent is a Claude Code CLI instance 
  spawned and managed by the engine
- **Message transport:** Custom filesystem-based message bus 
  using the JSON message contract from the spec
- **Role instructions:** Separate CLAUDE.md file per role 
  (5 files)
- **Build target:** Headless engine with structured log output. 
  Dashboard is a later phase.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                  ORCHESTRATOR                      │
│  (TypeScript process — the engine)                │
│                                                    │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │  Spawner    │  │  Router    │  │  Phase      │ │
│  │  Manager    │  │  (message  │  │  Controller │ │
│  │  (lifecycle │  │   bus)     │  │  (workflow   │ │
│  │   of CLI    │  │            │  │   state     │ │
│  │   instances)│  │            │  │   machine)  │ │
│  └────────────┘  └────────────┘  └─────────────┘ │
│         │               │               │         │
│         ▼               ▼               ▼         │
│  ┌─────────────────────────────────────────────┐  │
│  │              Team State Store               │  │
│  │  (in-memory + filesystem persistence)       │  │
│  └─────────────────────────────────────────────┘  │
└──────────┬───────────┬───────────┬────────────────┘
           │           │           │
     ┌─────▼──┐  ┌─────▼──┐  ┌────▼────┐
     │ Claude │  │ Claude │  │ Claude  │  ... (5 per team)
     │ Code   │  │ Code   │  │ Code    │
     │ CLI    │  │ CLI    │  │ CLI     │
     │ inst.  │  │ inst.  │  │ inst.   │
     └────────┘  └────────┘  └─────────┘
```

The orchestrator is a single TypeScript process that:
1. Spawns Claude Code CLI instances (one per agent role)
2. Routes messages between agents via the filesystem bus
3. Manages workflow phase transitions
4. Persists team state inside each project's `.claude-orchestra/`
   directory for the dashboard to read
5. Maintains a lightweight `registry.json` with pointers to all
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
│   ├── index.ts                  # Entry point — CLI interface
│   ├── orchestrator.ts           # Main orchestrator class
│   │
│   ├── spawner/
│   │   ├── agent-spawner.ts      # Spawns and manages CLI instances
│   │   └── agent-process.ts      # Wrapper around a single CLI process
│   │
│   ├── router/
│   │   ├── message-bus.ts        # Filesystem-based message routing
│   │   ├── message-types.ts      # TypeScript types for message contract
│   │   └── flag-enums.ts         # All flag enums per role pair
│   │
│   ├── phases/
│   │   ├── phase-controller.ts   # Workflow state machine
│   │   ├── pre-work.ts           # Pre-work phase logic
│   │   ├── work.ts               # Work phase logic
│   │   ├── handoff.ts            # Handoff phase logic
│   │   └── review.ts             # Review phase logic
│   │
│   ├── state/
│   │   ├── team-state.ts         # In-memory team state
│   │   └── persistence.ts        # Filesystem persistence layer
│   │
│   ├── roles/
│   │   ├── role-registry.ts      # Role definitions and JTBD mapping
│   │   └── role-types.ts         # TypeScript types for roles
│   │
│   ├── logger/
│   │   └── logger.ts             # Structured logging (replaces dashboard for now)
│   │
│   └── types/
│       └── index.ts              # Shared types
│
├── roles/                        # CLAUDE.md files per role
│   ├── supervisor.claude.md
│   ├── worker.claude.md
│   ├── security.claude.md
│   └── reviewer.claude.md
│
└── tests/
    ├── message-bus.test.ts
    ├── phase-controller.test.ts
    └── integration/
        └── full-cycle.test.ts
```

### Target Project (created by engine on attach)

```
{project-root}/
├── .claude-orchestra/            # Runtime data (gitignored)
│   └── teams/
│       └── {team-id}/
│           ├── state.json        # Team state snapshot
│           ├── messages/
│           │   ├── inbox/        # Pending messages per agent
│           │   │   ├── supervisor-1/
│           │   │   ├── worker-1/
│           │   │   ├── worker-2/
│           │   │   ├── security-1/
│           │   │   └── reviewer-1/
│           │   └── archive/      # Processed messages
│           └── reports/
│               ├── clearance/    # Security clearance reports
│               └── reviews/      # Reviewer verdicts
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

### Milestone 1: Types and Message Contract

**Goal:** All TypeScript types defined. Message contract is 
concrete and validated.

**Build:**
- `src/types/index.ts` — shared enums and base types
- `src/router/message-types.ts` — full message schema as TS
  interfaces, matching the JSON contract exactly
- `src/router/flag-enums.ts` — all flag enums per role pair,
  matching the flag definitions exactly
- `src/roles/role-types.ts` — role enum, role instance types, 
  JTBD type definitions

**Validate:** Types compile. Write unit tests that construct 
valid and invalid messages, confirming the type system catches 
malformed contracts at compile time.

**Reference:** [`docs/message-contract.md`](docs/message-contract.md) —
JSON schema, flag enums, flag validation matrix.

---

### Milestone 2: Message Bus

**Goal:** Messages can be written to and read from the 
filesystem bus. Routing by role and instance works.

**Build:**
- `src/router/message-bus.ts`
  - `send(message: AgentMessage): void` — writes message JSON 
    to the target agent's inbox directory
  - `receive(roleInstance: string): AgentMessage[]` — reads 
    and returns all pending messages from an agent's inbox
  - `acknowledge(messageId: string): void` — moves message 
    from inbox to archive, updates status
  - `getThread(threadId: string): AgentMessage[]` — retrieves 
    all messages in a thread across all inboxes/archives
  - `getPending(requiresResponse: true): AgentMessage[]` — 
    finds all unanswered messages (for stuck detection)
  - File locking to prevent race conditions when multiple 
    agents write simultaneously

**Validate:** Unit tests — send a message, receive it,
acknowledge it, verify threading, verify atomic writes under
concurrent access.

**Reference:** [`docs/message-contract.md`](docs/message-contract.md) —
atomic writes, message ordering, flag validation matrix,
deduplication, size limits.

---

### Milestone 3: Team State Store

**Goal:** Team state is tracked in memory and persisted to 
disk. State includes: which agents exist, what phase the team 
is in, what each agent's current status is, and the active 
task.

**Build:**
- `src/state/team-state.ts`
  - `TeamState` interface: teamId, teamName, projectPath, 
    currentPhase, agents (map of roleInstance → status), 
    currentTask, createdAt, updatedAt
  - `AgentStatus`: roleInstance, role, state (spawning, 
    active, idle, blocked, waiting, done, errored), 
    currentJob, lastMessageAt
  - State transitions: only valid transitions allowed 
    (e.g., can't go from pre-work to review without 
    passing through work and handoff)
- `src/state/persistence.ts`
  - Writes `state.json` to `{projectPath}/.claude-orchestra/teams/{team-id}/`
  - Runtime data lives inside each target project, not the engine repo
  - Debounced writes (don't write on every state change)
  - Read on startup for recovery — uses `registry.json` to locate
    all active teams across projects

**Validate:** Unit tests — create team state, transition
phases, verify invalid transitions are rejected, persist
and recover.

**Reference:** [`docs/state-machine.md`](docs/state-machine.md) —
team phase states, agent states, valid transitions, state
persistence schema, crash recovery.

---

### Milestone 4: Agent Spawner

**Goal:** Claude Code CLI instances can be spawned, managed, 
and terminated. Each instance runs with its role-specific 
CLAUDE.md.

**Build:**
- `src/spawner/agent-process.ts`
  - Wraps a single Claude Code CLI child process
  - Spawns with: working directory (project path), 
    role CLAUDE.md (injected via `--system-prompt` flag 
    or copied into the working directory), environment 
    variables (`CLAUDE_ORCHESTRA_ROLE`, 
    `CLAUDE_ORCHESTRA_INSTANCE`, `CLAUDE_ORCHESTRA_TEAM_ID`)
  - Captures stdout/stderr streams
  - Monitors process health (alive, exited, errored)
  - Provides `send(prompt: string)` to pipe instructions 
    to the CLI instance
  - Provides `terminate()` for graceful shutdown
- `src/spawner/agent-spawner.ts`
  - `spawnTeam(teamId, projectPath): AgentProcess[]` — 
    spawns all 5 agents for a team
  - `spawnAgent(teamId, role, instance): AgentProcess` — 
    spawns a single agent
  - `terminateTeam(teamId)` — graceful shutdown of all 
    agents in a team
  - `getAgent(teamId, roleInstance): AgentProcess` — 
    retrieve a running agent
  - Tracks all running processes

**Validate:** Integration test — spawn a single Claude Code 
CLI instance with a test CLAUDE.md, send it a simple prompt, 
verify output is captured, terminate it. Then spawn a full 
team of 5 and verify all are running.

**Important:** This milestone requires Claude Code CLI to be
installed. Test with a minimal CLAUDE.md first before using
the real role files.

**Reference:**
[`docs/context-management.md`](docs/context-management.md) —
agent-engine communication protocol (stdin pipe), response
parsing (ORCHESTRA-MESSAGE delimiters).
[`docs/operations.md`](docs/operations.md) — health checks,
crash recovery (respawn protocol), graceful shutdown.

---

### Milestone 5: CLAUDE.md Role Files

**Goal:** Each role has a CLAUDE.md that instructs the Claude 
Code CLI instance on its identity, JTBD, communication 
protocol, and constraints.

**Build 5 files in `roles/`:**

Each CLAUDE.md must include:
1. **Identity** — what role this agent is, its instance name
2. **Mission** — from the JTBD section
3. **Phase-specific jobs** — what to do in each workflow phase
4. **Communication protocol** — how to send messages (write 
   JSON to the message bus directory), what flags to use, 
   who to send to
5. **Constraints** — what NOT to do (e.g., worker must not 
   touch off-limits files, reviewer must not evaluate security)
6. **Message format** — the exact JSON schema to use when 
   writing messages

The CLAUDE.md files are the critical interface between the 
engine and the agents. The engine spawns the CLI instance and 
points it at the right CLAUDE.md. From that point, the agent 
is autonomous — it reads its inbox, does its job, writes 
messages to other agents' inboxes.

**Files:**
- `roles/supervisor.claude.md` — ref "Supervisor JTBD"
- `roles/worker.claude.md` — ref "Worker JTBD"
  (same file for both workers, instance name set via env var)
- `roles/security.claude.md` — ref "Security Agent JTBD"
- `roles/reviewer.claude.md` — ref "Reviewer JTBD"

**Validate:** Spawn a single agent with its role CLAUDE.md,
give it a simple task, verify it produces output and attempts
to write messages in the correct format.

**Reference:**
[`docs/roles-and-jtbd.md`](docs/roles-and-jtbd.md) — JTBD
per role, CLAUDE.md prompt engineering guidelines, few-shot
examples, output format enforcement.
[`docs/context-management.md`](docs/context-management.md) —
prompt size guidelines, model selection per role.

---

### Milestone 6: Phase Controller

**Goal:** The workflow state machine manages phase transitions 
and triggers the right actions at each phase boundary.

**Build:**
- `src/phases/phase-controller.ts`
  - State machine: pre-work → work → handoff → review → done
  - Also handles: handoff → work (security blocked), 
    review → work (reviewer revise), review → pre-work 
    (reviewer reject)
  - Each transition has preconditions (e.g., can't enter 
    work until clearance-report received)
  - Emits events on transitions for the logger/dashboard

- `src/phases/pre-work.ts`
  - Triggers: Supervisor receives task → sends scan-request 
    to Security → waits for clearance-report → Supervisor 
    sends task-assignments to Workers
  - Transition condition to Work: all workers have sent 
    task-accepted

- `src/phases/work.ts`
  - Monitors: worker progress-updates, blocked signals, 
    clearance-request/response flow
  - Transition condition to Handoff: all workers have sent 
    task-complete

- `src/phases/handoff.ts`
  - Triggers: Supervisor sends sweep-request to Security → 
    waits for handoff-clearance
  - If APPROVED: transition to Review
  - If BLOCKED/FLAGGED: Supervisor sends revision-request 
    to workers, transition back to Work

- `src/phases/review.ts`
  - Triggers: Supervisor sends review-request to Reviewer → 
    waits for verdict
  - If review-approved: transition to Done
  - If review-revise: Supervisor routes feedback, transition 
    back to Work
  - If review-rejected: transition back to Pre-Work

**Validate:** Unit test the state machine with mock messages.
Verify all valid transitions work. Verify invalid transitions
are rejected. Verify preconditions are enforced.

**Reference:** [`docs/state-machine.md`](docs/state-machine.md) —
all states, transitions, preconditions, timeouts, loop limits,
deadlock detection, error/cancelled states.

---

### Milestone 7: Orchestrator (Integration)

**Goal:** The main orchestrator class ties everything together. 
Accepts a task, creates a team, runs the full workflow cycle.

**Build:**
- `src/orchestrator.ts`
  - `createTeam(name, projectPath): TeamState` — creates
    `.claude-orchestra/teams/{team-id}/` inside the target
    project, adds `.claude-orchestra/` to the project's
    `.gitignore` if not already present, and adds a registry
    entry to the engine's `registry.json`
  - `assignTask(teamId, taskDescription): void` — kicks off 
    the pre-work phase
  - `tick(): void` — main loop iteration: check all inboxes, 
    route messages, update state, check phase transitions
  - `getTeamStatus(teamId): TeamState` — for the dashboard
  - `getAllTeams(): TeamState[]` — for the dashboard
  - `terminateTeam(teamId)` — shutdown

- `src/index.ts`
  - CLI entry point
  - Commands: `create-team`, `assign-task`, `status`, `list`
  - Runs the main loop (polling interval for tick())

**Validate:** Full integration test — create a team, assign
a task, watch it flow through all 4 phases to completion
(or at least to the first phase transition). This is the
first end-to-end test.

**Reference:** [`docs/architecture.md`](docs/architecture.md) —
topology, agent lifecycle, multi-team coordination.

---

### Milestone 8: Logger (Headless Dashboard Substitute)

**Goal:** Structured, readable log output that gives the 
human orchestrator full visibility without a dashboard.

**Build:**
- `src/logger/logger.ts`
  - Logs every message sent/received with role colors
  - Logs phase transitions
  - Logs attention-needed events (using the priority system)
  - Formats output for terminal readability
  - Optionally writes to a log file for post-run analysis

**Validate:** Run a full cycle and verify the log output
tells a coherent story of what happened.

**Reference:** [`docs/operations.md`](docs/operations.md) —
structured log format, event types, log levels, role colors,
log file locations.

---

## End-to-End Validation

After all milestones are complete, the full cycle test is:

1. Human runs: `claude-orchestra create-team my-project ./my-app`
2. Human runs: `claude-orchestra assign-task my-project "Add user authentication with JWT"`
3. Engine spawns 5 Claude Code CLI instances
4. **Pre-work:** Supervisor receives task → Security scans 
   → clearance report → Supervisor plans → assigns Workers
5. **Work:** Workers implement → progress updates flow → 
   (if needed) runtime clearance requests handled
6. **Handoff:** Workers complete → Supervisor verifies → 
   Security sweeps → clearance issued
7. **Review:** Reviewer evaluates → verdict issued
8. **Done:** Task closes, all agents idle
9. Log output shows the full story with correct flags, 
   phases, and role labels at every step

If this cycle completes, the engine works and the dashboard 
phase can begin.

---

## Resolved Design Decisions

The following were open questions, now resolved. See the
referenced docs for full specifications.

1. **Engine-to-agent communication:** stdin pipe. The engine
   spawns CLI instances as child processes and writes prompts
   to stdin. Agents respond via stdout. See
   [Context Management — Agent-Engine Communication](docs/context-management.md#agent-engine-communication).

2. **Inbox polling:** Engine-driven. The engine's `tick()`
   loop detects new inbox messages and injects them into
   agent context via stdin prompts. Agents do NOT poll the
   filesystem directly. See
   [Context Management — How Agents Check Their Inbox](docs/context-management.md#how-agents-check-their-inbox).

3. **Crash recovery:** 3 respawn attempts per agent per task.
   Respawned agents receive a recovery prompt summarizing
   their last known state. See
   [Operations — Crash Recovery](docs/operations.md#crash-recovery).

4. **Token cost management:** Different models per role
   (Haiku for Workers, Sonnet for Supervisor/Reviewer, Opus
   for Security). Configurable per team. Cost budget with
   warning at $10 and hard limit at $25. See
   [Context Management — Cost Budget](docs/context-management.md#cost-budget).

5. **Concurrency:** Atomic file writes via temp file +
   `fs.rename()`. Message ordering by timestamp. See
   [Message Contract — Atomic Writes](docs/message-contract.md#atomic-writes).

6. **Runtime data locality:** Runtime data (messages, team
   state, reports) lives inside each target project's
   `.claude-orchestra/` directory, not the engine repo. The
   engine maintains a lightweight `registry.json` with
   pointers to active teams across projects. The engine
   does not create projects — it attaches teams to existing
   local repos.

---

## Error Handling and Recovery

### Malformed Agent Output

When an agent produces unparseable output (invalid JSON,
missing required fields, wrong message schema):

1. Log the malformed output at `warn` level.
2. Delete the malformed file from the inbox.
3. Send a corrective prompt to the agent via stdin.
4. Increment retry counter for the agent.
5. After 3 consecutive failures, mark agent as `errored`.
6. Counter resets to 0 after any successful message.

### Agent Crashes

Each agent gets 3 respawn attempts per task. See
[Operations — Crash Recovery](docs/operations.md#crash-recovery)
for the full protocol including recovery prompts.

### Timeouts

All messages with `requiresResponse: true` are monitored.
Default timeouts range from 2-10 minutes depending on the
message type. Phase-level hard timeouts range from 15-90
minutes. See
[State Machine — Timeouts](docs/state-machine.md#timeouts).

### Loop Limits

- Max 3 revision loops (handoff→work or review→work)
- Max 2 rejection loops (review→pre-work)
- Max 5 total backward transitions per task
- Exceeding any limit transitions to `errored` state

See [State Machine — Loop Limits](docs/state-machine.md#loop-limits).

### Deadlock Detection

Checked on every `tick()`. If no agent is active, at least
one is waiting/blocked, and no pending messages exist, the
system is deadlocked. See
[State Machine — Deadlock Detection](docs/state-machine.md#deadlock-detection).

---

## Configuration

All settings are configurable via `orchestra.config.json` with
CLI flag overrides for common settings. See
[Operations — Configuration Reference](docs/operations.md#configuration-reference)
for the full schema.

Key settings:
- `engine.tickIntervalMs` — main loop interval (default: 1000)
- `engine.registryPath` — path to registry file (default: `./registry.json`)
- `models.*` — model selection per role
- `timeouts.*` — timeout values per message type and phase
- `limits.*` — max revisions, rejections, respawns
- `costBudget.*` — warning and hard limit thresholds

Required environment variable: `ANTHROPIC_API_KEY`

---

## Testing Strategy

### Unit Tests (Per Milestone)

Each milestone's "Validate" section defines unit test criteria.
These test individual components in isolation.

### Mock Agent Tests

For integration testing without real API calls, use **mock
agents** — lightweight processes that simulate agent behavior:

- Read messages from inbox
- Wait a configurable delay
- Write predefined response messages to target inboxes
- Support configurable failure modes (crash, malformed output,
  timeout, wrong flag)

Mock agents are defined as simple Node.js scripts in
`tests/mocks/` that accept a behavior configuration via
environment variables.

### Integration Tests

| Test | What It Validates |
|------|------------------|
| Happy path | Full 4-phase cycle with mock agents, no errors |
| Security block | Handoff→Work loop when Security blocks |
| Reviewer revise | Review→Work loop with revision feedback |
| Reviewer reject | Review→Pre-Work loop with re-planning |
| Agent crash + respawn | Kill a mock agent mid-task, verify respawn |
| Timeout escalation | Mock agent goes silent, verify timeout fires |
| Deadlock detection | Put all mock agents in waiting state |
| Loop limit | Trigger max revisions, verify errored state |
| Engine crash recovery | Kill engine, restart, verify resume |
| Malformed output | Mock agent sends invalid JSON 3 times |

### Stress Tests

| Test | What It Validates |
|------|------------------|
| Concurrent writes | 5 mock agents writing to inboxes simultaneously |
| Message flood | One agent sends 100 messages rapidly |
| Multi-team | 3 teams running simultaneously |
| Long-running task | 5 revision cycles (at the limit) |

### Test Commands

```bash
# Unit tests per milestone
npm test -- --grep "message-bus"
npm test -- --grep "phase-controller"

# Integration tests
npm run test:integration

# Stress tests (longer running)
npm run test:stress
```

---

## Document References

- **Architecture:** [`docs/architecture.md`](docs/architecture.md) —
  MAS topology, autonomy, authority hierarchy
- **Message Contract:** [`docs/message-contract.md`](docs/message-contract.md) —
  JSON schema, flag enums, validation (Milestones 1-2)
- **Roles & JTBD:** [`docs/roles-and-jtbd.md`](docs/roles-and-jtbd.md) —
  role definitions, prompt guidelines (Milestone 5)
- **State Machine:** [`docs/state-machine.md`](docs/state-machine.md) —
  workflow states, transitions, timeouts (Milestone 6)
- **Context Management:** [`docs/context-management.md`](docs/context-management.md) —
  LLM context, costs, model selection (Milestone 5)
- **Operations:** [`docs/operations.md`](docs/operations.md) —
  health checks, shutdown, logging (Milestone 8)
- **README:** [`README.md`](README.md) — product context,
  dashboard requirements (future build phase)
- **Workflow Diagram:** [`orchestration-workflow.html`](orchestration-workflow.html) —
  visual reference for the full lifecycle flow
