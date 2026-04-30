# CLAUDE.md

@AGENTS.md

## Claude Code

Claude Code reads `CLAUDE.md`; Codex reads `AGENTS.md`. Keep shared project guidance in `AGENTS.md` so both tools use the same source of truth. Put only Claude-specific behavior here.

Claude Code can use this import wrapper because `CLAUDE.md` supports `@path` imports. Codex does not need this wrapper because it discovers `AGENTS.md` directly.
