// Filesystem persistence layer for TeamState.
// Debounced writes, forced writes on phase transitions,
// atomic writes via temp-file + rename.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TeamState, type TeamStateData } from './team-state.js';

export interface PersistenceOptions {
  /** Root data directory (e.g., data/teams) */
  teamsDir: string;
  /** Debounce interval in ms (default: 1000) */
  debounceMs?: number;
}

export class StatePersistence {
  private readonly teamsDir: string;
  private readonly debounceMs: number;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(options: PersistenceOptions) {
    this.teamsDir = options.teamsDir;
    this.debounceMs = options.debounceMs ?? 1000;
  }

  /** Get the state.json path for a team. */
  private statePath(teamId: string): string {
    return path.join(this.teamsDir, teamId, 'state.json');
  }

  /** Ensure the team directory exists. */
  ensureTeamDir(teamId: string): void {
    fs.mkdirSync(path.join(this.teamsDir, teamId), { recursive: true });
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
   * List all team IDs that have persisted state.
   */
  listTeams(): string[] {
    if (!fs.existsSync(this.teamsDir)) return [];
    return fs.readdirSync(this.teamsDir).filter((dir) => {
      const statePath = path.join(this.teamsDir, dir, 'state.json');
      return fs.existsSync(statePath);
    });
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
    const teamDir = path.join(this.teamsDir, state.teamId);
    fs.mkdirSync(teamDir, { recursive: true });

    const finalPath = this.statePath(state.teamId);
    const tmpPath = path.join(teamDir, `.tmp-state-${randomUUID()}.json`);

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
