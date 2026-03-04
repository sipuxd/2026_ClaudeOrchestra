# ClaudeOrchestra
A lightweight terminal dashboard for supervising autonomous 
Claude Code CLI agents — see what's running, what's waiting, 
and where you're needed.

## The Problem
Running multiple Claude Code CLI instances across terminal tabs 
gives you no visibility into which agents need attention. 
You end up manually clicking through every tab constantly.

## Core Features
- Launch multiple Claude Code CLI instances from one place
- Unified dashboard view of all active agents
- Attention indicators — surface which instances are waiting on you
- Status per instance — running, idle, done, errored

## Tech Stack
- Node.js
- ink (React for terminal UIs)
- @inkjs/ui (pre-built terminal components)
- @pcoi/tokens (colors, spacing, hierarchy)
- @pcoi/icons (icon reference for unicode/emoji mapping)

## Dependencies
```bash
npm install ink @inkjs/ui @pcoi/tokens @pcoi/icons
```

## PCOI Integration
- Import color tokens from @pcoi/tokens for all color values
- Map @pcoi/icons to closest unicode/emoji equivalents for terminal
- Do not use PCOI React components directly — they are web-based 
  and won't render in ink
- Tokens should drive all visual decisions: status colors, 
  spacing, hierarchy

## UI Design

### Design Language
- Inherits color tokens and spacing from PCOI Design System
- Terminal-native adaptation of PCOI visual identity
- Icons mapped to unicode/emoji equivalents of PCOI icon set

### Layout
- Top bar: App title with gradient text, timestamp, total agent count
- Main area: Grid of agent cards, one per running instance
- Bottom bar: Keyboard shortcuts and quick actions

### Agent Card
- Bordered panel with rounded corners
- Agent name/ID and assigned task description
- Status badge — color-coded using PCOI token palette:
  - Green: running
  - Yellow: waiting for input (needs attention)
  - Red: errored
  - Gray: done/idle
- Animated spinner when running
- Time elapsed since launch
- Last output preview (truncated to 2-3 lines)

### Interactions
- Arrow keys to navigate between cards
- Enter to focus/attach to a specific agent
- N to launch a new instance
- Q to quit

### Design Principles
- Scannable at a glance — status should be obvious 
  without reading text
- Minimal noise — only surface what matters
- Color and motion do the heavy lifting, not text density
