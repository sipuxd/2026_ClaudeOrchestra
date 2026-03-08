// Registry — Lightweight JSON file tracking active teams across projects.
//
// The engine stores this in its own repo (registry.json). It contains
// only pointers to teams — no runtime data. Runtime data lives in each
// target project's .claude-orchestra/ directory.
//
// Atomic writes via temp-file + fs.renameSync() (same pattern as
// StatePersistence).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface RegistryEntry {
  teamId: string;
  teamName: string;
  projectPath: string;
  createdAt: string;    // ISO-8601
  lastActiveAt: string; // ISO-8601
}

interface RegistryData {
  teams: RegistryEntry[];
}

export class Registry {
  private readonly registryPath: string;

  constructor(registryPath: string) {
    this.registryPath = path.resolve(registryPath);
  }

  /**
   * Load all registry entries. Returns empty array if file doesn't exist.
   */
  load(): RegistryEntry[] {
    if (!fs.existsSync(this.registryPath)) return [];
    try {
      const content = fs.readFileSync(this.registryPath, 'utf-8');
      const data = JSON.parse(content) as RegistryData;
      return data.teams ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Add a new team entry to the registry.
   */
  add(entry: RegistryEntry): void {
    const entries = this.load();
    // Prevent duplicates
    const existing = entries.findIndex((e) => e.teamId === entry.teamId);
    if (existing >= 0) {
      entries[existing] = entry;
    } else {
      entries.push(entry);
    }
    this.write(entries);
  }

  /**
   * Remove a team entry from the registry.
   */
  remove(teamId: string): void {
    const entries = this.load().filter((e) => e.teamId !== teamId);
    this.write(entries);
  }

  /**
   * Update the lastActiveAt timestamp for a team.
   */
  updateLastActive(teamId: string): void {
    const entries = this.load();
    const entry = entries.find((e) => e.teamId === teamId);
    if (entry) {
      entry.lastActiveAt = new Date().toISOString();
      this.write(entries);
    }
  }

  /**
   * Get a single entry by teamId.
   */
  get(teamId: string): RegistryEntry | undefined {
    return this.load().find((e) => e.teamId === teamId);
  }

  // --- Private ---

  private write(entries: RegistryEntry[]): void {
    const data: RegistryData = { teams: entries };
    const json = JSON.stringify(data, null, 2);

    const dir = path.dirname(this.registryPath);
    fs.mkdirSync(dir, { recursive: true });

    const tmpPath = path.join(dir, `.tmp-registry-${randomUUID()}.json`);
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, this.registryPath);
  }
}
