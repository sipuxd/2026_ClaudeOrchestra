# ClaudeOrchestra

A terminal-based orchestration engine for managing autonomous
multi-agent teams built on Claude Code CLI. Each team runs a
fixed 5-role topology — 2 Workers, 1 Supervisor, 1 Reviewer,
1 Security Agent — with structured communication, phased
workflows, and jobs to be done per role.

You are the human orchestrator. This is your command center.

## The Problem

Running multiple Claude Code agent teams across projects means
dozens of concurrent agents with no unified visibility. You
can't tell which team is in what phase, which worker is blocked,
which security agent flagged something critical, or which
reviewer is waiting on your sign-off. You end up tab-switching
endlessly and losing context.

## What This Is

An active orchestration engine — not a passive monitor. You
assign tasks to teams, watch them progress through workflow
phases, respond to security alerts, approve handoffs, and
manage multiple teams simultaneously.

The engine understands the orchestration framework: it knows
about roles, message contracts, workflow phases, and flag-based
attention routing. A security alert looks different from a
worker progress update because it *is* different.

## How It Works

```
         ┌──────────────┐
         │    HUMAN      │  ← you, via CLI/dashboard
         │ ORCHESTRATOR  │
         └──────┬───────┘
                │
         ┌──────▼───────┐
         │  ORCHESTRATOR │  ← TypeScript engine
         │    ENGINE     │
         └──┬──┬──┬──┬──┘
            │  │  │  │
            ▼  ▼  ▼  ▼
          5 Claude Code CLI instances (per team)
```

Each team of 5 agents moves through 4 phases per task:

1. **Pre-Work** — Security scans workspace, Supervisor plans
2. **Work** — Workers execute, Security provides runtime clearance
3. **Handoff** — Security sweeps completed output
4. **Review** — Reviewer evaluates quality, issues verdict

See the [interactive workflow diagram](orchestration-workflow.html)
for the full lifecycle with decision branches and loop-backs.

## Project Status

**Phase: Engine Build** (dashboard is a separate future phase)

The engine is being built in 8 milestones. See the
[Implementation Plan](implementation-plan.md) for current
build status, milestone details, and validation criteria.

## Documentation

### Architecture & Design

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | MAS topology, agent autonomy model, authority hierarchy, conflict resolution, broadcast patterns |
| [Message Contract](docs/message-contract.md) | JSON schema, flag enums per role pair, flag validation matrix, ordering rules, size limits, deduplication |
| [Roles & JTBD](docs/roles-and-jtbd.md) | Role definitions, phase-specific responsibilities, CLAUDE.md prompt engineering guidelines, few-shot examples |

### Engine Specifications

| Document | Description |
|----------|-------------|
| [State Machine](docs/state-machine.md) | Workflow states (including error/cancelled), transitions, preconditions, timeouts, loop limits, deadlock detection |
| [Context Management](docs/context-management.md) | LLM context window strategy, model selection, cost budgets, agent-engine communication protocol |
| [Operations](docs/operations.md) | Health checks, crash recovery, graceful shutdown, signal handling, resource limits, structured logging, configuration reference |

### Build

| Document | Description |
|----------|-------------|
| [Implementation Plan](implementation-plan.md) | 8-milestone build sequence, error handling, configuration, testing strategy |
| [Workflow Diagram](orchestration-workflow.html) | Interactive visual diagram of the full lifecycle flow |

### Cross-Reference Map

```
README (you are here)
├── docs/architecture.md
│   ├── docs/message-contract.md
│   ├── docs/roles-and-jtbd.md
│   └── docs/state-machine.md
├── docs/state-machine.md
│   ├── docs/message-contract.md
│   └── docs/operations.md
├── docs/roles-and-jtbd.md
│   ├── docs/message-contract.md
│   └── docs/context-management.md
├── docs/context-management.md
│   └── docs/message-contract.md
├── docs/operations.md (leaf)
├── implementation-plan.md
│   └── refs all docs above per milestone
└── orchestration-workflow.html (standalone visual)
```

## Team Architecture (Per Team)

Each team is a fixed 5-agent topology:

- **Supervisor** — receives tasks, plans execution, directs
  workers, coordinates handoffs to reviewer
- **Worker-1** — executes assigned work within security-cleared
  boundaries
- **Worker-2** — executes assigned work within security-cleared
  boundaries (independent or paired with Worker-1)
- **Security Agent** — preemptive workspace scanning, runtime
  clearance checks, post-work validation before reviewer sees
  anything
- **Reviewer** — evaluates quality of completed, security-cleared
  work only

## Dashboard Features (Future Phase)

### Team Overview
- See all active teams and their current workflow phase
- Each team shows its 5 agents with role-specific status
- Phase progression indicator (pre-work → work → handoff → review)

### Attention Routing (Flag-Driven)
The dashboard surfaces what needs you based on message flags
and priority levels:

- **Critical** — Security alerts, blocked workers, reviewer
  rejections
- **High** — Clearance denials, revision requests, anomaly
  detections
- **Normal** — Progress updates, task completions, routine
  clearances
- **Low** — Acknowledgments, worker-to-worker sync messages

### Team Card
- Team name/ID and assigned project
- Current workflow phase with visual indicator
- Role status grid — 5 agents, each showing:
  - Role label (Supervisor, Worker-1, Worker-2, Security, Reviewer)
  - Current state (active, idle, blocked, waiting, done)
  - Latest flag sent/received
  - Color-coded by role
- Attention badge when human input is needed
- Time elapsed since task start

### Drill-Down
- Select a team to see its full message thread
- Select an agent to see its current job and recent messages
- View the security clearance report for any team
- View reviewer feedback and revision history

### Task Assignment
- Create a new team or assign a task to an existing team
- Dashboard kicks off the Pre-Work phase automatically

### Interactions
- Arrow keys to navigate between team cards
- Enter to drill into a team
- Tab to cycle between agents within a team
- T to assign a new task / create a new team
- A to view all attention-needed items across all teams
- Q to quit

## Tech Stack

- **Engine:** TypeScript, Node.js
- **Dashboard (future):** ink (React for terminal UIs), @inkjs/ui
- **Design tokens:** @pcoi/tokens (colors, spacing, hierarchy)
- **Icons:** @pcoi/icons (unicode/emoji mapping for terminal)

## Design Principles

- **Scannable at a glance** — team phase and attention status
  should be obvious without reading text
- **Role-aware** — the UI knows about the 5-role topology and
  renders accordingly, not as generic agent cards
- **Phase-aware** — the UI understands workflow phases and shows
  progression
- **Flag-driven attention** — what surfaces to the human is
  determined by the message contract's flag and priority fields,
  not arbitrary notifications
- **Minimal noise** — only surface what matters
- **Color and motion do the heavy lifting** — not text density

### Role Colors

| Role | Color |
|------|-------|
| Supervisor | Blue |
| Worker | Green |
| Security | Red |
| Reviewer | Amber/Orange |
| Human/Decision | Purple |
