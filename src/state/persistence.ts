// Filesystem persistence layer for TeamState.
// Debounced writes, forced writes on phase transitions,
// atomic writes via temp-file + rename.
//
// Supports per-project paths: each team's data lives in its
// target project's .claude-orchestra/teams/{teamId}/ directory,
// not in a single global data/ directory.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TeamState, type TeamStateData } from './team-state.js';

export interface PersistenceOptions {
  /** Debounce interval in ms (default: 1000) */
  debounceMs?: number;
}

export class StatePersistence {
  private readonly debounceMs: number;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Maps teamId → absolute directory path for that team's data.
   * e.g., teamId "auth-team" → "/Users/me/Projects/pcoi/.claude-orchestra/teams/auth-team"
   */
  private teamDirs: Map<string, string> = new Map();

  constructor(options: PersistenceOptions = {}) {
    this.debounceMs = options.debounceMs ?? 1000;
  }

  /**
   * Register a team's data directory. Must be called before
   * persist/load for that team. The orchestrator calls this
   * in createTeam() after computing the path from projectPath.
   */
  registerTeamDir(teamId: string, teamDir: string): void {
    this.teamDirs.set(teamId, teamDir);
  }

  /** Get the registered directory for a team. */
  getTeamDir(teamId: string): string | undefined {
    return this.teamDirs.get(teamId);
  }

  /** Get the state.json path for a team. */
  private statePath(teamId: string): string {
    const dir = this.teamDirs.get(teamId);
    if (!dir) {
      throw new Error(`No directory registered for team "${teamId}". Call registerTeamDir() first.`);
    }
    return path.join(dir, 'state.json');
  }

  /** Ensure the team directory exists. */
  ensureTeamDir(teamId: string): void {
    const dir = this.teamDirs.get(teamId);
    if (!dir) {
      throw new Error(`No directory registered for team "${teamId}". Call registerTeamDir() first.`);
    }
    fs.mkdirSync(dir, { recursive: true });
  }

  /**
   * Persist team state. If force is true (e.g., phase transition),
   * writes immediately. Otherwise debounces to at most once per
   * debounceMs interval.
   */
  persist(state: TeamState, force: boolean = false): void {
    if (force || state.hasPhaseTransitioned) {
      this.cancelDebounce(state.teamId);
      this.writeState(state);
      return;
    }

    if (!state.isDirty) return;

    // Debounce: schedule a write if none pending
    if (!this.debounceTimers.has(state.teamId)) {
      const timer = setTimeout(() => {
        this.debounceTimers.delete(state.teamId);
        if (state.isDirty) {
          this.writeState(state);
        }
      }, this.debounceMs);
      this.debounceTimers.set(state.teamId, timer);
    }
  }

  /**
   * Force an immediate write, bypassing debounce.
   */
  persistNow(state: TeamState): void {
    this.cancelDebounce(state.teamId);
    this.writeState(state);
  }

  /**
   * Read persisted state for a team. Returns null if no state file exists.
   */
  load(teamId: string): TeamStateData | null {
    const filePath = this.statePath(teamId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as TeamStateData;
    } catch {
      return null;
    }
  }

  /**
   * Load state from a specific directory path (used by recover()
   * when reading from registry entries before the team is registered).
   */
  loadFromDir(teamDir: string): TeamStateData | null {
    const filePath = path.join(teamDir, 'state.json');
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as TeamStateData;
    } catch {
      return null;
    }
  }

  /**
   * Cancel any pending debounced write and clear all timers.
   * Call on shutdown.
   */
  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /** Flush all pending debounced writes immediately. */
  flush(state: TeamState): void {
    this.persistNow(state);
  }

  // --- Private ---

  private writeState(state: TeamState): void {
    const dir = this.teamDirs.get(state.teamId);
    if (!dir) {
      throw new Error(`No directory registered for team "${state.teamId}". Call registerTeamDir() first.`);
    }
    fs.mkdirSync(dir, { recursive: true });

    const finalPath = path.join(dir, 'state.json');
    const tmpPath = path.join(dir, `.tmp-state-${randomUUID()}.json`);

    const json = JSON.stringify(state.snapshot, null, 2);
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, finalPath);

    state.markPersisted();
  }

  private cancelDebounce(teamId: string): void {
    const timer = this.debounceTimers.get(teamId);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(teamId);
    }
  }
}
