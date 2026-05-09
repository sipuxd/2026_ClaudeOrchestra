# Architecture Decision 003: OWASP Top 10 for Agentic Applications (2026) — Gap Analysis

**Status:** Active
**Date:** 2026-04-01 (documented)

## Context

The OWASP Top 10 for Agentic Applications (2026) identifies security risks specific to multi-agent AI systems. ClaudeOrchestra is a multi-agent orchestration engine that spawns provider-backed agent sessions through either Claude Agent SDK or Codex SDK. Tool access depends on the active provider and role: Worker agents can modify code, while Security and Reviewer roles are constrained through disallowed tools or read-only sandboxing. This document maps each OWASP risk to our current coverage and documents mitigations.

## The 10 Risks and Our Coverage

### ASI01 — Agent Goal Hijack

**Risk:** Attackers embed instructions in task inputs (poisoned documents, prompt injection in task descriptions) that alter agent objectives — causing data exfiltration, unauthorized actions, or bypassing security gates.

**Our coverage:** Partially mitigated.
- `security.agent.md` scans for prompt injection patterns during pre-scan
- Both `worker-1.agent.md` and `worker-2.agent.md` include instructions to ignore embedded instructions that contradict the role assignment
- The deterministic pipeline prevents agents from self-routing to skip security gates

**Remaining gap:** Task descriptions come from the dashboard user input and are passed directly to agents as prompt content. A sophisticated injection in the task description could still influence Worker-1's behavior within its cleared scope. A content sanitization layer before the orchestrator would be the full mitigation but is not yet implemented.

---

### ASI02 — Tool Misuse and Exploitation

**Risk:** Agents misuse legitimate tools due to ambiguous prompts or manipulated inputs — accidentally deleting files, running destructive commands, or accessing unauthorized resources.

**Our coverage:** Mitigated.
- Security and Reviewer agents have `Write`, `Edit`, and `Bash` tools explicitly disallowed
- Worker-1's tool access is scoped to the cleared project directory
- Worker-2's frontmatter declares `disallowedTools: Write, Edit, Bash` — the SDK adapter strips those tools before the session starts, so the read-only constraint is enforced rather than merely instructed
- `worker-1.agent.md` includes explicit Bash constraints (no `curl | sh`, no `rm -rf /`, no network calls to unknown hosts)
- Shared guardrail policy is enforced through Claude hooks, Codex stream monitoring, and orchestrator post-phase audits

**Remaining gap:** Codex does not expose a true pre-tool hook callback in the installed SDK. Codex stream aborts are post-detection, so sandboxing and orchestrator audits remain the hard guarantee.

---

### ASI03 — Identity and Privilege Abuse

**Risk:** Agents inherit and escalate user or system credentials, reusing high-privilege tokens across systems unintentionally.

**Our coverage:** Partially mitigated.
- Subscription auth rejects provider API-key environment variables before startup to avoid accidental API-key billing or unintended credential mode
- Runtime adapters strip guarded provider auth variables before spawning provider sessions
- `security.agent.md` checks for leaked credentials in agent outputs during post-sweep
- Security and Reviewer roles are constrained through Claude `disallowedTools` or Codex read-only sandboxing

**Remaining gap:** Per-agent environment scoping is still coarse. Agents inherit the orchestrator process environment after guarded provider variables are removed, so project-specific secrets in the process environment may still be visible to roles that do not need them. A stricter per-role environment allowlist would be the stronger mitigation.

---

### ASI04 — Agentic Supply Chain Vulnerabilities

**Risk:** Compromised tools, plugins, prompt templates, MCP servers, or runtime-loaded dependencies alter agent behavior or expose data.

**Our coverage:** Partially mitigated.
- `security.agent.md` checks `package.json`/lock files for known vulnerable or compromised packages
- `security.agent.md` scans for new or modified MCP server configurations and dynamic imports during pre-scan
- Production dependencies are limited to the provider SDKs and Node built-ins for the dashboard

**Remaining gap:** Agent prompt files (`agents/*.agent.md`) are loaded from the filesystem at runtime. If an attacker can modify these files, they control the agent's behavior. File integrity verification (checksums or signing) is not implemented.

---

### ASI05 — Unexpected Code Execution

**Risk:** Agents generate or execute code unsafely — shell commands, scripts, or system calls without proper validation or sandboxing.

**Our coverage:** Partially mitigated.
- Security and Reviewer agents cannot execute code (Bash is disallowed)
- `worker-1.agent.md` includes explicit constraints: no piped installs (`curl | sh`), no recursive deletions (`rm -rf /`), no `..` path traversal above the project root, no network calls to unknown hosts (Worker-2 cannot run Bash at all per its SDK-level tool denial)
- The pipeline runs Worker-1 in a specific project directory, not system-wide
- Claude Worker tool calls pass through shared `PreToolUse` command/path guardrails
- Codex Worker turns run with network disabled, stream monitoring, abort-on-detection, and post-phase audits before commits

**Remaining gap:** Codex stream monitoring can abort after detecting a forbidden command or file event, but it is not equivalent to Claude's pre-execution hooks.

This is a planned future enhancement.

---

### ASI06 — Memory and Context Poisoning

**Risk:** Attackers poison memory, RAG data, or session context to influence agent behavior across sessions.

**Our coverage:** Not applicable.
- Our agents do not use persistent memory (`memory` frontmatter field is not set)
- No RAG integration exists
- Agent sessions are fresh per pipeline run — no cross-session context carries over
- The `PipelineOrchestrator` constructs prompts programmatically, not from stored context

**Risk level:** None for current architecture. Would become relevant if persistent memory is added.

---

### ASI07 — Insecure Inter-Agent Communication

**Risk:** Multi-agent message exchanges lack authentication, encryption, or validation — enabling identity spoofing and instruction injection.

**Our coverage:** Not applicable.
- Agents do not communicate with each other (see Architecture Decision 001 and 002)
- The `PipelineOrchestrator` talks to each agent directly via SDK `send()` calls
- No message bus, no inter-agent routing, no shared inboxes
- Agent responses are parsed as plain strings, not as trusted instructions

**Risk level:** None for current architecture. The elimination of the Supervisor and MessageBus (Architecture Decisions 001 and 002) removed this attack surface entirely.

---

### ASI08 — Cascading Failures

**Risk:** Small errors propagate rapidly across interconnected agent networks, affecting planning, execution, and downstream systems.

**Our coverage:** Mitigated.
- Pipeline is sequential — one agent at a time, no concurrent cascading
- Loop limits prevent infinite retry cycles: `maxRevisions: 3`, `maxRejections: 2`, `maxTotalBackwardTransitions: 5`
- Agent crashes are caught and can trigger respawn (up to `maxRespawns: 3`)
- The `TeamState` machine transitions to `errored` state when limits are exceeded, halting the pipeline cleanly

---

### ASI09 — Human-Agent Trust Exploitation

**Risk:** Users over-trust persuasive agent recommendations, allowing attackers to influence decisions through deceptive agent explanations.

**Our coverage:** Partially mitigated.
- `worker-1.agent.md` requires Decision Transparency — every implementation decision must include reasoning, options considered, and trade-offs
- `reviewer.agent.md` includes instruction to flag cases where worker reasoning appears designed to persuade rather than inform
- The dashboard displays agent outputs for human review

**Remaining gap:** There is no automated check for manipulative reasoning patterns. The Reviewer flags obvious cases, but a determined attacker crafting persuasive-but-incorrect justifications could pass review. This is fundamentally difficult to automate — human oversight of agent reasoning remains the primary defense.

---

### ASI10 — Rogue Agents

**Risk:** Compromised or misaligned agents act harmfully while appearing legitimate — persisting across sessions, impersonating trusted systems.

**Our coverage:** Partially mitigated.
- Agent sessions are ephemeral — created fresh per pipeline run, no persistence
- The `PipelineOrchestrator` controls all agent inputs; agents cannot self-direct
- Security sweep runs after all work, checking for unauthorized changes
- Pipeline structure ensures no agent can skip the security gate

**Remaining gap:** No integrity verification of agent sessions. If the SDK itself were compromised, or if an agent's system prompt were modified between the security scan and the work phase, there is no detection mechanism. Session integrity hashing would mitigate this but is not implemented.

---

## Summary Table

| Risk | ID | Coverage | Gap Severity |
|------|-----|----------|-------------|
| Agent Goal Hijack | ASI01 | Partial | Medium |
| Tool Misuse | ASI02 | Mitigated | Low |
| Identity & Privilege Abuse | ASI03 | Partial | Medium (SDK limitation) |
| Supply Chain | ASI04 | Partial | Low |
| Unexpected Code Execution | ASI05 | Partial | Low (Codex lacks true pre-tool hooks) |
| Memory & Context Poisoning | ASI06 | N/A | None |
| Insecure Inter-Agent Comms | ASI07 | N/A | None |
| Cascading Failures | ASI08 | Mitigated | None |
| Human-Agent Trust | ASI09 | Partial | Low |
| Rogue Agents | ASI10 | Partial | Low |

## Future Mitigations (Planned)

1. **Task input sanitization** — Content filter before task descriptions reach agents (addresses ASI01)
2. **Agent prompt integrity checks** — Checksum verification of `.agent.md` files at spawn time (addresses ASI04 and ASI10)
3. **Per-agent environment sandboxing** — Scoped credentials per agent role (addresses ASI03, requires SDK support)
4. **Codex pre-tool hook parity** — Replace post-detection stream aborts if the Codex SDK later exposes true hook callbacks.
