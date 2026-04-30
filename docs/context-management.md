# ClaudeOrchestra - Context Management

> Source of truth for provider session strategy, context flow,
> prompt sizing, model selection, and agent-engine communication.
>
> Cross-references:
> - [Architecture](./architecture.md) - runtime topology
> - [Roles & JTBD](./roles-and-jtbd.md) - role prompts and responsibilities

---

## Agent-Engine Communication

The active pipeline communicates through a provider-agnostic `AgentSession` interface:

```typescript
interface AgentSession {
  readonly name: string;
  readonly closed: boolean;
  readonly lastActivityLog: string;
  send(message: string, images?: AgentInputImage[]): Promise<string>;
  close(): void;
  waitForCompletion(): Promise<void>;
}
```

The orchestrator does not call provider SDKs directly. It creates sessions through `createAgentSession()` in `src/agent-runtime/factory.ts`.

### Claude Runtime

Claude uses `ClaudeAgentSession`, which wraps the Claude Agent SDK `query()` API:

- A `PromptChannel` async iterable bridges `send()` calls into the SDK stream.
- `systemPrompt` is passed directly from the role prompt file.
- `allowedTools`, `disallowedTools`, `maxTurns`, and `effort` are sent as SDK options.
- Governance hooks are attached for path traversal blocking and TypeScript checking.

### Codex Runtime

Codex uses `CodexAgentSession`, which wraps the Codex SDK/CLI thread API:

- The first `send()` starts a Codex thread.
- The role prompt is prepended to the first user message.
- Later `send()` calls reuse the thread.
- Streamed Codex items are normalized into progress text.
- Image inputs are written under `.claude-orchestra/codex-images/` and passed as local image inputs.
- `disallowedTools` selects a read-only sandbox for review-style roles.

Provider parity notes:

- Claude supports SDK hook callbacks, so path traversal checks and post-edit TypeScript checks run through `buildGovernanceHooks()`.
- Codex currently relies on sandbox mode, disabled network access, and `approvalPolicy: "never"`; it does not yet run the same hook callbacks.
- `maxTurns` is passed to Claude. Codex turn limiting is not currently enforced by the adapter.

---

## Runtime Instructions

Runtime agents receive explicit prompts from:

```text
agents/worker.agent.md
agents/security.agent.md
agents/reviewer.agent.md
agents/security-review.agent.md
```

These are YAML-frontmatter + markdown files. Frontmatter supplies defaults such as model, effort, max turns, and disallowed tools. The markdown body becomes the role system prompt.

Important distinction:

- `AGENTS.md` guides Codex and is imported by `CLAUDE.md` for interactive repo work.
- `CLAUDE.md` guides Claude Code for interactive repo work.
- `agents/*.agent.md` guides ClaudeOrchestra's spawned runtime agents.

Runtime agents do not automatically inherit `AGENTS.md` or `CLAUDE.md`.

---

## No Filesystem Message Bus

The original architecture used a filesystem JSON message bus. Pipeline mode does not use it.

Current communication model:

1. Engine builds a focused prompt for the current phase.
2. Engine calls `session.send(...)`.
3. Provider adapter streams progress and returns final text.
4. Engine parses verdicts with deterministic functions.
5. Engine chooses the next phase.

The message-bus reference code under `docs/architecture-decisions/message-bus-reference/` is historical reference material.

---

## Context Flow

Each provider session accumulates context differently, but the orchestration strategy is the same:

1. Start with a role prompt from `agents/*.agent.md`.
2. Send only the information needed for the current phase.
3. Truncate downstream summaries before sending them to later roles.
4. Keep sessions alive after completion for Q&A where possible.
5. Close sessions on cancellation, error, shutdown, or provider-specific failure.

The orchestrator intentionally passes summaries between agents instead of full transcripts. This keeps later prompts focused and reduces context pollution.

### Summary Truncation

Current truncation points in the pipeline:

| Context | Limit |
|---------|-------|
| Worker-1 output passed to Worker-2 | 3,000 characters |
| Worker summaries passed to Security sweep | 2,000 characters each |
| Worker summaries passed to Reviewer | 2,000 characters each |
| Final security-review diff | 80,000 characters |

When more detail is needed, agents can inspect files directly within the target project.

---

## Image Support

The engine accepts image attachments on task creation, task assignment, and Q&A.

Claude adapter:

- Sends base64 image content through the SDK user message format.

Codex adapter:

- Writes image bytes to `.claude-orchestra/codex-images/`.
- Sends local image paths through Codex input items.

---

## Model Selection

Model selection is global-first.

1. If `agentRuntime.model` is set and not `"default"`, every role uses it.
2. If the provider is Codex and no global model is set, Codex chooses its default.
3. If the provider is Claude and no global model is set, role frontmatter/per-role config can provide Claude model IDs.

Example Codex config:

```json
{
  "agentRuntime": {
    "provider": "codex",
    "auth": "subscription",
    "model": "gpt-5.5"
  }
}
```

Example Claude config:

```json
{
  "agentRuntime": {
    "provider": "claude",
    "auth": "subscription",
    "model": "claude-opus-4-6"
  }
}
```

---

## Effort Selection

Effort is configured per role and translated at the provider boundary.

Recommended while building this project:

```json
{
  "efforts": {
    "Worker": "xhigh",
    "Security": "high",
    "Reviewer": "high"
  }
}
```

Provider-native names:

| Provider | Native effort names |
|----------|---------------------|
| Codex | `minimal`, `low`, `medium`, `high`, `xhigh` |
| Claude Agent SDK | `low`, `medium`, `high`, `max` |

Codex VS Code may only show Low, Medium, High, and Extra High. Extra High is `xhigh` in config/SDK terms.

Compatibility mapping:

| Config value | Codex adapter | Claude adapter |
|--------------|---------------|----------------|
| `max` | `xhigh` | `max` |
| `xhigh` | `xhigh` | `max` |
| `minimal` | `minimal` | `low` |

---

## Subscription Auth And Cost

ClaudeOrchestra is currently designed for subscription/OAuth operation rather than API-key billing:

- Claude uses Claude subscription auth through Claude Agent SDK.
- Codex uses ChatGPT/Codex subscription auth through Codex SDK/CLI.
- API-key environment variables are rejected when subscription auth is selected.

Older API pricing and token-budget estimates are intentionally not treated as operational guidance for the current subscription runtime. If API billing is added later, it should be modeled as a separate auth mode with explicit config, docs, and budget controls.

---

## Context Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| Long-running sessions accumulate stale context | Phase prompts are focused and summaries are truncated |
| Worker summary too long for downstream agents | Orchestrator truncates to fixed character limits |
| Runtime agents miss shared repo conventions | Put required runtime guidance directly in `agents/*.agent.md` |
| Provider event formats differ | Adapters normalize progress/output into `AgentSession` |
| Codex and Claude effort names diverge | `src/agent-runtime/effort.ts` owns mapping |
