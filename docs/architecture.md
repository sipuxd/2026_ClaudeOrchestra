# ClaudeOrchestra — System Architecture

> Source of truth for pipeline topology, agent roles, authority
> model, and coordination patterns.
>
> **Cross-references:**
> - [Roles & JTBD](./roles-and-jtbd.md) — role definitions
> - [State Machine](./state-machine.md) — workflow model
> - [Visual Diagram](../orchestration-workflow.html) — interactive
>   lifecycle flow

---

## Pipeline Architecture

ClaudeOrchestra uses a **deterministic, code-driven pipeline**.
There is no Supervisor LLM — the `PipelineOrchestrator` class
drives the workflow directly, sending prompts to agents via
the Claude Agent SDK `query()` API.

```
PipelineOrchestrator (TypeScript)
├── Complexity Router (heuristic classification)
├── Agent Sessions (SDK query() with warm PromptChannel)
└── Phase Controller (state machine)
    ↓ manages
Team State Store
    ↓ spawns/manages
Up to 4 Agent Sessions (1 per role)
```

### Two Pipeline Modes

| Mode | Agents | When |
|------|--------|------|
| **Simple** | Worker-1 only | Short task description, no complexity keywords |
| **Standard** | Security-1, Worker-1, Worker-2, Reviewer-1 | Longer description or complexity keywords detected |

The complexity router (`src/router/complexity-router.ts`)
classifies tasks heuristically based on description length
(>20 words = standard) and keyword analysis (e.g., "test",
"refactor", "implement", "api"). Security-1 can also
reclassify a standard task to simple during its pre-scan.

### Standard Pipeline Flow

```
Security-1 (pre-scan)
    ↓
Worker-1 (implement) → Worker-2 (verify requirements)
    ↓                       ↓ gaps found? → Worker-1 fixes (max 2 loops)
    ↓
Security-1 (post-sweep)
    ↓ BLOCKED? → back to Worker-1
    ↓ APPROVED/FLAGGED ↓
Reviewer-1 (quality review)
    ↓ REVISION_NEEDED? → back to Worker-1
    ↓ REJECTED? → back to Security-1 (full restart)
    ↓ APPROVED ↓
Done
```

### Simple Pipeline Flow

```
Worker-1 (implement task)
    ↓
Done
```

---

## Agent Topology

ClaudeOrchestra uses up to **4 agent sessions** per team.
All coordination is handled by the engine code — agents do
not communicate with each other directly.

```
         PipelineOrchestrator (code)
        ┌──────┬──────┬──────────┐
        │      │      │          │
   ┌────┴─┐ ┌──┴───┐ ┌┴────────┐ ┌─────────┐
   │ W-1  │ │ W-2  │ │Security │ │Reviewer │
   └──────┘ └──────┘ └─────────┘ └─────────┘
```

### Agents Per Team

| Role | Instances | Purpose |
|------|-----------|---------|
| Worker-1 | 1 | Implements the assigned task within security-cleared boundaries |
| Worker-2 | 1 | Verifies Worker-1's output against task requirements (does NOT write code) |
| Security Agent | 1 | Pre-scan clearance + post-work sweep validation |
| Reviewer | 1 | Evaluates quality and correctness of security-cleared work |

### Communication Model

Agents do **not** communicate with each other. The pipeline
orchestrator acts as the sole coordinator:

1. Engine sends a prompt to an agent via SDK `query()`.
2. Agent processes the prompt and returns a response.
3. Engine parses the response for verdicts (regex-based).
4. Engine decides the next step based on the verdict.
5. Engine sends the next prompt to the next agent.

All agent sessions are created in parallel at pipeline start
(cold-start latency ~12s happens concurrently). Subsequent
messages within a warm session are ~2-3s.

---

## Authority Model

### Security Decisions

The Security Agent's verdict is authoritative:

- **APPROVED** — work is clean, proceed to review
- **FLAGGED** — concerns noted but not blocking, proceed
- **BLOCKED** — must be resolved, triggers automatic retry

A BLOCKED verdict causes an automatic backward transition
(Handoff → Work). The engine does not override Security.
If loop limits are exceeded, the pipeline errors and
escalates to the human.

### Quality Decisions

The Reviewer's verdict is authoritative:

- **APPROVED** — task complete
- **REVISION_NEEDED** — specific changes required, retry Work
- **REJECTED** — fundamentally off-track, restart from PreWork

### Verification Decisions

Worker-2's verdict drives the inner verification loop:

- **COMPLETE** — all requirements met, proceed to sweep
- **GAPS_FOUND** — specific requirements missing, Worker-1
  fixes (max 2 verification passes)

### Human Authority

The human orchestrator has final authority via the dashboard:

- Can cancel any task at any time
- Receives notifications for security blocks, revisions,
  rejections
- Can respond to blocking feedback questions
- Can push and merge completed work via dashboard

---

## Agent Sessions

Each agent gets a **warm SDK session** via the Claude Agent
SDK `query()` call with a `PromptChannel` for streaming input.

### Session Lifecycle

1. **Created** when a task is assigned (all sessions in parallel)
2. **Warm** throughout the pipeline — subsequent messages reuse
   the same session (~2-3s vs ~12s cold start)
3. **Kept alive** after pipeline completion for Q&A
4. **Closed** when the team is terminated

### Session Identity

Each session is configured with:
- Role-specific CLAUDE.md system prompt
- Working directory set to the target project
- Model selection (configurable, default: all use the same model)

### Context Management

Sessions accumulate context through:
1. Their initial CLAUDE.md prompt (role instructions)
2. Sequential prompts from the engine
3. Work performed (file reads/writes via Claude Code tools)

Context is ephemeral to the session. If a session is closed
and recreated, previous context is lost. The engine provides
summary context in subsequent prompts to compensate.

---

## Auto-Commits

The engine performs automatic git commits at safety
checkpoints during the standard pipeline:

| Checkpoint | Commit Message |
|-----------|---------------|
| After Work phase completes | `WIP: work phase complete` |
| After Security sweep passes | `WIP: security sweep passed` |
| Pipeline success | First 72 chars of task description |

The engine ensures the project is on a non-main branch
(`dev` created if needed) and adds `.claude-orchestra/` to
`.gitignore`.

---

## Feedback System

The pipeline supports two feedback patterns for dashboard
integration:

### Non-Blocking (Fire-and-Forget)

Notifications that don't pause the pipeline:
- Requirements gap warnings from Worker-2
- Security block notifications
- Revision/rejection notifications
- Completion summaries

### Blocking (Pause Until Response)

Questions that halt the pipeline until the user responds:
- Requirements approval before work begins
- Any decision that requires human input

---

## Multi-Team Coordination

Teams are fully isolated. There is no inter-team
communication. Each team:

- Has its own `.claude-orchestra/teams/{team-id}/` directory
  inside the target project
- Has its own agent sessions
- Has its own workflow phase state
- Operates on its own project path

The human orchestrator is the only entity with cross-team
visibility, provided by the dashboard.

Sequential teams on the same repo are supported. Parallel
teams on the same repo are not yet supported.
