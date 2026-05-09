#!/bin/bash
# Generates .claude/project-context.md — a factual snapshot of the project.
# Purely descriptive. No opinions, no instructions.
# Archives previous version before overwriting.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="$PROJECT_ROOT/.claude/project-context.md"
HISTORY_DIR="$PROJECT_ROOT/.claude/context-history"

# --- Archive previous snapshot ---
if [ -f "$OUTPUT" ]; then
  mkdir -p "$HISTORY_DIR"
  TIMESTAMP=$(date +"%Y-%m-%dT%H-%M-%S")
  cp "$OUTPUT" "$HISTORY_DIR/$TIMESTAMP.md"
fi

# --- Generate new snapshot ---
cd "$PROJECT_ROOT"

cat > "$OUTPUT" << 'HEADER'
# Project Context (Auto-Generated)

This file is generated automatically on each session start.
It contains factual project data only — no instructions or conventions.
For project rules and guidance, see CLAUDE.md.

HEADER

# Timestamp
echo "**Generated:** $(date '+%Y-%m-%d %H:%M:%S')" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# --- File Structure ---
echo "## File Structure" >> "$OUTPUT"
echo "" >> "$OUTPUT"
for dir in src tests agents docs; do
  if [ -d "$dir" ]; then
    count=$(find "$dir" -type f | wc -l | tr -d ' ')
    echo "- \`$dir/\` — $count files" >> "$OUTPUT"
  fi
done
echo "" >> "$OUTPUT"

# --- Source Files ---
echo "## Source Files" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "| File | Lines |" >> "$OUTPUT"
echo "|------|-------|" >> "$OUTPUT"
if [ -d "src" ]; then
  find src -name '*.ts' -type f | sort | while read -r f; do
    lines=$(wc -l < "$f" | tr -d ' ')
    echo "| \`$f\` | $lines |" >> "$OUTPUT"
  done
fi
echo "" >> "$OUTPUT"

# --- Test Files ---
echo "## Test Files" >> "$OUTPUT"
echo "" >> "$OUTPUT"
if [ -d "tests" ]; then
  for f in tests/*.test.ts; do
    [ -f "$f" ] || continue
    lines=$(wc -l < "$f" | tr -d ' ')
    echo "- \`$f\` ($lines lines)" >> "$OUTPUT"
  done
fi
echo "" >> "$OUTPUT"

# --- Agent Files ---
echo "## Agent Files" >> "$OUTPUT"
echo "" >> "$OUTPUT"
if [ -d "agents" ]; then
  for f in agents/*.agent.md; do
    [ -f "$f" ] || continue
    echo "- \`$f\`" >> "$OUTPUT"
  done
fi
echo "" >> "$OUTPUT"

# --- Dependencies ---
echo "## Dependencies" >> "$OUTPUT"
echo "" >> "$OUTPUT"
if [ -f "package.json" ]; then
  echo "**Production:**" >> "$OUTPUT"
  # Extract dependencies keys (no jq — pure bash/sed)
  sed -n '/"dependencies"/,/}/p' package.json | grep '"' | grep -v 'dependencies' | sed 's/[",:]//g' | awk '{print "- `" $1 "`: " $2}' >> "$OUTPUT"
  echo "" >> "$OUTPUT"
  echo "**Dev:**" >> "$OUTPUT"
  sed -n '/"devDependencies"/,/}/p' package.json | grep '"' | grep -v 'devDependencies' | sed 's/[",:]//g' | awk '{print "- `" $1 "`: " $2}' >> "$OUTPUT"
fi
echo "" >> "$OUTPUT"

# --- Git State ---
echo "## Git State" >> "$OUTPUT"
echo "" >> "$OUTPUT"
if git rev-parse --git-dir > /dev/null 2>&1; then
  branch=$(git branch --show-current 2>/dev/null || echo "detached")
  dirty=$(git status --short 2>/dev/null | wc -l | tr -d ' ')
  echo "- **Branch:** \`$branch\`" >> "$OUTPUT"
  echo "- **Uncommitted changes:** $dirty files" >> "$OUTPUT"
  echo "" >> "$OUTPUT"
  echo "**Last 5 commits:**" >> "$OUTPUT"
  git log --oneline -5 2>/dev/null | while read -r line; do
    echo "- \`$line\`" >> "$OUTPUT"
  done
fi
echo "" >> "$OUTPUT"

# --- Architecture Decisions ---
echo "## Architecture Decisions" >> "$OUTPUT"
echo "" >> "$OUTPUT"
if [ -d "docs/architecture-decisions" ]; then
  for f in docs/architecture-decisions/*.md; do
    [ -f "$f" ] || continue
    echo "- \`$f\`" >> "$OUTPUT"
  done
fi
echo "" >> "$OUTPUT"

# --- Recent Changes (last 7 days) ---
echo "## Recently Changed Files (last 7 days)" >> "$OUTPUT"
echo "" >> "$OUTPUT"
if git rev-parse --git-dir > /dev/null 2>&1; then
  changes=$(git log --since="7 days ago" --name-only --pretty=format: 2>/dev/null | sort -u | grep -v '^$' || true)
  if [ -n "$changes" ]; then
    echo "$changes" | while read -r f; do
      echo "- \`$f\`" >> "$OUTPUT"
    done
  else
    echo "No commits in the last 7 days." >> "$OUTPUT"
  fi
fi
echo "" >> "$OUTPUT"
