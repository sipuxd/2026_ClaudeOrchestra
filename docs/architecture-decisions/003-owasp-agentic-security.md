# Architecture Decision 003: OWASP Top 10 for Agentic Applications (2026) — Gap Analysis

**Status:** Active
**Date:** 2026-04-01 (documented)

## Context

The OWASP Top 10 for Agentic Applications (2026) identifies security risks specific to multi-agent AI systems. ClaudeOrchestra is a multi-agent orchestration engine that spawns Claude sessions with tool access (including Bash, file writes, and code execution). This document maps each OWASP risk to our current coverage and documents mitigations.

## The 10 Risks and Our Coverage

### ASI01 — Agent Goal Hijack

**Risk:** Attackers embed instructions in task inputs (poisoned documents, prompt injection in task descriptions) that alter agent objectives — causing data exfiltration, unauthorized actions, or bypassing security gates.

**Our coverage:** Partially mitigated.
- `security.agent.md` scans for prompt injection patterns during pre-scan
- `worker.agent.md` includes instructions to ignore embedded instructions that contradict the role assignment
- The deterministic pipeline prevents agents from self-routing to skip security gates

**Remaining gap:** Task descriptions come from the dashboard user input and are passed directly to agents as prompt content. A sophisticated injection in the task description could still influence Worker-1's behavior within its cleared scope. A content sanitization layer before the orchestrator would be the full mitigation but is not yet implemented.

---

### ASI02 — Tool Misuse and Exploitation

**Risk:** Agents misuse legitimate tools due to ambiguous prompts or manipulated inputs — accidentally deleting files, running destructive commands, or accessing unauthorized resources.

**Our coverage:** Mitigated.
- Security and Reviewer agents have `Write`, `Edit`, and `Bash` tools explicitly disallowed
- Worker-1's tool access is scoped to the cleared project directory
- Worker-2 is instructed never to modify code (requirements verification only)
- `worker.agent.md` includes explicit Bash constraints (no `curl | sh`, no `rm -rf /`, no network calls to unknown hosts)

**Remaining gap:** Worker-1's Bash access is constrained by prompt instructions, not by a PreToolUse hook that programmatically validates commands. A hook-based validation layer would be stronger than prompt-based constraints. This is a future enhancement.

---

### ASI03 — Identity and Privilege Abuse

**Risk:** Agents inherit and escalate user or system credentials, reusing high-privilege tokens across systems unintentionally.

**Our coverage:** Partially mitigated.
- All agents share the same `ANTHROPIC_API_KEY` and process environment
- `security.agent.md` checks for leaked credentials in agent outputs during post-sweep
- The SDK's `permissionMode: 'bypassPermissions'` grants all agents the same privilege level

**Remaining gap:** Per-agent credential scoping is not supported by the Claude Agent SDK natively. All agents run with the same API key and environment variables. If Worker-1 has access to a database connection string in the environment, so does the Reviewer. Mitigation would require custom environment sandboxing per agent spawn, which adds significant complexity.

---

### ASI04 — Agentic Supply Chain Vulnerabilities

**Risk:** Compromised tools, plugins, prompt templates, MCP servers, or runtime-loaded dependencies alter agent behavior or expose data.

**Our coverage:** Partially mitigated.
- `security.agent.md` checks `package.json`/lock files for known vulnerable or compromised packages
- `security.agent.md` scans for new or modified MCP server configurations and dynamic imports during pre-scan
- Zero production dependencies besides `@anthropic-ai/claude-agent-sdk` — minimal attack surface

**Remaining gap:** Agent prompt files (`agents/*.agent.md`) are loaded from the filesystem at runtime. If an attacker can modify these files, they control the agent's behavior. File integrity verification (checksums or signing) is not implemented.

---

### ASI05 — Unexpected Code Execution

**Risk:** Agents generate or execute code unsafely — shell commands, scripts, or system calls without proper validation or sandboxing.

**Our coverage:** Partially mitigated.
- Security and Reviewer agents cannot execute code (Bash is disallowed)
- `worker.agent.md` includes explicit constraints: no piped installs (`curl | sh`), no recursive deletions (`rm -rf /`), no `..` path traversal above the project root, no network calls to unknown hosts
- The pipeline runs Worker-1 in a specific project directory, not system-wide

**Remaining gap:** Worker-1's Bash constraints are prompt-based, not enforced programmatically. The proper mitigation is a PreToolUse hook on Bash that validates commands against a blocklist before execution. This would catch cases where the LLM ignores prompt instructions. Example hook:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "scripts/validate-bash-command.sh"
      }]
    }]
  }
}
```

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
- `worker.agent.md` requires Decision Transparency — every implementation decision must include reasoning, options considered, and trade-offs
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
| Tool Misuse | ASI02 | Mitigated | Low (prompt-based, not hook-based) |
| Identity & Privilege Abuse | ASI03 | Partial | Medium (SDK limitation) |
| Supply Chain | ASI04 | Partial | Low |
| Unexpected Code Execution | ASI05 | Partial | Medium (needs PreToolUse hook) |
| Memory & Context Poisoning | ASI06 | N/A | None |
| Insecure Inter-Agent Comms | ASI07 | N/A | None |
| Cascading Failures | ASI08 | Mitigated | None |
| Human-Agent Trust | ASI09 | Partial | Low |
| Rogue Agents | ASI10 | Partial | Low |

## Future Mitigations (Planned)

1. **PreToolUse hook for Bash validation** — Programmatic command blocklist before Worker-1 executes shell commands (addresses ASI02 and ASI05)
2. **Task input sanitization** — Content filter before task descriptions reach agents (addresses ASI01)
3. **Agent prompt integrity checks** — Checksum verification of `.agent.md` files at spawn time (addresses ASI04 and ASI10)
4. **Per-agent environment sandboxing** — Scoped credentials per agent role (addresses ASI03, requires SDK support)
