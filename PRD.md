# ClaudeOrchestra — Product Requirements Document

## Executive Summary

ClaudeOrchestra is a deterministic multi-agent orchestration engine that governs autonomous AI code generation. It enables solo developers and small teams to build production code with multiple AI agents while maintaining security enforcement, requirements verification, code review gates, and real-time visibility across multiple projects.

The engine eliminates the need for a Supervisor LLM — code drives the pipeline deterministically: **Security Scan → Worker Implementation → Requirements Verification → Security Sweep → Code Review → Done**. Each phase has clear responsibilities, verdicts, and loop-back logic. A real-time browser dashboard at `localhost:3460` provides visibility and control.

**Tech stack**: TypeScript, Node.js 18+, `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`. Dashboard uses Node.js built-in `http` module (no Express, no React, no WebSocket). The active agent runtime is global: one running orchestrator process uses either Claude or Codex for all teams.

---

## Problem Statement

Developers trust AI coding agents such as Claude Code and Codex to write code but face critical gaps:

1. **No security enforcement** — AI agents can read/write anywhere, including `.env` files and sensitive modules
2. **No completeness verification** — No systematic way to ensure all requirements are actually implemented
3. **No quality gate** — Code ships without structured review
4. **No multi-project visibility** — Managing concurrent projects requires tab-switching and manual tracking

### Target User

- Solo developers or small team leads managing 2–5 projects concurrently
- Trust AI for code generation but demand safety and governance
- Use Claude Code, Codex, or both for interactive building
- Need to say "build this feature" and return to a reviewed, security-checked result

---

## Architecture

### Pipeline Topology (No Supervisor LLM)

The `PipelineOrchestrator` (in `src/pipeline-orchestrator.ts`) is pure TypeScript code — no LLM makes routing decisions. The orchestrator calls each agent's `AgentSession.send()` method sequentially, parses verdicts with regex, and drives transitions deterministically.

```
                  ┌──────────────┐
                  │  Reviewer-1  │
                  └──────┬───────┘
                         │
            ┌────────────┴────────────┐
            │   PIPELINE ORCHESTRATOR │  ← TypeScript code, not an LLM
            └──┬──────┬───────────┬───┘
               │      │           │
          ┌────┴──┐ ┌─┴────┐ ┌───┴──────┐
          │Worker │ │Worker│ │ Security │
          │  -1   │ │  -2  │ │   -1     │
          └───────┘ └──────┘ └──────────┘
```

### Agent Execution Model

Each runtime agent is a provider-backed `AgentSession` created through `src/agent-runtime/factory.ts`. The orchestrator does not call provider SDKs directly; it talks to the shared `AgentSession` interface and the provider adapters own SDK-specific behavior.

- **Global provider**: `agentRuntime.provider` is all-or-nothing for the current process: `claude` or `codex`. Teams do not mix providers.
- **Claude adapter**: `ClaudeAgentSession` wraps the Claude Agent SDK `query()` API with a `PromptChannel` async iterable for warm, streaming sessions.
- **Codex adapter**: `CodexAgentSession` wraps the Codex SDK/CLI thread API with `startThread()` and `runStreamed()`.
- **Role prompts**: runtime agents receive explicit prompts from `agents/*.agent.md`. They do not automatically inherit `AGENTS.md` or `CLAUDE.md`; shared project guidance must be added to role prompts deliberately if runtime agents need it.
- **Streaming progress**: adapters normalize provider events into dashboard progress messages and stream them via SSE.
- **Session reuse**: after pipeline completion, sessions stay alive for user Q&A via the "Ask" button when the provider session remains open.

Runtime options:
- `auth: "subscription"` means OAuth subscription credentials, not API-key billing.
- Claude subscription auth strips API-key/provider environment variables and passes `CLAUDECODE: undefined`.
- Codex subscription auth strips OpenAI API-key environment variables and forces ChatGPT login with `forced_login_method: "chatgpt"`.
- Codex uses read-only sandbox mode for roles whose disallowed tools include write/edit/bash capability; otherwise it uses workspace-write.
- Provider-specific effort names are translated at the adapter boundary in `src/agent-runtime/effort.ts`.

### Agent Roles, Defaults, And Provider Models

| Role | Instance(s) | Default Model Source | Default Effort | Default Max Turns | Disallowed Tools |
|------|-------------|----------------------|----------------|-------------------|------------------|
| Worker | Worker-1, Worker-2 | role prompt frontmatter for Claude; provider default for Codex unless `agentRuntime.model` is set | high | 50 | (none — full access) |
| Security | Security-1 | role prompt frontmatter for Claude; provider default for Codex unless `agentRuntime.model` is set | medium | 20 | Write, Edit, Bash |
| Reviewer | Reviewer-1 | role prompt frontmatter for Claude; provider default for Codex unless `agentRuntime.model` is set | medium | 20 | Write, Edit, Bash |
| Security Review | (on-demand) | same provider/model resolution as Security | high | 15 | Write, Edit, Bash |

`agentRuntime.model`, when set, is the global model override for every role. If omitted or set to `"default"`, the active provider chooses its default, except Claude can still use role prompt frontmatter/per-role `models` for tuning.

Effort names are provider-specific:
- Codex SDK/config accepts `minimal`, `low`, `medium`, `high`, and `xhigh`. The VS Code dropdown may only show Low, Medium, High, and Extra High; Extra High maps to `xhigh`.
- Claude Agent SDK uses `low`, `medium`, `high`, and `max`.
- Compatibility aliases are kept at the adapter boundary: `max` maps to Codex `xhigh`; `xhigh` maps to Claude Agent SDK `max`; Codex-only `minimal` maps to Claude Agent SDK `low`.

### Role Instance Types (from `src/roles/role-types.ts`)

```typescript
enum Role { Supervisor, Worker, Security, Reviewer }
type WorkerInstance = 'Worker-1' | 'Worker-2';
type SecurityInstance = 'Security-1';
type ReviewerInstance = 'Reviewer-1';
type SupervisorInstance = 'Supervisor-1';  // Not used in pipeline mode
```

---

## Pipeline Phases

### Phase Mapping

The internal `TeamPhase` enum uses legacy names that map to the dashboard's display names:

| TeamPhase (code) | Dashboard Display | Pipeline Step |
|---|---|---|
| `pre_work` | SCAN | Security Scan |
| `work` | BUILD | Worker-1 implements + Worker-2 verifies |
| `handoff` | SWEEP | Security Sweep |
| `review` | REVIEW | Reviewer evaluates |
| `done` | DONE | Pipeline complete |
| `errored` | ERRORED | Unrecoverable failure |
| `cancelled` | CANCELLED | User-cancelled |

### Step 0: Requirements Extraction (Pre-Pipeline)

Before the pipeline starts, a disposable provider-backed session extracts a numbered requirements checklist from the task description. This is shown to the user in a blocking feedback prompt with "Approve" / "Skip" buttons. Approved requirements become the verification target for Worker-2.

- Model: uses Worker model at `effort: 'low'`, `maxTurns: 1`
- System prompt: "You are a requirements analyst. Extract explicit requirements... Do NOT add requirements the user didn't ask for."
- Configurable: `skipRequirements: true` in config bypasses this step

### Step 1: Security Scan (Phase: `pre_work`)

**Agent**: Security-1 | **Prompt file**: `agents/security.agent.md`

The Security agent receives a `PRE-WORK SCAN REQUEST` with the task description, approved requirements, and project path. It must:

1. Run the 10-point security checklist (hardcoded secrets, injection, auth, data exposure, dependencies, path traversal, SSRF, crypto, prompt injection, supply chain)
2. Begin response with `CLASSIFICATION: SIMPLE|STANDARD|COMPLEX` — this can override the heuristic classifier
3. Produce a clearance report categorizing files as SAFE/CAUTION/OFF-LIMITS

**Classification Override Logic** (in `parseClassification()`):
- If Security says `SIMPLE`: orchestrator closes Worker-2, Reviewer, and Security sessions. Switches to simple pipeline (Worker-1 only).
- If Security says `COMPLEX`: sets `ctx.isComplex = true`, tells Reviewer to apply strict criteria.

**Verdict Parsing** (`parseSecurityVerdict()`):
- Checks if response starts with `APPROVED`, `FLAGGED`, or `BLOCKED`
- Defaults to `APPROVED` if no clear verdict prefix

### Step 2: Build — Worker-1 Implements + Worker-2 Verifies (Phase: `work`)

**Worker-1** receives: task description, approved requirements, security clearance report, revision feedback (if retry).
- Prompt file: `agents/worker.agent.md`
- Implements the full task within cleared boundaries
- Large outputs (>100 lines) must be written to files, not inline

**Worker-2** receives: original task, approved requirements, Worker-1's output summary (truncated to 3000 chars).
- Same prompt file but role-specific instructions in prompt
- Acts as engineering manager — verifies requirements only, does NOT write code
- Outputs a checklist: `- [x] Requirement — implemented` / `- [ ] Requirement — NOT implemented`
- Must begin verdict with `COMPLETE` or `GAPS_FOUND`

**Verification Loop** (max `MAX_VERIFY_PASSES = 2`):
1. Worker-2 checks → if `GAPS_FOUND`:
   - Extract unmet requirements (lines matching `- [ ]`)
   - Show in dashboard feedback as "Requirements Gap"
   - Send gaps to Worker-1 with instruction to fix only unchecked items
   - Worker-2 re-checks
2. After max passes, proceed regardless

**Verdict Parsing** (`parseVerifyVerdict()`):
- Checks for `GAPS_FOUND` / `COMPLETE` prefix
- Falls back to checklist analysis: unchecked `- [ ]` items → GAPS_FOUND
- Falls back to keyword patterns
- Defaults to `COMPLETE` if no gap signals found

**Auto-commit**: `GitOps.commit(cwd, 'WIP: work phase complete')` after BUILD phase.

### Step 3: Security Sweep (Phase: `handoff`)

**Agent**: Security-1 (same warm session)

Receives a `POST-WORK SWEEP REQUEST` with task, requirements, and Worker summaries. Must begin response with `APPROVED`, `FLAGGED`, or `BLOCKED`.

- **APPROVED/FLAGGED** → proceed to Review. Auto-commit: `'WIP: security sweep passed'`
- **BLOCKED** → backward transition to `work` phase. Increments `counters.revisions` and `counters.totalBackwardTransitions`. Checked against limits.

### Step 4: Code Review (Phase: `review`)

**Agent**: Reviewer-1 | **Prompt file**: `agents/reviewer.agent.md`

Receives task, requirements, Worker summaries. If `isComplex`, gets extra instruction for strict criteria. Must begin response with `APPROVED`, `REVISION_NEEDED`, or `REJECTED`.

**Verdict Parsing** (`parseReviewVerdict()`):
- Checks prefix first (strongest signal)
- Falls back to pattern scanning with 3 categories:
  - Reject patterns: `/\brejected?\b/i`, `/\bfundamentally\s+flawed\b/i`, etc.
  - Revision patterns: `/\brevision\s*(needed|required)\b/i`, `/\bneeds?\s+(revision|fix)/i`, etc.
  - Approve patterns: `/\bapproved?\b/i`, `/\blooks?\s+good\b/i`, `/\bready\s+(to\s+)?(merge|ship)/i`, etc.
- Cross-checks: approve only if no conflicting revision/reject signals
- **Default**: `REVISION_NEEDED` (errs on side of caution when ambiguous)

**Loop-Back Rules**:
- `APPROVED` → Phase: `done` (break both loops)
- `REVISION_NEEDED` → Phase: `work` (inner loop continues)
- `REJECTED` → Phase: `pre_work` (outer loop restarts from scan)

### Loop Limits (from `TeamState`)

| Limit | Default | Transition Type |
|---|---|---|
| `maxRevisions` | 3 | `handoff→work`, `review→work` |
| `maxRejections` | 2 | `review→pre_work` |
| `maxTotalBackwardTransitions` | 5 | Sum of all backward transitions |

When exceeded: `TeamPhase` transitions to `errored`, throws `TransitionError`, escalates to human.

### Simple Pipeline

For tasks classified as `simple` by either the heuristic classifier or Security-1:
1. Worker-1 implements → Done
2. No scan, no verification, no sweep, no review

**Heuristic classifier** (`src/router/complexity-router.ts`):
- `simple` if: ≤20 words AND no complexity keywords (test, refactor, api, database, security, etc.)
- `standard` otherwise

### Pipeline Completion

On success:
1. Final auto-commit with task description (truncated to 72 chars)
2. Transition to `done` phase
3. Emit `task-complete` event with duration
4. Dashboard shows "Push & Merge to Main" button
5. Sessions stay alive for Q&A

On failure:
1. Close all sessions
2. Transition to `errored` phase
3. Emit error + task-complete events

---

## State Machine

### Valid Phase Transitions (from `src/state/team-state.ts`)

```
pre_work → work, errored, cancelled
work     → handoff, done, errored, cancelled
handoff  → review, work, errored, cancelled
review   → done, work, pre_work, errored, cancelled
done     → pre_work  (re-launch)
errored  → pre_work, cancelled
cancelled → (terminal — no transitions)
```

### Agent State Transitions

```
spawning → active, errored
active   → idle, blocked, waiting, done, errored
idle     → active, errored
blocked  → active, errored
waiting  → active, errored
done     → active, idle
errored  → spawning
```

### TeamState Data Structure

```typescript
interface TeamStateData {
  teamId: string;
  teamName: string;
  projectPath: string;
  currentPhase: TeamPhase;
  agents: Record<RoleInstance, AgentStatus>;  // 5 agents (including unused Supervisor-1)
  currentTask: {
    description: string;
    assignedAt: string;
    complexity?: 'simple' | 'standard' | 'complex';
    requirements?: string;  // Approved requirements checklist
  } | null;
  counters: {
    revisions: number;
    rejections: number;
    totalBackwardTransitions: number;
  };
  createdAt: string;
  updatedAt: string;
}
```

---

## Agent Communication

### Agent Runtime (`src/agent-runtime/`)

The pipeline runtime uses provider adapters behind a shared `AgentSession` interface:

1. **Claude mode**: `ClaudeAgentSession` uses `PromptChannel` -> Claude Agent SDK `query()` with streaming.
2. **Codex mode**: `CodexAgentSession` uses Codex SDK/CLI threads and streamed turn events.
3. **Testing**: Vitest mocks SDK behavior so pipeline tests do not call real providers.

`src/spawner/agent-process.ts` is retained from the original architecture as a dual-mode wrapper for older spawning flows and tests, but the pipeline orchestrator now creates runtime sessions through `src/agent-runtime/factory.ts`.

Key features:
- **"Last message wins"**: In SDK mode, messages are buffered per turn. Within a decision category (e.g., review verdicts), only the last message is authoritative. This handles LLM deliberation — if an agent sends `review-rejected` then changes its mind to `review-approved`, only the approval is emitted.
- **MESSAGE_START/END delimiters**: `---ORCHESTRA-MESSAGE-START---` / `---ORCHESTRA-MESSAGE-END---` protocol for extracting structured messages from agent output.

---

## Dashboard

### Server (`src/dashboard/dashboard-server.ts`)

Built-in Node.js `http` server. No Express, no frameworks.

**REST API endpoints**:

| Method | Path | Handler |
|---|---|---|
| GET | `/` | Serve dashboard HTML (cached in memory) |
| GET | `/events` | SSE event stream |
| GET | `/api/teams` | List all teams |
| GET | `/api/teams/:id` | Get team status |
| GET | `/api/registry` | Get registry entries |
| POST | `/api/teams` | Create team (body: `{ name, projectPath, task?, images? }`) |
| POST | `/api/teams/:id/task` | Assign task (body: `{ description, images? }`) |
| POST | `/api/teams/:id/stop` | Terminate team |
| POST | `/api/teams/:id/push-merge` | Git push & merge to main |
| POST | `/api/teams/:id/feedback` | Respond to blocking feedback (body: `{ feedbackId, value }`) |
| POST | `/api/teams/:id/ask` | Ask a question to warm agent session (body: `{ message, images? }`) |
| POST | `/api/teams/:id/security-review` | Run final security review |
| GET | `/preview/:id` | Auto-redirect to newest HTML file in project |
| GET | `/preview/:id?browse` | File browser for project HTML files |
| GET | `/preview/:id/:file` | Serve specific file from project (path traversal protected) |
| POST | `/api/pick-directory` | Native OS directory picker (macOS Finder dialog) |

**SSE Events** (13 event types):

| Event | Payload |
|---|---|
| `init` | `{ teams: TeamStateData[] }` — full state dump on connect |
| `team-created` | `{ teamId, team }` |
| `task-assigned` | `{ teamId, description, timestamp }` |
| `task-classified` | `{ teamId, complexity, agentCount }` |
| `phase-transition` | `{ teamId, from, to, trigger, timestamp }` |
| `agent-output` | `{ teamId, instance, text }` — final output per agent |
| `agent-progress` | `{ teamId, instance, text }` — streaming tool activity (throttled 500ms) |
| `agent-task` | `{ teamId, instance, subtask }` — current subtask label |
| `task-complete` | `{ teamId, phase, durationMs }` |
| `error` | `{ teamId, message }` |
| `feedback` | `{ teamId, id, type, title, message, blocking?, actions? }` |
| `security-review` | `{ teamId, status, result? }` |
| `shutdown` | `{}` |

### UI (`src/dashboard/dashboard-ui.ts` — ~2,619 lines)

Single-file HTML/CSS/JS generated by `buildDashboardHTML()`. Dark theme (GitHub dark style).

**Layout**:
- **Left sidebar**: Team list grouped by project. Badges show phase (SCAN/BUILD/DONE/etc.)
- **Main content**: Phase progress bar (5 steps with checkmarks), task description, agent cards, controls
- **Side panel**: Expandable feedback/notification panel

**Agent Cards** (4 cards: Security-1, Worker-1, Worker-2, Reviewer-1):
- Role-colored indicators (red, green, green, yellow)
- Status: IDLE → Working → REVIEWING → DONE → SKIPPED
- Progress bar (0–100%) based on streaming text length
- Click to navigate to detail view with full agent output
- During security review: Security-1 card shows "REVIEWING" with live progress

**Controls Bar**:
- Stop button (always visible)
- "Final Security Review" button (visible when phase=done) — runs `runSecurityReview()`, shows results in detail modal with "Re-run Review" option
- "Push & Merge to Main" button (visible when phase=done)
- "Preview" button (visible when phase=done)
- "Next Task or Ask" textarea with image attachment support (drag, paste, file picker)
- "Run Task" button (launches new pipeline) + "Ask" button (sends Q&A to warm session)

**Modals**:
- New Team modal: name, project path, task description, image attachments
- Detail modal: shows security review results, feedback details (with optional action buttons)

**Feedback System**:
- Non-blocking: color-coded notifications (info=blue, warning=yellow, question=purple, decision=cyan)
- Blocking: auto-opens side panel, pauses pipeline until user responds (e.g., requirements approval)
- Highlight terms: specific keywords get colored badges (e.g., "blocked", "vulnerability")

**Timer**: Live elapsed timer that starts on task-assigned, stops on task-complete, restarts during security review.

**Keyboard shortcuts**: Escape closes modals, side panel toggleable.

---

## Data Architecture

### Runtime Data Locality

```
Engine repo (2026_ClaudeOrchestra/)
├── registry.json              ← Pointers to active teams (only file that changes)
├── logs/
│   ├── orchestra.log          ← Main log (10MB rotation)
│   ├── orchestra.error.log    ← Error log (5MB rotation)
│   └── teams/{teamId}/
│       └── team.log           ← Per-team log
└── src/, agents/, tests/...   ← Source code (clean)

Target project repos (e.g., /Users/me/my-app/)
├── .claude-orchestra/         ← Auto-gitignored
│   └── teams/{teamId}/
│       └── state.json         ← TeamState (debounced writes, forced on phase transitions)
└── (project files)
```

### Registry (`src/registry.ts`)

Lightweight JSON file in engine repo root. Contains team name, project path, timestamps. Used for recovery on engine restart. Atomic writes via temp-file + rename.

### State Persistence (`src/state/persistence.ts`)

- Debounced writes: at most once per 1000ms
- Phase transitions force immediate write
- Atomic writes via temp-file + `fs.renameSync()`
- Supports `loadFromDir()` for recovery before team registration
- `dispose()` clears all timers on shutdown

---

## Git Operations (`src/git.ts`)

Two tiers:

**Automatic (engine-controlled)**:
- `GitOps.commit()` — safety checkpoints at phase boundaries (`git add -A` + commit). Only if changes exist.
- `ensureDevBranch()` — if on `main`, checks out or creates `dev` branch
- `ensureGitignore()` — adds `.claude-orchestra/` to project's `.gitignore`

**User-initiated (dashboard button)**:
- `GitOps.pushAndMerge()` — full workflow:
  1. `git push origin dev`
  2. `git checkout main && git pull origin main`
  3. `git merge dev`
  4. `git push origin main`
  5. `git checkout dev`
- Merge failure: aborts merge, returns to dev
- Push failure: returns to dev with error

All git commands have 30-second timeout.

---

## Agent Prompt Files

### `agents/worker.agent.md`
- Worker-1: implements code, fixes gaps from Worker-2
- Worker-2: requirements verifier only, never modifies code
- Decision Transparency: must explain reasoning for every choice
- Constraints: respect clearance boundaries, don't touch off-limits files

### `agents/security.agent.md`
- 10-point security checklist
- Pre-scan: must output `CLASSIFICATION: SIMPLE|STANDARD|COMPLEX`
- Post-sweep: must begin with `APPROVED|FLAGGED|BLOCKED`
- "Be fast. Do NOT read every line — scan for patterns."
- Does NOT evaluate code quality

### `agents/reviewer.agent.md`
- "Rapid quality gate" — spot-check 2-3 key files
- Must begin with `APPROVED|REVISION_NEEDED|REJECTED`
- "Default to APPROVED if the work reasonably addresses the task"
- Does NOT evaluate security

### `agents/security-review.agent.md`
- Final security review (user-initiated, post-completion)
- Thorough (unlike scan/sweep which are fast)
- Analyzes `git diff main...HEAD`
- Outputs `PASSED` or `CONCERNS` with detailed findings

---

## Logging (`src/logger/logger.ts`)

Dual output: colored terminal + JSON log files.

**19 structured event types**: team_created, task_assigned, task_classified, task_complete, agent_spawned, agent_errored, agent_respawned, message_sent, message_received, message_malformed, phase_transition, timeout_warning, timeout_exceeded, deadlock_detected, loop_limit_reached, shutdown_initiated, health_check_failed, validation_error, agent_output.

**Log levels**: DEBUG, INFO, WARN, ERROR (configurable via `CLAUDE_ORCHESTRA_LOG_LEVEL` env var).

**Role-colored terminal output**: Supervisor=blue, Worker=green, Security=red, Reviewer=yellow. Phase-colored transitions. Decision messages (verdicts) promoted to INFO with content preview.

**File rotation**: Main log at 10MB, error log at 5MB. Single-file rotation (.log → .log.1).

**Orchestrator integration**: `logger.attach(orchestrator)` wires all 15 orchestrator events to structured log output.

---

## CLI Entry Point (`src/index.ts`)

Commands:
- `dashboard` — Start HTTP server + SSE at port 3460 (default). Auto-opens browser. Recovers teams from registry.
- `create-team <name> <project-path>` — Create team, show status
- `assign-task <team-id> <description>` — Recover teams, start pipeline, auto-exit on completion
- `status <team-id>` — Show team status with agent details
- `list` — Show all teams with phase badges
- `recover` — Recover teams from persisted state, start engine

**Config file selection priority**: `--config <path>` > `CLAUDE_ORCHESTRA_CONFIG` env var > `./orchestra.config.json`.

**Config value priority**: CLI flags > selected config file > defaults.

**Signal handling**: SIGTERM/SIGINT → graceful shutdown (close dashboard, close sessions, persist state). Second signal → force kill all.

---

## Configuration

### `orchestra.config.json` (all fields optional)

```json
{
  "agentRuntime": {
    "provider": "codex",
    "auth": "subscription",
    "model": "gpt-5.5"
  },
  "engine": {
    "registryPath": "./registry.json",
    "logDirectory": "./logs",
    "rolesDir": "./agents"
  },
  "skipRequirements": false,
  "teams": { "maxConcurrentTeams": 5 },
  "limits": {
    "maxRevisions": 3,
    "maxRejections": 2,
    "maxTotalBackwardTransitions": 5
  },
  "efforts": {
    "Worker": "xhigh",
    "Security": "high",
    "Reviewer": "high"
  },
  "disallowedTools": {
    "Security": ["Write", "Edit", "Bash"],
    "Reviewer": ["Write", "Edit", "Bash"]
  },
  "maxTurns": {
    "Worker": 50,
    "Security": 20,
    "Reviewer": 20
  }
}
```

Use `agentRuntime.provider: "claude"` with a Claude model when running through Claude Agent SDK:

```json
{
  "agentRuntime": {
    "provider": "claude",
    "auth": "subscription",
    "model": "claude-opus-4-6"
  },
  "efforts": {
    "Worker": "max",
    "Security": "low",
    "Reviewer": "medium"
  }
}
```

The optional per-role `models` block remains available for Claude tuning. For all-or-nothing provider switching, prefer `agentRuntime.model` as the single global model override.

### CLI Flags

```
--port <n>              Dashboard port (default: 3460)
--registry <path>       Registry file path
--config <path>         Config file path
--max-teams <n>         Max concurrent teams
--provider <name>       Agent provider: claude or codex
--auth <mode>           Auth mode: subscription
--model <id>            Global model override (e.g. gpt-5.5, default)
--model-worker <id>     Model for Worker agents
--model-security <id>   Model for Security agent
--model-reviewer <id>   Model for Reviewer agent
```

---

## Testing

**233 tests across 10 test files** — all passing.

| Test File | What It Covers |
|---|---|
| `complexity-router.test.ts` | Keyword detection, word count threshold, simple vs standard classification |
| `agent-runtime.test.ts` | Provider-specific effort mapping and compatibility aliases |
| `config.test.ts` | Config loading, CLI override priority, runtime knob pass-through |
| `dashboard-server.test.ts` | HTTP routes, SSE streaming, team CRUD, task assignment, push-merge |
| `git.test.ts` | Commit, push, merge, pushAndMerge workflow, branch checkout, merge failure recovery |
| `hooks.test.ts` | Governance hooks, type-check hook behavior, safe handling of tool input |
| `logger.test.ts` | Structured logging, terminal output, file output, rotation |
| `pipeline-orchestrator.test.ts` | Full pipeline (scan→build→verify→sweep→review→done), security BLOCKED loops, revision loops, rejection loops, loop limit enforcement, simple pipeline, reclassification, requirements extraction |
| `registry.test.ts` | CRUD operations, atomic writes, duplicate handling |
| `team-state.test.ts` | Phase transitions (valid/invalid), agent state transitions, loop counters, limits |

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

---

## File Structure

```
2026_ClaudeOrchestra/
├── AGENTS.md                             # Shared coding-agent guidance for Codex and Claude Code
├── CLAUDE.md                             # Claude Code wrapper that imports AGENTS.md
├── src/
│   ├── index.ts                          # CLI entry point
│   ├── config.ts                         # Config loading, config-path priority,
│   │                                     #   CLI override merging, pass-through tests
│   ├── pipeline-orchestrator.ts          # Core engine: verdict parsers, pipeline loops,
│   │                                     #   feedback, Q&A, provider session creation
│   ├── git.ts                            # Git commit, push, merge operations (163 lines)
│   ├── registry.ts                       # Registry.json management (102 lines)
│   │
│   ├── agent-runtime/
│   │   ├── types.ts                      # Provider-agnostic AgentSession interface
│   │   ├── auth.ts                       # Runtime config + subscription env guards
│   │   ├── effort.ts                     # Provider-specific effort mapping
│   │   ├── factory.ts                    # Provider adapter factory
│   │   ├── claude-session.ts             # Claude Agent SDK adapter
│   │   └── codex-session.ts              # Codex SDK adapter
│   │
│   ├── spawner/
│   │   ├── agent-process.ts              # Legacy Claude-only SDK/child-process wrapper
│   │   ├── agent-spawner.ts              # Legacy Claude-only team lifecycle path
│   │   └── frontmatter-parser.ts         # YAML frontmatter parser for role prompts
│   │
│   ├── router/
│   │   └── complexity-router.ts          # Heuristic task classifier (54 lines)
│   │
│   ├── state/
│   │   ├── team-state.ts                 # TeamState: transitions, counters, limits (380 lines)
│   │   └── persistence.ts                # Debounced filesystem persistence (170 lines)
│   │
│   ├── dashboard/
│   │   ├── dashboard-server.ts           # HTTP + SSE server (595 lines)
│   │   ├── dashboard-ui.ts              # Full SPA: HTML/CSS/JS (2,619 lines)
│   │   └── index.ts                      # Module exports (3 lines)
│   │
│   ├── logger/
│   │   └── logger.ts                     # Structured logging with rotation (550 lines)
│   │
│   ├── roles/
│   │   └── role-types.ts                 # Role enum, instances, JTBD types (44 lines)
│   │
│   └── types/
│       └── index.ts                      # Phase, Priority, MessageStatus, AgentState enums (45 lines)
│
├── agents/                               # Agent system prompts (YAML frontmatter + markdown)
│   ├── worker.agent.md                  # Worker-1 (implement) + Worker-2 (verify)
│   ├── security.agent.md                # Security scan + sweep (10-point checklist)
│   ├── reviewer.agent.md                # Code review verdicts
│   └── security-review.agent.md         # Final comprehensive security review (on-demand)
│
├── tests/                                # 233 tests across 10 files
│   ├── mocks/mock-sdk.ts
│   └── *.test.ts
│
├── docs/                                 # Design documents
│   ├── architecture.md
│   ├── architecture-decisions/           # ADRs and reference implementations
│   ├── state-machine.md
│   ├── roles-and-jtbd.md
│   ├── context-management.md
│   └── operations.md
│
├── package.json                          # deps: Claude Agent SDK and Codex SDK
├── tsconfig.json
├── vitest.config.ts
└── implementation-plan.md                # 8-milestone build plan
```

**Total**: production TypeScript plus a single-file dashboard UI.

---

## Key Design Decisions

### Why Code-Driven Pipeline Over LLM Supervisor?
The original architecture used a Supervisor LLM to route messages between agents. This was replaced by the PipelineOrchestrator because:
- **Deterministic**: Code always runs Security→Build→Sweep→Review. No LLM routing hallucinations.
- **Cheaper**: One fewer LLM call per phase. Supervisor's 30 max turns × 4 phases = eliminated.
- **Faster**: No cold start for routing decisions. No prompt parsing for delegation.
- **Debuggable**: `console.log` in TypeScript vs. hoping the LLM explains itself.

### Why `AgentSession.send()` Over Message Bus?
The message bus (filesystem JSON files) was built for the Supervisor architecture where agents communicated asynchronously. Pipeline mode uses synchronous `await session.send()` because:
- Pipeline is sequential — no concurrent agent communication needed
- `send()` returns the full response, making verdict parsing trivial
- Warm sessions avoid cold-start overhead between phases

### Why Minimal Dependencies?
Production dependencies are limited to the provider SDKs: `@anthropic-ai/claude-agent-sdk` and `@openai/codex-sdk`. Dashboard uses Node.js `http` module. No Express, no React, no WebSocket libraries. This means:
- Minimal attack surface
- Lower supply chain risk
- No dependency version conflicts
- Fast `npm install`

### Why Provider Adapters?
Claude Agent SDK and Codex SDK expose different APIs (`query()` vs. Codex threads) and different effort names (`max` vs. `xhigh`). The orchestrator stays clean by depending only on `AgentSession`; SDK-specific code, auth guards, and effort mapping live under `src/agent-runtime/`.

### Why Runtime Data in Target Projects?
`.claude-orchestra/` lives in the target project (auto-gitignored), not in the engine repo. This means:
- Engine repo stays clean — only source code + registry.json
- Multiple projects don't pollute each other
- Recovery: engine reads registry → finds project paths → reads state.json from each project

---

## Non-Goals

1. **Project creation** — ClaudeOrchestra attaches to existing local repos. Users create repos first.
2. **CI/CD integration** — Human-driven tool, not an automated pipeline stage.
3. **Distributed execution** — Single orchestrator process, one machine.
4. **Custom agent topologies** — Fixed 4-agent layout per team (Worker×2, Security, Reviewer).
5. **Mixed providers in one run** — A process is globally all Claude or all Codex. Teams do not choose different providers.
6. **Inter-team coordination** — Teams are isolated. Sequential teams on same repo only.

---

## Future Roadmap

- **Tunnel support** (`--tunnel` flag): Expose dashboard via cloudflared/ngrok for phone access. ~20 lines, no dashboard changes.
- **Multi-team coordination**: Parallel teams on same repo with resource fairness.
- **Custom roles**: Extensible agent pool beyond fixed 4.
- **Webhook integration**: External notifications (Slack, email).
- **Programmatic API**: REST endpoints for external tool management.

---

## Glossary

| Term | Definition |
|---|---|
| **Agent Runtime** | The active provider layer, either Claude or Codex, configured globally through `agentRuntime.provider`. |
| **AgentSession** | Provider-agnostic wrapper around a warm runtime session. Claude uses `query()`; Codex uses SDK/CLI threads. |
| **PromptChannel** | Claude adapter async iterable that bridges sync `push()` to the Claude SDK's streaming API. Supports text + base64 images. |
| **Provider Adapter** | Runtime module under `src/agent-runtime/` that translates orchestration calls into Claude SDK or Codex SDK behavior. |
| **Pipeline** | The deterministic sequence: Scan → Build → Sweep → Review → Done. |
| **Team** | A set of 4 agent sessions + orchestrator context attached to one project. |
| **Phase** | A workflow stage (pre_work, work, handoff, review, done, errored, cancelled). |
| **Verdict** | An agent's structured assessment. Security: APPROVED/FLAGGED/BLOCKED. Review: APPROVED/REVISION_NEEDED/REJECTED. Verify: COMPLETE/GAPS_FOUND. |
| **Gap** | A requirement from the task that Worker-1 didn't implement, detected by Worker-2. |
| **Clearance** | Security agent's file categorization: SAFE (modify freely), CAUTION (document changes), OFF-LIMITS (don't touch). |
| **Classification** | Security's task complexity assessment: SIMPLE/STANDARD/COMPLEX. Can override heuristic classifier. |
| **Sweep** | Post-work security re-scan for introduced vulnerabilities. |
| **Loop** | A backward phase transition (e.g., review→work for revision, review→pre_work for rejection). |
| **Backward transition** | Any transition that moves to an earlier phase. Counted against configurable limits. |
| **Registry** | `registry.json` — lightweight index of all active teams across projects. |
| **SSE** | Server-Sent Events — one-way server→client push for real-time dashboard updates. |
| **Warm session** | An AgentSession whose `query()` is already running. Subsequent `send()` calls avoid the ~12s cold start. |
| **"Last message wins"** | In AgentProcess: when an agent sends contradictory messages in the same turn, only the last one counts. |
