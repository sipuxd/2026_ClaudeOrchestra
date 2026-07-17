# ClaudeOrchestra — Product Requirements Document

## Executive Summary

ClaudeOrchestra is a deterministic multi-agent orchestration engine that governs autonomous AI code generation. It enables solo developers and small teams to ship production code with multiple AI agents while maintaining security enforcement, requirements verification, code review gates, and real-time visibility across multiple projects.

The engine eliminates the need for a Supervisor LLM — TypeScript code drives the pipeline deterministically: **Security Scan → Worker Implementation → Requirements Verification → Security Sweep → Code Review → Done**. Each phase has clear responsibilities, verdicts, and loop-back logic.

The dashboard at `localhost:3460` provides real-time visibility and control. Each team has a persistent **Coordinator-1 chat panel** that is the primary entry point — typing "build me X" kicks off a new pipeline run. The portfolio view groups teams by project. The Code tab embeds a project-local code-server. Per-project **Run / Open / Stop** buttons spawn the project's real dev server (Storybook, Vite, Next, etc.) and open it in a browser tab.

**Tech stack**: TypeScript, Node.js 18+, `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`. The dashboard uses the Node.js built-in `http` module (no Express, no React, no WebSocket libraries). The active agent runtime is global per orchestrator process: all teams use either Claude or Codex.

---

## Problem Statement

Developers trust AI coding agents (Claude Code, Codex) to write code but face four gaps:

1. **No security enforcement** — agents can read/write anywhere, including `.env` and sensitive modules.
2. **No completeness verification** — no systematic way to ensure every requirement is actually implemented.
3. **No quality gate** — code ships without structured review.
4. **No multi-project visibility** — managing concurrent projects requires tab-switching and manual tracking.

### Target User

- Solo developers or small team leads managing 2–5 projects concurrently.
- Trust AI for code generation but demand safety and governance.
- Use Claude Code, Codex, or both for interactive building.
- Want to say "build this feature" and return to a reviewed, security-checked result.

---

## Architecture

### Pipeline Topology (no Supervisor LLM)

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

      ┌──────────────────┐
      │  Coordinator-1   │  ← Persistent chat panel per team
      └──────────────────┘    Triggers pipeline via TRIGGER_PIPELINE verdict
```

### Agent Execution Model

Each runtime agent is a provider-backed `AgentSession` created through `src/agent-runtime/factory.ts`. The orchestrator does not call provider SDKs directly; it talks to the shared `AgentSession` interface and the provider adapters own SDK-specific behaviour.

- **Global provider**: `agentRuntime.provider` is all-or-nothing for the current process: `claude` or `codex`. Teams do not mix providers.
- **Claude adapter**: `ClaudeAgentSession` wraps the Claude Agent SDK `query()` API with a `PromptChannel` async iterable for warm, streaming sessions.
- **Codex adapter**: `CodexAgentSession` wraps the Codex SDK/CLI thread API via `startThread()` and `runStreamed()`.
- **Role prompts**: runtime agents receive explicit prompts from `agents/*.agent.md`. They do not automatically inherit `AGENTS.md` or `CLAUDE.md`; shared project guidance must be added to role prompts deliberately if needed.
- **Streaming progress**: adapters normalize provider events into dashboard progress messages and stream them via SSE.
- **Session reuse**: after pipeline completion, all four sessions stay alive so the user can Steer follow-up questions to the last working agent (typically Reviewer-1 in a standard pipeline, Worker-1 in a simple one).

Runtime options:
- `auth: "subscription"` means OAuth subscription credentials, not API-key billing.
- Claude subscription auth strips API-key/provider environment variables and passes `CLAUDECODE: undefined`.
- Codex subscription auth strips OpenAI API-key environment variables and forces ChatGPT login with `forced_login_method: "chatgpt"`.
- Codex uses read-only sandbox mode for roles whose disallowed tools include write/edit/bash; otherwise it uses workspace-write.
- Provider-specific effort names are translated at the adapter boundary in `src/agent-runtime/effort.ts`.

### Agent Roles, Defaults, and Provider Models

| Role | Instance(s) | Default Model Source | Default Effort | Default Max Turns | Disallowed Tools |
|------|-------------|----------------------|----------------|-------------------|------------------|
| Worker | Worker-1, Worker-2 | role prompt frontmatter (Claude) / provider default (Codex) | high | 50 | (none — full access) |
| Security | Security-1 | role prompt frontmatter (Claude) / provider default (Codex) | medium | 20 | Write, Edit, Bash |
| Reviewer | Reviewer-1 | role prompt frontmatter (Claude) / provider default (Codex) | medium | 20 | Write, Edit, Bash |
| Coordinator | Coordinator-1 | role prompt frontmatter (Claude) / provider default (Codex) | medium | 100 | Write, Edit, Bash, NotebookEdit |
| Security Review | (on-demand) | same as Security | high | 15 | Write, Edit, Bash |

`agentRuntime.model`, when set, is the global model override for every role. If omitted or set to `"default"`, the active provider chooses its default, except Claude can still use role-prompt frontmatter / per-role `models` for tuning.

Effort names are provider-specific:
- Codex SDK/config accepts `minimal`, `low`, `medium`, `high`, and `xhigh`. The VS Code Codex dropdown may show Low, Medium, High, and Extra High; Extra High maps to `xhigh`.
- Claude Agent SDK uses `low`, `medium`, `high`, and `max`.
- Compatibility aliases live at the adapter boundary: `max` maps to Codex `xhigh`; `xhigh` maps to Claude `max`; Codex-only `minimal` maps to Claude `low`.

### Role Instance Types (`src/roles/role-types.ts`)

```typescript
enum Role { Worker, Security, Reviewer, Coordinator }

type WorkerInstance      = 'Worker-1' | 'Worker-2';
type SecurityInstance    = 'Security-1';
type ReviewerInstance    = 'Reviewer-1';
type CoordinatorInstance = 'Coordinator-1';

type RoleInstance =
  | WorkerInstance
  | SecurityInstance
  | ReviewerInstance
  | CoordinatorInstance;
```

---

## Pipeline Phases

The deterministic pipeline drives one team's task through these phases:

| Phase | Agent | Verdict | Loop-back |
|---|---|---|---|
| `pre-work` (Security Scan) | Security-1 | `CLASSIFICATION: SIMPLE\|STANDARD\|COMPLEX` | — |
| `work` (Build) | Worker-1 (implement) → Worker-2 (verify) | Worker-2: `COMPLETE` or `GAPS_FOUND` | Gaps → Worker-1 (re-implement) |
| `handoff` (Security Sweep) | Security-1 | `APPROVED \| FLAGGED \| BLOCKED` | BLOCKED → `work` (re-implement with constraints) |
| `review` (Code Review) | Reviewer-1 | `APPROVED \| REVISION_NEEDED \| REJECTED` | REVISION_NEEDED → `work`, REJECTED → `pre-work` |
| `done` | — | — | — |

**Simple pipeline shortcut**: when Security-1's pre-scan classifies the task as `SIMPLE`, only Worker-1 runs. Worker-2 / Sweep / Review are skipped.

**Loop limits** (configurable, defaults below) bound the maximum churn:
- `maxRevisions: 3` — review → work transitions per pipeline run.
- `maxRejections: 2` — review → pre-work transitions per pipeline run.
- `maxTotalBackwardTransitions: 5` — combined upper bound across all backward transitions.

When a limit is exceeded, the team transitions to `errored`.

---

## State Machine (`src/state/team-state.ts`)

`TeamState` is the per-team state object — phase, agent statuses, current task, history, counters.

**Forward transitions**: `pre-work → work → handoff → review → done` (or `done` straight from `work` in simple mode).

**Backward transitions** (counted against limits): `review → work` (revision), `review → pre-work` (rejection), `handoff → work` (security BLOCKED).

**Terminal phases**: `done`, `cancelled`, `errored`, plus dashboard-derived `pr_open` and `merged` (when a PR has been opened or merged).

**Agent states** (`AgentState` enum at `src/types/index.ts`): `spawning | active | idle | blocked | waiting | done | errored`. Exactly one pipeline instance is `active` at a time given the deterministic sequential pipeline; the rest are `waiting`, `done`, or `errored`.

**Persistence** (`src/state/persistence.ts`):
- Debounced writes: at most once per 1000ms.
- Phase transitions force an immediate write.
- Atomic writes via tmp-file + `fs.renameSync()`.
- `loadFromDir()` supports recovery before team registration.
- `dispose()` clears all timers on shutdown.

---

## Coordinator-1 Chat (per-team chat panel)

Each team has a persistent chat panel in the dashboard backed by a long-running `Coordinator-1` session. The chat is the team's primary entry point — your first message becomes the team's task. Coordinator-1 emits one of three structured verdicts on every turn:

- `RESPONDING` — direct reply (questions, explanations, status).
- `ASKING` — clarification question to the user.
- `TRIGGER_PIPELINE` — body becomes a fresh `assignTask` call, kicking off Security-1 → Worker-1/2 → Reviewer-1.

Verdict parsing is fail-loud (mirrors the existing pipeline gates): malformed responses retry once, then surface an error in the chat. Chat history persists to `<projectPath>/.claude-orchestra/teams/<teamId>/chat.jsonl` (append-only, line-delimited JSON). The coordinator session is lazy-spawned on first message, kept alive across pipeline runs, and closed on team termination.

**Cancel**: a `×` button next to Send aborts an in-flight coordinator turn via `AbortController` raced against `send()`. The `chat-cancelled` SSE event clears the pending state on the dashboard. Cancellation only affects the coordinator turn — if `TRIGGER_PIPELINE` had already fired, the resulting pipeline runs to completion independently.

**Steer** (post-completion follow-ups): when a team's pipeline is finished, a **Steer `<instance>`** button appears in the team panel (e.g., `Steer Reviewer-1` for a standard pipeline, `Steer Worker-1` for a simple one). The label names the specific session that will receive the message; routing uses the `targetInstance` parameter through `/api/teams/:id/ask` so the message lands exactly where the label says.

---

## Dashboard

### Server (`src/dashboard/dashboard-server.ts`)

Built-in Node.js `http` server. No Express, no frameworks. Auto-starts with the engine.

#### REST API

| Method | Path | Purpose |
|---|---|---|
| GET    | `/` | Serve dashboard HTML (cached in memory) |
| GET    | `/events` | SSE event stream |
| GET    | `/api/teams` | List all teams (enriched with derived fields) |
| GET    | `/api/teams/:id` | Get a single team's status |
| GET    | `/api/runtime` | Current agent runtime config |
| GET    | `/api/registry` | Raw registry entries |
| POST   | `/api/teams` | Create a team `{ name, projectPath, task?, images? }` |
| POST   | `/api/teams/:id/task` | Assign a task `{ description, images? }` (also called internally by Coordinator-1's `TRIGGER_PIPELINE`) |
| POST   | `/api/teams/:id/stop` | Terminate a team |
| POST   | `/api/teams/:id/create-pr` | Push team branch + open GitHub PR via `gh` |
| POST   | `/api/teams/:id/feedback` | Respond to a blocking feedback request `{ feedbackId, value }` |
| POST   | `/api/teams/:id/ask` | Steer message to active agent `{ message, targetInstance?, images? }` |
| GET    | `/api/teams/:id/chat` | Full chat history for a team |
| POST   | `/api/teams/:id/chat` | Send chat message to Coordinator-1 `{ message }` |
| POST   | `/api/teams/:id/chat/cancel` | Abort in-flight coordinator turn |
| POST   | `/api/teams/:id/security-review` | Run on-demand final security review |
| GET    | `/api/portfolio` | List portfolio projects |
| POST   | `/api/portfolio` | Add project `{ projectPath, displayName? }` |
| DELETE | `/api/portfolio/:projectPath` | Remove project (blocked if any team exists for it) |
| POST   | `/api/projects/clear-done` | Bulk-terminate all done/cancelled/errored teams for one project |
| POST   | `/api/projects/run` | Spawn dev server for a project `{ projectPath }` |
| POST   | `/api/projects/stop` | Stop the running dev server for a project |
| GET    | `/api/projects/run/status?projectPath=…` | Current runner status |
| GET    | `/api/code-server/status` | Embedded code-server status |
| POST   | `/api/code-server/start` | Lazy-spawn code-server |
| POST   | `/api/pick-directory` | Open native macOS NSOpenPanel folder picker (returns selected path) |
| GET    | `/preview/:id` | Legacy static-HTML auto-redirect to newest `.html` in project root |
| GET    | `/preview/:id?browse` | Legacy static-HTML file browser |
| GET    | `/preview/:id/:file` | Serve a specific HTML file (path-traversal protected) |

The `/preview/*` routes are legacy — the Run-in-Browser button on every project header is the live way to view a running app.

#### SSE Events

| Event | Payload | Source |
|---|---|---|
| `init` | `{ teams, runtime, portfolio, runners }` | First message on connect — full state dump |
| `team-created` | `{ teamId, team }` | New team registered |
| `task-assigned` | `{ teamId, description, timestamp }` | Task body submitted |
| `task-classified` | `{ teamId, complexity, agentCount }` | Security-1 classified the task |
| `phase-transition` | `{ teamId, from, to, trigger, timestamp }` | Phase change |
| `agent-output` | `{ teamId, instance, text }` | Final output per agent turn |
| `agent-progress` | `{ teamId, instance, text }` | Streaming tool activity (500ms throttle) |
| `agent-task` | `{ teamId, instance, subtask }` | Current subtask label |
| `malformed-output` | `{ teamId, instance, raw }` | Verdict parser failed to read agent response (auto-retried once) |
| `task-complete` | `{ teamId, phase, durationMs }` | Pipeline finished |
| `feedback` | `{ teamId, id, type, title, message, blocking?, actions? }` | Notification or blocking question |
| `feedback-response` | `{ teamId, feedbackId, value }` | A client resolved a blocking feedback prompt (multi-tab dismissal) |
| `security-review` | `{ teamId, status, result? }` | On-demand security review result |
| `pr-created` | `{ teamId, prNumber, prUrl }` | `gh pr create` succeeded |
| `team-archived` | `{ teamId, prUrl }` | PR merged, team archived |
| `team-deleted` | `{ teamId }` | Team removed |
| `chat-message` | `{ teamId, message }` | User or Coordinator-1 message (or system note) |
| `chat-cancelled` | `{ teamId }` | Coordinator turn aborted via × button |
| `runner-starting` | `{ projectPath, framework, command }` | Run button clicked, dev server spawning |
| `runner-ready` | `{ projectPath, url }` | Dev server printed its URL |
| `runner-error` | `{ projectPath, reason, stdoutTail }` | Dev server failed to start or crashed |
| `runner-stopped` | `{ projectPath }` | Stop button clicked, dev server killed |
| `error` | `{ teamId, message }` | Generic team error |
| `shutdown` | `{}` | Engine shutting down |

**Future SSE events** (not currently emitted): `agent-crashed` / `agent-respawned` as a paired crash+recover story will land when the `AgentSession` adapters grow crash detection + respawn budgets. A `deadlock-detected` event will land when a real silence-timeout / stuck-state detector ships — today the orchestrator only fails to `errored` on loop-limit exhaustion, which is distinct from deadlock.

### UI (`src/dashboard/dashboard-ui.ts`)

Single-file HTML/CSS/JS generated by `buildDashboardHTML()`. Dark theme. Cached in memory on server start — source edits require `npm run build` plus server restart.

**Top-level layout**:
- **Top tabs**: `Portfolio` | `Code`. Portfolio is the default view.
- **Portfolio view**: per-project sections (header + team grid). Header shows project name, short path, team count, stat pills (active/review/done/errored), and per-project action buttons: **Run** (or **Open** + **Stop** when running), **Clear done** (when terminal teams exist), **+ Add Team**, **Remove from portfolio** (when zero teams remain). Above the project list is the global **+ Add Project** button.
- **Project detail view** (click a project header): full team list for that project plus the same Run/+ Add Team/Clear done controls.
- **Team panel** (click a team card or its row): opens the side panel showing the live-agent grid, controls, and the chat panel.
- **Code tab**: lazy-spawns the embedded code-server and iframes it to whichever project is currently selected.

**Per-project Run / Open / Stop button cluster** (Phase 4): replaces the legacy static-HTML Preview button. Auto-detects the project's framework from `package.json` and spawns the right dev server:

| Detected dep | Command |
|---|---|
| `@storybook/*` | `npm run storybook` |
| `next` | `npm run dev` (or `start`) |
| `vite` | `npm run dev` (or `start`) |
| `@angular/core` | `npm start` (or `dev`) |
| `vue` / `svelte` | `npm run dev` (or `start`) |
| `react` (no Next) | `npm start` (or `dev`) |
| No package.json + `*.html` at root | `python3 -m http.server 0` |
| Generic fallback | `npm run dev` or `npm start` if either script exists |

Stdout is parsed for a `Local: http://localhost:NNNN` line (with framework-specific fallbacks). If no URL appears within 30s, the runner flips to `error` and surfaces the last 50 lines of stdout. Stop sends SIGTERM with a 2s grace period before SIGKILL. Dashboard shutdown stops all runners.

**Live-agent grid** (in the side panel):
- Four cards: Security-1, Worker-1, Worker-2, Reviewer-1.
- Each card shows agent state badge (ACTIVE / SPAWNING / DONE / APPROVED / REJECTED / Complete / BLOCKED / SKIPPED / ERRORED / WAITING), role-colored dot, segmented progress, and streaming output preview.
- The badge is driven by `AgentState` enum + output-content refinement for the DONE state only. Only one instance shows ACTIVE at a time given the deterministic sequential pipeline.

**Team-panel controls**:
- **Steer `<instance>`** — visible only when the team's phase is `done` and an instance is open. Pre-fills the modal with the target instance.
- **Terminate team** — kills all sessions, marks the team cancelled, removes from registry.
- **Create PR** / **Security Review** — visible when phase is `done`.
- **+ Add Team** — opens the create-team modal pre-filled with the project.

**Chat panel**: full chat history, input textarea + Send button. While a coordinator turn is in flight, Send is replaced with a `×` Cancel button that POSTs to `/api/teams/:id/chat/cancel`. Toast confirms cancellation and notes that any pipeline already started by `TRIGGER_PIPELINE` keeps running.

**Add Project flow**: clicking **+ Add Project** opens the native macOS NSOpenPanel via a precompiled Swift binary at `tools/pick-folder`. The binary is positioned on whichever screen the mouse cursor is on (multi-monitor friendly) and forced above other windows via `panel.level = .modalPanel`. On non-macOS platforms, a browser `window.prompt()` fallback collects the path manually.

**Empty-state cards**: a fresh "No teams yet — Add a team to start work on `<project>`" card appears only for projects added in the current session (`state.recentlyAddedProjects`); existing zero-team projects show just their header to avoid clutter.

**Feedback System**: non-blocking notifications are color-coded (info=blue, warning=yellow, question=purple, decision=cyan); blocking feedback auto-opens the side panel and pauses the pipeline until the user responds.

**Keyboard**: Escape closes modals. Side panel toggleable.

### Embedded code-server (Code tab)

`src/dashboard/code-server-manager.ts` lazy-spawns a local `code-server` process when the user opens the Code tab, then iframes it with `?folder=<projectPath>`.

- **Lockdown**: project-local `--user-data-dir` and `--extensions-dir` keep the embedded view scoped (a single `rm -rf .code-server-data/` resets it). The `EXTENSIONS_GALLERY` env var points to an invalid `serviceUrl`, so the marketplace returns "Cannot connect" — search/install of AI-coding extensions (Claude Code, Copilot, Cursor, Continue) is blocked. Default settings hide the activity bar, secondary side bar, welcome page, and disable all chat/AI features. The rationale: every Claude/agent interaction for a team flows through one place — the team's chat panel.
- **Health check**: polls `/healthz` on the chosen port for up to 30s after spawn.
- **Detect**: `which code-server` runs lazily; surfaces an `install code-server` hint if the binary is missing.

### Native folder picker (`tools/pick-folder`)

24-line Swift binary that opens `NSOpenPanel` and prints the selected path. Built via `npm run build:picker` (`swiftc -O`). Hardened for current macOS focus rules:
- `panel.level = .modalPanel` to sit above normal application windows (works under Chrome fullscreen / different Spaces).
- `RunLoop.main.run(until: …)` for ~50ms after `NSApp.activate(...)` so the focus transition propagates before `runModal()` blocks.
- `panel.makeKeyAndOrderFront(nil)` for belt-and-suspenders activation.
- Multi-monitor positioning via `NSEvent.mouseLocation` + `NSScreen.screens` lookup.

---

## Data Architecture

### Runtime Data Locality

```
Engine repo (2026_ClaudeOrchestra/)
├── registry.json              ← Active-team pointers (gitignored)
├── projects.json              ← Portfolio of registered projects (gitignored)
├── .code-server-data/         ← Project-local code-server state (gitignored)
├── logs/
│   ├── orchestra.log          ← Main log (10 MB rotation)
│   ├── orchestra.error.log    ← Error log (5 MB rotation)
│   └── teams/{teamId}/
│       └── team.log
└── src/, agents/, tests/, tools/, ...

Target project repos (e.g., /Users/me/my-app/)
├── .claude-orchestra/         ← Auto-gitignored
│   └── teams/{teamId}/
│       ├── state.json         ← TeamState (debounced writes, forced on phase transitions)
│       └── chat.jsonl         ← Append-only Coordinator-1 chat history
└── (project files)
```

### Portfolio (`src/portfolio.ts`)

`projects.json` in the engine repo holds the user's set of registered projects independently of any teams in them. A project can sit in the portfolio with zero teams; adding a team for an unregistered project auto-registers it.

```typescript
interface Project {
  projectPath: string; // Absolute path on disk
  displayName: string; // Defaults to path basename
  addedAt: string;     // ISO-8601 timestamp
}
```

`Portfolio` mirrors `Registry`'s shape: `load`, `add`, `remove`, `has`, `get`. Atomic writes via tmp-file + `fs.renameSync()`. Path normalization via `path.resolve()` so relative paths in callers resolve correctly.

**Test isolation**: when a `PipelineOrchestraConfig` provides a custom `registryPath` but no `portfolioPath`, the orchestrator defaults `portfolioPath` to a sibling of the registry. This keeps tests that isolate `registryPath` in a tmpdir from accidentally polluting the engine repo's real `projects.json` via auto-register-on-createTeam.

### Registry (`src/registry.ts`)

Lightweight JSON of active teams (team name, project path, timestamps). Used for recovery on engine restart. Atomic writes via tmp-file + rename.

### State Persistence (`src/state/persistence.ts`)

Per-team `TeamState` on disk under the **target project's** `.claude-orchestra/teams/<teamId>/state.json`. Debounced writes (≤1 per 1000ms) with phase transitions forcing an immediate flush. Atomic via tmp-file + rename. `dispose()` clears all timers on shutdown.

---

## Git Operations (`src/git.ts`)

Three tiers:

**1. Automatic (engine-controlled):**
- `GitOps.commit(projectPath, message)` — safety checkpoint at phase boundaries. `git add -A` + commit on the team's branch. No-op when there are no changes.
- `GitOps.createTeamBranch(projectPath, branchName)` — at team creation, checks out main, pulls latest (best-effort), creates the team branch (`team/<slug>` from `slugifyBranchName(teamName)`), and pushes with `-u` to set up tracking. Append `-2`, `-3`, … or a timestamp suffix on collisions.

**2. User-initiated (dashboard buttons):**
- `GitOps.createPullRequest(projectPath, branchName, title, body)` — pushes the team branch and runs `gh pr create --base main --head <branch> --title … --body …`. Returns `{ prNumber, prUrl }` on success. Wired to the **Create PR** button.
- `GitOps.checkPrState(projectPath, prNumber)` — `gh pr view <n> --json state,merged`. Engine polls open PRs and emits `team-archived` when a PR merges.

The old direct-merge-to-main flow (and its dashboard route) was removed in July 2026 — the team-branch + GitHub-PR flow above is the only merge path.

All git commands have a 30-second timeout. `gh` availability is detected lazily and cached; if `gh` is missing, the **Create PR** path surfaces an install hint instead of failing silently.

**Single-branch workflow** (commit `23f40db`, May 2026): the engine used to maintain a separate `dev` branch and merge to `main` automatically. That was dropped in favour of the team-branch + GitHub-PR flow above.

---

## Agent Prompt Files (`agents/*.agent.md`)

| File | Role |
|---|---|
| `worker-1.agent.md` | Implements code; fixes gaps reported by Worker-2. Decision Transparency: must explain reasoning for every choice. |
| `worker-2.agent.md` | Requirements verifier only. `disallowedTools: Write, Edit, Bash` enforced at the SDK boundary. Verdict prefix: `COMPLETE` or `GAPS_FOUND` followed by `- Requirement N: <description>` lines. |
| `security.agent.md` | 10-point security checklist. Pre-scan: `CLASSIFICATION: SIMPLE\|STANDARD\|COMPLEX`. Post-sweep: `APPROVED \| FLAGGED \| BLOCKED`. "Be fast. Do NOT read every line — scan for patterns." Does not evaluate code quality. |
| `reviewer.agent.md` | "Rapid quality gate" — spot-check 2-3 key files. Verdict prefix: `APPROVED \| REVISION_NEEDED \| REJECTED`. "Default to APPROVED if the work reasonably addresses the task." Does not evaluate security. |
| `coordinator.agent.md` | Per-team chat coordinator. Receives user messages in the dashboard chat panel; emits one of three verdicts (`RESPONDING \| ASKING \| TRIGGER_PIPELINE`) so the orchestrator routes between direct reply, clarifying question, or new pipeline run. |
| `requirements.agent.md` | Pre-build requirements extraction from natural-language task descriptions, surfacing decisions for user approval before Worker-1 starts. |
| `security-review.agent.md` | Final, thorough on-demand security review. Analyzes `git diff main...HEAD`. Verdict: `PASSED` or `CONCERNS` with detailed findings. |
| `built-in-security-review.agent.md` | Variant of security-review used by the engine's built-in post-pipeline pass. |

---

## Logging (`src/logger/logger.ts`)

Dual output: colored terminal + JSON log files.

- **Structured event types** include: `team_created`, `task_assigned`, `task_classified`, `task_complete`, `agent_spawned`, `agent_errored`, `agent_respawned`, `message_sent`, `message_received`, `message_malformed`, `phase_transition`, `timeout_warning`, `timeout_exceeded`, `deadlock_detected`, `loop_limit_reached`, `shutdown_initiated`, `health_check_failed`, `validation_error`, `agent_output`.
- **Log levels**: DEBUG, INFO, WARN, ERROR (configurable via `CLAUDE_ORCHESTRA_LOG_LEVEL` env var).
- **Role-colored terminal output**: Worker=green, Security=red, Reviewer=yellow, Coordinator=blue. Phase-colored transitions. Decision messages (verdicts) promoted to INFO with content preview.
- **File rotation**: main log at 10 MB, error log at 5 MB. Single-file rotation (`.log` → `.log.1`).
- **Orchestrator integration**: `logger.attach(orchestrator)` wires the orchestrator's events to structured log output.

---

## CLI Entry Point (`src/index.ts`)

Commands:
- `dashboard` — start the HTTP + SSE server (default port 3460). Recovers teams from the registry. Auto-starts the engine. This is the primary command — the dashboard is the surface most users will touch.
- `create-team <name> <project-path>` — create a team without spawning the dashboard.
- `assign-task <team-id> <description>` — recover teams, start the pipeline for one team, auto-exit on completion.
- `status <team-id>` — print one team's status with agent details.
- `list` — show all teams with phase badges.
- `recover` — recover teams from persisted state and start the engine (no dashboard).

**Config file selection priority**: `--config <path>` > `CLAUDE_ORCHESTRA_CONFIG` env var > `./orchestra.config.json`.

**Config value priority**: CLI flags > selected config file > defaults.

**Signal handling**: SIGTERM/SIGINT → graceful shutdown (close dashboard, close sessions, stop runners, persist state). Second signal → force kill.

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
    "portfolioPath": "./projects.json",
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
    "Reviewer": "high",
    "Coordinator": "medium"
  },
  "disallowedTools": {
    "Security": ["Write", "Edit", "Bash"],
    "Reviewer": ["Write", "Edit", "Bash"],
    "Coordinator": ["Write", "Edit", "Bash", "NotebookEdit"]
  },
  "maxTurns": {
    "Worker": 50,
    "Security": 20,
    "Reviewer": 20,
    "Coordinator": 100
  }
}
```

Switch to Claude:

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
    "Reviewer": "medium",
    "Coordinator": "medium"
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

**383 tests across 16 test files** — all passing. Tests use Vitest with mocked SDK behaviour; the pipeline tests simulate agent sessions without real provider calls.

Notable suites:
- `pipeline-orchestrator.test.ts` — full pipeline, simple-pipeline shortcut, security BLOCKED loops, revision loops, rejection loops, loop-limit enforcement, requirements extraction, chat cancellation.
- `dashboard-server.test.ts` — HTTP routes, SSE streaming, team CRUD, task assignment, portfolio endpoints.
- `portfolio.test.ts` — Portfolio CRUD, atomic writes, idempotent add, path normalization.
- `project-runner.test.ts` — full framework-detection truth table + dev-server lifecycle (start → ready → stop) + error states (process exited, ready timeout) + stopAll.
- `git.test.ts` — change detection (`hasChanges`), repo detection (`isGitRepo`), current branch, commit checkpoints, checkout, merge, and error handling.
- `team-state.test.ts` — phase transitions (valid/invalid), agent state transitions, loop counters, limits.
- `config.test.ts`, `logger.test.ts`, `registry.test.ts`, `complexity-router.test.ts`, `agent-runtime.test.ts`, `hooks.test.ts`, and others.

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

---

## File Structure

```
2026_ClaudeOrchestra/
├── AGENTS.md                              # Shared coding-agent guidance for Codex and Claude Code
├── CLAUDE.md                              # Claude Code wrapper that imports AGENTS.md
├── PRD.md                                 # This document
├── README.md                              # Human-facing project overview
├── orchestra.config.json                  # Runtime config (gitignored)
├── registry.json                          # Active-team pointers (gitignored)
├── projects.json                          # Portfolio (gitignored)
│
├── src/
│   ├── index.ts                           # CLI entry point + signal handling
│   ├── config.ts                          # Config loading, CLI override merging
│   ├── pipeline-orchestrator.ts           # Core engine: verdict parsers, pipeline loops,
│   │                                      #   feedback, Q&A, coordinator chat, cancel
│   ├── git.ts                             # Commit, team-branch creation, PR creation via gh
│   ├── registry.ts                        # registry.json management
│   ├── portfolio.ts                       # projects.json — first-class project list
│   │
│   ├── agent-runtime/
│   │   ├── types.ts                       # Provider-agnostic AgentSession interface
│   │   ├── auth.ts                        # Runtime config + subscription env guards
│   │   ├── effort.ts                      # Provider-specific effort mapping
│   │   ├── factory.ts                     # Provider adapter factory
│   │   ├── claude-session.ts              # Claude Agent SDK adapter
│   │   └── codex-session.ts               # Codex SDK adapter
│   │
│   ├── router/
│   │   └── complexity-router.ts           # Heuristic task classifier
│   │
│   ├── state/
│   │   ├── team-state.ts                  # TeamState: transitions, counters, limits
│   │   └── persistence.ts                 # Debounced filesystem persistence
│   │
│   ├── dashboard/
│   │   ├── dashboard-server.ts            # HTTP + SSE server, route handlers
│   │   ├── dashboard-ui.ts                # Full SPA: HTML/CSS/JS (single file)
│   │   ├── code-server-manager.ts         # Lazy-spawn + lockdown for embedded code-server
│   │   ├── project-runner.ts              # Run in Browser: spawn project dev servers
│   │   └── index.ts                       # Module exports
│   │
│   ├── logger/
│   │   └── logger.ts                      # Structured logging with rotation
│   │
│   ├── roles/
│   │   └── role-types.ts                  # Role enum, instances, JTBD types
│   │
│   └── types/
│       └── index.ts                       # Phase, Priority, MessageStatus, AgentState enums
│
├── agents/                                # Agent system prompts (YAML frontmatter + markdown)
│   ├── worker-1.agent.md
│   ├── worker-2.agent.md
│   ├── security.agent.md
│   ├── reviewer.agent.md
│   ├── coordinator.agent.md
│   ├── requirements.agent.md
│   ├── security-review.agent.md
│   └── built-in-security-review.agent.md
│
├── tools/
│   ├── pick-folder.swift                  # Native macOS NSOpenPanel binary source
│   └── pick-folder                        # Precompiled Mach-O binary (committed)
│
├── tests/                                 # 311 tests across 14 files
│
├── docs/                                  # Design documents and ADRs
│
├── .github/
│   └── workflows/                         # CI: build + test + biome lint
│
├── package.json                           # deps: Claude Agent SDK + Codex SDK
├── tsconfig.json
├── biome.json                             # Biome lint + format config
└── vitest.config.ts
```

---

## Key Design Decisions

### Why a code-driven pipeline over an LLM supervisor?
The original architecture used a Supervisor LLM to route messages between agents. The current `PipelineOrchestrator` replaces it because:
- **Deterministic**: code always runs Security → Build → Sweep → Review. No LLM routing hallucinations.
- **Cheaper**: one fewer LLM call per phase. Supervisor's 30 max turns × 4 phases eliminated.
- **Faster**: no cold start for routing decisions. No prompt parsing for delegation.
- **Debuggable**: `console.log` in TypeScript beats hoping the LLM explains itself.

### Why a Coordinator-1 chat panel instead of pure dashboard buttons?
The chat is the team's natural entry point. Typing "build me X" reads more like Claude Code than clicking "Assign Task" → modal → textarea → Submit. The coordinator's three structured verdicts (`RESPONDING / ASKING / TRIGGER_PIPELINE`) preserve the deterministic pipeline while making the interaction conversational.

### Why spawn the real dev server (Phase 4) instead of serving static HTML?
The earlier "Preview" button served `index.html` from a hardcoded list of build-output directories. It broke for any SPA build with dynamic imports (Storybook, Vite-built React apps, etc.) because serving from a subpath misaligns the bundler's expectations. Spawning the project's real dev server and opening its own URL bypasses all of that — and matches Claude Code's "run in browser" instinct.

### Why `AgentSession.send()` over a message bus?
Pipeline mode is synchronous and sequential — no concurrent agent communication is needed. `send()` returns the full response, making verdict parsing trivial. Warm sessions avoid cold-start overhead between phases.

### Why minimal dependencies?
Production dependencies are limited to the provider SDKs (`@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`). The dashboard uses Node.js `http`. No Express, no React, no WebSocket libraries. Result: minimal attack surface, lower supply chain risk, no version conflicts, fast `npm install`.

### Why provider adapters?
Claude Agent SDK and Codex SDK expose different APIs (`query()` vs Codex threads) and different effort names (`max` vs `xhigh`). The orchestrator stays clean by depending only on `AgentSession`; SDK-specific code, auth guards, and effort mapping live under `src/agent-runtime/`.

### Why runtime data in target projects?
`.claude-orchestra/` lives in the target project (auto-gitignored), not in the engine repo. This means:
- Engine repo stays clean — only source code + `registry.json` + `projects.json`.
- Multiple projects don't pollute each other.
- Recovery: engine reads registry → finds project paths → reads `state.json` from each project.

### Why lock down the embedded code-server marketplace?
The architectural premise of the team chat panel is that all Claude/agent interactions for a team flow through one place. Allowing AI coding extensions (Claude Code, Copilot, Cursor, Continue) to be invoked from inside the iframe would create parallel, untracked conversations the orchestrator can't see. Disabling the marketplace at the env-var level is the simplest enforcement.

---

## Non-Goals

1. **Project creation** — ClaudeOrchestra attaches to existing local repos. Users create repos first (typically on GitHub, then clone).
2. **CI/CD integration** — human-driven tool, not an automated pipeline stage.
3. **Distributed execution** — single orchestrator process, one machine.
4. **Custom agent topologies** — fixed 4-agent pipeline layout (Worker×2, Security, Reviewer) plus the per-team Coordinator-1.
5. **Mixed providers in one run** — a process is globally all Claude or all Codex. Teams do not choose different providers.
6. **Inter-team coordination** — teams are isolated. Sequential teams on the same repo only.
7. **Streaming the coordinator's response live** — current behavior is opaque until verdict; revisit if it becomes painful.

---

## Future Roadmap

- **Settings modal** for `maxTeamsPerProject` (rename of `maxConcurrentTeams`). UI: gear icon → spinbox (1–15) → save. Validates that no project already exceeds the new value.
- **Phase 4b — agent-based framework fallback** for projects whose framework isn't in the Run-in-Browser detection table. One-shot Claude session inspects the project, returns a command, caches it per-project.
- **Tunnel support** (`--tunnel` flag) — expose the dashboard via cloudflared/ngrok for phone access. ~20 lines, no dashboard changes.
- **Webhook integration** — external notifications (Slack, email) on phase transitions.
- **Programmatic API surface** beyond the dashboard REST endpoints (long-tail integrations).

Recently shipped (no longer roadmap items):
- Bulk Clear-done teams per project, with last-team warning. (PR #15)
- Portfolio as first-class entity + native folder picker + multi-monitor positioning. (PR #16)
- Run in Browser — `ProjectRunnerManager` spawns the project's real dev server. (PR #17)
- Team panel cleanup — dynamic Steer label, ACTIVE-badge fix, chat cancel button, dropped Assign New Task. (PR #18)

---

## Glossary

| Term | Definition |
|---|---|
| **Agent Runtime** | The active provider layer (Claude or Codex), configured globally via `agentRuntime.provider`. |
| **AgentSession** | Provider-agnostic wrapper around a warm runtime session. Claude uses `query()`; Codex uses SDK/CLI threads. |
| **PromptChannel** | Claude adapter async iterable that bridges sync `push()` to the Claude SDK's streaming API. Supports text + base64 images. |
| **Provider Adapter** | Runtime module under `src/agent-runtime/` that translates orchestration calls into Claude SDK or Codex SDK behaviour. |
| **Pipeline** | The deterministic sequence: Scan → Build → Sweep → Review → Done. |
| **Team** | A set of pipeline agent sessions plus a persistent Coordinator-1 chat session, attached to one project. |
| **Phase** | A workflow stage (`pre_work`, `work`, `handoff`, `review`, `done`, `errored`, `cancelled`, plus dashboard-derived `pr_open` and `merged`). |
| **Verdict** | An agent's structured assessment. Security: `APPROVED / FLAGGED / BLOCKED`. Review: `APPROVED / REVISION_NEEDED / REJECTED`. Verify: `COMPLETE / GAPS_FOUND`. Coordinator: `RESPONDING / ASKING / TRIGGER_PIPELINE`. |
| **Coordinator-1** | Per-team long-running chat session. Receives user messages, emits one of three verdicts. The chat panel is the primary entry point for a team. |
| **Steer** | A follow-up message sent to a specific completed agent session via `/api/teams/:id/ask` with a `targetInstance` parameter. Available only post-completion. |
| **Gap** | A requirement from the task that Worker-1 didn't implement, detected by Worker-2. |
| **Clearance** | Security agent's file categorization: `SAFE` (modify freely), `CAUTION` (document changes), `OFF-LIMITS` (don't touch). |
| **Classification** | Security's task complexity assessment: `SIMPLE / STANDARD / COMPLEX`. Can override heuristic classifier. |
| **Sweep** | Post-work security re-scan for newly introduced vulnerabilities. |
| **Loop** | A backward phase transition (e.g., review → work for revision, review → pre_work for rejection). |
| **Backward transition** | Any transition that moves to an earlier phase. Counted against configurable limits. |
| **Registry** | `registry.json` — lightweight index of all active teams across projects. |
| **Portfolio** | `projects.json` — first-class list of registered projects, independent of any teams. |
| **Project Runner** | `ProjectRunnerManager` — spawns the project's real dev server (Storybook, Vite, etc.) and parses its URL for the Run / Open / Stop button cluster. |
| **Code tab** | Dashboard tab that lazy-spawns an embedded code-server with the project folder open. |
| **SSE** | Server-Sent Events — one-way server → client push for real-time dashboard updates. |
| **Warm session** | An AgentSession whose underlying provider session is already running. Subsequent `send()` calls avoid the ~12s cold start. |
