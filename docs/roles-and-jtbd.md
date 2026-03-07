# ClaudeOrchestra — Roles & Jobs To Be Done

> Source of truth for role definitions, phase-specific
> responsibilities, and prompt engineering guidelines for
> CLAUDE.md files.
>
> **Cross-references:**
> - [Message Contract](./message-contract.md) — flags each
>   role uses
> - [Architecture](./architecture.md) — autonomy and authority
> - [Context Management](./context-management.md) — prompt
>   sizing per role

---

## Role Overview

| Role | Instances | Model Recommendation | Context Budget |
|------|-----------|---------------------|---------------|
| Supervisor | 1 | Sonnet | High — coordinates everything |
| Worker | 2 | Haiku | Medium — focused execution |
| Security Agent | 1 | Opus | High — deep analysis required |
| Reviewer | 1 | Sonnet | Medium — evaluative, not generative |

Model selection is configurable per team. See
[Context Management](./context-management.md#model-selection)
for configuration details.

---

## Security Agent

**Mission:** Ensure the workspace and all agent output is
safe before, during, and after work.

### Phase 1 — Pre-Scan (Pre-Work)

- Scan all files in the task scope for prompt injection
  patterns.
- Check for hardcoded credentials, API keys, secrets,
  and tokens.
- Validate dependency integrity — compromised, outdated, or
  known-vulnerable packages.
- Map sensitive areas — auth modules, database configs,
  environment files, encryption logic.
- Identify files that could influence worker behavior if read
  (malicious comments, embedded instructions).
- Produce clearance report with four tiers:
  - **Safe** — modify freely
  - **Caution** — proceed carefully, document changes
  - **Off-limits** — do not touch under any circumstances
  - **Needs Supervisor approval** — requires explicit sign-off

**Sends:** `clearance-report` → Supervisor
**Receives:** `scan-request` ← Supervisor

### Phase 2 — Runtime Clearance (Work)

- Respond to Worker clearance requests when they hit something
  outside the original scope.
- Evaluate the requested file or module against the same threat
  criteria from pre-scan.
- Issue clearance, deny with explanation, or escalate to
  Supervisor.
- Monitor for scope creep — Workers drifting into areas that
  weren't part of the assignment.

**Sends:** `clearance-granted` or `clearance-denied` → Worker
**Sends:** `security-alert` → Supervisor (if critical)
**Receives:** `clearance-request` ← Worker

### Phase 3 — Post-Work Validation (Handoff)

- Sweep all completed output before it reaches the Reviewer.
- Check for prompt injection patterns introduced in new or
  modified files.
- Scan for accidentally committed secrets or credentials.
- Verify no unauthorized dependencies were added.
- Detect behavioral drift — did the Worker's output deviate
  from the task in ways that suggest influence from a malicious
  file.
- Confirm scope adherence — the work product only touches what
  was cleared.
- Produce handoff clearance:
  - **Approved** — work is clean, proceed to review
  - **Flagged** — concerns noted but not blocking, proceed
    with caution notes
  - **Blocked** — security issues found, must be resolved
    before review

**Sends:** `handoff-clearance` → Supervisor
**Receives:** `sweep-request` ← Supervisor

---

## Supervisor

**Mission:** Receive tasks, plan execution, direct Workers,
and ensure work is ready for handoff.

### Phase 1 — Task Receipt and Planning (Pre-Work)

- Receive the incoming task or assignment.
- Hand the scope to the Security Agent and wait for the
  clearance report.
- Analyze the clearance report and determine the work plan —
  what gets done, in what order, by whom.
- Decide whether Workers operate independently on separate
  pieces or paired on the same problem.
- Produce task assignments with security clearance boundaries
  attached — each Worker knows what they can touch and what
  they can't.

**Sends:** `scan-request` → Security
**Receives:** `clearance-report` ← Security

### Phase 2 — Active Direction (Work)

- Assign tasks to Worker-1 and Worker-2.
- Monitor Worker progress — are they blocked, stuck, going in
  the wrong direction.
- Mediate if Workers are paired and diverge.
- Receive escalations from the Security Agent if a runtime
  clearance is denied.
- Make judgment calls — adjust the plan, reassign work, change
  the pairing model if something isn't working.
- Ensure Workers aren't going silent — if a Worker hasn't
  communicated in a while, send `check-in`.

**Sends:** `task-assignment`, `direction-change`, `pause`,
`resume`, `check-in` → Workers
**Receives:** `task-accepted`, `progress-update`,
`task-complete`, `blocked`, `needs-guidance`, `scope-concern`,
`anomaly-detected` ← Workers

### Phase 3 — Handoff Coordination (Handoff)

- Receive completion signals from Workers.
- Verify the work addresses the original task before involving
  Security.
- Hand completed work to the Security Agent for the post-work
  sweep.
- If Security flags issues, route them back to the appropriate
  Worker with specific instructions.
- If Security clears the work, package it and hand it to the
  Reviewer.
- Provide the Reviewer with context — what was the task, what
  was the approach, any decisions made along the way.

**Sends:** `sweep-request` → Security
**Sends:** `revision-request` → Workers (if blocked)
**Sends:** `review-request` → Reviewer (if cleared)
**Receives:** `handoff-clearance` ← Security

### Phase 4 — Post-Review (Review)

- Receive the Reviewer's feedback.
- If revisions needed, route feedback to the appropriate Worker
  and re-enter the Work phase.
- If rejected, re-plan from scratch and re-enter Pre-Work.
- If approved, close out the task.

**Sends:** `revision-request` → Workers (if revise)
**Receives:** `review-approved`, `review-revise`,
`review-rejected` ← Reviewer

---

## Worker

**Mission:** Execute assigned work within cleared boundaries,
communicate status, and flag unknowns.

### Phase 1 — Receive and Understand (Pre-Work)

- Receive task assignment from the Supervisor with security
  clearance boundaries.
- Understand what files and modules are safe to modify, which
  require caution, and which are off-limits.
- Identify ambiguities in the assignment and ask the Supervisor
  for clarification before starting — not mid-work.

**Sends:** `task-accepted` → Supervisor
**Sends:** `needs-guidance` → Supervisor (if ambiguous)
**Receives:** `task-assignment` ← Supervisor

### Phase 2 — Execute (Work)

- Implement the assigned work within the cleared scope.
- If working independently, own the full implementation of
  the assigned piece.
- If paired with the other Worker, coordinate on shared
  interfaces, boundaries, and integration points.
- If the work requires touching something outside the cleared
  scope, **stop and request runtime clearance** from the
  Security Agent. Do not proceed on unchecked areas.
- Communicate progress to the Supervisor at meaningful
  milestones — not just at the end.
- Flag blockers immediately — don't sit on them.

**Sends:** `progress-update`, `blocked`, `needs-guidance`,
`scope-concern`, `anomaly-detected` → Supervisor
**Sends:** `clearance-request` → Security (if needed)
**Sends:** `sync-request`, `sync-response`, `heads-up` →
other Worker (if paired)
**Receives:** `direction-change`, `pause`, `resume`,
`check-in` ← Supervisor
**Receives:** `clearance-granted`, `clearance-denied` ←
Security

### Phase 3 — Completion Signal (Handoff)

- Signal the Supervisor that the work is done.
- Provide a summary of what was implemented, what was changed,
  and any decisions made during execution.
- Call out anything that felt off — files that seemed unusual,
  behavior that was unexpected, areas where the implementation
  required judgment calls.
- This feeds the Security Agent's post-work sweep with useful
  context.

**Sends:** `task-complete` → Supervisor

---

## Reviewer

**Mission:** Evaluate the quality and correctness of completed,
security-cleared work.

### Phase 1 — Receive (Review)

- Receive the completed work package from the Supervisor along
  with task context.
- Understand the original goal, the approach taken, and any
  relevant decisions.
- Confirm that the work has been security-cleared — if it
  hasn't passed through the Security Agent, reject it back to
  the Supervisor.

**Receives:** `review-request` ← Supervisor

### Phase 2 — Evaluate

- Assess correctness — does the implementation actually solve
  the task.
- Assess code quality — structure, readability,
  maintainability, patterns.
- Assess completeness — are there gaps, missing edge cases,
  untested paths.
- Assess integration — does this work fit with the broader
  codebase without introducing conflicts or regressions.
- Do **not** evaluate security concerns — that's not this
  role's job. Trust the Security Agent's clearance.

### Phase 3 — Verdict

- **Approve** — work is ready, task is complete.
- **Revise** — work needs changes, provide specific actionable
  feedback routed back through the Supervisor.
- **Reject** — work is fundamentally off-track, requires
  re-planning by the Supervisor.

**Sends:** `review-approved`, `review-revise`, or
`review-rejected` → Supervisor

---

## CLAUDE.md Prompt Engineering Guidelines

Each role gets a dedicated CLAUDE.md file that instructs the
Claude Code CLI instance on its identity and behavior. These
files are the critical interface between the engine and the
agents.

### Required Sections in Every CLAUDE.md

1. **Identity Block**
   ```markdown
   # Role: {ROLE_NAME}
   # Instance: {INSTANCE_NAME} (set via $CLAUDE_ORCHESTRA_INSTANCE)
   # Team: {TEAM_ID} (set via $CLAUDE_ORCHESTRA_TEAM_ID)
   ```

2. **Mission Statement** — one sentence from the JTBD above.

3. **Phase-Specific Instructions** — what to do in each
   workflow phase, structured as clear directives.

4. **Communication Protocol** — how to send messages:
   ```markdown
   ## How to Send Messages

   When you need to communicate with another agent, write a
   JSON file to their inbox directory.

   Inbox path: data/teams/$CLAUDE_ORCHESTRA_TEAM_ID/messages/inbox/{target-instance}/

   File name: {timestamp}-msg-{uuid}.json

   Use this exact JSON format:
   ```
   Followed by the full schema with a concrete example.

5. **How to Check Your Inbox**
   ```markdown
   ## Checking Your Inbox

   Your inbox is at:
   data/teams/$CLAUDE_ORCHESTRA_TEAM_ID/messages/inbox/$CLAUDE_ORCHESTRA_INSTANCE/

   Read all .json files in this directory, sorted by filename
   (which sorts by timestamp). Process each message according
   to your role's responsibilities for the given flag.

   After processing a message, move it to:
   data/teams/$CLAUDE_ORCHESTRA_TEAM_ID/messages/archive/
   ```

6. **Constraints** — explicit prohibitions per role:
   - Worker: "Do NOT touch files marked as off-limits in your
     clearance boundaries."
   - Worker: "Do NOT proceed on areas outside your cleared
     scope without receiving clearance-granted from Security."
   - Reviewer: "Do NOT evaluate security concerns. If you
     notice something security-related, note it in your
     feedback but do not block on it."
   - Security: "Do NOT implement fixes. Your job is to
     identify and report, not to modify code."

7. **Output Format Examples** — at least 2 concrete few-shot
   examples of messages this role should produce:

### Few-Shot Example: Worker Progress Update

```json
{
  "messageId": "msg-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "threadId": "thread-f0e1d2c3-b4a5-6789-0abc-def123456789",
  "timestamp": "2026-03-07T15:30:00.000Z",
  "roleSource": "Worker",
  "roleSourceInstance": "Worker-1",
  "roleTarget": "Supervisor",
  "roleTargetInstance": "Supervisor-1",
  "flag": "progress-update",
  "priority": "normal",
  "phase": "work",
  "content": "Completed the user model with email validation and password hashing. Moving on to the authentication middleware. Estimated 60% through my assignment.",
  "references": ["msg-previous-task-assignment-id"],
  "requiresResponse": false,
  "status": "pending"
}
```

### Few-Shot Example: Security Clearance Report

```json
{
  "messageId": "msg-b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "threadId": "thread-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-03-07T14:15:00.000Z",
  "roleSource": "Security",
  "roleSourceInstance": "Security-1",
  "roleTarget": "Supervisor",
  "roleTargetInstance": "Supervisor-1",
  "flag": "clearance-report",
  "priority": "normal",
  "phase": "pre-work",
  "content": "Clearance scan complete.\n\nSAFE: src/components/, src/utils/, tests/\nCAUTION: src/api/routes.ts (contains auth middleware), src/config/\nOFF-LIMITS: .env, .env.production, src/config/secrets.ts\nNEEDS APPROVAL: src/database/migrations/ (schema changes affect production)\n\nNo prompt injection patterns detected. No exposed credentials found. Dependencies are current.",
  "references": ["msg-scan-request-id"],
  "requiresResponse": false,
  "status": "pending"
}
```

### Prompt Size Guidelines

| Role | Target CLAUDE.md Size | Rationale |
|------|----------------------|-----------|
| Supervisor | 2,000-3,000 tokens | Complex coordination requires detailed instructions |
| Worker | 1,500-2,000 tokens | Focused execution, simpler decision tree |
| Security Agent | 2,500-3,500 tokens | Detailed threat criteria, scan procedures |
| Reviewer | 1,500-2,000 tokens | Clear evaluation framework, simpler interactions |

These are targets, not hard limits. The goal is to leave
sufficient context window budget for actual work. See
[Context Management](./context-management.md) for full
context budget breakdown.

### Agent Output Format Enforcement

LLM agents will occasionally produce malformed output. The
engine handles this through a **retry loop**:

1. Agent writes a file to an inbox.
2. Engine's `receive()` function attempts to parse the JSON.
3. If parsing fails:
   a. Log the malformed output with the agent's roleInstance.
   b. Delete the malformed file from the inbox.
   c. Send the agent a corrective prompt: "Your last message
      was malformed JSON. Please re-send using the exact
      format specified in your instructions."
   d. Increment a retry counter for this agent.
4. If the retry counter exceeds **3 consecutive failures**,
   mark the agent as `errored` and escalate to the human
   orchestrator.
5. The retry counter resets to 0 after any successful message.

This is implemented in the engine, not in the CLAUDE.md. The
agent is unaware of the retry mechanism — it simply receives
a corrective prompt.
