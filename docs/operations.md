# ClaudeOrchestra — Operations

> Source of truth for health monitoring, graceful shutdown,
> signal handling, resource management, structured logging,
> and observability.
>
> **Cross-references:**
> - [State Machine](./state-machine.md) — timeout values,
>   error states
> - [Architecture](./architecture.md) — pipeline topology
> - [Implementation Plan](../implementation-plan.md) — build
>   milestones

---

## Health Monitoring

### Pipeline-Driven Model

ClaudeOrchestra does NOT use a tick-based health check loop.
The pipeline is sequential and deterministic — the engine
knows exactly which agent is active at any point because it
drives the conversation directly via SDK `query()` calls.

Health is monitored implicitly:

| Signal | Method | When |
|--------|--------|------|
| **Session alive** | SDK query resolves or rejects | Per prompt |
| **Response valid** | Verdict parser succeeds | Per agent response |
| **Pipeline progress** | Phase transitions occur | Per step |

### Error Detection

Errors are detected when:

1. **SDK query rejects** — agent session crashed or timed out.
   The pipeline catches the error, marks the team as `errored`,
   and surfaces it to the dashboard.
2. **Verdict parse fails** — agent response doesn't contain
   a recognizable verdict. Review verdict defaults to
   `REVISION_NEEDED` (conservative). Security and verify
   verdicts fail explicitly.
3. **Loop limits exceeded** — backward transitions exceed
   configured maximums. The state machine throws a
   `TransitionError` and the pipeline transitions to `errored`.

### Dashboard Observability

The pipeline emits events for real-time dashboard updates via
SSE:

- `agent-output` — raw agent response text
- `agent-progress` — streaming progress during long operations
- `agent-task` — current subtask label for each agent
- `phase-transition` — phase changes with trigger description
- `feedback` — notifications and blocking questions
- `error` — pipeline failures

---

## Shutdown Protocol

### Engine Shutdown (SIGTERM / SIGINT)

When the orchestrator receives a termination signal:

1. **Signal handler fires** — set a `shuttingDown` flag.
2. **Stop accepting new tasks** — reject any new team
   creation or task assignment.
3. **Close all agent sessions:**
   a. Close each `PromptChannel` (signals SDK to stop).
   b. Abort any in-flight `query()` calls.
   c. Persist final `state.json` for each team.
4. **Clean up:**
   - Flush all log buffers.
   - Close file handles.
   - Stop the HTTP dashboard server.
   - Exit with code 0.

### Team Shutdown (Single Team)

When `terminateTeam(teamId)` is called:

1. Set team phase to the appropriate terminal state
   (`cancelled` if mid-task, `done` if task complete).
2. Close all agent sessions for the team.
3. Persist final `state.json`.
4. Remove the team from the active team map.

### Signal Handling

| Signal | Action |
|--------|--------|
| `SIGTERM` | Graceful shutdown (full protocol above) |
| `SIGINT` (Ctrl+C) | Same as SIGTERM |
| `SIGINT` x2 (double Ctrl+C) | Immediate force exit |

```typescript
let shutdownRequested = false;

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', () => {
  if (shutdownRequested) {
    process.exit(1);
  }
  shutdownRequested = true;
  gracefulShutdown();
});
```

---

## Resource Management

### Process Limits

| Resource | Limit | Rationale |
|----------|-------|-----------|
| Max concurrent teams | 5 | Each team = up to 4 SDK sessions. 20 sessions is a reasonable ceiling. |
| Max agent sessions total | 20 | 5 teams x 4 agents |

If the user attempts to create a team beyond the limit, the
engine rejects with a clear error message.

### Filesystem Usage

| Directory | Growth Pattern | Cleanup |
|-----------|---------------|---------|
| `.claude-orchestra/teams/{id}/` | Per-team runtime data | Automatic on team termination |
| `state.json` | Fixed size, overwritten | Automatic |
| `registry.json` (engine repo) | Grows with team count | Manual |

**Disk space monitoring:** The engine checks available disk
space on startup. If less than 100 MB is available, log a
warning. If less than 10 MB, refuse to start.

---

## Structured Logging

### Log Format

All log entries are structured JSON written to both terminal
(formatted for readability) and a log file (raw JSON for
machine parsing).

```json
{
  "timestamp": "ISO-8601",
  "level": "info | warn | error | debug",
  "teamId": "team-uuid",
  "phase": "pre_work | work | handoff | review",
  "role": "Worker-1",
  "event": "phase_transition | agent_output | verdict_parsed | pipeline_complete | ...",
  "message": "Human-readable description",
  "data": {}
}
```

### Terminal Formatting

Terminal output uses role-specific colors for scanability:

| Role | Color | ANSI Code |
|------|-------|-----------|
| Worker-1 | Green | `\x1b[32m` |
| Worker-2 | Green | `\x1b[32m` |
| Security | Red | `\x1b[31m` |
| Reviewer | Yellow/Amber | `\x1b[33m` |
| System | Purple | `\x1b[35m` |
| Error | Bright Red | `\x1b[91m` |

### Event Types

| Event | Level | Description |
|-------|-------|-------------|
| `team_created` | info | New team initialized |
| `task_assigned` | info | Task assigned to team |
| `task_classified` | info | Complexity classification result |
| `phase_transition` | info | Team moved to new phase |
| `agent_output` | debug | Agent response text |
| `agent_progress` | debug | Streaming progress text |
| `verdict_parsed` | info | Security/review/verify verdict extracted |
| `pipeline_complete` | info | Task finished successfully |
| `pipeline_error` | error | Pipeline failed |
| `loop_limit_reached` | error | Revision/rejection max exceeded |
| `feedback_sent` | info | Notification sent to dashboard |
| `feedback_blocking` | info | Blocking question sent, pipeline paused |
| `feedback_response` | info | User responded to blocking question |
| `shutdown_initiated` | info | Graceful shutdown started |
| `auto_commit` | info | Git auto-commit at checkpoint |

### Log Files

| File | Contents | Rotation |
|------|----------|----------|
| `orchestra.log` | All events, JSON format | Rotate at 10 MB |
| `orchestra.error.log` | Error events only | Rotate at 5 MB |
| Per-team logs | Team-specific events | Per task, no rotation |

### Log Levels

| Level | When to Use |
|-------|-------------|
| `debug` | Agent output, streaming progress, internal state |
| `info` | Phase transitions, team creation, task assignment, verdicts, auto-commits |
| `warn` | Conservative verdict defaults, reclassification |
| `error` | Pipeline failures, loop limits, SDK errors |

---

## Configuration Reference

All configuration is provided via a JSON config file
(`orchestra.config.json`) in the project root, with CLI flag
overrides for common settings.

### Config File Schema

```json
{
  "engine": {
    "dataDirectory": ".claude-orchestra",
    "logDirectory": ".claude-orchestra/logs"
  },
  "teams": {
    "maxConcurrentTeams": 5
  },
  "models": {
    "Worker": "claude-opus-4-6",
    "Security": "claude-opus-4-6",
    "Reviewer": "claude-opus-4-6"
  },
  "limits": {
    "maxRevisions": 3,
    "maxRejections": 2,
    "maxTotalBackwardTransitions": 5,
    "maxVerifyPasses": 2
  },
  "costBudget": {
    "warningThreshold": 10,
    "hardLimit": 25
  }
}
```

### CLI Flag Overrides

| Flag | Config Path | Description |
|------|------------|-------------|
| `--data-dir <path>` | `engine.dataDirectory` | Data directory location |
| `--max-teams <n>` | `teams.maxConcurrentTeams` | Max concurrent teams |
| `--model-worker <id>` | `models.Worker` | Worker model |
| `--model-security <id>` | `models.Security` | Security model |
| `--model-reviewer <id>` | `models.Reviewer` | Reviewer model |
| `--max-revisions <n>` | `limits.maxRevisions` | Max revision loops |
| `--cost-limit <usd>` | `costBudget.hardLimit` | Cost hard limit |

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | API key for Claude models | Yes (unless using Claude Max) |
| `CLAUDE_ORCHESTRA_LOG_LEVEL` | Override log level (debug/info/warn/error) | No (default: info) |
| `CLAUDE_ORCHESTRA_CONFIG` | Path to config file | No (default: ./orchestra.config.json) |
