# ClaudeOrchestra - Operations

> Source of truth for configuration, health monitoring, shutdown,
> resource management, logging, and operational behavior.
>
> Cross-references:
> - [Architecture](./architecture.md) - runtime topology
> - [State Machine](./state-machine.md) - workflow states and limits

---

## Runtime Modes

ClaudeOrchestra runs as one Node.js process. The active agent provider is global for that process:

| Provider | SDK | Auth |
|----------|-----|------|
| `claude` | `@anthropic-ai/claude-agent-sdk` | Claude subscription OAuth |
| `codex` | `@openai/codex-sdk` | ChatGPT/Codex subscription OAuth |

Provider selection is controlled by `agentRuntime.provider` or the `--provider` CLI flag. Teams do not choose different providers inside the same process.

---

## Health Monitoring

ClaudeOrchestra does not use a tick-based health loop for pipeline execution. The pipeline is sequential and deterministic: the engine knows which agent is active because it is awaiting that agent's `send()` call.

Health signals:

| Signal | Method | When |
|--------|--------|------|
| Provider session alive | `send()` resolves/rejects or stream emits error | Per prompt |
| Response valid | Verdict parser succeeds or falls back | Per agent response |
| Pipeline progress | Phase transition occurs | Per step |
| Dashboard connected | SSE clients receive events | Per HTTP connection |
| PR merged/closed | `gh pr view` polling | Every 60s while PRs are open |

---

## Error Detection

Errors are detected when:

1. Provider session fails or rejects.
2. Codex streamed turn emits `turn.failed` or `error`.
3. Verdict parsing yields a blocking/negative result.
4. Loop limits are exceeded by `TeamState.transitionPhase()`.
5. Git operations fail during branch, commit, push, or PR creation.
6. Dashboard request handlers catch invalid input or orchestrator errors.

Pipeline failure behavior:

- Emit `error`.
- Emit warning feedback to the dashboard.
- Attempt transition to `errored`.
- Persist state immediately.
- Close sessions when failure occurs in the standard pipeline catch path.

---

## Dashboard Observability

The dashboard server uses Node's built-in `http` module and Server-Sent Events.

Primary events:

| Event | Description |
|-------|-------------|
| `init` | Initial teams and runtime state |
| `team-created` | New team registered |
| `task-assigned` | Task assigned to team |
| `task-classified` | Simple/standard/complex and agent count |
| `phase-transition` | Team moved between workflow phases |
| `agent-output` | Final or summarized agent output |
| `agent-progress` | Streaming provider/tool progress, throttled |
| `agent-task` | Current agent subtask label |
| `task-complete` | Pipeline completed or errored |
| `feedback` | Notification or blocking question |
| `security-review` | Final diff security review status/result |
| `pr-created` | PR number and URL |
| `team-archived` | Merged team archived |
| `shutdown` | Server/orchestrator shutdown |

`agent-progress` is throttled per team/agent to avoid flooding SSE clients.

---

## Shutdown Protocol

### Engine Shutdown

On `SIGTERM` or first `SIGINT`:

1. Set `shuttingDown`.
2. Stop PR polling.
3. Close all active sessions.
4. Transition non-terminal teams to `cancelled` when valid.
5. Persist all team states.
6. Dispose persistence timers.
7. Emit `shutdown`.
8. Close the dashboard server and SSE clients.

Second `SIGINT` exits immediately.

### Team Shutdown

When `terminateTeam(teamId)` is called:

1. Close all active sessions.
2. Transition active team to `cancelled` when valid.
3. Persist final state.
4. Remove registry entry.
5. Remove team from memory.

### Archive After PR Merge

When a PR is detected as merged:

1. Close lingering sessions.
2. Transition `pr_open -> merged`.
3. Persist state.
4. Checkout `main`.
5. Delete local team branch.
6. Remove registry entry.
7. Remove team from memory.
8. Emit `team-archived`.

---

## Resource Limits

| Resource | Default | Notes |
|----------|---------|-------|
| Max concurrent teams | 5 | Configurable through `teams.maxConcurrentTeams` or `--max-teams` |
| Sessions per standard team | 4 | Security, Worker-1, Worker-2, Reviewer |
| Sessions per simple team | 1 | Worker-1 only |
| Worker verification passes | 2 | Hardcoded `MAX_VERIFY_PASSES` |
| Revision loop limit | 3 | Configurable |
| Rejection loop limit | 2 | Configurable |
| Total backward transitions | 5 | Configurable |
| Guardrails | enabled | Shared policy, Claude hooks, Codex stream monitoring, and post-phase audits |

---

## Filesystem Layout

Engine repo:

```text
registry.json
logs/
src/
agents/
docs/
```

Target project:

```text
.claude-orchestra/
└── teams/
    └── {teamId}/
        └── state.json
```

Codex image attachments may also be written under:

```text
.claude-orchestra/codex-images/
```

The engine automatically adds `.claude-orchestra/` to the target project's `.gitignore`.

---

## Git Operations

Automatic:

- Create/check out a team branch from `main`.
- Add `.claude-orchestra/` to `.gitignore`.
- Auto-commit after Work phase.
- Auto-commit after Security sweep passes.
- Auto-commit final task checkpoint.

User initiated:

- Create GitHub PR with `gh pr create`.
- Legacy push-and-merge endpoint remains for compatibility.

Polling:

- While any team is in `pr_open`, poll PR state every 60 seconds.
- Merged PRs are archived automatically.
- Closed unmerged PRs return the team to `done`.

---

## Configuration

Config file selection priority:

1. `--config <path>`
2. `CLAUDE_ORCHESTRA_CONFIG`
3. `./orchestra.config.json`

Config value priority:

1. CLI flags
2. selected config file
3. defaults

Example:

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
  "teams": {
    "maxConcurrentTeams": 5
  },
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

Claude example:

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

Guardrail and roadmap controls:

```json
{
  "guardrails": {
    "enabled": true,
    "abortCodexOnForbiddenStreamEvent": true
  },
  "contracts": {
    "mode": "phased-fallback",
    "validationRetries": 1
  },
  "review": {
    "complexFileThreshold": 8,
    "complexDiffLineThreshold": 600,
    "maxFilesPerBatch": 5
  },
  "recovery": {
    "maxProviderRetries": 2,
    "initialBackoffMs": 1000
  }
}
```

Guardrail enforcement is layered:

- Claude uses SDK `PreToolUse` / `PostToolUse` hooks for true pre/post tool checks.
- Codex uses sandbox mode, disabled network access, `approvalPolicy: "never"`, streamed command/file monitoring, and abort-on-detection.
- Both providers go through deterministic orchestrator audits before phase commits.

---

## CLI Flags

| Flag | Description |
|------|-------------|
| `--port <n>` | Dashboard port |
| `--registry <path>` | Registry file path |
| `--config <path>` | Config file path |
| `--max-teams <n>` | Max concurrent teams |
| `--provider <name>` | Agent provider: `claude` or `codex` |
| `--auth <mode>` | Auth mode: `subscription` |
| `--model <id>` | Global model override |
| `--model-worker <id>` | Per-role Worker model override |
| `--model-security <id>` | Per-role Security model override |
| `--model-reviewer <id>` | Per-role Reviewer model override |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLAUDE_ORCHESTRA_CONFIG` | Optional path to config file |
| `CLAUDE_ORCHESTRA_LOG_LEVEL` | Optional log level override |

Guarded variables rejected for Claude subscription runtime:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`
- `CLAUDE_CODE_USE_BEDROCK`
- `CLAUDE_CODE_USE_VERTEX`
- `CLAUDE_CODE_USE_FOUNDRY`

Guarded variables rejected for Codex subscription runtime:

- `CODEX_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_AUTH_TOKEN`

---

## Logging

The logger writes structured JSON and terminal-friendly output.

Log destinations:

| File | Contents |
|------|----------|
| `logs/orchestra.log` | Main structured log |
| `logs/orchestra.error.log` | Error log |
| `logs/teams/{teamId}/team.log` | Per-team log |

Log levels: `debug`, `info`, `warn`, `error`.

The logger can attach to the orchestrator and subscribe to its events. Dashboard progress is separate and flows through SSE.

---

## Cost And Billing

The current supported auth mode is `subscription`. That means Claude subscription OAuth for Claude and ChatGPT/Codex subscription OAuth for Codex.

API-key billing is intentionally guarded against in this mode. If API billing is introduced later, it should be a separate explicit auth mode with separate budget controls and documentation.
