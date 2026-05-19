# Changelog

## Unreleased

### UX: Side panel redesign

Refactored the team-detail slide-out panel into four clear regions per
[`docs/side-panel-redesign.md`](docs/side-panel-redesign.md):

- **Header** now carries identity: team name, project/team breadcrumb,
  status pill, pipeline progress ticks, elapsed time, ⋮ overflow menu, ✕ close.
- **Agents** is a collapsible region; each row still expands individually.
- **Chat** owns its own scroll container with a sticky `CHAT WITH COORDINATOR-1`
  sub-header. The "Original Task" now appears as a pinned, collapsible card at
  the top of the thread instead of italic/disabled-looking text at the bottom.
  The card is read-only — to refine scope, message Coordinator-1 in the
  composer (which decides whether to `TRIGGER_PIPELINE`).
- **Composer** is a multi-line textarea: `⌘↵` / `Ctrl+↵` sends, `Shift+↵`
  inserts a newline, with an affordances row beneath.
- Destructive **Delete team** moved out of the inline action row into the ⋮
  overflow menu and now opens a focus-trapped confirm dialog (`role="dialog"`
  `aria-modal="true"`, Esc cancels, focus returns to ⋮).
- Auto-scroll to latest on each new message; day dividers ("Today",
  "Yesterday", `Mar 14`) and per-message timestamps + author labels.
- A11y: ARIA labels on icon-only buttons and status pills, arrow-key
  navigation in the ⋮ menu, status carried by both color and text.
- Responsive: panel becomes full-screen below 640px viewport width;
  Agents region auto-collapses on first open when viewport height < 720px.

Cleaned up the now-orphaned `.chat-panel` / `.chat-log` / `.chat-bubble*`
CSS rules that were emitted by the old `renderChatPanel`.
