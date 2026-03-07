# ClaudeOrchestra — Context Management

> Source of truth for LLM context window strategy, message
> size limits, cost budgets, model selection, and context
> recovery mechanisms.
>
> **Cross-references:**
> - [Message Contract](./message-contract.md) — message size
>   limits
> - [Roles & JTBD](./roles-and-jtbd.md) — prompt sizing per
>   role

---

## Context Window Budget

Each agent is a Claude Code CLI instance with a finite context
window. The budget must account for:

1. **System prompt** — the CLAUDE.md role file
2. **Inbox messages** — accumulated messages read during the
   task
3. **Work context** — files read, code written, tool outputs
4. **Headroom** — space for the agent to generate responses

### Budget Allocation Per Role

| Role | Model | Context Window | System Prompt | Message Budget | Work Context | Headroom |
|------|-------|---------------|---------------|---------------|-------------|----------|
| Supervisor | Sonnet | 200K tokens | ~3K tokens | ~50K tokens | ~100K tokens | ~47K tokens |
| Worker | Haiku | 200K tokens | ~2K tokens | ~20K tokens | ~140K tokens | ~38K tokens |
| Security Agent | Opus | 200K tokens | ~3.5K tokens | ~30K tokens | ~120K tokens | ~46.5K tokens |
| Reviewer | Sonnet | 200K tokens | ~2K tokens | ~20K tokens | ~130K tokens | ~48K tokens |

Workers get the largest work context allocation because they
need to read and write substantial amounts of code. The
Supervisor gets the largest message budget because it
coordinates all communication.

### Context Exhaustion

Claude Code CLI handles context window management internally
through conversation summarization. However, for long-running
tasks with many revision loops, context quality degrades as
the window fills and compresses.

**Mitigation strategies:**

1. **Message pruning in the engine** — the engine only injects
   the most recent messages from an agent's inbox when
   prompting the agent, not the full history. Older messages
   are available in the archive for reference but are not
   injected into context.

2. **Message size limits** — enforced at 8,000 characters per
   message content field (see
   [Message Contract — Size Limits](./message-contract.md#message-size-limits)).

3. **Report offloading** — large payloads (clearance reports,
   code diffs, review feedback) are written to the `reports/`
   directory and referenced by path rather than inlined in
   messages.

4. **Fresh agent on revision** — when a Worker re-enters the
   Work phase after a revision request, the engine MAY
   respawn the Worker with a fresh context containing only:
   - The CLAUDE.md role file
   - The original task assignment
   - The revision feedback
   - The current clearance boundaries
   This avoids accumulated context from the previous attempt.
   This is a configurable behavior (`freshContextOnRevision:
   true|false`, default: `true`).

---

## Model Selection

Model assignment per role is configurable at the team level.

### Default Configuration

| Role | Default Model | Rationale |
|------|--------------|-----------|
| Supervisor | `claude-sonnet-4-6` | Coordination requires strong reasoning but not the deepest analysis |
| Worker-1 | `claude-haiku-4-5` | Code generation at lowest cost; volume role |
| Worker-2 | `claude-haiku-4-5` | Same as Worker-1 |
| Security Agent | `claude-opus-4-6` | Deep analysis of security threats requires highest capability |
| Reviewer | `claude-sonnet-4-6` | Quality evaluation requires good judgment |

### Configuration

Model selection is specified in the team configuration:

```json
{
  "models": {
    "Supervisor": "claude-sonnet-4-6",
    "Worker": "claude-haiku-4-5",
    "Security": "claude-opus-4-6",
    "Reviewer": "claude-sonnet-4-6"
  }
}
```

This can be overridden per team via CLI flags:

```bash
claude-orchestra create-team my-project ./my-app \
  --model-supervisor claude-opus-4-6 \
  --model-worker claude-sonnet-4-6
```

### Cost Implications

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|----------------------|
| Haiku 4.5 | $0.80 | $4.00 |
| Sonnet 4.6 | $3.00 | $15.00 |
| Opus 4.6 | $15.00 | $75.00 |

Estimated cost per task (single pass, no revisions):

| Component | Estimated Tokens | Estimated Cost |
|-----------|-----------------|---------------|
| Supervisor (Sonnet) | ~30K in / ~10K out | ~$0.24 |
| Worker-1 (Haiku) | ~50K in / ~20K out | ~$0.12 |
| Worker-2 (Haiku) | ~50K in / ~20K out | ~$0.12 |
| Security (Opus) | ~40K in / ~15K out | ~$1.73 |
| Reviewer (Sonnet) | ~20K in / ~5K out | ~$0.14 |
| **Total per pass** | | **~$2.35** |

Each revision loop adds roughly 60-80% of the initial cost
(Workers and Security re-run, Supervisor and Reviewer are
lighter on revisions).

---

## Cost Budget

### Per-Task Budget

Each task has a configurable cost budget. When the estimated
token consumption approaches the budget, the engine takes
action.

| Budget Level | Default | Action |
|-------------|---------|--------|
| Warning | $10 | Log warning, surface to human as `high` priority |
| Hard limit | $25 | Pause all agents, escalate to human as `critical` |

### Token Tracking

The engine does not have direct access to API token counts
(those are internal to the Claude Code CLI). Instead, token
consumption is estimated by:

1. **Message volume** — count of messages sent/received,
   multiplied by average message size.
2. **Phase count** — number of phases completed (including
   revisions), multiplied by estimated per-phase cost.
3. **Agent lifetime** — total time each agent has been active,
   as a rough proxy for API usage.

This is an estimate, not a precise measurement. The hard
limit exists as a safety net, not a precise budget tool.

### Configuration

```json
{
  "costBudget": {
    "warningThreshold": 10,
    "hardLimit": 25,
    "currency": "USD"
  }
}
```

---

## Thread Management

### Active Thread Injection

When the engine prompts an agent to check its inbox, it
injects only the **active thread context**, not the full
message history:

1. Read all pending messages from the agent's inbox.
2. For each message, retrieve its `threadId`.
3. For each thread, include only the **last 5 messages** in
   that thread (most recent first).
4. Inject these as context when prompting the agent.

This bounds the context consumed by message history
regardless of how long the task has been running.

### Thread Pruning

Threads are automatically considered "closed" when:
- All messages in the thread have `status: resolved`
- The thread has had no new messages for 10 minutes
- The thread's initiating message has been resolved

Closed threads are not injected into agent context on
subsequent inbox checks.

### Archive Access

If an agent needs historical context from a closed thread,
the engine can retrieve it via `getThread(threadId)`. This
is a pull operation — the agent requests it, and the engine
provides it as a one-time context injection. This prevents
old threads from consuming context budget permanently.

---

## Agent-Engine Communication

### How the Engine Talks to Agents

The engine communicates with Claude Code CLI instances via
**stdin pipe**. Each CLI instance is spawned as a child
process, and the engine writes prompts to the process's
stdin.

```typescript
// Simplified
const agent = spawn('claude', [
  '--model', modelId,
  '--system-prompt', claudeMdPath,
  '--output-format', 'json'
], {
  cwd: projectPath,
  env: {
    ...process.env,
    CLAUDE_ORCHESTRA_ROLE: role,
    CLAUDE_ORCHESTRA_INSTANCE: instance,
    CLAUDE_ORCHESTRA_TEAM_ID: teamId
  }
});

// Send a prompt
agent.stdin.write(prompt + '\n');

// Read response
agent.stdout.on('data', (data) => { /* parse response */ });
```

### How Agents Check Their Inbox

The engine handles inbox polling, not the agents. The flow:

1. Engine's `tick()` loop detects new messages in an agent's
   inbox.
2. Engine reads the message(s).
3. Engine constructs a prompt that includes the message
   content and instructs the agent to process it.
4. Engine pipes the prompt to the agent via stdin.
5. Agent processes and responds via stdout.
6. Engine parses the response and, if it contains outgoing
   messages, writes them to the appropriate inboxes.

**Agents do NOT poll the filesystem directly.** The engine
is the intermediary. This:
- Eliminates the need for agents to understand filesystem
  paths
- Gives the engine control over message injection rate
- Enables context management (thread pruning, message limits)
- Simplifies the CLAUDE.md (agents just receive and respond
  to prompts)

### Agent Response Parsing

Agent responses are expected to contain structured output.
The engine parses responses looking for:

1. **Outgoing messages** — JSON objects matching the message
   schema, indicating the agent wants to send a message to
   another agent.
2. **Work output** — file modifications, commands executed,
   etc. (handled by Claude Code CLI natively).
3. **Status signals** — indications of completion, blockers,
   or progress.

The CLAUDE.md instructs agents to wrap outgoing messages in
a specific delimiter:

```
---ORCHESTRA-MESSAGE-START---
{json message here}
---ORCHESTRA-MESSAGE-END---
```

The engine scans stdout for these delimiters to extract
messages. Everything else is treated as work output.
