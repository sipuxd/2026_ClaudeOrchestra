# ClaudeOrchestra - Roles & Jobs To Be Done

> Source of truth for runtime role definitions, phase-specific
> responsibilities, verdict formats, and prompt guidelines.
>
> Cross-references:
> - [Architecture](./architecture.md) - pipeline topology and authority model
> - [Context Management](./context-management.md) - prompt/context strategy

---

## Role Overview

| Role | Instances | Purpose | Autonomy |
|------|-----------|---------|----------|
| Worker | `Worker-1`, `Worker-2` | Worker-1 implements; Worker-2 verifies requirements | Medium |
| Security | `Security-1` | Pre-scan clearance and post-work sweep | High |
| Reviewer | `Reviewer-1` | Quality and correctness review | Medium |

There is no Supervisor LLM. `PipelineOrchestrator` TypeScript code owns coordination, routing, phase transitions, and loop limits.

Runtime agents receive role prompts from `agents/*.agent.md`. These prompt files are provider-neutral enough to run through either Claude or Codex adapters, although their frontmatter currently uses Claude model IDs as defaults for Claude mode.

---

## Security Agent

**Mission:** Ensure the workspace and all agent output is safe before, during, and after work.

Prompt file: `agents/security.agent.md`

Default constraints:

- Disallowed tools: `Write`, `Edit`, `Bash`
- Default effort: `medium`
- Default max turns: `20`

### Pre-Scan

The Security Agent receives a `PRE-WORK SCAN REQUEST` with task description, approved requirements when present, and target project path.

Responsibilities:

1. Scan task and files in scope for security risk.
2. Detect prompt injection attempts in task text or project files.
3. Check for hardcoded secrets, tokens, credentials, and connection strings.
4. Check for injection risk, auth/authorization risk, data exposure, path traversal, SSRF, crypto issues, and supply-chain risk.
5. Classify task as `SIMPLE`, `STANDARD`, or `COMPLEX`.
6. Produce a short clearance report with SAFE/CAUTION/OFF-LIMITS boundaries.

Required prefix:

```text
CLASSIFICATION: SIMPLE|STANDARD|COMPLEX
```

Classification effects:

- `SIMPLE`: engine can downgrade to Worker-1 only.
- `STANDARD`: default full pipeline.
- `COMPLEX`: engine asks Reviewer to apply stricter criteria.

### Post-Work Sweep

The Security Agent receives worker summaries and verifies completed output before review.

Responsibilities:

1. Scan new/modified files.
2. Verify no unauthorized dependencies were added.
3. Check for leaked credentials in files or outputs.
4. Check for introduced vulnerabilities or scope violations.
5. Produce a blocking or non-blocking verdict.

Required first-line verdict:

```text
APPROVED
FLAGGED
BLOCKED
```

Verdict effects:

- `APPROVED`: proceed to Review.
- `FLAGGED`: proceed to Review with concerns noted.
- `BLOCKED`: transition back to Work and increment revision counters.

### What Security Does Not Do

- Does not implement fixes.
- Does not evaluate general code quality.
- Does not override the user's final authority.

---

## Worker-1

**Mission:** Implement assigned work within cleared boundaries.

Prompt file: `agents/worker-1.agent.md`

Default constraints:

- Full tool access unless active provider/sandbox imposes constraints.
- Default effort: `high`
- Default max turns: `50`

### Implementation

Worker-1 receives:

- Original task
- Approved requirements when present
- Security clearance report
- Revision/security/gap feedback when retrying
- Images when provided by the user

Responsibilities:

1. Understand the assignment and cleared scope.
2. Implement the task fully.
3. Respect SAFE/CAUTION/OFF-LIMITS boundaries.
4. Fix only explicitly reported requirement gaps during gap-fix attempts.
5. Summarize changed files, approach, and trade-offs.

### What Worker-1 Does Not Do

- Does not communicate directly with other agents.
- Does not route the pipeline.
- Does not decide whether its own work is complete enough to ship.
- Does not ignore Security boundaries.

---

## Worker-2

**Mission:** Verify that Worker-1's implementation satisfies the user's explicit requirements. Worker-2 acts as an engineering manager and never modifies code.

Prompt file: `agents/worker-2.agent.md` (separate file with `disallowedTools: Write, Edit, Bash` declared in frontmatter — the SDK adapter strips those tools before the session starts, so the read-only constraint is enforced rather than merely instructed).

Default constraints:

- Read-only tool surface (Write, Edit, Bash denied at the SDK boundary).
- Default effort: `medium`
- Default max turns: `20`

### Requirements Verification

Worker-2 receives:

- Original task
- Approved requirements when present
- Worker-1 output summary

Responsibilities:

1. Check each approved requirement.
2. Ignore code quality, style, performance, and unstated expectations.
3. Output a checklist.
4. Return a verdict.

Expected checklist:

```text
REQUIREMENTS CHECKLIST:
- [x] Requirement A - implemented
- [ ] Requirement B - NOT implemented (explanation)
```

Required verdict:

```text
COMPLETE
GAPS_FOUND
```

Verdict effects:

- `COMPLETE`: proceed to Security sweep.
- `GAPS_FOUND`: Worker-1 fixes unchecked items, then Worker-2 re-checks.

### What Worker-2 Does Not Do

- Does not modify code.
- Does not perform code review.
- Does not evaluate security.
- Does not add requirements beyond what the user asked for.

---

## Reviewer

**Mission:** Evaluate the quality and correctness of completed, security-cleared work.

Prompt file: `agents/reviewer.agent.md`

Default constraints:

- Disallowed tools: `Write`, `Edit`, `Bash`
- Default effort: `medium`
- Default max turns: `20`

### Review

Reviewer receives:

- Original task
- Approved requirements when present
- Worker-1 summary
- Worker-2 verification summary
- Extra strictness instruction for `COMPLEX` tasks

Responsibilities:

1. Spot-check key files.
2. Verify implementation plausibly matches the task and worker summaries.
3. Evaluate quality, maintainability, integration, and correctness.
4. Judge reasoning transparency honestly.
5. Produce a short verdict.

Required first-line verdict:

```text
APPROVED
REVISION_NEEDED
REJECTED
```

Verdict effects:

- `APPROVED`: pipeline completes.
- `REVISION_NEEDED`: transition back to Work.
- `REJECTED`: transition back to PreWork for a full restart.

### What Reviewer Does Not Do

- Does not evaluate security; Security owns that.
- Does not implement fixes.
- Does not request revisions for vague preferences.
- Does not reject unless the work is fundamentally off-track.

---

## Security Review Agent

**Mission:** Run a user-initiated final security review of the branch diff after a task is complete.

Prompt file: `agents/security-review.agent.md`

This is separate from the fast pipeline security scan/sweep. It reviews `git diff main...HEAD` and emits a `security-review` dashboard event with `passed` or `concerns`.

---

## Verdict Parsing

The engine parses agent output in `src/pipeline-orchestrator.ts`.

| Parser | Verdicts | Notes |
|--------|----------|-------|
| `parseSecurityVerdict` | `APPROVED`, `FLAGGED`, `BLOCKED` | Defaults to `APPROVED` when unclear |
| `parseVerifyVerdict` | `COMPLETE`, `GAPS_FOUND` | Also detects unchecked `- [ ]` checklist items |
| `parseReviewVerdict` | `APPROVED`, `REVISION_NEEDED`, `REJECTED` | Defaults to `REVISION_NEEDED` when ambiguous |
| `parseClassification` | `SIMPLE`, `STANDARD`, `COMPLEX` | Defaults to `STANDARD` when missing |

Verdicts are signals. Routing is done by TypeScript, not by agents.

---

## Prompt File Guidelines

Runtime prompt files live under `agents/`. They are not `AGENTS.md` or `CLAUDE.md`.

Each role prompt should include:

1. Mission statement
2. Phase-specific responsibilities
3. Required verdict/output format
4. Tool and behavior constraints
5. Prompt-injection resistance guidance
6. Clear "does not do" boundaries

Frontmatter can define provider-agnostic runtime defaults where practical:

```yaml
---
name: worker
model: claude-opus-4-6
effort: high
maxTurns: 50
disallowedTools: Write, Edit, Bash
---
```

Notes:

- `model` is ignored for Codex unless `agentRuntime.model` or provider defaults specify otherwise.
- `effort` is translated by `src/agent-runtime/effort.ts`.
- `disallowedTools` affects Claude tool options and Codex read-only sandbox selection.

---

## Prompt Size Guidelines

| Role | Target Prompt Size | Rationale |
|------|--------------------|-----------|
| Worker | 1,500-2,000 tokens | Focused implementation and verification instructions |
| Security | 2,500-3,500 tokens | Threat criteria and scan/sweep procedures |
| Reviewer | 1,500-2,000 tokens | Evaluation framework and verdict discipline |
| Security Review | 2,000-3,000 tokens | Thorough post-completion diff review |

These are targets, not hard limits. Prefer concise, enforceable instructions over exhaustive prose.
