// Spawns and manages Claude Code CLI instances for a team.
// Tracks all running processes and provides lifecycle management.

import * as path from 'node:path';
import { Role, type RoleInstance, ROLE_INSTANCES } from '../roles/role-types.js';
import { AgentProcess, type AgentSpawnOptions, ProcessState } from './agent-process.js';

// --- Default model configuration ---

export const DEFAULT_MODELS: Record<Role, string> = {
  [Role.Supervisor]: 'claude-sonnet-4-6',
  [Role.Worker]: 'claude-haiku-4-5',
  [Role.Security]: 'claude-opus-4-6',
  [Role.Reviewer]: 'claude-sonnet-4-6',
};

// --- Default effort levels per role ---
// Supervisor: medium — reads project, delegates, doesn't write code
// Worker: high — writes code, needs quality reasoning
// Security: medium — pattern-matching analysis, guided by checklist
// Reviewer: medium — evaluation guided by Decision Transparency framework

export const DEFAULT_EFFORTS: Record<Role, 'low' | 'medium' | 'high' | 'max'> = {
  [Role.Supervisor]: 'medium',
  [Role.Worker]: 'high',
  [Role.Security]: 'medium',
  [Role.Reviewer]: 'medium',
};

// --- Tools to disallow per role ---
// Workers get full access. Supervisor, Security, and Reviewer only need
// read-only tools — removing Write/Edit/Bash from their context saves
// tokens and prevents unintended modifications.

export const DEFAULT_DISALLOWED_TOOLS: Record<Role, string[]> = {
  [Role.Supervisor]: ['Write', 'Edit', 'Bash'],
  [Role.Worker]: [],                              // Full access
  [Role.Security]: ['Write', 'Edit', 'Bash'],
  [Role.Reviewer]: ['Write', 'Edit', 'Bash'],
};

// --- Default max turns per role ---
// Safety net to prevent runaway agent loops.
// Workers get more turns because they do real coding work.

export const DEFAULT_MAX_TURNS: Record<Role, number> = {
  [Role.Supervisor]: 30,
  [Role.Worker]: 50,
  [Role.Security]: 20,
  [Role.Reviewer]: 20,
};

// --- Spawner options ---

export interface SpawnerOptions {
  /** Path to the claude CLI binary (default: 'claude') */
  claudeBin?: string;
  /** Override spawn args for all agents (for testing) */
  spawnArgs?: string[];
  /** Directory containing role CLAUDE.md files */
  rolesDir: string;
  /** Model overrides per role */
  models?: Partial<Record<Role, string>>;
  /** Effort level overrides per role */
  efforts?: Partial<Record<Role, 'low' | 'medium' | 'high' | 'max'>>;
  /** Disallowed tools overrides per role (removes tools from agent context) */
  disallowedTools?: Partial<Record<Role, string[]>>;
  /** Max turns overrides per role */
  maxTurns?: Partial<Record<Role, number>>;
  /** Global max budget per agent query (USD) */
  maxBudgetUsd?: number;
  /** Max respawn attempts per agent per task */
  maxRespawns?: number;
}

// --- Role to CLAUDE.md filename mapping ---

const ROLE_FILE_MAP: Record<Role, string> = {
  [Role.Supervisor]: 'supervisor.claude.md',
  [Role.Worker]: 'worker.claude.md',
  [Role.Security]: 'security.claude.md',
  [Role.Reviewer]: 'reviewer.claude.md',
};

export class AgentSpawner {
  private readonly options: SpawnerOptions;
  private readonly models: Record<Role, string>;
  private readonly efforts: Record<Role, 'low' | 'medium' | 'high' | 'max'>;
  private readonly disallowedTools: Record<Role, string[]>;
  private readonly maxTurnsPerRole: Record<Role, number>;
  private readonly maxBudgetUsd: number | undefined;
  private readonly maxRespawns: number;

  // teamId → (instance → AgentProcess)
  private teams: Map<string, Map<RoleInstance, AgentProcess>> = new Map();
  // teamId → (instance → respawn count)
  private respawnCounts: Map<string, Map<RoleInstance, number>> = new Map();

  constructor(options: SpawnerOptions) {
    this.options = options;
    this.models = { ...DEFAULT_MODELS, ...options.models };
    this.efforts = { ...DEFAULT_EFFORTS, ...options.efforts };
    this.disallowedTools = { ...DEFAULT_DISALLOWED_TOOLS, ...options.disallowedTools };
    this.maxTurnsPerRole = { ...DEFAULT_MAX_TURNS, ...options.maxTurns };
    this.maxBudgetUsd = options.maxBudgetUsd;
    this.maxRespawns = options.maxRespawns ?? 3;
  }

  /**
   * Spawn all 5 agents for a team.
   */
  spawnTeam(teamId: string, projectPath: string): AgentProcess[] {
    if (this.teams.has(teamId)) {
      throw new Error(`Team ${teamId} already has spawned agents`);
    }

    const agents: AgentProcess[] = [];
    const teamMap = new Map<RoleInstance, AgentProcess>();
    const respawnMap = new Map<RoleInstance, number>();

    for (const [role, instances] of Object.entries(ROLE_INSTANCES)) {
      for (const instance of instances) {
        const agent = this.createAgent(teamId, role as Role, instance, projectPath);
        agent.spawn();
        teamMap.set(instance, agent);
        respawnMap.set(instance, 0);
        agents.push(agent);
      }
    }

    this.teams.set(teamId, teamMap);
    this.respawnCounts.set(teamId, respawnMap);
    return agents;
  }

  /**
   * Spawn a single agent for a team.
   */
  spawnAgent(teamId: string, role: Role, instance: RoleInstance, projectPath: string): AgentProcess {
    let teamMap = this.teams.get(teamId);
    if (!teamMap) {
      teamMap = new Map();
      this.teams.set(teamId, teamMap);
    }

    let respawnMap = this.respawnCounts.get(teamId);
    if (!respawnMap) {
      respawnMap = new Map();
      this.respawnCounts.set(teamId, respawnMap);
    }

    if (teamMap.has(instance) && teamMap.get(instance)!.isAlive) {
      throw new Error(`Agent ${instance} in team ${teamId} is already running`);
    }

    const agent = this.createAgent(teamId, role, instance, projectPath);
    agent.spawn();
    teamMap.set(instance, agent);

    if (!respawnMap.has(instance)) {
      respawnMap.set(instance, 0);
    }

    return agent;
  }

  /**
   * Respawn a crashed agent. Returns the new process, or null
   * if the respawn budget is exhausted.
   */
  respawnAgent(teamId: string, instance: RoleInstance, projectPath: string): AgentProcess | null {
    const respawnMap = this.respawnCounts.get(teamId);
    if (!respawnMap) return null;

    const count = respawnMap.get(instance) ?? 0;
    if (count >= this.maxRespawns) return null;

    const teamMap = this.teams.get(teamId);
    const oldAgent = teamMap?.get(instance);
    const role = oldAgent?.role;
    if (!role) return null;

    const agent = this.createAgent(teamId, role, instance, projectPath);
    agent.spawn();

    teamMap!.set(instance, agent);
    respawnMap.set(instance, count + 1);

    return agent;
  }

  /**
   * Get the respawn count for an agent.
   */
  getRespawnCount(teamId: string, instance: RoleInstance): number {
    return this.respawnCounts.get(teamId)?.get(instance) ?? 0;
  }

  /**
   * Reset respawn counters for a team (e.g., on new task).
   */
  resetRespawnCounts(teamId: string): void {
    const respawnMap = this.respawnCounts.get(teamId);
    if (respawnMap) {
      for (const key of respawnMap.keys()) {
        respawnMap.set(key, 0);
      }
    }
  }

  /**
   * Get a running agent by team and instance.
   */
  getAgent(teamId: string, instance: RoleInstance): AgentProcess | undefined {
    return this.teams.get(teamId)?.get(instance);
  }

  /**
   * Get all agents for a team.
   */
  getTeamAgents(teamId: string): AgentProcess[] {
    const teamMap = this.teams.get(teamId);
    return teamMap ? Array.from(teamMap.values()) : [];
  }

  /**
   * Gracefully terminate all agents in a team.
   */
  async terminateTeam(teamId: string): Promise<void> {
    const teamMap = this.teams.get(teamId);
    if (!teamMap) return;

    const shutdownPrompt =
      'The orchestrator is shutting down. Please finish your current operation and save your progress. You will be terminated shortly.';

    const terminatePromises = Array.from(teamMap.values()).map((agent) =>
      agent.terminate({ shutdownPrompt, gracePeriodMs: 5000 })
    );

    await Promise.all(terminatePromises);
    this.teams.delete(teamId);
    this.respawnCounts.delete(teamId);
  }

  /**
   * Terminate a single agent.
   */
  async terminateAgent(teamId: string, instance: RoleInstance): Promise<void> {
    const agent = this.getAgent(teamId, instance);
    if (!agent) return;

    await agent.terminate({ gracePeriodMs: 3000 });
  }

  /**
   * Force kill all agents across all teams.
   */
  forceKillAll(): void {
    for (const teamMap of this.teams.values()) {
      for (const agent of teamMap.values()) {
        agent.kill();
      }
    }
    this.teams.clear();
    this.respawnCounts.clear();
  }

  /**
   * Get count of currently alive agents across all teams.
   */
  get totalAliveAgents(): number {
    let count = 0;
    for (const teamMap of this.teams.values()) {
      for (const agent of teamMap.values()) {
        if (agent.isAlive) count++;
      }
    }
    return count;
  }

  // --- Private ---

  private createAgent(
    teamId: string,
    role: Role,
    instance: RoleInstance,
    projectPath: string
  ): AgentProcess {
    const disallowed = this.disallowedTools[role];

    const opts: AgentSpawnOptions = {
      claudeBin: this.options.claudeBin,
      spawnArgs: this.options.spawnArgs,
      model: this.models[role],
      systemPromptPath: path.join(this.options.rolesDir, ROLE_FILE_MAP[role]),
      cwd: projectPath,
      role,
      instance,
      teamId,
      effort: this.efforts[role],
      maxTurns: this.maxTurnsPerRole[role],
      maxBudgetUsd: this.maxBudgetUsd,
      disallowedTools: disallowed.length > 0 ? disallowed : undefined,
    };
    return new AgentProcess(opts);
  }
}
