// SubagentOrchestrator — SDK-native subagent-based orchestration.
//
// Replaces the legacy multi-process orchestrator with a single query() call
// where the Supervisor is the parent agent and Workers/Security/Reviewer are
// subagents invoked via the Task tool.
//
// Eliminates: filesystem message bus, ORCHESTRA-MESSAGE delimiters,
// tick loop polling, stdout parsing, 5 separate CLI processes.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition, Query, HookCallback, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { Role } from './roles/role-types.js';
import { AgentState } from './types/index.js';
import { TeamState, TeamPhase, type TeamStateData, type LoopLimits, DEFAULT_LOOP_LIMITS } from './state/team-state.js';
import { StatePersistence } from './state/persistence.js';
import { Registry } from './registry.js';
import { classifyComplexity } from './router/complexity-router.js';
import type { OrchestratorEvents, OrchestraConfig } from './orchestrator.js';
import {
  DEFAULT_MODELS,
  DEFAULT_DISALLOWED_TOOLS,
  DEFAULT_MAX_TURNS,
} from './spawner/agent-spawner.js';

// --- Model name mapping ---
// SDK subagents use short model names; our config uses full IDs.

const FULL_TO_SHORT: Record<string, 'sonnet' | 'opus' | 'haiku'> = {
  'claude-sonnet-4-6': 'sonnet',
  'claude-sonnet-4-5-20250514': 'sonnet',
  'claude-opus-4-6': 'opus',
  'claude-haiku-4-5': 'haiku',
};

function mapModelToShort(fullModel: string): 'sonnet' | 'opus' | 'haiku' {
  return FULL_TO_SHORT[fullModel] ?? 'sonnet';
}

// --- Subagent Orchestrator Config ---

export interface SubagentOrchestraConfig {
  registryPath: string;
  logDirectory: string;
  /** Directory containing subagent-mode role prompt files */
  rolesDir: string;
  maxConcurrentTeams: number;
  /** Model overrides per role (full model IDs like 'claude-sonnet-4-6') */
  models?: Partial<Record<Role, string>>;
  /** Effort level (query-level; SDK doesn't support per-subagent effort) */
  effort?: 'low' | 'medium' | 'high' | 'max';
  /** Disallowed tools overrides per role */
  disallowedTools?: Partial<Record<Role, string[]>>;
  /** Max turns overrides per role */
  maxTurns?: Partial<Record<Role, number>>;
  /** Global max budget per query (USD) */
  maxBudgetUsd?: number;
  /** Loop limits for phase transitions */
  limits?: Partial<LoopLimits>;
}

const DEFAULT_SUBAGENT_CONFIG = {
  registryPath: './registry.json',
  logDirectory: './logs',
  rolesDir: './roles/subagent',
  maxConcurrentTeams: 5,
  effort: 'medium' as const,
};

// --- Per-team runtime context ---

interface SubagentTeamContext {
  state: TeamState;
  /** Active SDK query (null if no task running) */
  activeQuery: Query | null;
  /** Tracks which subagent types have been invoked (for phase tracking) */
  subagentHistory: Array<{ type: string; startedAt: number; endedAt?: number }>;
  /** Whether Security has been invoked once (pre-scan) */
  securityScanDone: boolean;
}

// --- SubagentOrchestrator ---

export class SubagentOrchestrator extends EventEmitter<OrchestratorEvents> {
  private readonly config: SubagentOrchestraConfig & typeof DEFAULT_SUBAGENT_CONFIG;
  private readonly persistence: StatePersistence;
  private readonly registry: Registry;
  private readonly models: Record<Role, string>;
  private readonly disallowedTools: Record<Role, string[]>;
  private readonly maxTurnsPerRole: Record<Role, number>;
  private readonly teams: Map<string, SubagentTeamContext> = new Map();
  private shuttingDown = false;

  constructor(config: Partial<SubagentOrchestraConfig> = {}) {
    super();

    // Filter out undefined values so they don't overwrite defaults
    const cleanConfig = Object.fromEntries(
      Object.entries(config).filter(([, v]) => v !== undefined)
    );
    this.config = { ...DEFAULT_SUBAGENT_CONFIG, ...cleanConfig } as SubagentOrchestraConfig & typeof DEFAULT_SUBAGENT_CONFIG;

    this.persistence = new StatePersistence();
    this.registry = new Registry(this.config.registryPath);

    this.models = { ...DEFAULT_MODELS, ...config.models };
    this.disallowedTools = { ...DEFAULT_DISALLOWED_TOOLS, ...config.disallowedTools };
    this.maxTurnsPerRole = { ...DEFAULT_MAX_TURNS, ...config.maxTurns };
  }

  // --- Team Lifecycle ---

  createTeam(name: string, projectPath: string): TeamState {
    if (this.shuttingDown) {
      throw new Error('Orchestrator is shutting down');
    }
    if (this.teams.size >= this.config.maxConcurrentTeams) {
      throw new Error(
        `Maximum concurrent teams (${this.config.maxConcurrentTeams}) reached. Terminate an existing team first.`
      );
    }

    const teamId = name;
    if (this.teams.has(teamId)) {
      throw new Error(`Team "${teamId}" already exists`);
    }

    const resolvedProjectPath = path.resolve(projectPath);

    // Project directory must already exist — engine attaches to existing repos
    if (!fs.existsSync(resolvedProjectPath)) {
      throw new Error(`Project path does not exist: ${resolvedProjectPath}`);
    }

    // Create .claude-orchestra/teams/{teamId}/ in the target project
    const orchDir = path.join(resolvedProjectPath, '.claude-orchestra');
    const teamDir = path.join(orchDir, 'teams', teamId);
    fs.mkdirSync(teamDir, { recursive: true });

    // Add .claude-orchestra/ to the project's .gitignore if not present
    this.ensureGitignore(resolvedProjectPath);

    const limits: LoopLimits = {
      ...DEFAULT_LOOP_LIMITS,
      ...this.config.limits,
    };

    const state = TeamState.create(teamId, name, resolvedProjectPath, limits);

    // Register team directory with persistence and persist initial state
    this.persistence.registerTeamDir(teamId, teamDir);
    this.persistence.ensureTeamDir(teamId);
    this.persistence.persistNow(state);

    // Add registry entry
    this.registry.add({
      teamId,
      teamName: name,
      projectPath: resolvedProjectPath,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });

    const ctx: SubagentTeamContext = {
      state,
      activeQuery: null,
      subagentHistory: [],
      securityScanDone: false,
    };

    this.teams.set(teamId, ctx);
    this.emit('team-created', teamId);

    return state;
  }

  // --- Recovery ---

  /**
   * Recover teams from persisted state on disk.
   * This allows assign-task to find teams created in a previous process.
   * Returns the list of recovered team IDs.
   */
  recover(): string[] {
    const recovered: string[] = [];
    const entries = this.registry.load();

    for (const entry of entries) {
      if (this.teams.has(entry.teamId)) continue;

      // Handle missing project path gracefully (project deleted or moved)
      if (!fs.existsSync(entry.projectPath)) {
        continue;
      }

      const teamDir = path.join(
        entry.projectPath, '.claude-orchestra', 'teams', entry.teamId
      );
      const data = this.persistence.loadFromDir(teamDir);
      if (!data) continue;

      // Skip terminal teams
      if (
        data.currentPhase === TeamPhase.Done ||
        data.currentPhase === TeamPhase.Cancelled ||
        data.currentPhase === TeamPhase.Errored
      ) {
        continue;
      }

      // Register team directory with persistence
      this.persistence.registerTeamDir(entry.teamId, teamDir);

      const limits: LoopLimits = { ...DEFAULT_LOOP_LIMITS, ...this.config.limits };
      const state = TeamState.fromData(data, limits);

      const ctx: SubagentTeamContext = {
        state,
        activeQuery: null,
        subagentHistory: [],
        securityScanDone: false,
      };

      this.teams.set(entry.teamId, ctx);
      recovered.push(entry.teamId);
    }

    return recovered;
  }

  // --- Task Assignment ---

  assignTask(teamId: string, taskDescription: string): void {
    if (this.shuttingDown) {
      throw new Error('Orchestrator is shutting down');
    }

    const ctx = this.teams.get(teamId);
    if (!ctx) throw new Error(`Team "${teamId}" not found`);
    if (ctx.state.isTerminal) throw new Error(`Team "${teamId}" is in terminal state: ${ctx.state.currentPhase}`);
    if (ctx.state.snapshot.currentTask) throw new Error(`Team "${teamId}" already has an active task`);

    // Record the task and classify complexity
    ctx.state.assignTask(taskDescription);
    const complexity = classifyComplexity(taskDescription);
    ctx.state.setTaskComplexity(complexity);

    const agentCount = complexity === 'simple' ? 2 : 5;
    this.emit('task-classified', teamId, complexity, agentCount);
    this.emit('task-assigned', teamId, taskDescription);

    // Register Supervisor and Worker-1 agents in state
    ctx.state.transitionAgent('Supervisor-1' as any, AgentState.Active);
    ctx.state.transitionAgent('Worker-1' as any, AgentState.Active);

    if (complexity === 'standard') {
      ctx.state.transitionAgent('Worker-2' as any, AgentState.Active);
      ctx.state.transitionAgent('Security-1' as any, AgentState.Active);
      ctx.state.transitionAgent('Reviewer-1' as any, AgentState.Active);
    }

    // Build subagent definitions and launch the query
    const agentDefs = this.buildAgentDefinitions(complexity);
    const supervisorPrompt = this.loadRolePrompt('supervisor.claude.md');
    const taskPrompt = this.buildTaskPrompt(taskDescription, complexity);

    this.persistence.persistNow(ctx.state);

    // Launch the SDK query
    this.startQuery(teamId, ctx, taskPrompt, supervisorPrompt, agentDefs);
  }

  // --- Query ---

  getTeamStatus(teamId: string): Readonly<TeamStateData> | undefined {
    return this.teams.get(teamId)?.state.snapshot;
  }

  getAllTeams(): Array<Readonly<TeamStateData>> {
    const result: Array<Readonly<TeamStateData>> = [];
    for (const ctx of this.teams.values()) {
      result.push(ctx.state.snapshot);
    }
    return result;
  }

  // --- Start / Stop (no-ops for API compatibility) ---
  // The SubagentOrchestrator doesn't use a tick loop.

  start(): void {
    // No-op — subagent mode doesn't use a tick loop
  }

  stop(): void {
    // No-op
  }

  // --- Shutdown ---

  async terminateTeam(teamId: string): Promise<void> {
    const ctx = this.teams.get(teamId);
    if (!ctx) return;

    // Close active query if running
    if (ctx.activeQuery) {
      ctx.activeQuery.close();
      ctx.activeQuery = null;
    }

    // Transition to cancelled if mid-task
    if (!ctx.state.isTerminal) {
      const fromPhase = ctx.state.currentPhase;
      try {
        ctx.state.transitionPhase(TeamPhase.Cancelled);
        this.emit('phase-transition', teamId, fromPhase, TeamPhase.Cancelled, 'manual termination');
      } catch {
        // Transition may not be valid — best effort
      }
    }

    this.persistence.persistNow(ctx.state);

    // Remove from registry
    this.registry.remove(teamId);

    this.teams.delete(teamId);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    // Close all active queries
    for (const [, ctx] of this.teams) {
      if (ctx.activeQuery) {
        ctx.activeQuery.close();
        ctx.activeQuery = null;
      }
      if (!ctx.state.isTerminal) {
        try {
          ctx.state.transitionPhase(TeamPhase.Cancelled);
        } catch {
          // Best effort
        }
      }
      this.persistence.persistNow(ctx.state);
    }

    this.teams.clear();
    this.persistence.dispose();
    this.emit('shutdown');
  }

  forceKillAll(): void {
    for (const ctx of this.teams.values()) {
      if (ctx.activeQuery) {
        ctx.activeQuery.close();
        ctx.activeQuery = null;
      }
      try {
        this.persistence.persistNow(ctx.state);
      } catch {
        // Best effort
      }
    }
    this.teams.clear();
    this.persistence.dispose();
  }

  // --- Registry Access (for dashboard) ---

  getRegistryEntries(): import('./registry.js').RegistryEntry[] {
    return this.registry.load();
  }

  // --- Private: .gitignore Management ---

  private ensureGitignore(projectPath: string): void {
    const gitignorePath = path.join(projectPath, '.gitignore');
    const entry = '.claude-orchestra/';

    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
      // Check if already present
      if (content.split('\n').some(line => line.trim() === entry)) {
        return;
      }
    }

    // Append the entry
    const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(gitignorePath, content + separator + entry + '\n', 'utf-8');
  }

  // --- Private: Phase Transition Helper ---

  /**
   * Attempt a phase transition. If invalid, silently skip.
   * Emits phase-transition event on success.
   */
  private tryTransitionPhase(
    state: TeamState,
    teamId: string,
    fromPhase: TeamPhase,
    toPhase: TeamPhase,
    trigger: string
  ): void {
    try {
      state.transitionPhase(toPhase);
      this.emit('phase-transition', teamId, fromPhase, toPhase, trigger);
    } catch {
      // Invalid transition — subagent model may not follow strict phase ordering
    }
  }

  // --- Private: Agent Definition Building ---

  private buildAgentDefinitions(
    complexity: 'simple' | 'standard'
  ): Record<string, AgentDefinition> {
    const defs: Record<string, AgentDefinition> = {};

    // Worker-1 (always present)
    const workerPrompt = this.loadRolePrompt('worker.claude.md');
    defs['Worker-1'] = {
      description: 'Executes coding tasks. Invoke this agent to assign implementation work.',
      prompt: workerPrompt,
      model: mapModelToShort(this.models[Role.Worker]),
      disallowedTools: this.disallowedTools[Role.Worker].length > 0
        ? this.disallowedTools[Role.Worker]
        : undefined,
      maxTurns: this.maxTurnsPerRole[Role.Worker],
    };

    if (complexity === 'standard') {
      // Worker-2
      defs['Worker-2'] = {
        description: 'Executes coding tasks. Invoke this agent for a second parallel worker.',
        prompt: workerPrompt,
        model: mapModelToShort(this.models[Role.Worker]),
        disallowedTools: this.disallowedTools[Role.Worker].length > 0
          ? this.disallowedTools[Role.Worker]
          : undefined,
        maxTurns: this.maxTurnsPerRole[Role.Worker],
      };

      // Security
      const securityPrompt = this.loadRolePrompt('security.claude.md');
      defs['Security'] = {
        description: 'Security scanning and analysis. Invoke for pre-work scans and post-work sweeps.',
        prompt: securityPrompt,
        model: mapModelToShort(this.models[Role.Security]),
        disallowedTools: this.disallowedTools[Role.Security].length > 0
          ? this.disallowedTools[Role.Security]
          : undefined,
        maxTurns: this.maxTurnsPerRole[Role.Security],
      };

      // Reviewer
      const reviewerPrompt = this.loadRolePrompt('reviewer.claude.md');
      defs['Reviewer'] = {
        description: 'Code review and quality assessment. Invoke after security sweep passes.',
        prompt: reviewerPrompt,
        model: mapModelToShort(this.models[Role.Reviewer]),
        disallowedTools: this.disallowedTools[Role.Reviewer].length > 0
          ? this.disallowedTools[Role.Reviewer]
          : undefined,
        maxTurns: this.maxTurnsPerRole[Role.Reviewer],
      };
    }

    return defs;
  }

  // --- Private: Task Prompt ---

  private buildTaskPrompt(
    taskDescription: string,
    complexity: 'simple' | 'standard'
  ): string {
    if (complexity === 'simple') {
      return (
        'A new task has been assigned to your team.\n\n' +
        `TASK: ${taskDescription}\n\n` +
        'PIPELINE: SIMPLE\n' +
        'You have one worker available: Worker-1. No Security or Reviewer agents.\n\n' +
        'Instructions:\n' +
        '1. Invoke the Worker-1 agent with clear instructions for the task.\n' +
        '2. Once the Worker completes, the task is done.\n' +
        '3. Summarize the result.'
      );
    }

    return (
      'A new task has been assigned to your team.\n\n' +
      `TASK: ${taskDescription}\n\n` +
      'PIPELINE: STANDARD (full team)\n' +
      'Available agents: Worker-1, Worker-2, Security, Reviewer\n\n' +
      'Follow this workflow:\n' +
      '1. PRE-WORK: Invoke the Security agent with a scan request describing the task scope.\n' +
      '2. Read the Security scan results. Plan how to split work between Worker-1 and Worker-2.\n' +
      '3. WORK: Invoke Worker-1 and Worker-2 with their assignments and the clearance boundaries from the Security scan.\n' +
      '4. HANDOFF: Once Workers complete, invoke the Security agent again for a post-work sweep of the changes.\n' +
      '5. If Security APPROVES or FLAGS: invoke the Reviewer agent with the task context and worker summaries.\n' +
      '   If Security BLOCKS: invoke the Workers again to fix the issues, then re-sweep.\n' +
      '6. REVIEW: Read the Reviewer verdict.\n' +
      '   If APPROVED: the task is complete. Summarize the result.\n' +
      '   If REVISION_NEEDED: invoke Workers again with the feedback, then re-sweep and re-review.\n' +
      '   If REJECTED: re-plan from scratch (start from step 1).'
    );
  }

  // --- Private: Role Prompt Loading ---

  private loadRolePrompt(filename: string): string {
    const promptPath = path.join(this.config.rolesDir, filename);
    try {
      return fs.readFileSync(promptPath, 'utf-8');
    } catch (err: any) {
      throw new Error(`Failed to read role prompt at ${promptPath}: ${err?.message}`);
    }
  }

  // --- Private: SDK Query Management ---

  private startQuery(
    teamId: string,
    ctx: SubagentTeamContext,
    taskPrompt: string,
    supervisorSystemPrompt: string,
    agentDefs: Record<string, AgentDefinition>
  ): void {
    const complexity = ctx.state.snapshot.currentTask?.complexity ?? 'standard';

    // Build the full agents record including Supervisor as the main agent
    const allAgents: Record<string, AgentDefinition> = {
      Supervisor: {
        description: 'Orchestrates the team workflow. Plans, delegates, and coordinates.',
        prompt: supervisorSystemPrompt,
        model: mapModelToShort(this.models[Role.Supervisor]),
        disallowedTools: this.disallowedTools[Role.Supervisor].length > 0
          ? this.disallowedTools[Role.Supervisor]
          : undefined,
        maxTurns: this.maxTurnsPerRole[Role.Supervisor],
      },
      ...agentDefs,
    };

    // Build hooks for phase tracking
    const hooks = this.buildHooks(teamId, ctx);

    try {
      const q = query({
        prompt: taskPrompt,
        options: {
          agent: 'Supervisor',
          agents: allAgents,
          cwd: ctx.state.snapshot.projectPath,
          effort: this.config.effort,
          maxTurns: this.maxTurnsPerRole[Role.Supervisor],
          maxBudgetUsd: this.config.maxBudgetUsd,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          persistSession: false,
          hooks,
        },
      });

      ctx.activeQuery = q;

      // Consume the SDK stream in the background
      this.consumeStream(teamId, ctx, q);
    } catch (err: any) {
      this.emit('error', teamId, new Error(`SDK query() failed: ${err?.message ?? err}`));
      try {
        ctx.state.transitionPhase(TeamPhase.Errored);
      } catch {
        // Best effort
      }
      this.persistence.persistNow(ctx.state);
    }
  }

  private async consumeStream(
    teamId: string,
    ctx: SubagentTeamContext,
    q: Query
  ): Promise<void> {
    try {
      for await (const msg of q) {
        // Extract text from SDK messages for agent-output events
        const text = extractSdkText(msg);
        if (text) {
          this.emit('agent-output', teamId, 'Supervisor-1' as any, text);
        }
      }

      // Query completed — task is done
      if (!ctx.state.isTerminal) {
        const fromPhase = ctx.state.currentPhase;
        try {
          ctx.state.transitionPhase(TeamPhase.Done);
          this.emit('phase-transition', teamId, fromPhase, TeamPhase.Done, 'query completed');
        } catch {
          // Transition may not be valid from current phase — force to errored
          try {
            ctx.state.transitionPhase(TeamPhase.Errored);
            this.emit('phase-transition', teamId, fromPhase, TeamPhase.Errored, 'query completed (unexpected phase)');
          } catch {
            // Best effort
          }
        }

        // Emit task-complete
        const task = ctx.state.snapshot.currentTask;
        const startTime = task?.assignedAt ? new Date(task.assignedAt).getTime() : 0;
        const durationMs = startTime > 0 ? Date.now() - startTime : 0;
        this.emit('task-complete', teamId, ctx.state.currentPhase, durationMs);
      }
    } catch (err: any) {
      if (!this.shuttingDown) {
        this.emit('error', teamId, new Error(`SDK stream error: ${err?.message ?? err}`));
        if (!ctx.state.isTerminal) {
          const fromPhase = ctx.state.currentPhase;
          try {
            ctx.state.transitionPhase(TeamPhase.Errored);
          } catch {
            // Best effort
          }
          this.emit('phase-transition', teamId, fromPhase, TeamPhase.Errored, 'sdk-error');

          const task = ctx.state.snapshot.currentTask;
          const startTime = task?.assignedAt ? new Date(task.assignedAt).getTime() : 0;
          const durationMs = startTime > 0 ? Date.now() - startTime : 0;
          this.emit('task-complete', teamId, TeamPhase.Errored, durationMs);
        }
      }
    } finally {
      ctx.activeQuery = null;
      this.persistence.persistNow(ctx.state);
    }
  }

  // --- Private: Hook Building ---

  private buildHooks(
    teamId: string,
    ctx: SubagentTeamContext
  ): Record<string, Array<{ hooks: HookCallback[] }>> {
    const onSubagentStart: HookCallback = async (
      input: HookInput,
      _toolUseId: string | undefined,
      _options: { signal: AbortSignal }
    ): Promise<HookJSONOutput> => {
      if (input.hook_event_name !== 'SubagentStart') return { continue: true };

      const agentType = (input as any).agent_type as string;
      ctx.subagentHistory.push({ type: agentType, startedAt: Date.now() });

      // Phase tracking based on which subagent starts
      const fromPhase = ctx.state.currentPhase;

      if (agentType === 'Security') {
        if (!ctx.securityScanDone) {
          // First Security invocation → PreWork phase (pre-scan)
          // Already in PreWork from create(), so usually no transition needed
          if (fromPhase !== TeamPhase.PreWork) {
            this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.PreWork, `${agentType} pre-scan`);
          }
        } else {
          // Subsequent Security invocations → Handoff phase (sweep)
          if (fromPhase !== TeamPhase.Handoff) {
            this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Handoff, `${agentType} sweep`);
          }
        }
      } else if (agentType === 'Worker-1' || agentType === 'Worker-2') {
        if (fromPhase !== TeamPhase.Work) {
          this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Work, `${agentType} started`);
        }
      } else if (agentType === 'Reviewer') {
        if (fromPhase !== TeamPhase.Review) {
          this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Review, `${agentType} started`);
        }
      }

      this.persistence.persist(ctx.state);
      return { continue: true };
    };

    const onSubagentStop: HookCallback = async (
      input: HookInput,
      _toolUseId: string | undefined,
      _options: { signal: AbortSignal }
    ): Promise<HookJSONOutput> => {
      if (input.hook_event_name !== 'SubagentStop') return { continue: true };

      const agentType = (input as any).agent_type as string;

      // Mark the end time for this subagent
      const lastEntry = [...ctx.subagentHistory].reverse().find(e => e.type === agentType && !e.endedAt);
      if (lastEntry) {
        lastEntry.endedAt = Date.now();
      }

      // Track Security scan completion
      if (agentType === 'Security' && !ctx.securityScanDone) {
        ctx.securityScanDone = true;
      }

      this.persistence.persist(ctx.state);
      return { continue: true };
    };

    return {
      SubagentStart: [{ hooks: [onSubagentStart] }],
      SubagentStop: [{ hooks: [onSubagentStop] }],
    };
  }
}

// --- Utility: Extract text from SDK messages ---

function extractSdkText(msg: any): string | null {
  // SDKAssistantMessage with content array
  if (msg?.type === 'assistant' && Array.isArray(msg.content)) {
    const textParts = msg.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text);
    return textParts.length > 0 ? textParts.join('\n') : null;
  }
  // Result message with text
  if (msg?.type === 'result' && msg.result) {
    return typeof msg.result === 'string' ? msg.result : null;
  }
  return null;
}
