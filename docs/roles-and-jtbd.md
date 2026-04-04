# ClaudeOrchestra — Roles & Jobs To Be Done

> Source of truth for role definitions, phase-specific
> responsibilities, and prompt engineering guidelines for
> CLAUDE.md files.
>
> **Cross-references:**
> - [Architecture](./architecture.md) — pipeline topology and
>   authority model
> - [Context Management](./context-management.md) — prompt
>   sizing per role

---

## Role Overview

| Role | Instances | Purpose | Autonomy |
|------|-----------|---------|----------|
| Worker-1 | 1 | Implements the task within security-cleared scope | Medium — executes freely within cleared boundaries |
| Worker-2 | 1 | Verifies Worker-1's output against requirements (read-only) | Medium — evaluates but never modifies code |
| Security Agent | 1 | Pre-scan clearance + post-work sweep validation | High — can block work, cannot be overridden |
| Reviewer | 1 | Evaluates quality and correctness of cleared work | Medium — approve, revise, or reject independently |

**Note:** There is no Supervisor LLM. The `PipelineOrchestrator`
(TypeScript code) drives the pipeline deterministically. All
coordination, routing, and decision-making that the original
spec assigned to a Supervisor is now handled by engine code.

Model selection is configurable per team. See
[Context Management](./context-management.md#model-selection)
for configuration details.

---

## Security Agent

**Mission:** Ensure the workspace and all agent output is
safe before, during, and after work.

### Pre-Scan (PreWork Phase)

- Receives a scan request from the engine with the task
  description and project path.
- Scans all files in the task scope for prompt injection
  patterns.
- Checks for hardcoded credentials, API keys, secrets,
  and tokens.
- Validates dependency integrity — compromised, outdated, or
  known-vulnerable packages.
- Maps sensitive areas — auth modules, database configs,
  environment files, encryption logic.
- Classifies task complexity as SIMPLE, STANDARD, or COMPLEX.
  - If SIMPLE, the engine downgrades to the simple pipeline
    (Worker-1 only, no sweep or review).
  - If COMPLEX, the engine applies stricter review criteria.
- Produces clearance report with four tiers:
  - **Safe** — modify freely
  - **Caution** — proceed carefully, document changes
  - **Off-limits** — do not touch under any circumstances
  - **Needs approval** — requires explicit sign-off

### Post-Work Sweep (Handoff Phase)

- Receives a sweep request from the engine with Worker-1
  and Worker-2 summaries.
- Sweeps all completed output before it reaches the Reviewer.
- Checks for prompt injection patterns introduced in new or
  modified files.
- Scans for accidentally committed secrets or credentials.
- Verifies no unauthorized dependencies were added.
- Detects scope violations — work product touches areas
  outside cleared scope.
- Produces handoff verdict:
  - **APPROVED** — work is clean, proceed to review
  - **FLAGGED** — concerns noted but not blocking, proceed
    with caution
  - **BLOCKED** — security issues found, must be resolved
    (triggers automatic retry of Work phase)

---

## Worker-1

**Mission:** Implement assigned work within cleared boundaries,
producing working code that satisfies the task requirements.

### Implementation (Work Phase)

- Receives the task description, approved requirements (if
  present), and security clearance report from the engine.
- Implements the full task within the cleared scope.
- On revision attempts, receives feedback from previous
  security sweeps or reviewer evaluations and addresses
  specific issues.
- On gap-fix attempts, receives Worker-2's checklist of
  unmet requirements and implements only the missing items.

### What Worker-1 Does NOT Do

- Does not communicate directly with other agents.
- Does not make routing or coordination decisions.
- Does not evaluate its own work — that's Worker-2 and
  Reviewer's job.

---

## Worker-2

**Mission:** Verify that Worker-1's implementation satisfies
all task requirements. Acts as an engineering manager —
reads code, checks requirements, never modifies code.

### Requirements Verification (Work Phase)

- Receives the original task, approved requirements, and
  Worker-1's output summary from the engine.
- For each requirement, checks whether it is implemented
  in the code.
- Outputs a checklist:
  ```
  REQUIREMENTS CHECKLIST:
  - [x] Requirement A — implemented
  - [ ] Requirement B — NOT implemented (explanation)
  ```
- Issues a verdict:
  - **COMPLETE** — all requirements are met, proceed to sweep
  - **GAPS_FOUND** — specific requirements are missing,
    Worker-1 must fix them

### Verification Loop

- If GAPS_FOUND, the engine sends the checklist back to
  Worker-1 for fixes, then re-runs Worker-2 verification.
- Maximum 2 verification passes per Work phase entry.
- After 2 passes, proceeds to Security sweep regardless.

### What Worker-2 Does NOT Do

- Does not modify code — read-only verification.
- Does not flag code quality, style, or performance issues.
- Only evaluates against the approved requirements list.
- Does not communicate directly with other agents.

---

## Reviewer

**Mission:** Evaluate the quality and correctness of completed,
security-cleared work.

### Review (Review Phase)

- Receives the task description, approved requirements,
  Worker-1 and Worker-2 summaries from the engine.
- Assesses correctness — does the implementation solve the task.
- Assesses code quality — structure, readability,
  maintainability, patterns.
- Assesses completeness — are there gaps, missing edge cases,
  untested paths.
- Assesses integration — does this work fit with the broader
  codebase.
- For COMPLEX tasks (flagged by Security), applies stricter
  criteria for backward compatibility, data integrity, and
  security.
- Does **not** evaluate security concerns — trusts the
  Security Agent's clearance.

### Verdict

- **APPROVED** — work is ready, task is complete.
- **REVISION_NEEDED** — work needs changes, triggers
  backward transition to Work phase.
- **REJECTED** — work is fundamentally off-track, triggers
  backward transition to PreWork phase (full restart).

---

## Verdict Parsing

The engine parses agent responses using regex-based verdict
detection. Each agent type has its own parser:

### Security Verdict (`parseSecurityVerdict`)

Looks for `APPROVED`, `FLAGGED`, or `BLOCKED` at the start
of the response. Also parses classification (`SIMPLE`,
`STANDARD`, `COMPLEX`) from pre-scan results.

### Review Verdict (`parseReviewVerdict`)

1. Checks for explicit prefix (strongest signal).
2. Scans for pattern keywords (revision/approval/reject).
3. Defaults to `REVISION_NEEDED` if ambiguous (conservative).

### Verify Verdict (`parseVerifyVerdict`)

Looks for `COMPLETE` or `GAPS_FOUND` in Worker-2's response.

---

## CLAUDE.md Prompt Engineering Guidelines

Each role gets a dedicated CLAUDE.md file that instructs the
Claude Code SDK session on its identity and behavior.

### Required Sections in Every CLAUDE.md

1. **Identity Block**
   ```markdown
   # Role: {ROLE_NAME}
   # Instance: {INSTANCE_NAME}
   # Team: {TEAM_ID}
   ```

2. **Mission Statement** — one sentence from the JTBD above.

3. **Phase-Specific Instructions** — what to do when prompted,
   structured as clear directives.

4. **Output Format** — how to structure responses so the
   engine's verdict parser can extract decisions:
   - Security: Begin response with `APPROVED`, `FLAGGED`,
     or `BLOCKED`
   - Reviewer: Begin response with `APPROVED`,
     `REVISION_NEEDED`, or `REJECTED`
   - Worker-2: End response with `COMPLETE` or `GAPS_FOUND`

5. **Constraints** — explicit prohibitions per role:
   - Worker-1: "Do NOT touch files marked as off-limits in
     your clearance boundaries."
   - Worker-2: "Do NOT modify any code. Verification only."
   - Reviewer: "Do NOT evaluate security concerns."
   - Security: "Do NOT implement fixes. Identify and report
     only."

### Prompt Size Guidelines

| Role | Target CLAUDE.md Size | Rationale |
|------|----------------------|-----------|
| Worker-1 | 1,500-2,000 tokens | Focused implementation, simpler instructions |
| Worker-2 | 1,000-1,500 tokens | Narrow scope: checklist verification only |
| Security Agent | 2,500-3,500 tokens | Detailed threat criteria, scan/sweep procedures |
| Reviewer | 1,500-2,000 tokens | Clear evaluation framework |

These are targets, not hard limits. The goal is to leave
sufficient context window budget for actual work. See
[Context Management](./context-management.md) for full
context budget breakdown.
