# Product Recommendations

## 1. Dashboard Refactor: Split the Single-File SPA

### The Problem

`dashboard-ui.ts` is 2,619 lines of HTML, CSS, and JS inside a single `buildDashboardHTML()` template string. No syntax highlighting, no autocomplete, no component reuse, no testability. It was the right call to ship fast, but it's now the bottleneck for everything else — the inbox feature, any future UI work, and maintainability.

### The Recommendation

Split into composable builder functions. No framework. No new dependencies. Same output — one HTML string served by the dashboard server.

```
src/dashboard/
├── dashboard-server.ts            (unchanged)
├── dashboard-ui.ts                (slim composer — imports and concatenates)
├── components/
│   ├── sidebar.ts                 buildSidebar()
│   ├── agent-card.ts              buildAgentCard()
│   ├── phase-bar.ts               buildPhaseBar()
│   ├── feedback-panel.ts          buildFeedbackPanel()
│   ├── portfolio-view.ts           buildPortfolioView() — NEW
│   ├── controls.ts                buildControls()
│   └── modals.ts                  buildModals()
├── styles.ts                      buildStyles()
└── client-js.ts                   buildClientJS()
```

`buildDashboardHTML()` becomes ~30 lines:

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

Each builder function is real TypeScript your editor understands. Each can be tested. Each can be modified without merge-conflicting every other piece of the UI.

### Order of Operations

1. Extract `buildStyles()` into `styles.ts` — easiest, lowest risk
2. Extract `buildClientJS()` into `client-js.ts` — biggest win (this is where most of the untestable logic lives)
3. Extract HTML components one at a time (sidebar, agent cards, modals, etc.)
4. Verify `buildDashboardHTML()` still produces identical output after each extraction
5. Then build the Portfolio View on the new structure

This is a refactor, not a rewrite. At no point does the output change.

---

## 2. The Portfolio View

### What It Is

A visual, scannable overview of all work across all projects. The user opens the dashboard and immediately sees the state of every team across every project — encoded in color, shape, and position — without reading a single line of text. They spot the red card, click it, deal with it, move on.

This is not an inbox (which implies linear, sequential processing). It's an **operations dashboard** — designed for spatial scanning, anomaly detection, and fast drill-in.

### Why It Matters

The current dashboard is optimized for watching one team work. The target persona — a capacity-constrained technical person running multiple projects — needs to manage many teams across many projects simultaneously. They weren't watching each one. They need to scan, spot, act.

A user running 3 projects with 3-4 teams each has 9-12 active pipelines, each with 4 agents — up to 48 agent sessions producing output. The Portfolio View exists so they don't have to check all 48.

### The Hierarchy

The product has three levels. The Portfolio View reflects all of them:

```
Projects (multiple)
└── Teams (up to 5 per project, each on its own branch)
    └── Agents (4 per team: Security-1, Worker-1, Worker-2, Reviewer-1)
```

Each level has a distinct role in the UI:
- **Project level** — visual grouping, aggregate status
- **Team level** — card grid, scannable at a glance, the primary interaction point
- **Agent level** — detail view, drill-in only when needed

### Level 1: Project Sections (Card Grid Layout)

The Portfolio View is organized as project sections, each containing a card grid of teams:

```
SaaS App                                          2 done · 1 in review · 1 BLOCKED
┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│ Auth API   │ │ Billing   │ │ Webhooks  │ │ Search    │
│ ■■■■□      │ │ ■■■■■     │ │ ■■□□□     │ │ ■■■□□     │
│ 🔴 BLOCKED │ │ ✅ DONE    │ │ BUILD     │ │ REVIEW    │
│ 14m        │ │ 8m        │ │ 6m...     │ │ 11m...    │
└───────────┘ └───────────┘ └───────────┘ └───────────┘

Marketing Site                                    3 done
┌───────────┐ ┌───────────┐ ┌───────────┐
│ Landing    │ │ Blog      │ │ Forms     │
│ ■■■■■     │ │ ■■■■■     │ │ ■■■■■     │
│ ✅ DONE    │ │ ✅ DONE    │ │ ✅ DONE    │
│ 12m        │ │ 5m        │ │ 9m        │
└───────────┘ └───────────┘ └───────────┘
```

Each team card encodes state visually:
- **5-segment progress bar** — maps directly to the 5 pipeline phases (scan, build, sweep, review, done). Filled segments show progress at a glance.
- **Color** — red = needs attention (blocked, rejected, errored), green = done, blue = actively working, gray = idle
- **Duration** — elapsed time, with `...` suffix if still running

The user scans the grid in under 2 seconds, sees one red card, clicks it. No reading required.

### Level 2: Team Detail (Slide-In Panel)

Clicking a team card opens a **slide-in panel from the right** — the Portfolio View stays visible behind it so the user can close the panel and immediately click the next card without navigating back.

The panel has **two modes**:

**Summary Mode (default for completed or blocked teams):**

Shows structured results from all 4 agents, not raw output:

1. **What** — task description (one line)
2. **Status** — single pass/fail indicator (all gates passed, or which gate failed)
3. **Action** — [Merge to Main] or [View Issue] or [Assign New Task]

Below the fold (expandable, not shown by default):
- Worker-1: what was built, files modified
- Worker-2: X/Y requirements met
- Security-1: pre-scan and post-sweep verdicts
- Reviewer-1: verdict and rationale
- Pipeline stats: duration, revision count, verification passes

This is the "trust receipt" — a structured proof that the work was scanned, built, verified, and reviewed. The detail is there when you need it, but the top-level summary is 3 fields.

**Live Mode (default for actively running teams):**

The current detail view: phase progress bar, 4 agent cards with streaming output, feedback panel, controls. For when you choose to watch a team work in real time — high-stakes tasks, debugging a stuck pipeline, or just curiosity.

The user can toggle between modes. Live mode is also available on completed teams to see the full history of agent output.

### The Sidebar (Redesigned)

The current sidebar lists all teams grouped by project — which duplicates what the Portfolio View already shows. With the Portfolio View as the landing page, the sidebar's role changes.

**The sidebar becomes a persistent navigation rail:**

- **Project list** — project names only (not team lists), with alert badges showing how many teams need attention per project. Clicking a project scrolls the Portfolio View to that project section.
- **Quick-switch** — when you're in a team detail panel, the sidebar lets you jump to a different project without closing the panel and scrolling.
- **Global actions** — [+ New Team] button, settings
- **Active alert count** — total across all projects, visible at the top so you always know if something needs you even while drilled into a detail panel

The sidebar stops listing individual teams. That's the Portfolio View's job. The sidebar is thin, persistent, and purely navigational.

### Data You Already Have

This doesn't require new pipeline data. Everything the Portfolio View needs is already produced by the 4 agents in each team:
- Phase transitions and current phase (from SSE events, per team)
- Security-1 verdicts — pre-scan and post-sweep (parsed by orchestrator)
- Worker-1 completion summaries (from agent output)
- Worker-2 requirement checklists — X/Y met (from verification output)
- Reviewer-1 verdicts and rationale (from review output)
- Duration (from task-assigned to task-complete timestamps, per team)
- Project grouping (from registry — each team has a projectPath)

The Portfolio View is a **visual layer over existing data from all levels of the hierarchy**, not a new feature in the engine.

---

## 3. Product Direction

### The Persona

**A technical person who is capacity-constrained and needs to multiply themselves across multiple projects.**

Not a non-technical founder (they'll use Bolt/Lovable). Not a beginner (they need to write good task descriptions and understand what the pipeline produces). Someone who can run a software business if they just had more hands — and your product gives them those hands with quality guarantees.

Examples:
- Solo SaaS founder maintaining 2-3 products
- Freelancer/agency running 3-4 client projects concurrently
- Small studio shipping multiple products in parallel
- Senior dev/tech lead with more work than time

### The Positioning

Stop leading with orchestration mechanics. Lead with the outcome.

**Current:** "Deterministic multi-agent orchestration engine"

**Recommended:** Something closer to: "Every feature gets security-scanned, verified, and code-reviewed — automatically. Run them in parallel across all your projects."

The orchestration is the implementation detail. The value is:
1. **Throughput** — 5 teams per project, multiple projects, all running in parallel
2. **Trust** — every branch gets a 4-agent pipeline so you're not trading speed for quality
3. **Leverage** — one person does the output of a small engineering org

### Relationship to Vibe Kanban

**They are not competitors.** Vibe Kanban is a planning/dispatch layer — Kanban board, task management, agent-agnostic. It spawns one raw agent per task with no quality process.

ClaudeOrchestra is an execution/quality layer — security, implementation, verification, review. It runs a full pipeline per task.

**Short-term:** Build the Portfolio View yourself. It's a view over data you already have, it keeps you self-contained, and it solves the portfolio management problem for your persona without adding a dependency.

**Medium-term:** Expose ClaudeOrchestra as an MCP server. This lets Vibe Kanban users (or any MCP-compatible tool) plug your pipeline in as the execution engine behind their task cards. Instead of Vibe Kanban spawning one raw Claude Code session, it could spawn a ClaudeOrchestra pipeline. You don't need to build a Kanban board — let them own planning, you own execution quality.

**The pitch to Vibe Kanban's audience:** "Your agents run with `--dangerously-skip-permissions` and no review process. What if each task card ran through a security scan, requirements verification, and code review before you ever saw the diff?"

### Suggested Priority

1. **Dashboard refactor** (split single-file SPA) — unblocks everything else, low risk
2. **Portfolio View** — biggest UX impact for the target persona, built on existing data
3. **MCP server interface** — opens the integration path without forcing you to build a Kanban board
