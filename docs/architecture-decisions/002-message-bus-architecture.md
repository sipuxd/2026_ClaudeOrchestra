# Architecture Decision 002: MessageBus — Unused but Archived

**Status:** Archived (built, tested, not used in production)
**Date:** 2026-04-01 (documented)

## What the MessageBus Is

A filesystem-based inter-agent message routing system designed for concurrent, autonomous agent communication. Each agent instance gets an inbox directory. Messages are individual JSON files written atomically (temp file + rename) to prevent partial reads.

Key capabilities:
- **Structured messages** — every message has a sender, recipient, flag (message type), priority, phase, thread ID, and content
- **Route validation** — flag enums define which message types are legal between each role pair (e.g., only Security can send `clearance-report` to Supervisor)
- **Deduplication** — messages are tracked by ID; duplicates are silently dropped
- **Multicast** — setting `roleTargetInstance` to null delivers to all instances of a role
- **Message lifecycle** — `pending → acknowledged → resolved` with status tracking
- **Thread grouping** — related messages share a `threadId` for conversation tracking
- **Pending detection** — finds messages marked `requiresResponse` that haven't been resolved, for stuck/timeout monitoring

## How It Works

The system has three layers:

### Layer 1: Message Schema and Validation
`message-types.ts` defines the `AgentMessage` interface — the structured JSON contract every message must follow. `validateMessage()` checks all fields against the schema (ID format, valid roles, content length limits, etc.).

### Layer 2: Route Rules
`flag-enums.ts` defines enums for each legal role pair (e.g., `WorkerToSecurityFlag.ClearanceRequest`). The `FLAG_VALIDATION_MATRIX` maps every `source → target` route to its legal flags. `isValidFlag()` checks any message against this matrix before it's sent.

### Layer 3: The Bus
`message-bus.ts` ties it together:
- `send(message)` — validates the message, checks the flag route, writes JSON to the target's inbox
- `receive(instance)` — reads all pending messages from an inbox, sorted chronologically
- `acknowledge(messageId, instance)` — moves a message from inbox to archive, marks as acknowledged
- `resolve(messageId)` — marks a message as resolved (no further action needed)
- `getThread(threadId)` — retrieves all messages in a conversation across all inboxes and archives
- `getPending()` — finds unresolved messages that require a response

### Phase Integration
The `PhaseController` consumes messages and evaluates them against the current team phase. Each phase has a handler (`pre-work.ts`, `work.ts`, `handoff.ts`, `review.ts`) that examines incoming messages and returns a `PhaseEvaluation` — whether to transition, where, and what actions the engine should take.

### Archived Reference Files
Full implementation is preserved in `message-bus-reference/`:

| File | What it contains |
|------|-----------------|
| `message-bus.ts` | MessageBus class — send, receive, acknowledge, resolve, thread/pending queries |
| `message-types.ts` | AgentMessage interface, CreateMessageParams, validateMessage() |
| `flag-enums.ts` | Flag enums per role pair, FLAG_VALIDATION_MATRIX, isValidFlag(), getLegalFlags() |
| `phase-controller.ts` | PhaseController class — evaluate, apply, processMessage |
| `pre-work.ts` | Pre-work phase evaluation logic |
| `work.ts` | Work phase evaluation logic |
| `handoff.ts` | Handoff phase evaluation logic |
| `review.ts` | Review phase evaluation logic |
| `message-bus.test.ts` | Tests for MessageBus send/receive/acknowledge/threading |
| `message-contract.test.ts` | Tests for flag validation, route legality, message schema |
| `phase-controller.test.ts` | Tests for phase transitions driven by messages |
| `message-contract.md` | Original message contract specification |

## The Decision: Why We Chose Direct SDK Calls Over the MessageBus

### How we arrived at this conclusion

The MessageBus was built for an architecture where agents communicate autonomously — Worker-1 sends a `clearance-request` to Security-1, Security-1 responds with `clearance-granted`, the Supervisor reads both and decides what happens next. The bus routes, validates, deduplicates, and tracks all of this traffic.

When the Supervisor LLM was eliminated (see [Architecture Decision 001](001-eliminate-supervisor-llm.md)), we examined whether the MessageBus could still serve a purpose without it. The answer came down to one question: **do our agents actually need to talk to each other?**

They don't. The Claude Agent SDK's `query()` and `send()` are request-response calls. You prompt an agent, it responds. An agent cannot independently decide to message Security or ping the Reviewer — it only speaks when spoken to. The MessageBus models autonomous inter-agent communication, but the SDK gives us something closer to function calls.

On top of that, the ClaudeOrchestra pipeline is sequential and fixed: Security scan → Worker-1 implements → Worker-2 verifies → Security sweep → Review. At no point are two agents active simultaneously. There are no competing messages to prioritize, no threads to track across concurrent conversations, no multicast announcements to route. Every capability the MessageBus provides — deduplication, thread grouping, pending detection, route validation, message lifecycle — solves a concurrency problem that this pipeline does not have.

### What we did instead

The `PipelineOrchestrator` (`src/pipeline-orchestrator.ts`) talks to agents directly via sequential SDK `send()` calls. Each step looks like this:

1. Call `send()` on the agent with a prompt string
2. Wait for the response
3. Parse the verdict from the response using `startsWith()` string checks
4. Use an `if/else` branch to decide the next step

There is no message schema, no routing validation, no inbox directories, no acknowledgment lifecycle. The orchestrator constructs prompt strings programmatically and reads plain text responses.

### Why this was the better decision

**The MessageBus adds complexity without adding value for a sequential pipeline.** Every message would need to be constructed as a full `AgentMessage` object (messageId, threadId, timestamp, roleSource, roleTarget, flag, priority, phase, content, references, requiresResponse, status), validated against the schema, checked against the flag routing matrix, written atomically to an inbox directory, then read and parsed by the orchestrator on the other side. All of this to accomplish what a single `send()` call and `startsWith()` check does directly.

**Determinism.** The MessageBus doesn't introduce hallucination risk on its own — it's just plumbing. But it was designed to work with a Supervisor LLM that reads messages and decides what to do next. That combination reintroduces non-deterministic routing. The `PipelineOrchestrator` with direct SDK calls is fully deterministic — the flow is hardcoded TypeScript, not an LLM interpreting message flags.

**Fewer failure modes.** The MessageBus has filesystem operations (atomic writes, temp file cleanup, directory scanning), deduplication state, and message lifecycle tracking. Any of these can fail. The direct approach has none of these — it's a function call that returns a string.

**Debuggability.** Tracing a problem through sequential `send()` calls is reading code top to bottom. Tracing a problem through message inboxes, acknowledgments, thread groupings, and phase controller evaluations across multiple concurrent agents is significantly harder.

### How we know it was the right decision

The `PipelineOrchestrator` has been running the full pipeline — security scans, implementation, verification, security sweeps, code reviews — without the MessageBus, without the PhaseController, and without the Supervisor. The entire message routing layer (8 source files, 3 test files) is unused in production. The pipeline produces the same outcomes with less code, fewer moving parts, and zero routing failures.

The MessageBus wasn't less effective — it was solving the wrong problem. It was built for autonomous concurrent agents, but ClaudeOrchestra runs a sequential pipeline with request-response agents. The right tool for that job is direct function calls, not a message routing system.

## When a MessageBus Architecture Makes Sense

A MessageBus earns its complexity when the work is **parallel, the agents have different specializations, and they need to react to each other's outputs in real time**. If the work is sequential and the order is known upfront, a pipeline wins every time.

### Parallel workers on a shared task
Worker-1 builds the frontend, Worker-2 builds the backend, simultaneously. When Worker-1 changes the API contract, it sends a `sync-request` through the bus. Worker-2 picks it up and adapts. The orchestrator polls both sessions and relays messages — the bus validates routing and prevents illegal communication.

### Microservices monitoring
One agent watches logs, another watches metrics, another watches deployments. The log agent spots errors spiking and messages the metrics agent: "are you seeing latency increases?" The metrics agent correlates and messages the deployment agent: "did something deploy recently?" They triangulate a root cause together instead of one agent trying to do everything sequentially.

### Multi-repo refactor
Renaming an API across 5 repositories. Each repo gets a worker agent. The API repo agent posts "I've updated the interface" and the consumer repo agents need the new contract before updating their code. The bus routes dependency messages between them.

### Game NPC system
Multiple AI characters in a simulation, each with their own goals. They trade information, form alliances, react to each other. The bus validates who can talk to whom and what kinds of messages are legal between character types.

### Customer support triage
A classifier agent reads incoming tickets and routes them to specialist agents — billing, technical, account management. Specialists can escalate to each other through the bus. Route validation ensures a billing agent can't accidentally handle a security incident.

## Trade-offs: MessageBus vs Sequential Pipeline

| | Sequential Pipeline (current) | MessageBus Architecture |
|---|---|---|
| **Execution** | One agent active at a time | Multiple agents active simultaneously |
| **Routing** | Hardcoded in TypeScript | Agents react to messages from each other |
| **Speed** | Slower (sequential) | Faster (parallel work) |
| **Determinism** | 100% predictable | Non-deterministic — agents may send unexpected messages |
| **Debugging** | Linear trace, easy to follow | Interleaved message logs, harder to diagnose |
| **Token cost** | Agents idle when not their turn | All agents active and potentially chatting — each exchange costs money |
| **Failure modes** | Simple — one agent fails, pipeline stops | Complex — deadlocks, circular conversations, message storms |
| **SDK fit** | Natural — request-response maps directly | Requires orchestrator to poll and relay, fighting the SDK's design |

The sequential pipeline is the right choice when the workflow is fixed and well-defined. The MessageBus architecture makes sense when tasks require genuine collaboration between concurrent agents with different specializations.
