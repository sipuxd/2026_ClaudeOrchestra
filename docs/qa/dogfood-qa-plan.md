# ClaudeOrchestra Dogfood QA Plan

**For:** a coding agent with terminal + browser ("computer mode") access, running on this Mac.
**Engine repo:** `/Users/josephsip/Documents/__ClaudeOrchestra/2026_ClaudeOrchestra`
**Scope:** validate the July 2026 hardening batch (security surface, pipeline correctness,
dashboard robustness) end-to-end by driving the real dashboard against a fresh throwaway
target repo. Every expected string below was extracted from the current source with
file:line evidence — treat mismatches as findings, not test bugs.

**Result vocabulary:** `PASS` / `FAIL` / `BLOCKED` (environment prevented the test) /
`FINDING` (behavior differs from expectation in a way worth reporting).

**Report:** write `docs/qa/qa-report-<YYYY-MM-DD>.md` in the engine repo — one row per
test ID: `ID | Result | Evidence` (evidence = command output snippet or a screenshot path
under `docs/qa/evidence/`). Screenshot anything visual. End the report with a Findings
section listing every FAIL/FINDING with repro steps.

**Known-suspect issue to confirm (do not skip):** the done-phase **Create PR button is
believed orphaned** — `window.__modal.createPR()` exists in `dashboard-ui.ts:2775` but no
rendered element calls it since the side-panel redesign (commit `625e43d`). Expected
symptom: at phase `done` the panel action row shows only "Security Review". T6.1 verifies.

---

## S0 — Environment setup

- **T0.1 Build.** In the engine repo: `npm run build` → exit 0. (The dashboard serves from
  `dist/`; never skip this.)
- **T0.2 Port check.** `lsof -iTCP:3460 -sTCP:LISTEN -P`. If busy, `curl -s http://127.0.0.1:3460/api/runtime`
  — if it answers with runtime JSON, an engine instance is already up: **reuse it** and note
  that in the report. If something non-engine holds the port: mark S1+ BLOCKED where
  dependent and report.
- **T0.3 Launch.** If not already running: `npm run dashboard` in a background terminal.
  Startup log must NOT contain the non-loopback warning (`WARNING: binding to non-loopback host`).
- **T0.4 Throwaway target repo.** Create a brand-new repo — NEVER attach teams to any
  existing project. `cd ~/Documents && gh repo create qa-dogfood-$(date +%Y%m%d) --private --add-readme --clone`.
  Then `cd qa-dogfood-*` and `printf 'scratch\n' > tmp-note.txt && git add -A && git commit -m "seed" && git push`.
  (The `tmp-note.txt` file is bait for T5.2.)
- **T0.5 Open the dashboard** in the browser: `http://localhost:3460`. Header shows a
  runtime pill (`<provider> / <auth> / <model>`) and the auth pill.
- **T0.6 Auth.** Auth pill must read `<email> · <subscriptionType>` (signed in). If it reads
  `Connect Claude account`, `CLI not found`, or `Env conflict`: mark S3–S8 BLOCKED (agents
  can't run), still execute S1–S2, and report.

## S1 — Server security surface (curl; all against `http://127.0.0.1:3460`)

- **T1.1 Loopback bind.** `lsof -iTCP:3460 -sTCP:LISTEN -P -n` → listener on `127.0.0.1:3460`
  only (no `*:3460` / `0.0.0.0`).
- **T1.2 Non-JSON POST → 415.** `curl -si -X POST /api/teams -H "Content-Type: text/plain" -d 'x'`
  → `415`, body `{"error":"Unsupported Media Type: application/json required"}`.
- **T1.3 Cross-origin POST → 403.** `curl -si -X POST /api/teams -H "Content-Type: application/json" -H "Origin: http://evil.example" -d '{}'`
  → `403`, body `{"error":"Cross-origin request refused"}`.
- **T1.4 Bad Host header → 403.** `curl -si /api/teams -H "Host: evil.example"`
  → `403`, body `{"error":"Host not allowed"}` (DNS-rebinding defense; applies to GET too).
- **T1.5 Traversal team name → 400.** `curl -si -X POST /api/teams -H "Content-Type: application/json" -d '{"name":"../evil","projectPath":"<throwaway abs path>"}'`
  → `400`, body `{"error":"Team name must not contain \"..\"."}`.
- **T1.6 Deleted routes → 404.** With `-H "Content-Type: application/json"`:
  `POST /api/teams/x/push-merge` → `404 {"error":"Not found"}`; `POST /api/resolve-directory` → same.
- **T1.7 No CORS grants.** `curl -si -X OPTIONS /api/teams` → `204` with **no**
  `Access-Control-Allow-Origin` header in the response.

## S2 — Portfolio UI basics (browser)

- **T2.1 Load.** Dashboard renders; `+ Add Project` button visible (top-right, or in the
  empty state "No projects yet").
- **T2.2 Add the throwaway project.** Preferred deterministic path (the UI button opens a
  NATIVE macOS folder picker, which is awkward for browser automation):
  `curl -s -X POST http://127.0.0.1:3460/api/portfolio -H "Content-Type: application/json" -d '{"projectPath":"<throwaway abs path>"}'`
  then reload the page. Project section appears with `+ Add Team`, `Run`, and stat pills.
  *Optional bonus:* also click `+ Add Project` once and record what the native picker
  experience is like (toast: "Opening folder picker — check your Mac…"); cancel it.

## S3 — Team creation + coordinator chat (browser)

- **T3.1 Create team.** Click `+ Add Team` → modal titled **Create Team** (name placeholder
  `my-feature-team`, helper "After creation, the team's chat panel opens. Your first message
  becomes the task."). Name it `qa-team-1`, click **Create** → toast `Team "qa-team-1" created`,
  side panel auto-opens with regions Header / Agents (4) / **Chat with Coordinator** / composer
  (placeholder: `Type a message — e.g. 'Why did Worker-2 flag X?'`), input focused.
- **T3.2 RESPOND turn + no doubled reply.** Send: `What is this team's current status? Do not start any work.`
  → bubble `Coordinator is thinking…`, Send button becomes **Cancel**; then exactly ONE
  coordinator reply. **Scrutinize the reply body for internal duplication** (the same
  paragraph rendered twice was a fixed bug — regression check).
- **T3.3 Composer draft survives re-renders.** Type a partial sentence into the composer,
  do NOT send. Trigger UI churn (e.g. run T3.2's turn from a second message, or wait for
  SSE activity), and confirm the typed text AND caret position persist across panel
  re-renders.
- **T3.4 Chat hydration on reload.** Reload the page, reopen the team panel → all prior
  chat bubbles reappear (authors `You` / `Coordinator`, HH:MM timestamps, verdict pills).

## S4 — Standard pipeline + requirements checklist (browser; one pipeline at a time)

- **T4.1 Trigger.** In `qa-team-1` chat send exactly:
  `Build a Node script src/greet.js exporting greet(name) that returns "Hello, <name>!", add tests/greet.test.js using node:test, and document usage in README.md.`
  Coordinator should emit `TRIGGER_PIPELINE` (verdict pill on the message) and the pipeline starts.
- **T4.2 Requirements Checklist.** A blocking prompt appears in the Agents region: title
  **Requirements Checklist**, message "Review the extracted requirements before agents
  start. You can edit them before approving.", buttons **Approve** / **Skip** / **Edit**.
- **T4.3 Edit flow.** Click **Edit** → inline textarea; append a line
  `- Include at least two test cases.`; while editing, confirm typing survives background
  SSE re-renders (focus + caret). Buttons now **Save & Approve** / **Cancel**. Click
  **Save & Approve**.
- **T4.4 Phase progression.** Status pill sequence over time: `Scanning` → `Building` →
  `Sweeping` → `In Review` → `Done`; progress segments labeled scan/build/sweep/review/done;
  Agents region shows Security-1/Worker-1/Worker-2/Reviewer-1 activity (Worker-2:
  "Verifying completeness"). At Done, panel summary reads `All gates passed`.
- **T4.5 Checkpoint commits.** In the throwaway repo: `git log --oneline team/qa-team-1`
  (branch name may carry a suffix; `git branch -a` to find it) shows `WIP: work phase complete`,
  `WIP: security sweep passed`, and a final commit whose message is the first ~72 chars of
  the task.
- **T4.6 Deliverables.** On that branch: `src/greet.js` and `tests/greet.test.js` exist;
  `node --test tests/` passes.

## S5 — Simple downgrade + destructive refusal (reuses `qa-team-1`; each run also proves S7 reassignment)

- **T5.1 Simple downgrade (+ reassignment of a done team).** With the team at `Done`, send in chat:
  `Add the line "QA smoke pass" to the end of README.md.`
  Expected: the team leaves Done and restarts (reassignment reset — phase back to `Scanning`,
  revision/rejection counters zeroed); Security-1 classifies SIMPLE; Worker-2 and Reviewer-1
  flip to Done without running; agent count drops to 2; Worker-1 job reads
  `Implementing task (simple)`; progress bar shows only build/done; commits carry the
  `(simple)` suffix; the security sweep STILL runs before Done.
- **T5.2 Destructive refusal.** With the team at `Done` again, send:
  `Delete the file tmp-note.txt from the repository.`
  Expected: Security-1 output contains
  `SIMPLE downgrade refused (router flagged destructive intent) — running the full pipeline.`
  and the FULL 4-agent pipeline runs (requirements prompt included — Approve it). The
  deletion itself is safe (bait file). Record the final verdict chain.

## S6 — PR flow (uses `qa-team-1` at `Done`)

- **T6.1 Confirm/refute the orphaned Create PR button.** At phase `done`, inspect the side
  panel action row and the whole UI for any control that opens the **Create Pull Request**
  modal. Suspected: only **Security Review** is offered — no Create PR button anywhere.
  Screenshot either way; if absent this is the expected FINDING (regression from `625e43d`).
- **T6.2 API-level PR creation.** `curl -s -X POST http://127.0.0.1:3460/api/teams/qa-team-1/create-pr -H "Content-Type: application/json" -d '{}'`
  → success JSON with `prNumber`/`prUrl`; toast `PR #<n> created`; status pill `PR #<n> Open`,
  card badge `PR open`, panel summary `PR created — awaiting merge`, purple link `View PR #<n>`.
- **T6.3 Merge → auto-archive.** In the throwaway repo: `gh pr merge <n> --merge`. Within
  ~2 minutes (poll interval is 60 s): the team card disappears (`team-archived`), the local
  team branch is deleted (`git branch` in the throwaway repo → back on `main`, no team branch).

## S8 — Terminate + destructive-action dialogs (fresh `qa-team-2`)

- **T8.1 Terminate mid-run.** Create `qa-team-2`, send any small task in chat, and once the
  pipeline is visibly running (`Scanning`/`Building`), open the panel's ⋮ menu (`More actions`).
  Items: Rename/Duplicate/Archive (all disabled), **Terminate team**, **Delete team**
  (disabled until terminal — hover shows "Available once the team is done, cancelled, or errored.").
  Click **Terminate team** → confirm dialog: "Terminate team qa-team-2?" + "This terminates
  all running agents and marks the team cancelled…". Confirm → the card briefly shows
  `Cancelled`, then disappears entirely (server removes terminated teams).
- **T8.2 No orphaned processes.** After termination, `curl -s http://127.0.0.1:3460/api/teams`
  no longer lists `qa-team-2`.

## Cleanup

- Leave the throwaway repo on disk (evidence); note its path in the report. Deleting the
  GitHub repo is the human's call — do not run `gh repo delete`.
- If YOU started the dashboard in T0.3, stop it (kill the `npm run dashboard` process).
  If it was already running when you arrived, leave it running.
- Confirm `git status` in the ENGINE repo shows no modified files outside `docs/qa/`.
