# ClaudeOrchestra — System Architecture

> Source of truth for MAS topology, agent autonomy, authority
> hierarchy, and coordination patterns.
>
> **Cross-references:**
> - [Message Contract](./message-contract.md) — communication layer
> - [Roles & JTBD](./roles-and-jtbd.md) — role definitions
> - [State Machine](./state-machine.md) — workflow model
> - [Visual Diagram](../orchestration-workflow.html) — interactive
>   lifecycle flow

---

## Agent Topology

ClaudeOrchestra uses a **fixed 5-agent star topology** per team.
The Supervisor is the hub. All inter-role communication routes
through the Supervisor except two sidecar paths:

```
                 ┌──────────┐
                 │ Reviewer  │
                 └─────┬─────┘
                       │
          ┌────────────┴────────────┐
          │       SUPERVISOR        │  ← hub
          └──┬──────┬──────────┬────┘
             │      │          │
        ┌────┴─┐ ┌──┴───┐ ┌───┴──────┐
        │ W-1  │ │ W-2  │ │ Security │
        └──┬───┘ └──┬───┘ └──────────┘
           │        │          ▲
           └────────┴──────────┘
            direct: clearance-request/response
```

### Agents Per Team

| Role | Instances | Purpose |
|------|-----------|---------|
| Supervisor | 1 | Receives tasks, plans execution, directs workers, coordinates handoffs |
| Worker | 2 | Execute assigned implementation work within security-cleared boundaries |
| Security Agent | 1 | Pre-scan, runtime clearance, post-work validation |
| Reviewer | 1 | Evaluates quality of completed, security-cleared work |

### Communication Paths

| Path | Direction | When |
|------|-----------|------|
| Supervisor ↔ Worker | Bidirectional | All phases |
| Supervisor ↔ Security | Bidirectional | Pre-work, handoff, escalations |
| Supervisor ↔ Reviewer | Bidirectional | Review phase |
| Worker → Security | Unidirectional request | Runtime clearance during work |
| Security → Worker | Unidirectional response | Clearance grant/deny |
| Worker ↔ Worker | Bidirectional (when paired) | Work phase coordination |

All other paths are **invalid**. Workers never communicate
directly with the Reviewer. The Reviewer never communicates
directly with Security. See the
[flag validation matrix](./message-contract.md#flag-validation-matrix)
for enforcement rules.

---

## Agent Autonomy Model

Each agent operates as a **semi-autonomous actor**: it has a
defined role, receives instructions, and executes independently
within its boundaries. However, autonomy is constrained by role.

### Autonomy Levels Per Role

| Role | Autonomy Level | Description |
|------|---------------|-------------|
| Supervisor | **High** | Can plan, assign, reassign, adjust, and close tasks. Cannot override Security clearance decisions. |
| Worker | **Medium** | Can implement freely within cleared scope. Must stop and request clearance when hitting unchecked areas. Cannot refuse valid task assignments. |
| Security Agent | **High** | Can block work, deny clearance, flag concerns independently. Cannot be overridden by the Supervisor (see Authority Hierarchy). |
| Reviewer | **Medium** | Can approve, revise, or reject independently based on quality assessment. Cannot evaluate security. |

### What Agents Can NOT Do

- **Workers** cannot refuse a `task-assignment` from the
  Supervisor. If a Worker detects a problem with the assignment,
  it sends `needs-guidance` to the Supervisor rather than
  refusing.
- **Workers** cannot proceed on unchecked scope. They must stop
  and send `clearance-request` to Security.
- **Reviewers** cannot evaluate security concerns. If a Reviewer
  notices something security-related, it includes it in feedback
  as a note, but the Security Agent's clearance is the authority.
- **Supervisors** cannot override Security Agent decisions (see
  Authority Hierarchy below).

---

## Authority Hierarchy

When agents disagree or produce conflicting directives, the
following hierarchy resolves the conflict:

### Security Decisions

```
Human Orchestrator  →  final authority
      ↑
Security Agent      →  can block, deny, flag (cannot be overridden by Supervisor)
      ↑
Supervisor          →  can request re-evaluation, cannot override
```

**The Security Agent has veto power on security matters.** If
the Security Agent issues a `clearance-denied` or a
`handoff-clearance: BLOCKED`, the Supervisor cannot override it.
The Supervisor's options are:

1. **Request re-evaluation** — send `escalation-query` to
   Security with additional context, asking Security to
   re-assess.
2. **Adjust the plan** — modify the work to avoid the
   blocked area.
3. **Escalate to human** — if the Supervisor believes
   Security is wrong, escalate to the human orchestrator
   for a manual decision.

The Security Agent cannot be overridden programmatically. Only
the human orchestrator can override a security block, and only
through the dashboard's attention system.

### Task Decisions

```
Human Orchestrator  →  final authority
      ↑
Supervisor          →  plans, assigns, adjusts, closes
      ↑
Worker              →  executes, reports, flags concerns
```

The Supervisor has full authority over task planning and
assignment. Workers execute. If a Worker has concerns, it sends
`needs-guidance` or `scope-concern` — it does not unilaterally
change the plan.

### Quality Decisions

```
Human Orchestrator  →  final authority
      ↑
Reviewer            →  approve, revise, reject
      ↑
Supervisor          →  packages work for review, routes feedback
```

The Reviewer's verdict is authoritative on quality. The
Supervisor routes the verdict but does not overrule it. If the
Supervisor disagrees with a `review-rejected`, it can re-plan
and resubmit, but it cannot mark the task as done without
Reviewer approval.

---

## Conflict Resolution

### Worker-Worker Conflicts (Paired Mode)

When Workers are paired and produce conflicting implementations
(e.g., incompatible interface definitions via `sync-response`):

1. **Detection:** The Supervisor monitors Worker-Worker messages
   (`sync-request`, `sync-response`, `heads-up`). The
   Supervisor does not intervene in every sync exchange, but
   checks for conflicts when both Workers send `sync-response`
   messages that reference the same interface or boundary.
2. **Mediation protocol:**
   a. Supervisor sends `pause` to both Workers.
   b. Supervisor reviews both proposals.
   c. Supervisor picks one, synthesizes a compromise, or
      redefines the boundary.
   d. Supervisor sends `direction-change` to both Workers
      with the resolution.
   e. Supervisor sends `resume` to both Workers.
3. **Escalation:** If the Supervisor cannot resolve the
   conflict (e.g., both approaches are valid but architecturally
   significant), it escalates to the human orchestrator via a
   `critical` priority message.

### Security-Supervisor Disagreements

When the Supervisor believes Security is being too restrictive:

1. Supervisor sends `escalation-query` to Security with
   specific reasoning for why the area should be cleared.
2. Security re-evaluates and responds with
   `escalation-response` (either maintaining or adjusting
   its assessment).
3. If Security maintains its block, the Supervisor must
   either adjust the plan or escalate to the human
   orchestrator.

### Reviewer-Supervisor Disagreements

The Supervisor cannot override the Reviewer. If the Supervisor
believes a `review-rejected` is incorrect:

1. Supervisor re-plans and resubmits (entering Pre-Work again).
2. If the same work is rejected a second time, the system
   escalates to the human orchestrator (enforced by the
   [max revision loop count](./state-machine.md#loop-limits)).

---

## Broadcast and Multicast

The message contract supports targeted messaging via
`roleTarget` and `roleTargetInstance`. Two special patterns
are supported:

### Role-Level Routing (`roleTargetInstance: null`)

When `roleTargetInstance` is `null`, the message is delivered
to **all instances** of the target role. This is a multicast
to a role group.

Use cases:
- Supervisor sends `pause` to all Workers:
  `roleTarget: "Worker"`, `roleTargetInstance: null`
- Supervisor sends `direction-change` to all Workers

### Team Broadcast

For messages that must reach all agents in a team (e.g., task
cancellation), the engine handles this at the orchestrator
level rather than through the message contract. The orchestrator
sends individual messages to each agent's inbox.

Events that trigger team broadcast:
- **Task cancelled** — human orchestrator cancels via dashboard
- **Team shutdown** — graceful termination initiated

These are engine-level operations, not agent-to-agent messages.
See [Operations](./operations.md#graceful-shutdown-protocol)
for the shutdown sequence.

---

## Agent Identity and State

### Identity (Persistent)

An agent's identity is defined by its CLAUDE.md role file and
environment variables set at spawn time:

- `CLAUDE_ORCHESTRA_ROLE` — the role (Supervisor, Worker,
  Security, Reviewer)
- `CLAUDE_ORCHESTRA_INSTANCE` — the instance name (Worker-1,
  Worker-2, etc.)
- `CLAUDE_ORCHESTRA_TEAM_ID` — the team this agent belongs to

Identity does not change during an agent's lifetime.

### State (Ephemeral)

An agent accumulates context through:
1. Its initial CLAUDE.md prompt (role instructions)
2. Messages received via its inbox
3. Work performed (file reads/writes in the project)
4. Its own Claude Code CLI context window

**Agent state is ephemeral to the CLI instance.** If an agent
process is terminated and respawned, it loses its accumulated
context. Recovery relies on:
- Re-reading inbox history from the filesystem
- The team's `state.json` capturing what phase/status the
  agent was in
- The engine providing a "recovery prompt" that summarizes
  what the agent was doing before the crash

See [Context Management](./context-management.md) for context
window strategy and [Operations](./operations.md#crash-recovery)
for the respawn protocol.

### Agent Lifecycle

Agents are **ephemeral per task**:
1. **Spawned** when a task is assigned to a team
2. **Active** throughout the task's workflow phases
3. **Terminated** when the task reaches a terminal state
   (done, cancelled, errored)

Agents are NOT reused across tasks. Each new task spawns fresh
CLI instances. This avoids context pollution between tasks and
simplifies the recovery model.

---

## Multi-Team Coordination

Teams are fully isolated. There is no inter-team communication.
Each team:
- Has its own `data/teams/{team-id}/` directory
- Has its own 5 agent processes
- Has its own workflow phase state
- Operates on its own project path

The orchestrator manages multiple teams concurrently by running
independent `tick()` loops (or a single loop that iterates
over all teams). Teams do not share agents, messages, or state.

The human orchestrator is the only entity with cross-team
visibility, provided by the dashboard.
