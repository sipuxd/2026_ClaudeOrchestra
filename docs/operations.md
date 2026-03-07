# ClaudeOrchestra — Operations

> Source of truth for health checks, graceful shutdown, signal
> handling, resource management, structured logging, and
> observability.
>
> **Cross-references:**
> - [State Machine](./state-machine.md) — timeout values,
>   error states
> - [Architecture](./architecture.md) — agent lifecycle
> - [Implementation Plan](../implementation-plan.md) — build
>   milestones

---

## Health Checks

### Agent Health Model

Each agent's health is determined by three signals:

| Signal | Method | Interval |
|--------|--------|----------|
| **Process alive** | PID check (`kill(pid, 0)`) | Every tick (1s) |
| **Responsive** | Message activity tracking | Continuous |
| **Output valid** | JSON parse success rate | Per message |

### Process Health

The spawner monitors each agent's child process:

- **Alive check:** On every `tick()`, verify the PID is still
  running via `kill(pid, 0)` (signal 0 = check existence).
- **Exit detection:** Listen for the `exit` event on the child
  process. Log exit code and signal.
- **Crash detection:** If a process exits unexpectedly (exit
  code !== 0), mark the agent as `errored`.

### Responsiveness

An agent is considered "responsive" if it has produced output
(stdout data) within the silence threshold:

| Role | Silence Threshold | During Phase |
|------|------------------|--------------|
| Worker | 5 minutes | Work |
| Worker | 2 minutes | Pre-Work (should respond quickly) |
| Security Agent | 3 minutes | Any active phase |
| Supervisor | 3 minutes | Any phase |
| Reviewer | 5 minutes | Review |

**Action on silence exceeded:**
1. Supervisor sends `check-in` to silent Workers.
2. For non-Worker roles, log a warning.
3. If silence persists for 2x the threshold, mark agent as
   potentially unhealthy and surface to human as `high`
   priority.
4. If silence persists for 3x the threshold, mark agent as
   `errored`.

### Output Validity

Track the ratio of valid to malformed messages per agent:

- **Healthy:** 0-1 malformed messages in last 10
- **Warning:** 2 malformed messages in last 10
- **Unhealthy:** 3+ consecutive malformed messages → agent
  marked as `errored`

See [Roles & JTBD — Output Format Enforcement](./roles-and-jtbd.md#agent-output-format-enforcement)
for the retry protocol on malformed output.

---

## Crash Recovery

### Agent Crash Recovery

When an agent process crashes (exits unexpectedly):

1. **Detect:** Spawner receives `exit` event with non-zero
   code.
2. **Log:** Record crash details — exit code, signal, last
   stdout/stderr output.
3. **Assess:** Check respawn budget:
   - Each agent gets **3 respawn attempts** per task.
   - If budget exhausted, mark agent as `errored` and
     escalate to human.
4. **Respawn:** If budget allows:
   a. Spawn a new CLI instance with the same CLAUDE.md and
      environment variables.
   b. Inject a **recovery prompt** summarizing:
      - The current task and phase
      - The agent's last known state
      - Recent messages from its inbox (last 5)
      - What the agent was working on (from last
        `progress-update` or similar)
   c. Set agent state to `active`.
   d. Decrement respawn budget.
5. **Resume:** The respawned agent continues from the
   recovery prompt. It does not have the previous instance's
   context window — it starts fresh with the recovery summary.

### Engine Crash Recovery

If the orchestrator process itself crashes:

1. **On restart:** The engine scans `data/teams/` for
   existing team directories.
2. **For each team with `state.json`:**
   a. Read the persisted state.
   b. If `currentPhase` is a non-terminal state (not `done`,
      `cancelled`, or `errored`):
      - Check if agent PIDs are still alive.
      - For alive agents: attempt to reconnect (may not be
        possible if stdin pipe is broken — in that case,
        terminate and respawn).
      - For dead agents: respawn with recovery prompts.
      - Resume the `tick()` loop.
   c. If `currentPhase` is terminal: skip (team is finished).
3. **Message bus recovery:**
   - Clean up orphaned temp files (`.tmp-*`).
   - Rebuild the deduplication set from existing messages.
   - Process any unacknowledged messages in inboxes.

### Data Recovery Priority

| Data | Recovery Method | Reliability |
|------|----------------|-------------|
| Team phase | Read from `state.json` | High (forced write on transitions) |
| Loop counters | Read from `state.json` | High (written with phase) |
| Agent states | Read from `state.json` | Medium (may be up to 1s stale) |
| Pending messages | Scan inbox directories | High (individual files on disk) |
| Agent context | Lost — reconstructed via recovery prompt | Low (summarized, not exact) |
| In-flight work | Depends on Claude Code CLI | Variable (CLI may have written files) |

---

## Graceful Shutdown Protocol

### Engine Shutdown (SIGTERM / SIGINT)

When the orchestrator receives a termination signal:

1. **Signal handler fires** — set a `shuttingDown` flag.
2. **Stop accepting new tasks** — reject any `create-team`
   or `assign-task` calls.
3. **For each active team:**
   a. Persist current `state.json` (forced, synchronous
      write).
   b. Send each agent a **shutdown prompt** via stdin:
      "The orchestrator is shutting down. Please finish your
      current operation and save your progress. You will be
      terminated shortly."
   c. Wait up to **5 seconds** for agents to finish.
   d. Send `SIGTERM` to each agent process.
   e. Wait up to **3 seconds** for graceful exit.
   f. Send `SIGKILL` to any agents still running.
4. **Clean up:**
   - Flush all log buffers.
   - Close file handles.
   - Exit with code 0.

### Team Shutdown (Single Team)

When `terminateTeam(teamId)` is called:

1. Set team phase to the appropriate terminal state
   (`cancelled` if mid-task, `done` if task complete).
2. Send shutdown prompt to each agent (same as above).
3. Follow the same SIGTERM → wait → SIGKILL sequence.
4. Archive all messages to `messages/archive/`.
5. Persist final `state.json`.
6. Remove the team from the active team list.

### Agent Shutdown (Single Agent)

When a single agent needs to be terminated (e.g., to respawn):

1. Send a shutdown prompt via stdin.
2. Wait 3 seconds.
3. Send SIGTERM.
4. Wait 2 seconds.
5. Send SIGKILL if still alive.
6. Update agent state in team state store.

### Signal Handling

Register handlers for:

| Signal | Action |
|--------|--------|
| `SIGTERM` | Graceful shutdown (full protocol above) |
| `SIGINT` (Ctrl+C) | Same as SIGTERM |
| `SIGINT` x2 (double Ctrl+C) | Immediate SIGKILL all agents, exit |
| `SIGHUP` | Ignore (daemon mode) or graceful shutdown |

```typescript
let shutdownRequested = false;

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', () => {
  if (shutdownRequested) {
    // Second Ctrl+C — force kill
    forceKillAll();
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
| Max concurrent teams | 5 | Each team = 5 agents = 5 child processes. 25 processes is a reasonable ceiling for a dev machine. |
| Max agents total | 25 | 5 teams x 5 agents |
| Max open file descriptors | System default (~256 on macOS) | May need `ulimit -n` increase for 3+ teams |

If the user attempts to create a team beyond the limit, the
engine rejects with a clear error message suggesting they
terminate an existing team first.

### Filesystem Usage

| Directory | Growth Pattern | Cleanup |
|-----------|---------------|---------|
| `messages/inbox/{agent}/` | Grows during task, cleared on acknowledge | Automatic |
| `messages/archive/` | Grows indefinitely per task | Manual (or per-team on termination) |
| `reports/` | Grows during task | Manual |
| `state.json` | Fixed size, overwritten | Automatic |

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
  "phase": "pre-work | work | handoff | review",
  "roleSource": "Worker",
  "roleSourceInstance": "Worker-1",
  "roleTarget": "Supervisor",
  "messageId": "msg-uuid",
  "flag": "progress-update",
  "event": "message_sent | message_received | phase_transition | agent_spawned | agent_errored | timeout | deadlock | ...",
  "message": "Human-readable description",
  "data": {}
}
```

### Terminal Formatting

Terminal output uses role-specific colors for scanability:

| Role | Color | ANSI Code |
|------|-------|-----------|
| Supervisor | Blue | `\x1b[34m` |
| Worker | Green | `\x1b[32m` |
| Security | Red | `\x1b[31m` |
| Reviewer | Yellow/Amber | `\x1b[33m` |
| Human/System | Purple | `\x1b[35m` |
| Error | Bright Red | `\x1b[91m` |

### Event Types

| Event | Level | Description |
|-------|-------|-------------|
| `team_created` | info | New team initialized |
| `task_assigned` | info | Task assigned to team |
| `agent_spawned` | info | CLI instance started |
| `agent_errored` | error | Agent crashed or malformed output |
| `agent_respawned` | warn | Agent respawned after crash |
| `message_sent` | debug | Message written to inbox |
| `message_received` | debug | Message read from inbox |
| `message_malformed` | warn | Agent produced unparseable output |
| `phase_transition` | info | Team moved to new phase |
| `timeout_warning` | warn | Message or phase timeout approaching |
| `timeout_exceeded` | error | Timeout limit reached |
| `deadlock_detected` | error | All agents blocked |
| `loop_limit_reached` | error | Revision/rejection max exceeded |
| `shutdown_initiated` | info | Graceful shutdown started |
| `health_check_failed` | warn | Agent unresponsive |
| `validation_error` | warn | Invalid message rejected |

### Log Files

| File | Contents | Rotation |
|------|----------|----------|
| `data/logs/orchestra.log` | All events, JSON format | Rotate at 10 MB |
| `data/logs/orchestra.error.log` | Error events only | Rotate at 5 MB |
| `data/teams/{team-id}/team.log` | Team-specific events | Per task, no rotation |

### Log Levels

| Level | When to Use |
|-------|-------------|
| `debug` | Individual message sends/receives, internal state changes |
| `info` | Phase transitions, team creation, task assignment, agent lifecycle |
| `warn` | Timeouts approaching, malformed output, health check concerns, validation errors |
| `error` | Crashes, deadlocks, loop limits, timeouts exceeded, unrecoverable failures |

---

## Configuration Reference

All configuration is provided via a JSON config file
(`orchestra.config.json`) in the project root, with CLI flag
overrides for common settings.

### Config File Schema

```json
{
  "engine": {
    "tickIntervalMs": 1000,
    "dataDirectory": "./data",
    "logDirectory": "./data/logs"
  },
  "teams": {
    "maxConcurrentTeams": 5
  },
  "models": {
    "Supervisor": "claude-sonnet-4-6",
    "Worker": "claude-haiku-4-5",
    "Security": "claude-opus-4-6",
    "Reviewer": "claude-sonnet-4-6"
  },
  "timeouts": {
    "messageDefault": 180000,
    "phasePre_work": 900000,
    "phaseWork": 3600000,
    "phaseHandoff": 600000,
    "phaseReview": 900000,
    "silenceWorker": 300000,
    "silenceSecurity": 180000,
    "silenceSupervisor": 180000,
    "silenceReviewer": 300000
  },
  "limits": {
    "maxRevisions": 3,
    "maxRejections": 2,
    "maxTotalBackwardTransitions": 5,
    "maxRespawnsPerAgent": 3,
    "maxMalformedRetries": 3
  },
  "context": {
    "freshContextOnRevision": true,
    "maxInboxMessagesInjected": 10,
    "maxThreadMessagesInjected": 5,
    "messageContentMaxChars": 8000,
    "messageTotalMaxBytes": 16384
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
| `--tick-interval <ms>` | `engine.tickIntervalMs` | Main loop interval |
| `--max-teams <n>` | `teams.maxConcurrentTeams` | Max concurrent teams |
| `--model-supervisor <id>` | `models.Supervisor` | Supervisor model |
| `--model-worker <id>` | `models.Worker` | Worker model |
| `--model-security <id>` | `models.Security` | Security model |
| `--model-reviewer <id>` | `models.Reviewer` | Reviewer model |
| `--max-revisions <n>` | `limits.maxRevisions` | Max revision loops |
| `--cost-limit <usd>` | `costBudget.hardLimit` | Cost hard limit |

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | API key for Claude models | Yes |
| `CLAUDE_ORCHESTRA_LOG_LEVEL` | Override log level (debug/info/warn/error) | No (default: info) |
| `CLAUDE_ORCHESTRA_CONFIG` | Path to config file | No (default: ./orchestra.config.json) |
