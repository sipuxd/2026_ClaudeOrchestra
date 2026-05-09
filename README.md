# ClaudeOrchestra

A governance engine for autonomous AI coding. Security gates, completeness verification, code review, and real-time visibility — across multiple projects, from one dashboard.

## The Problem

You can open Claude Code or Codex and build anything. But letting AI agents write production code unsupervised is a different problem. There's no security enforcement, no review gate, no way to know if requirements were fully met, and no visibility when you're running multiple projects.

**ClaudeOrchestra is for the solo developer or small team lead managing multiple AI-assisted projects.** You're building 2-5 things concurrently. You trust AI to write code but don't trust it to ship without review. You want to say "build this feature" and come back to a reviewed, security-checked result — not babysit a single Claude session.

Think: a freelancer building multiple client projects, or a startup CTO prototyping features in parallel.

## What It Does

Every task runs through a deterministic pipeline with built-in safety gates:

```
Security Scan → Worker-1 Implements → Worker-2 Verifies → Security Sweep → Review → Done
```

1. **Security by design** — A Security agent pre-scans the workspace (categorizing files as SAFE, CAUTION, or OFF-LIMITS) and post-sweeps completed work. Agents cannot touch `.env`, leak credentials, or introduce known vulnerabilities without being caught.

2. **Completeness verification** — Worker-1 implements the task. Worker-2 reads the output and verifies it against the original requirements — reporting any gaps, missing edge cases, or incomplete implementations. Worker-1 fixes reported gaps. Up to 2 verification passes before proceeding.

3. **Code review gate** — A Reviewer agent evaluates quality and correctness. Can approve, request revisions, or reject entirely — triggering the appropriate loop.

4. **Real-time visibility** — One dashboard showing all teams across all repos. Phase progression, agent status, streaming output, and feedback — no tab-switching.

## How It Works

The engine does not create projects. You create a repo, clone it locally, then create a team in ClaudeOrchestra pointed at that project.

```
              ┌──────────────┐
              │     YOU       │  ← browser dashboard at localhost:3460
              └──────┬───────┘
                     │  create team, assign task, respond to feedback
              ┌──────▼───────┐
              │   PIPELINE    │  ← TypeScript engine (Node.js)
              │  ORCHESTRATOR │
              └──┬──┬──┬──┬──┘
                 │  │  │  │     4 warm provider SDK sessions, plus
                 │  │  │  │     1 Coordinator-1 per team (chat panel)
                 │  │  │  └──── Reviewer-1  (quality gate)
                 │  │  └─────── Worker-2    (completeness verifier)
                 │  └────────── Worker-1    (implementer)
                 └───────────── Security-1  (pre-scan + post-sweep)
```

Each team also has a `Coordinator-1` chat session (lazy-spawned on first message) that lives in the dashboard's slide panel. The user talks to Coordinator-1; it decides whether to respond directly or emit `TRIGGER_PIPELINE` to kick off a fresh Security-1 → Worker-1/2 → Reviewer-1 cycle. See [AGENTS.md](AGENTS.md#team-chat-coordinator-1) for the verdict contract.

### Pipeline Flow

```
┌─────────┐    ┌──────────────────────────────────┐    ┌─────────┐    ┌──────────┐
│  SCAN   │───▶│            BUILD                  │───▶│  SWEEP  │───▶│  REVIEW  │───▶ DONE
│Security │    │                                    │    │Security │    │Reviewer-1│
│pre-scan │    │  Worker-1 implements               │    │post-    │    │          │
│         │    │       │                            │    │sweep    │    │          │
│         │    │  Worker-2 verifies completeness    │    │         │    │          │
│         │    │       │                            │    │         │    │          │
│         │    │  If gaps found ──▶ Worker-1 fixes  │    │         │    │          │
│         │    │       │            (max 2 loops)   │    │         │    │          │
│         │    │  Worker-2 re-verifies              │    │         │    │          │
└─────────┘    └──────────────────────────────────┘    └────┬────┘    └────┬─────┘
     ▲                                                      │              │
     │              ┌───────────────────────────────────────┘              │
     │              │ BLOCKED ──▶ back to BUILD                           │
     │              │                                                     │
     └──────────────┼─────────────────────────────────────────────────────┘
       REJECTED     │ REVISION_NEEDED ──▶ back to BUILD
       restarts     │
       from SCAN    │
```

| Phase | What Happens |
|-------|-------------|
| **Scan** | Security-1 scans workspace, categorizes files as SAFE/CAUTION/OFF-LIMITS, produces clearance report |
| **Build** | Worker-1 implements task within cleared scope. Worker-2 verifies completeness against original requirements. If gaps found, Worker-1 fixes and Worker-2 re-checks (max 2 passes). |
| **Sweep** | Security-1 re-scans for introduced vulnerabilities, leaked secrets, unauthorized file changes. BLOCKED sends workers back; APPROVED/FLAGGED proceeds. |
| **Review** | Reviewer-1 evaluates quality and correctness. APPROVED completes the pipeline. REVISION_NEEDED loops back to Build. REJECTED restarts from Scan. |
| **Done** | Task complete. Push & Merge to main available from dashboard. |

### Smart Routing

Tasks are automatically classified by complexity before the pipeline starts:

- **Simple** (typo fix, single-file change) — Spawns only Worker-1. Skips security scan, completeness verification, sweep, and review. Straight to Work → Done.
- **Standard** (feature implementation, multi-file work) — Full 4-agent pipeline: Security-1, Worker-1, Worker-2, Reviewer-1 with all gates and loop-backs.

### Runtime Data Separation

The engine repo stays clean. Each target project gets a `.claude-orchestra/` directory (gitignored) containing team state, messages, and reports. The engine maintains only a lightweight `registry.json` with pointers to active teams.

## Dashboard

A live browser dashboard at `localhost:3460` with zero external dependencies (Node.js built-in `http` + SSE).

- **Sidebar** — All teams grouped by project, with phase badges (SCAN, BUILD, DONE, etc.)
- **Phase bar** — Visual 5-step progression with loop-back support
- **Agent panels** — Real-time streaming output per agent with role labels and subtask indicators
- **Feedback bar** — Non-blocking notifications and blocking prompts when the pipeline needs input
- **New Team modal** — Create a team by name, project path, and task description
- **Preview** — Opens the most recently built HTML file directly in a new tab
- **Push & Merge** — One-click git push to main when task is complete
- **Run Task / Ask** — Submit follow-up tasks or ask questions to a warm agent session

## Agent Roles

| Agent | Job | Modifies Code? |
|-------|-----|---------------|
| **Security-1** | Pre-scan workspace, post-sweep completed work. Categorize files as SAFE/CAUTION/OFF-LIMITS. Verdicts: APPROVED, FLAGGED, BLOCKED. | No |
| **Worker-1** | Implement the full task within security-cleared boundaries. Fix gaps reported by Worker-2. | Yes |
| **Worker-2** | Verify Worker-1's implementation for completeness against original requirements. Report missing features, edge cases, TODOs. | No — report only |
| **Reviewer-1** | Evaluate code quality and correctness. Spot-check key files. Verdicts: APPROVED, REVISION_NEEDED, REJECTED. | No |

## Quick Start

```bash
# Clone and install
git clone https://github.com/sipuxd/2026_ClaudeOrchestra.git
cd 2026_ClaudeOrchestra
npm install

# Build
npm run build

# Start the dashboard
node dist/index.js dashboard --mode pipeline

# Opens http://localhost:3460 in your browser automatically
# Click "+ New Team" to create a team and assign a task
```

### Prerequisites

- Node.js 18+
- Claude subscription for the Claude provider, or ChatGPT/Codex subscription for the Codex provider
- A local git repo to point the engine at (the engine does not create projects)

### CLI Commands

```bash
# Dashboard (primary way to use the engine)
node dist/index.js dashboard --mode pipeline              # Start dashboard (port 3460)
node dist/index.js dashboard --mode pipeline --port 8080  # Custom port

# Headless CLI (no dashboard)
node dist/index.js create-team <name> <project-path> --mode pipeline
node dist/index.js assign-task <team-id> <description> --mode pipeline
node dist/index.js status <team-id> --mode pipeline
node dist/index.js list --mode pipeline
node dist/index.js recover --mode pipeline
```

### Configuration

Optional `orchestra.config.json` (all fields optional):

```json
{
  "agentRuntime": {
    "provider": "claude",
    "auth": "subscription",
    "model": "claude-opus-4-6"
  },
  "engine": {
    "registryPath": "./registry.json",
    "logDirectory": "./logs",
    "rolesDir": "./agents"
  },
  "skipRequirements": false,
  "teams": {
    "maxConcurrentTeams": 5
  },
  "limits": {
    "maxRevisions": 3,
    "maxRejections": 2,
    "maxTotalBackwardTransitions": 5
  },
  "efforts": {
    "Worker": "high",
    "Security": "medium",
    "Reviewer": "medium"
  }
}
```

### Agent Runtime

ClaudeOrchestra uses one global agent runtime at a time. It is all Codex or all Claude for the current dashboard/orchestrator process.

The active provider is selected in exactly one place: `agentRuntime.provider`.
`agentRuntime.model`, when set, is a global model override for every agent role. If you omit it or set it to `"default"`, the active provider chooses its default model. The optional per-role `models` block is Claude tuning and is not needed to switch providers.

Use Codex with ChatGPT subscription auth:

```json
{
  "agentRuntime": {
    "provider": "codex",
    "auth": "subscription",
    "model": "gpt-5.5"
  }
}
```

Before starting the dashboard, sign in with ChatGPT through Codex:

```bash
codex login
npm run build
npm run dashboard
```

Use Claude with Claude.ai subscription auth:

```json
{
  "agentRuntime": {
    "provider": "claude",
    "auth": "subscription",
    "model": "claude-opus-4-6"
  }
}
```

Before starting the dashboard, sign in through Claude Code:

```bash
claude
npm run build
npm run dashboard
```

You can also override the runtime for a single CLI run:

```bash
node dist/index.js dashboard --provider codex --auth subscription --model gpt-5.5
node dist/index.js dashboard --provider claude --auth subscription --model claude-opus-4-6
```

`auth: "subscription"` means OAuth subscription credentials, not API key billing. When subscription auth is selected, the engine refuses to start if API-key environment variables that would override subscription auth are present:

- Codex: `CODEX_API_KEY`, `OPENAI_API_KEY`, `OPENAI_AUTH_TOKEN`
- Claude: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`

If you want the provider to choose its default model, set `"model": "default"` or omit the model.

### Effort Levels

`efforts` are configured once in `orchestra.config.json`, but the active provider adapter translates them to that SDK's vocabulary:

- Codex SDK / Codex config accepts `minimal`, `low`, `medium`, `high`, and `xhigh`. In the Codex VS Code dropdown, you may only see Low, Medium, High, and Extra High for the selected model/profile. Extra High maps to config value `xhigh`; Codex does not use `max` as the preferred setting.
- Claude Agent SDK uses `low`, `medium`, `high`, and `max` through its `query()` options. Claude's general API docs also describe newer model-specific effort levels such as `xhigh`, but this project currently targets the Claude Agent SDK surface.

For clean provider switching, prefer provider-native names in config:

```json
{
  "agentRuntime": { "provider": "codex", "auth": "subscription", "model": "gpt-5.5" },
  "efforts": { "Worker": "xhigh", "Security": "low", "Reviewer": "medium" }
}
```

```json
{
  "agentRuntime": { "provider": "claude", "auth": "subscription", "model": "claude-opus-4-6" },
  "efforts": { "Worker": "max", "Security": "low", "Reviewer": "medium" }
}
```

The runtime keeps backward-compatible aliases at the adapter boundary: `max` maps to Codex `xhigh`, `xhigh` maps to Claude Agent SDK `max`, and Codex-only `minimal` maps to Claude Agent SDK `low`.

### Provider SDKs

- Claude runtime uses `@anthropic-ai/claude-agent-sdk`.
- Codex runtime uses `@openai/codex-sdk`, which wraps the Codex CLI and uses the same ChatGPT/Codex login when `auth` is `"subscription"`.
- SDK-specific calls stay inside `src/agent-runtime/*-session.ts`; the orchestrator only talks to the shared `AgentSession` interface.

### Agent Instruction Files

- `AGENTS.md` is the shared coding-agent instruction file. Codex reads it directly.
- `CLAUDE.md` is a thin Claude Code wrapper that imports `@AGENTS.md` and contains only Claude-specific notes.
- ClaudeOrchestra's spawned runtime agents do not automatically inherit either file. They receive explicit role prompts from `agents/*.agent.md`; add shared instructions to those role prompts deliberately if runtime agents need them.

## Tech Stack

- **Runtime:** TypeScript, Node.js
- **AI:** Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) or Codex SDK (`@openai/codex-sdk`)
- **Dashboard:** Node.js built-in `http` + SSE (zero UI dependencies)
- **Tests:** Vitest — 233 tests across 10 files
- **External dependencies:** Claude Agent SDK and Codex SDK

## Project Structure

```
AGENTS.md                          # Shared instructions for Codex and imported by Claude Code
CLAUDE.md                          # Claude Code wrapper around AGENTS.md
src/
├── index.ts                       # CLI entry point & command routing
├── config.ts                      # Config file loading and CLI override merging
├── pipeline-orchestrator.ts       # Core pipeline engine (standard + simple)
├── git.ts                         # Git commit, push & merge operations
├── registry.ts                    # Cross-project team registry
├── agent-runtime/
│   ├── types.ts                   # Provider-agnostic AgentSession interface
│   ├── auth.ts                    # Runtime config + subscription env guards
│   ├── effort.ts                  # Provider-specific effort mapping
│   ├── factory.ts                 # Provider adapter factory
│   ├── claude-session.ts          # Claude Agent SDK adapter
│   └── codex-session.ts           # Codex SDK adapter
├── dashboard/
│   ├── dashboard-server.ts        # HTTP + SSE server, preview routes
│   ├── dashboard-ui.ts            # Single-page HTML/CSS/JS builder
│   └── index.ts                   # Dashboard exports
├── router/
│   └── complexity-router.ts       # Simple vs standard classification
├── state/
│   ├── team-state.ts              # In-memory state with validated transitions
│   └── persistence.ts             # Filesystem persistence (.claude-orchestra/)
├── spawner/
│   ├── agent-spawner.ts           # Legacy Claude-only lifecycle path
│   ├── agent-process.ts           # Legacy Claude-only SDK/child-process wrapper
│   └── frontmatter-parser.ts     # YAML frontmatter parser for agent files
├── roles/
│   └── role-types.ts              # Role enums & types
├── logger/
│   └── logger.ts                  # Structured logging
└── types/
    └── index.ts                   # Shared enums (Phase, Priority, etc.)

agents/                            # Agent system prompts (YAML frontmatter + markdown)
├── worker-1.agent.md             # Implementer
├── worker-2.agent.md             # Requirements verifier (Write/Edit/Bash denied at SDK)
├── security.agent.md             # Security pre-scan & post-sweep
├── reviewer.agent.md             # Code review & verdicts
└── security-review.agent.md      # Final security review (on-demand)

tests/                             # 10 test files, 233 tests (Vitest)
docs/                              # Architecture & design specifications
```

## Loop Limits & Safety

The pipeline has built-in guardrails to prevent infinite loops:

| Loop | Trigger | Max |
|------|---------|-----|
| Completeness verification | Worker-2 finds gaps | 2 passes |
| Revision cycle | Reviewer requests changes | 3 revisions |
| Rejection cycle | Reviewer rejects entirely | 2 rejections |
| Security retry | Post-sweep blocks | Back to Build |

Auto-commits happen at 3 checkpoints: after Build, after Sweep passes, and final commit with task description.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | Agent topology, authority hierarchy, conflict resolution |
| [Roles & JTBD](docs/roles-and-jtbd.md) | Role definitions, prompt guidelines |
| [State Machine](docs/state-machine.md) | Phases, transitions, loop limits, deadlock detection |
| [Context Management](docs/context-management.md) | Model selection, cost budgets |
| [Operations](docs/operations.md) | Health checks, crash recovery, shutdown, logging |
| [Implementation Plan](implementation-plan.md) | 8-milestone build sequence |

## License

MIT
