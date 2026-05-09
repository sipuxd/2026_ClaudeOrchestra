# Product Roadmap & UX Recommendations

> This is a product and UX roadmap, not the architecture source of truth.
> For current system structure, provider runtime, and workflow rules, see:
> - [Architecture](./architecture.md)
> - [State Machine](./state-machine.md)
> - [Context Management](./context-management.md)
> - [Operations](./operations.md)

This document explains the next product moves that best match ClaudeOrchestra's inner workings: a deterministic execution pipeline with provider-backed agents, security gates, requirements verification, review gates, and live dashboard visibility.

---

## 1. Dashboard Refactor: Split The Single-File SPA

### The Problem

`dashboard-ui.ts` is currently about 1,800 lines of HTML, CSS, and client JavaScript inside one `buildDashboardHTML()` template string. That was the right move to ship quickly with zero UI dependencies, but it is now the bottleneck for future UI work.

The pain is practical:

- CSS, HTML, and client behavior all change in one file.
- Editor support is weak inside giant template strings.
- Small UI changes can create large merge conflicts.
- Portfolio View work would add more complexity to the same file.

### The Recommendation

Split the dashboard into composable builder modules. Keep the same runtime model: no framework, no bundler, no new production UI dependency, and still serve one HTML string from the dashboard server.

```text
src/dashboard/
├── dashboard-server.ts            (unchanged)
├── dashboard-ui.ts                buildDashboardHTML() composer
├── styles.ts                      buildStyles()
├── client-js.ts                   buildClientJS()
└── components/
    ├── sidebar.ts                 buildSidebar()
    ├── phase-bar.ts               buildPhaseBar()
    ├── agent-card.ts              buildAgentCard()
    ├── feedback-panel.ts          buildFeedbackPanel()
    ├── controls.ts                buildControls()
    ├── modals.ts                  buildModals()
    └── portfolio-view.ts          buildPortfolioView()
```

`buildDashboardHTML()` becomes a small composer:

```typescript
export function buildDashboardHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>${buildStyles()}</head>
<body>
  ${buildSidebar()}
  ${buildPhaseBar()}
  ${buildAgentCards()}
  ${buildFeedbackPanel()}
  ${buildPortfolioView()}
  ${buildModals()}
  ${buildControls()}
  <script>${buildClientJS()}</script>
</body>
</html>`;
}
```

### Refactor Rules

- Preserve the current generated dashboard behavior during extraction.
- Keep dashboard runtime dependency-free.
- Extract one surface at a time.
- Add focused tests around generated structure and key client-state reducers where practical.
- Do not build the Portfolio View until the dashboard file is split enough to avoid turning one large file into one larger file.

### Order Of Operations

1. Extract `buildStyles()` into `styles.ts`.
2. Extract `buildClientJS()` into `client-js.ts`.
3. Extract stable components: sidebar, phase bar, agent cards, feedback panel, modals, controls.
4. Add a small dashboard render test for expected root elements and event wiring markers.
5. Build the Portfolio View on top of the new structure.

This is a refactor, not a rewrite. The output should change only when the Portfolio View work begins.

---

## 2. Portfolio View

### What It Is

The Portfolio View is a visual operations dashboard for all active work across all projects. The user should open ClaudeOrchestra and immediately see which teams are healthy, which are moving, which are done, and which need attention.

This is not an inbox. An inbox implies linear processing. ClaudeOrchestra needs spatial scanning: project groups, team cards, attention states, and fast drill-in.

### Why It Matches The Product

ClaudeOrchestra's engine already thinks in projects, teams, agents, phases, verdicts, and gates. The current dashboard is strong for watching one team, but the target user is managing multiple efforts at once.

The Portfolio View makes the pipeline's structure visible:

```text
Projects
└── Teams (bounded by the orchestrator's max concurrent teams setting)
    └── Agents
        ├── Security-1
        ├── Worker-1
        ├── Worker-2
        └── Reviewer-1
```

Simple tasks may only run Worker-1. Standard tasks use the full four-agent path. The active provider is global for the process, so cards should show a single dashboard-level runtime indicator rather than implying mixed provider teams.

### Level 1: Project Sections

The landing dashboard should group teams by `projectPath` from the registry. Each project section gets an aggregate header:

- Project name/path
- Total active teams
- Done count
- Needs-attention count
- In-progress count
- Open PR count

Team cards should encode state visually:

- **Progress**: Scan, Build, Sweep, Review, Done
- **Attention state**: blocked feedback, security blocked, revision needed, rejected, errored, stale/no progress
- **Terminal state**: done, PR open, merged, cancelled
- **Duration**: elapsed time for active work, final duration for completed work
- **Branch/PR**: team branch and PR status where available

The card's job is not to explain everything. Its job is to make the one red or stalled item impossible to miss.

### Level 2: Team Detail Panel

Clicking a team card should open a right-side detail panel while keeping the Portfolio View visible behind it.

The panel should have two modes.

**Summary Mode**

Default for completed, blocked, errored, PR-open, or cancelled teams. This is the trust receipt:

1. **What**: task description and branch
2. **Status**: which gate passed or failed
3. **Action**: create PR, view PR, assign new task, resolve feedback, inspect failure

Expandable sections:

- Worker-1: summary of implementation and files changed
- Worker-2: requirements met/unmet
- Security-1: pre-scan and post-sweep verdicts
- Reviewer-1: verdict and rationale
- Pipeline stats: duration, revision count, rejection count, verification passes

**Live Mode**

Default for actively running teams. This is the current detailed dashboard experience: phase progress, agent cards, streaming output, feedback panel, and controls.

Live Mode should remain available for completed teams so the user can inspect the raw history when needed.

### Sidebar Role

With Portfolio View as the landing page, the sidebar should stop being the main list of teams. It becomes navigation and global control:

- Project list with attention badges
- Runtime indicator: provider/auth/model
- Global create-team action
- Settings
- Active alert count

Clicking a project scrolls the Portfolio View to that section. Team selection belongs to the card grid.

### Data Already Available

The current engine already exposes enough for a useful first version:

- Team/project grouping via registry entries and `projectPath`
- Current phase and terminal phase via `TeamState`
- Agent states and current jobs
- Task description and requirements text
- Loop counters for revisions, rejections, and backward transitions
- Branch name, PR number, and PR URL
- Runtime provider/auth/model via `/api/runtime`
- Live activity through SSE events

### Data To Structure Before The Trust Receipt

The raw output exists, but the Portfolio View should not scrape long agent transcripts every time it renders. The trust receipt needs structured, persisted summary data.

Recommended addition to team state:

```typescript
interface PipelineSummary {
  worker?: {
    summary: string;
    filesChanged: string[];
  };
  verification?: {
    verdict: 'COMPLETE' | 'GAPS_FOUND';
    totalRequirements?: number;
    metRequirements?: number;
    unmetRequirements?: string[];
  };
  security?: {
    preScanVerdict?: 'APPROVED' | 'FLAGGED' | 'BLOCKED';
    postSweepVerdict?: 'APPROVED' | 'FLAGGED' | 'BLOCKED';
    findings?: string[];
  };
  review?: {
    verdict: 'APPROVED' | 'REVISION_NEEDED' | 'REJECTED';
    rationale?: string;
  };
  timing?: {
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
  };
}
```

This summary should be written as the orchestrator parses each phase result. The UI can then render stable product data instead of interpreting prose.

### Implementation Boundary

Portfolio View should mostly be a dashboard feature. The engine changes should be limited to:

- Persisting `PipelineSummary`
- Emitting summary updates through SSE
- Exposing summaries through existing team status APIs

It should not change provider selection, agent prompts, phase transitions, or the pipeline authority model.

---

## 3. Product Direction

### Persona

ClaudeOrchestra is for a technical person who is capacity-constrained and needs to multiply themselves across multiple projects.

This person is not looking for a toy coding chat. They can write useful task descriptions, understand diffs, and judge quality. Their problem is throughput with trust: they need more implementation capacity without losing security, completeness, and review discipline.

Examples:

- Solo SaaS founder maintaining multiple products
- Freelancer or agency operator managing client projects
- Small studio shipping several tools in parallel
- Senior developer or tech lead with more work than time

### Positioning

Do not lead with orchestration mechanics. Lead with the outcome.

Current internal framing:

> Deterministic multi-agent orchestration engine

Stronger product framing:

> Every feature gets security-scanned, requirements-verified, and code-reviewed automatically. Run multiple branches across your projects without babysitting raw agents.

The orchestration is the implementation detail. The user-facing value is:

1. **Throughput**: multiple teams can work in parallel.
2. **Trust**: every branch goes through gates before it is considered done.
3. **Leverage**: one technical person gets the operating rhythm of a small engineering team.

### Relationship To Planning Tools

ClaudeOrchestra is an execution and quality layer. Planning tools are dispatch layers.

A Kanban-style tool decides what should be worked on. ClaudeOrchestra decides how that work safely moves from task description to reviewed branch.

Short-term:

- Build Portfolio View inside ClaudeOrchestra.
- Keep the product self-contained.
- Make the dashboard prove the value of the pipeline before adding integration complexity.

Medium-term:

- Expose ClaudeOrchestra as an MCP-compatible execution backend.
- Let external planning tools create teams, assign tasks, query team state, and open results.
- Keep provider selection global inside ClaudeOrchestra: all Codex or all Claude for a running orchestrator process.

Provider-neutral pitch:

> Instead of sending a task to one raw coding agent, send it through a security scan, implementation pass, requirements verification, security sweep, and code review before you ever see the PR.

### Suggested Priority

1. **Dashboard refactor**: split the single-file SPA without changing behavior.
2. **Pipeline summary data**: persist structured trust-receipt fields.
3. **Portfolio View**: project sections, team cards, attention states, detail panel.
4. **MCP/server interface**: make the pipeline usable from planning tools.

That order keeps the product moving without blurring the engine's current authority model.
