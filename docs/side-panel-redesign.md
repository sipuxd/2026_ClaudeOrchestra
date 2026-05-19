# Side Panel Redesign — Team Detail Slide-out

> Status: Spec for implementation
> Owner: Design (UX)
> Scope: The slide-out side panel that appears when a team card is opened
> from the Portfolio view.

---

## 1. Why we're changing it

The current panel has four UX problems:

1. **Redundant prompt at the bottom.** The "Original Task" is rendered as
   italic, low-contrast text that reads as *disabled* — a false affordance.
   It also stands in for a chat history that doesn't exist.
2. **Destructive action is mis-placed.** "Delete team" sits inline with
   operational controls, one mis-click from the agent list.
3. **Header is under-utilized.** Only the team name appears; status,
   progress, and breadcrumb (visible on the card) are dropped on entry.
4. **No scroll containment.** Agents and chat share one scroll, so growing
   chat history pushes agents off-screen (or vice versa).

---

## 2. Information architecture

Four regions, top to bottom:

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER          identity + global actions                  │
├─────────────────────────────────────────────────────────────┤
│  AGENTS          collapsible roster + status                │
├═════════════════════════════════════════════════════════════┤  ← strong divider
│  CHAT            sticky sub-header                          │
│                  ▸ Pinned "Original Task" card              │
│                  ▸ Threaded messages (own scroll)           │
├─────────────────────────────────────────────────────────────┤
│  COMPOSER        textarea + affordances row                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Wireframe

```
┌────────────────────────────────────────────────────────────┐
│  ◖ playing around                            … ⋮     ✕    │  Header
│  Joe / __my-prototypes / playing around                    │
│  ● CANCELLED   ▰▰▱▱▱  165h · 8m                            │
├────────────────────────────────────────────────────────────┤
│  AGENTS (4)                                  [▾ collapse]  │
│  ▸  ● Security-1                              ACTIVE       │
│  ▸  ● Worker-1                                ACTIVE       │
│  ▸  ● Worker-2                                ACTIVE       │
│  ▸  ● Reviewer-1                              ACTIVE       │
├════════════════════════════════════════════════════════════┤
│  CHAT WITH COORDINATOR-1                       [⛬ pin ▾]   │  sticky
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 📌  ORIGINAL TASK                       [Edit] [⌄]   │  │  pinned
│  │ Build a fully playable checkers (draughts)…          │  │
│  │ Show first 3 lines · Expand                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│                          ── Today ──                       │
│  🤖 Coordinator-1   10:42                                  │
│  Kicking off scan phase. Assigning Worker-1…               │
│                                                            │
│  👤 You              10:45                                 │
│  Use plain HTML/CSS only — no frameworks.                  │
│                                                            │
│                                 (auto-scroll to latest ↓) │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Type a message — e.g. "Why did Worker-2 flag X?"     │  │
│  │                                       📎  ⌘↵  [Send] │  │
│  └──────────────────────────────────────────────────────┘  │
│  Replying to Coordinator-1 · /command · @agent             │
└────────────────────────────────────────────────────────────┘

⋮ menu:  Rename · Duplicate · Archive · ─── · Delete team (red)
```

---

## 4. Component breakdown

| Component         | Purpose                                                                 |
|-------------------|-------------------------------------------------------------------------|
| `PanelHeader`     | Team name, breadcrumb, status pill, progress bar, ⋮ menu, ✕ close.      |
| `OverflowMenu`    | Rename / Duplicate / Archive / Delete team. Esc to close.               |
| `ConfirmDialog`   | Used by Delete team. Focus-trapped, Esc cancels, Enter on Delete needs focus on Delete. |
| `AgentsSection`   | Collapsible wrapper with count. Wraps existing `AgentRow` components.   |
| `AgentRow`        | Existing row; unchanged structurally (▸, status dot, name, state pill). |
| `ChatRegion`      | Owns its own scroll. Sticky `ChatSubHeader`.                            |
| `PinnedTaskCard`  | First child of the thread. Collapsible. Has Edit (inline editor).       |
| `MessageBubble`   | Author avatar/icon, name, timestamp, body. Supports markdown.           |
| `DayDivider`      | "── Today ──", "── Yesterday ──", "── Mar 14 ──".                       |
| `Composer`        | Multi-line textarea + affordances row.                                  |

---

## 5. Interaction states

### Pinned task card
- Default: collapsed, 3 lines visible + "Expand" link.
- Expanded: full prompt, "Collapse" link.
- Edit mode: textarea replaces text; Save / Cancel buttons; Cancel restores prior content; Save persists and exits edit mode.
- Empty (new team, no task yet): card hidden; show empty-state in thread.

### Agents section
- Collapsed: single row `AGENTS (4) ▸` — no rows visible.
- Expanded (default): rows visible; each row independently expandable.
- Auto-collapse on first open if viewport height < 720px.

### Composer
- Empty: Send button disabled.
- ⌘↵ (or Ctrl+Enter on Win/Linux): send.
- Shift+↵: newline.
- Sending: button shows spinner; textarea read-only until ack.

### Overflow menu
- Click ⋮ to open; click outside or Esc to close.
- Arrow keys navigate items; Enter activates.

### Delete confirm
- Title: "Delete team 'playing around'?"
- Body: "This permanently removes the team and its chat history. This cannot be undone."
- Buttons: Cancel (default focus) · Delete (red).
- Esc = Cancel.

### Empty thread state (new team)
- Above composer, centered in the chat area:
  > "No messages yet. Your original task is pinned above.
  > Try asking the coordinator about scope, agents, or timeline."

---

## 6. Visual tokens

Match what's already in the app; the values below are reference targets only — replace with the repo's existing token names if they exist.

| Token                         | Reference value |
|-------------------------------|-----------------|
| `--panel-bg`                  | `#0F1115`       |
| `--panel-surface`             | `#161A21`       |
| `--panel-surface-elevated`    | `#1C212A`       |
| `--panel-border`              | `#262C36`       |
| `--text-primary`              | `#E6E8EC`       |
| `--text-secondary`            | `#9AA2AE`       |
| `--text-muted`                | `#6B7280`       |
| `--accent`                    | existing brand blue/violet |
| `--danger`                    | `#E5484D`       |
| `--status-active`             | `#22C55E`       |
| `--status-review`             | `#F59E0B`       |
| `--status-blocked`            | `#EF4444`       |
| Radius (cards)                | `8px`           |
| Radius (panel)                | `12px` left edge |
| Region divider                | `1px` border + `16px` top/bottom padding; strong divider = `2px` |
| Spacing scale                 | 4 / 8 / 12 / 16 / 24 / 32 |

Typography:
- Header title: 16/22 semibold
- Breadcrumb: 12/16 regular, `--text-secondary`
- Section labels ("AGENTS (4)", "CHAT WITH COORDINATOR-1"): 11/14 uppercase, tracked +0.04em, `--text-secondary`
- Message body: 14/20 regular
- Timestamps: 11/14, `--text-muted`

---

## 7. Accessibility

- Logical Tab order: Header actions → Agents toggle → Agent rows → Pinned card actions → Thread (focusable region) → Composer → Send.
- All icon-only buttons (`✕`, `⋮`, `📎`) have `aria-label`.
- Status pills include `aria-label` (e.g. "Status: Active").
- ⋮ menu uses `role="menu"` / `role="menuitem"`; arrow-key navigation; Esc to close.
- Confirm dialog uses `role="dialog"` `aria-modal="true"`; focus trapped; returns focus to ⋮ on close.
- Composer textarea: `aria-label="Message to Coordinator-1"`.
- Color is never the sole status carrier — pair status dot with text label.
- Meets WCAG AA contrast on all text/background pairs.

---

## 8. Responsive

- ≥ 1024px wide: panel width 480px, slides over content.
- 640–1023px: panel width 420px.
- < 640px: panel takes full viewport width.
- Height < 720px: Agents region auto-collapses on first open.

---

## 9. Out of scope

- Portfolio/card view changes.
- Agent execution pipeline.
- Backend/API changes.
- New theming system.

---

## 10. Acceptance criteria

- [ ] Header shows team name, breadcrumb, status pill, progress bar.
- [ ] ⋮ menu contains Rename, Duplicate, Archive, Delete (red, after divider).
- [ ] Delete opens a confirm dialog; Esc cancels; focus returns to ⋮.
- [ ] Agents region collapses as a whole; rows still individually expandable.
- [ ] "Original Task" appears as a pinned card at the top of the thread, not as italic/disabled text at the bottom.
- [ ] Pinned card is collapsible (default collapsed) and editable.
- [ ] Chat region has its own scroll; sub-header is sticky.
- [ ] Messages show author, timestamp, and day dividers.
- [ ] Composer supports multi-line, ⌘↵ sends, Shift+↵ newline; affordances row visible.
- [ ] Empty thread state appears for new teams.
- [ ] Auto-scroll to latest on new message.
- [ ] Keyboard reachable end-to-end; ARIA roles correct; AA contrast.
- [ ] Responsive at <640px, <1024px, ≥1024px.
- [ ] Storybook stories: Active+messages, Cancelled+expanded task, New+empty.
- [ ] Unit tests cover the interactions listed in the prompt.
- [ ] CHANGELOG updated.

---

## 11. Notes for the implementer

- This is an **IA + presentation** change. Don't refactor data models.
- Reuse existing `AgentRow` rather than rebuilding it.
- The pinned task card should look obviously like a card (border, slightly elevated surface, icon). Avoid italics or low-contrast body text for primary content anywhere in the panel — that styling is reserved for `--text-muted` metadata only.
- When in doubt, mirror styles already used elsewhere in ClaudeOrchestra so the panel feels native, not bolted on.