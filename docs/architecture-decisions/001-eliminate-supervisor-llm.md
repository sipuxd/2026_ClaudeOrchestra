# Architecture Decision 001: Eliminate the Supervisor LLM Agent

**Status:** Accepted  
**Date:** 2026-04-01 (documented)

## Context

The original ClaudeOrchestra design included a **Supervisor LLM agent** — a fifth Claude session whose sole job was control flow. It received the user's task, then decided which agent to invoke next by following prompt instructions:

1. Send task to Security for pre-scan
2. Read Security's verdict, dispatch to Workers
3. Wait for Workers to finish, send back to Security for sweep
4. Read sweep verdict, dispatch to Reviewer
5. Read review verdict, loop back or finish

The Supervisor's prompt (`agents/supervisor.agent.md`) encoded this pipeline as natural language instructions. The Supervisor itself never wrote code — it was purely a dispatcher.

## Problem

Using an LLM for deterministic control flow introduced several issues:

**Non-determinism and hallucination.** The pipeline order (security scan, work, sweep, review) is fixed and never needs creative judgment. But an LLM could skip steps, reorder them, or hallucinate next actions — especially under ambiguous agent responses.

Consider a concrete example: Security-1 returns a scan with `VERDICT: FLAGGED` and a list of caution areas. The Supervisor LLM must interpret this response and decide what to do next. It could:

- Hallucinate that `FLAGGED` means `BLOCKED` and refuse to proceed to work
- Misread a verbose security report and conclude the scan passed clean when it flagged critical files
- Fabricate a security approval that was never issued — "Security has cleared all files" — when the actual response was ambiguous
- Skip the post-work security sweep entirely because it "remembers" the pre-scan was clean
- After a Reviewer `REVISION_NEEDED` verdict, route back to Security instead of Worker, restarting the pipeline unnecessarily

The `PipelineOrchestrator` eliminates this entirely. Verdict parsing is a regex match — `parseSecurityVerdict()` looks for the literal string `APPROVED`, `FLAGGED`, or `BLOCKED` in the agent's response. The routing logic is an `if/else` branch:

```typescript
// This code cannot hallucinate. It either matches the string or it doesn't.
if (verdict === 'APPROVED' || verdict === 'FLAGGED') {
  // proceed to work phase
} else if (verdict === 'BLOCKED') {
  // halt pipeline
}
```

An LLM Supervisor interpreting the same verdict is a probabilistic text-completion call that could produce any output. TypeScript code checking `verdict === 'APPROVED'` has exactly one outcome for each input. There is no hallucination risk because there is no generation — only string comparison.

**Latency.** Every routing decision required a full SDK `query()` round-trip. Cold start is ~12 seconds; warm messages are ~2-3 seconds. The Supervisor added at least one extra LLM call per phase transition — 4-6 unnecessary round-trips per pipeline run.

**Token cost.** The Supervisor consumed tokens to read agent outputs and produce routing decisions that were entirely predictable from the pipeline definition. This cost scaled linearly with pipeline complexity and revision loops.

**Fragile error handling.** If the Supervisor's session crashed or hit a context limit, the entire pipeline stalled with no recovery path. The routing logic lived inside an opaque LLM context window, not in inspectable code.

## Decision

Replace the Supervisor LLM with the `PipelineOrchestrator` TypeScript class (`src/pipeline-orchestrator.ts`). The orchestrator drives the pipeline directly:

```
Security scan → Worker-1 implements → Worker-2 verifies → Security sweep → Review
```

Each step is a sequential `send()` call to the appropriate agent session. Verdicts are parsed from agent responses using regex (`parseSecurityVerdict`, `parseVerifyVerdict`, `parseReviewVerdict`). Loop-back logic (review rejection → rework) is handled by `if/else` branches with configurable limits (`maxRevisions: 3`, `maxRejections: 2`, `maxTotalBackwardTransitions: 5`).

The Supervisor LLM session is never spawned. The `PipelineOrchestrator` *is* the supervisor — implemented as deterministic code rather than a prompt.

## Trade-offs

### What we gained

- **Deterministic execution.** The pipeline cannot skip steps, reorder phases, or hallucinate routing decisions. Security sweep always follows work. Review always follows sweep.
- **Zero routing cost.** No LLM calls, no tokens, no latency for control flow decisions.
- **Inspectable logic.** Routing, loop limits, and phase transitions are readable TypeScript with explicit state machine transitions (`src/state/team-state.ts`).
- **Resilience.** If an agent session fails, the orchestrator catches it and can retry or error out cleanly. The routing logic never crashes independently.

### What we gave up

- **Adaptive routing.** A Supervisor LLM could theoretically adjust the pipeline on the fly (e.g., skip review for trivial changes, add extra security passes for risky ones). The code-driven pipeline is fixed. However, the `classifyComplexity` heuristic (`src/router/complexity-router.ts`) partially addresses this by choosing between simple (Worker-1 only) and standard (full pipeline) modes.
- **Natural language coordination.** The Supervisor could relay context between agents conversationally. The orchestrator constructs prompts programmatically instead, which is less flexible but more predictable.

### Why the trade-off is acceptable

The pipeline is a well-defined, fixed workflow. The routing decisions are entirely mechanical: "if security passed, go to work; if review said revise, go back to work." No step requires judgment about *which* agent to call next — only *what* to tell them. Code handles this better than a prompt.

## Why not fix the Supervisor instead?

A reasonable alternative was to keep the Supervisor LLM but harden it — add hooks to enforce pipeline order, validate outputs against a state machine, use structured response formats, and retry on bad routing decisions.

This would have solved most problems. A state machine guard could reject out-of-order transitions (Supervisor tries to skip security — hook blocks it). Structured outputs could reduce verdict misreading. Retry logic could recover from crashes. With enough defensive infrastructure, the Supervisor could probably reach 95-99% routing reliability.

But hallucination is intrinsic to LLMs. It's not a bug to fix — it's how probabilistic text generation works. You can catch hallucinated outputs after they happen and reject them, but you cannot prevent the model from producing them in the first place. Every mitigation layer is reactive: detect the bad output, discard it, retry, hope the next attempt is correct.

The `PipelineOrchestrator` doesn't need any of that infrastructure because `if (verdict === 'APPROVED')` cannot hallucinate. There is no generation step to go wrong. The question was never "can we make the LLM Supervisor reliable enough?" — it was "why build defensive layers around an unreliable mechanism for a job that plain code handles with 100% reliability?"

## Consequences

### Active

- The `PipelineOrchestrator` class owns all coordination logic (~1,570 lines).
- Agent sessions are created only for the 4 active roles: Security, Worker, Worker (verifier), Reviewer.
- Pipeline mode selection (simple vs standard) is handled by `classifyComplexity`, not an LLM.

### Dead code (cleanup candidates)

- `agents/supervisor.agent.md` — the orphaned prompt file. Still mapped in `ROLE_FILE_MAP` but never loaded.
- `src/roles/role-types.ts` — `Role.Supervisor` enum value and `SupervisorInstance` type.
- `src/router/flag-enums.ts` — `SupervisorToWorkerFlag`, `WorkerToSupervisorFlag`, `SupervisorToSecurityFlag`, `SecurityToSupervisorFlag`, `SupervisorToReviewerFlag`, `ReviewerToSupervisorFlag` enums and their routing table entries.
- `src/spawner/agent-spawner.ts` — Supervisor entries in model defaults, effort levels, denied tools, and max tokens maps.
- `docs/message-contract.md` — Supervisor routing tables and flag definitions.

## References

- `src/pipeline-orchestrator.ts:1-14` — header comment documenting the decision
- `docs/architecture.md:17-20` — "There is no Supervisor LLM"
- `docs/roles-and-jtbd.md:26-29` — "All coordination... now handled by engine code"
