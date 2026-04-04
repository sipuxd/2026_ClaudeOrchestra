# ClaudeOrchestra — Context Management

> Source of truth for agent session strategy, context window
> budgets, cost estimates, model selection, and the
> agent-engine communication model.
>
> **Cross-references:**
> - [Roles & JTBD](./roles-and-jtbd.md) — prompt sizing per
>   role

---

## Agent-Engine Communication

### SDK Sessions (query API)

Each agent is a Claude Agent SDK `query()` session with a
`PromptChannel` for warm, streaming input. The engine does
NOT spawn CLI child processes or use stdin/stdout pipes.

```typescript
// Simplified — each agent gets a warm session
const session = query({
  model: modelId,
  prompt: promptChannel,       // async iterable of messages
  systemPrompt: claudeMdContent,
  cwd: projectPath,
  options: { maxTurns, allowedTools, disallowedTools },
});
```

### Warm Session Model

- **Cold start:** First `query()` call per session takes
  ~12 seconds. All agents cold-start in parallel.
- **Warm messages:** Subsequent messages within the same
  session are ~2-3 seconds (session stays open).
- **Session persistence:** Sessions remain open for Q&A
  after pipeline completion.

### How the Engine Talks to Agents

1. Engine creates a `PromptChannel` per agent.
2. Engine pushes prompts via `channel.push(promptText)`.
3. SDK processes the prompt and returns a text result.
4. Engine parses the result for verdicts using regex.
5. Engine decides the next pipeline step and sends the
   next prompt to the appropriate agent.

### Image Support

The engine supports sending images (screenshots, mockups)
to agents. Images are base64-encoded and passed through
the `PromptChannel` alongside text prompts.

### No Filesystem Message Bus

Unlike the original spec, agents do NOT poll filesystem
inboxes. The engine communicates directly via SDK sessions.
The message bus and its types were eliminated during
development. The `src/router/` directory contains only
the heuristic complexity classifier.

---

## Context Window Budget

Each agent session has a finite context window. The budget
must account for:

1. **System prompt** — the CLAUDE.md role file
2. **Engine prompts** — accumulated prompts sent during the
   pipeline
3. **Work context** — files read, code written, tool outputs
4. **Headroom** — space for the agent to generate responses

### Budget Allocation Per Role

| Role | System Prompt | Prompt Budget | Work Context | Headroom |
|------|---------------|---------------|-------------|----------|
| Worker-1 | ~2K tokens | ~20K tokens | ~140K tokens | ~38K tokens |
| Worker-2 | ~1.5K tokens | ~15K tokens | ~100K tokens | ~83.5K tokens |
| Security Agent | ~3.5K tokens | ~30K tokens | ~120K tokens | ~46.5K tokens |
| Reviewer | ~2K tokens | ~20K tokens | ~130K tokens | ~48K tokens |

Worker-1 gets the largest work context allocation because it
reads and writes substantial amounts of code. Worker-2 needs
less work context since it only reads (never writes).

### Context Exhaustion

Claude Code handles context window management internally
through conversation summarization. However, for long-running
pipelines with many revision loops, context quality degrades
as the window fills and compresses.

**Mitigation strategies:**

1. **Prompt truncation** — the engine truncates Worker
   summaries to 2,000-3,000 characters when passing them
   to downstream agents (Security sweep, Reviewer).

2. **Focused prompts** — each prompt contains only what the
   agent needs for the current step, not the full pipeline
   history.

3. **Fresh sessions on revision** — when a pipeline restarts
   from PreWork (rejection), all sessions receive fresh
   context. When retrying Work (revision/block), the same
   sessions continue with accumulated context.

---

## Model Selection

Model assignment per role is configurable at the team level.

### Default Configuration

All agents default to the same model. The user can override
per-role if desired.

| Role | Default Model | Rationale |
|------|--------------|-----------|
| Worker-1 | `claude-opus-4-6` | Code generation benefits from highest capability |
| Worker-2 | `claude-opus-4-6` | Requirements verification needs strong reasoning |
| Security Agent | `claude-opus-4-6` | Deep security analysis requires highest capability |
| Reviewer | `claude-opus-4-6` | Quality evaluation requires good judgment |

### Configuration

Model selection is specified in the team configuration:

```json
{
  "models": {
    "Worker": "claude-opus-4-6",
    "Security": "claude-opus-4-6",
    "Reviewer": "claude-opus-4-6"
  }
}
```

### Cost Implications

When using Claude Max (flat rate subscription), per-token
costs do not apply. For API-billed usage:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|----------------------|
| Haiku 4.5 | $0.80 | $4.00 |
| Sonnet 4.6 | $3.00 | $15.00 |
| Opus 4.6 | $15.00 | $75.00 |

Estimated cost per task (single pass, no revisions, Opus):

| Component | Estimated Tokens | Estimated Cost |
|-----------|-----------------|---------------|
| Security (Opus) | ~40K in / ~15K out | ~$1.73 |
| Worker-1 (Opus) | ~50K in / ~20K out | ~$2.25 |
| Worker-2 (Opus) | ~30K in / ~10K out | ~$1.20 |
| Reviewer (Opus) | ~20K in / ~5K out | ~$0.68 |
| **Total per pass** | | **~$5.86** |

Each revision loop adds roughly 60-80% of the initial cost
(Workers and Security re-run; Reviewer is lighter on revisions).

---

## Cost Budget

### Per-Task Budget

Each task has a configurable cost budget. When the estimated
token consumption approaches the budget, the engine takes
action.

| Budget Level | Default | Action |
|-------------|---------|--------|
| Warning | $10 | Log warning, surface to human as `high` priority |
| Hard limit | $25 | Pause agents, escalate to human as `critical` |

### Token Tracking

The engine does not have direct access to API token counts
(those are internal to the SDK). Token consumption is
estimated by:

1. **Phase count** — number of phases completed (including
   revisions), multiplied by estimated per-phase cost.
2. **Verification loops** — each Worker-2 pass adds cost.
3. **Pipeline mode** — simple pipelines cost ~25% of standard.

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
