# ClaudeOrchestra — Project Instructions

## Build Sequence

Read `implementation-plan.md` for the full 8-milestone build
plan. Each milestone has a **Reference** section pointing to
its source-of-truth document in `docs/`. Build in order. Do
not skip ahead.

## Document Map

- `implementation-plan.md` — what to build and in what order
- `docs/message-contract.md` — JSON schema, flags, validation
  (Milestones 1-2)
- `docs/state-machine.md` — workflow states, transitions,
  timeouts (Milestones 3, 6)
- `docs/roles-and-jtbd.md` — role definitions, CLAUDE.md
  prompt guidelines (Milestone 5)
- `docs/context-management.md` — agent-engine communication,
  model selection (Milestones 4-5)
- `docs/operations.md` — health checks, shutdown, logging,
  config (Milestones 4, 8)
- `docs/architecture.md` — topology, autonomy, authority
  (Milestone 7)

## Sandbox Policy

### Milestones 1-3: Sandboxed

Milestones 1-3 (types, message bus, state store) should run
with sandboxing enabled. All work is file I/O within the
project directory — no external process execution needed.

### Milestones 4-8: Unsandboxed

Starting at Milestone 4 (Agent Spawner), sandboxing must be
disabled. The engine spawns Claude Code CLI instances as child
processes using Node.js `child_process.spawn()`. Sandboxing
blocks this because it restricts process execution to the
project directory.

Integration tests in Milestones 4-8 also spawn real processes
to validate the engine works end-to-end.

### How to Disable Sandboxing

When the human is ready to start Milestone 4, remind them to
disable sandboxing and explain why before proceeding.

**To disable:** Type `/sandbox` in the Claude Code CLI prompt
to toggle sandboxing off. The CLI will confirm with:
"Bash commands will no longer be sandboxed."

**To re-enable later:** Type `/sandbox` again to toggle it
back on.

**Why it's needed:** The orchestration engine's core job is
spawning and managing Claude Code CLI instances as child
processes. Sandboxed mode restricts bash commands to safe
operations within the project directory, which prevents
`child_process.spawn()` from launching external processes.
Without disabling the sandbox, the agent spawner cannot
function and integration tests will fail.

**Risk context:** Unsandboxed mode allows the CLI to execute
any bash command. Only disable when actively working on
Milestones 4-8. Re-enable if switching to documentation-only
or type-only work.
