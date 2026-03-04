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
- Terminal UI library (suggest best option — blessed, ink, etc.)
