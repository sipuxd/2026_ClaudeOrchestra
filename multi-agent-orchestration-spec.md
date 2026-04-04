# Multi-Agent Orchestration Framework Spec

> **DEPRECATED:** This file has been superseded by the
> following documents. It is retained temporarily as a
> reference during the transition.
>
> - [Architecture](docs/architecture.md) — topology, autonomy,
>   authority hierarchy, conflict resolution
> - [Roles & JTBD](docs/roles-and-jtbd.md) — role definitions,
>   phase-specific jobs, prompt engineering guidelines
> - [State Machine](docs/state-machine.md) — workflow states,
>   transitions, timeouts, loop limits, deadlock detection
> - [Context Management](docs/context-management.md) — LLM
>   context, model selection, cost budgets
> - [Operations](docs/operations.md) — health checks, shutdown,
>   logging, configuration
>
> **Do not modify this file.** Update the docs above instead.

---

## Overview

A custom orchestration layer for Claude Code CLI built on top of the official agent teams (swarm mode) primitives. Defines a fixed 5-role topology with structured communication, defined jobs per role, phased workflows, and a terminal dashboard for managing multiple teams across projects.

## Architecture

- **2 Workers** — execute assigned implementation tasks
- **1 Supervisor** — receives tasks, plans, directs workers, coordinates handoffs
- **1 Security Agent** — preemptive workspace scanning, runtime clearance, post-work validation
- **1 Reviewer** — evaluates quality of completed, security-cleared work only

---

## Workflow Phases

### Phase 1: Pre-Work
1. Supervisor receives the incoming task.
2. Supervisor hands the scope to the Security Agent.
3. Security Agent scans the target workspace and produces a **clearance report**:
   - Safe to modify freely
   - Caution required
   - Off-limits
   - Requires Supervisor explicit approval
4. Supervisor uses the clearance report to plan and assign work to Workers.
5. Each Worker receives their assignment **with security clearance boundaries attached**.

### Phase 2: Work
1. Workers operate under the Supervisor's direction — independently or paired depending on the need.
2. Supervisor actively manages — monitors progress, mediates conflicts, adjusts plan as needed.
3. If a Worker hits something outside the cleared scope, they **stop and request runtime clearance** from the Security Agent.
4. Security Agent evaluates and issues clearance, denies with explanation, or escalates to Supervisor.

### Phase 3: Handoff
1. Workers signal completion to the Supervisor.
2. Supervisor verifies the work addresses the original task.
3. Security Agent performs a **post-work sweep** on all completed output:
   - Prompt injection patterns in new/modified files
   - Accidentally committed secrets or credentials
   - Unauthorized dependencies added
   - Behavioral drift (output deviating from task in ways suggesting malicious file influence)
   - Scope adherence (work only touches what was cleared)
4. Security Agent produces a **handoff clearance**: approved, flagged with concerns, or blocked.
5. Only security-cleared work moves to the Reviewer.

### Phase 4: Review
1. Reviewer receives clean, vetted work from the Supervisor along with task context.
2. Reviewer evaluates purely on quality — does not evaluate security concerns.
3. Reviewer issues verdict: Approve, Revise (with specific feedback), or Reject (requires re-planning).
4. If revisions needed, Supervisor routes feedback back to Workers and re-enters Work phase.
5. If approved, task is closed.

---

## Jobs To Be Done (JTBD) Per Role

### Security Agent

**Mission:** Ensure the workspace and all agent output is safe before, during, and after work.

**Phase 1 — Pre-Scan (Pre-Work)**
- Scan all files in the task scope for prompt injection patterns.
- Check for hardcoded credentials, API keys, secrets, and tokens.
- Validate dependency integrity — compromised, outdated, or known-vulnerable packages.
- Map sensitive areas — auth modules, database configs, environment files, encryption logic.
- Identify files that could influence worker behavior if read (malicious comments, embedded instructions).
- Produce clearance report with four tiers: safe, caution, off-limits, needs Supervisor approval.

**Phase 2 — Runtime Clearance (Work)**
- Respond to Worker clearance requests when they hit something outside the original scope.
- Evaluate the requested file or module against the same threat criteria from pre-scan.
- Issue clearance, deny with explanation, or escalate to Supervisor.
- Monitor for scope creep — Workers drifting into areas that weren't part of the assignment.

**Phase 3 — Post-Work Validation (Handoff)**
- Sweep all completed output before it reaches the Reviewer.
- Check for prompt injection patterns introduced in new or modified files.
- Scan for accidentally committed secrets or credentials.
- Verify no unauthorized dependencies were added.
- Detect behavioral drift — did the Worker's output deviate from the task in ways that suggest influence from a malicious file.
- Confirm scope adherence — the work product only touches what was cleared.
- Produce handoff clearance: approved for review, flagged with concerns, or blocked with explanation.

---

### Supervisor

**Mission:** Receive tasks, plan execution, direct Workers, and ensure work is ready for handoff.

**Phase 1 — Task Receipt and Planning (Pre-Work)**
- Receive the incoming task or assignment.
- Hand the scope to the Security Agent and wait for the clearance report.
- Analyze the clearance report and determine the work plan — what gets done, in what order, by whom.
- Decide whether Workers operate independently on separate pieces or paired on the same problem.
- Produce task assignments with security clearance boundaries attached — each Worker knows what they can touch and what they can't.

**Phase 2 — Active Direction (Work)**
- Assign tasks to Worker-1 and Worker-2.
- Monitor Worker progress — are they blocked, stuck, going in the wrong direction.
- Mediate if Workers are paired and diverge.
- Receive escalations from the Security Agent if a runtime clearance is denied.
- Make judgment calls — adjust the plan, reassign work, change the pairing model if something isn't working.
- Ensure Workers aren't going silent — if a Worker hasn't communicated in a while, check in.

**Phase 3 — Handoff Coordination (Handoff)**
- Receive completion signals from Workers.
- Verify the work addresses the original task before involving Security.
- Hand completed work to the Security Agent for the post-work sweep.
- If Security flags issues, route them back to the appropriate Worker with specific instructions.
- If Security clears the work, package it and hand it to the Reviewer.
- Provide the Reviewer with context — what was the task, what was the approach, any decisions made along the way.

**Phase 4 — Post-Review (Review)**
- Receive the Reviewer's feedback.
- If revisions needed, route feedback to the appropriate Worker and re-enter the Work phase.
- If approved, close out the task.

---

### Worker

**Mission:** Execute assigned work within cleared boundaries, communicate status, and flag unknowns.

**Phase 1 — Receive and Understand (Pre-Work)**
- Receive task assignment from the Supervisor with security clearance boundaries.
- Understand what files and modules are safe to modify, which require caution, and which are off-limits.
- Identify ambiguities in the assignment and ask the Supervisor for clarification before starting — not mid-work.

**Phase 2 — Execute (Work)**
- Implement the assigned work within the cleared scope.
- If working independently, own the full implementation of the assigned piece.
- If paired with the other Worker, coordinate on shared interfaces, boundaries, and integration points.
- If the work requires touching something outside the cleared scope, **stop and request runtime clearance** from the Security Agent. Do not proceed on unchecked areas.
- Communicate progress to the Supervisor at meaningful milestones — not just at the end.
- Flag blockers immediately — don't sit on them.

**Phase 3 — Completion Signal (Handoff)**
- Signal the Supervisor that the work is done.
- Provide a summary of what was implemented, what was changed, and any decisions made during execution.
- Call out anything that felt off — files that seemed unusual, behavior that was unexpected, areas where the implementation required judgment calls.
- This feeds the Security Agent's post-work sweep with useful context.

---

### Reviewer

**Mission:** Evaluate the quality and correctness of completed, security-cleared work.

**Phase 1 — Receive (Review)**
- Receive the completed work package from the Supervisor along with task context.
- Understand the original goal, the approach taken, and any relevant decisions.
- Confirm that the work has been security-cleared — if it hasn't passed through the Security Agent, reject it back to the Supervisor.

**Phase 2 — Evaluate**
- Assess correctness — does the implementation actually solve the task.
- Assess code quality — structure, readability, maintainability, patterns.
- Assess completeness — are there gaps, missing edge cases, untested paths.
- Assess integration — does this work fit with the broader codebase without introducing conflicts or regressions.
- Do **not** evaluate security concerns — that's not this role's job. Trust the Security Agent's clearance.

**Phase 3 — Verdict**
- **Approve** — work is ready, task is complete.
- **Revise** — work needs changes, provide specific actionable feedback routed back through the Supervisor.
- **Reject** — work is fundamentally off-track, requires re-planning by the Supervisor.

---

## JSON Message Contract

### Schema

```json
{
  "messageId": "msg-uuid",
  "threadId": "thread-uuid",
  "timestamp": "ISO-8601",
  "roleSource": "Worker | Supervisor | Security | Reviewer",
  "roleSourceInstance": "Worker-1 | Worker-2 | Supervisor-1 | Security-1 | Reviewer-1",
  "roleTarget": "Worker | Supervisor | Security | Reviewer",
  "roleTargetInstance": "Worker-1 | Worker-2 | Supervisor-1 | Security-1 | Reviewer-1 | null",
  "flag": "enum (see Flag Enums below)",
  "priority": "low | normal | high | critical",
  "phase": "pre-work | work | handoff | review",
  "content": "string",
  "references": ["msg-uuid | task-id"],
  "requiresResponse": true,
  "status": "pending | acknowledged | resolved"
}
```

### Field Descriptions

- **messageId** — Unique identifier for this message.
- **threadId** — Groups related messages into a conversation thread. Used for tracking multi-step exchanges (e.g., clearance request → response → escalation).
- **timestamp** — ISO-8601. Enables ordering, latency detection, and timeout monitoring.
- **roleSource / roleSourceInstance** — Who sent the message and which specific instance.
- **roleTarget / roleTargetInstance** — Who the message is for. Instance can be null for role-level routing (e.g., "any Worker").
- **flag** — Enum scoped per role pair. Drives routing logic. Tells the receiver why this message is in their inbox and what kind of response is expected.
- **priority** — Determines surfacing order in the dashboard. Critical = immediate human attention.
- **phase** — Ties the message to the current workflow stage. Gives context for how the flag should be interpreted.
- **content** — The actual message payload.
- **references** — Links to related messages or task IDs. Enables threading and cross-referencing.
- **requiresResponse** — Boolean. If true, the system tracks whether a response has been received. Enables stuck-detection.
- **status** — Lifecycle of this specific message. Pending → Acknowledged → Resolved.

---

## Flag Enums Per Role Pair

### Supervisor → Worker
- `task-assignment` — Here's your work, here's your scope, here's your clearance boundaries.
- `direction-change` — Plan has changed, adjust your approach.
- `pause` — Stop what you're doing, await further instruction.
- `resume` — Continue previously paused work.
- `check-in` — You've been quiet, report your status.
- `revision-request` — Reviewer sent back feedback, here's what needs to change.

### Worker → Supervisor
- `task-accepted` — Assignment received and understood.
- `progress-update` — Milestone reached, here's where I am.
- `task-complete` — I'm done, ready for handoff.
- `blocked` — I can't proceed, here's why.
- `needs-guidance` — Ambiguity or judgment call, need your input.
- `scope-concern` — The work may require going outside cleared boundaries.
- `anomaly-detected` — Something feels off about a file or behavior.

### Supervisor → Security
- `scan-request` — Here's the scope, produce a clearance report (pre-work).
- `sweep-request` — Here's the completed work, do a post-work validation (handoff).
- `escalation-query` — A Worker or situation needs your security assessment.

### Security → Supervisor
- `clearance-report` — Pre-scan complete. Here's what's safe, cautious, off-limits, needs approval.
- `handoff-clearance` — Post-work sweep complete. Approved / flagged / blocked.
- `security-alert` — Something urgent found. Requires immediate Supervisor attention.
- `escalation-response` — Response to Supervisor's escalation query.

### Worker → Security
- `clearance-request` — I need to touch something outside my cleared scope. Is it safe?

### Security → Worker
- `clearance-granted` — You're clear to proceed on the requested area.
- `clearance-denied` — Do not touch. Here's why. Escalate to Supervisor if needed.

### Supervisor → Reviewer
- `review-request` — Here's the completed, security-cleared work. Here's the task context.

### Reviewer → Supervisor
- `review-approved` — Work is good. Task complete.
- `review-revise` — Work needs changes. Here's specific feedback.
- `review-rejected` — Work is fundamentally off-track. Needs re-planning.

### Worker → Worker (when paired)
- `sync-request` — I need to coordinate on a shared boundary or interface.
- `sync-response` — Here's my side of the shared boundary.
- `heads-up` — FYI, I changed something that might affect your piece.

---

## Runtime Data

Runtime data (messages between agents, team state, security
clearance reports, reviewer verdicts) lives inside each target
project in a `.claude-orchestra/` directory, added to the
project's `.gitignore`. The engine does not store runtime data
from other projects inside its own repo.

When the engine attaches a team to a project, it creates:

```
{project-root}/
├── .claude-orchestra/
│   └── teams/
│       └── {team-id}/
│           ├── state.json
│           ├── messages/
│           │   ├── inbox/
│           │   │   ├── supervisor-1/
│           │   │   ├── worker-1/
│           │   │   ├── worker-2/
│           │   │   ├── security-1/
│           │   │   └── reviewer-1/
│           │   └── archive/
│           └── reports/
│               ├── clearance/
│               └── reviews/
```

Multiple teams on the same project each get their own
subdirectory under `.claude-orchestra/teams/`.

### Registry

The engine keeps a lightweight registry file in its own repo —
just a JSON file with pointers to active teams. No runtime data,
only references. The dashboard reads this registry on load to
know which projects to look at, then reaches into each project's
`.claude-orchestra/` directory to pull actual state.

Registry location: `{engine-repo}/registry.json`

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

When the engine attaches a team to a project, it adds an entry
to the registry. When a team is removed, the entry is deleted.

---

## Multi-Team & Dashboard

### Problem
One team = 5 agents. Multiple projects = multiple teams. Without a management layer, the human orchestrator drowns in terminal tabs.

### Dashboard Concept
A purpose-built terminal interface that understands the orchestration framework:
- Shows each team and its current workflow phase (pre-work / work / handoff / review).
- Surfaces attention-needed indicators driven by the flag and priority fields from the message contract.
- Differentiates between role types — a Security alert looks different from a Worker progress update.
- Highlights blocked agents, unanswered messages (requiresResponse = true, status = pending), and completed reviews awaiting human sign-off.
- Allows the human orchestrator to drill into any team, any agent, any message thread.
- Reads the engine's `registry.json` on load to discover all active teams across all projects.

### Attention Priority (Dashboard Surfacing)
1. **Critical** — Security alerts, blocked Workers, Reviewer rejections.
2. **High** — Clearance denials, revision requests, anomaly detections.
3. **Normal** — Progress updates, task completions, routine clearances.
4. **Low** — Acknowledgments, sync messages between paired Workers.

---

## Open Items
- Scaling considerations — max teams, token costs, coordination overhead.
