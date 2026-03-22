// Main orchestrator class. Ties together the spawner, message bus,
// phase controller, team state, and persistence into a unified
// tick-based engine loop.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { Role, type RoleInstance, ROLE_INSTANCES, VALID_INSTANCES } from './roles/role-types.js';
import { AgentState, Phase, Priority } from './types/index.js';
import { MessageBus } from './router/message-bus.js';
import { type AgentMessage, type CreateMessageParams, validateMessage } from './router/message-types.js';
import { SupervisorToSecurityFlag, SupervisorToWorkerFlag, SupervisorToReviewerFlag, type MessageFlag } from './router/flag-enums.js';
import { TeamState, TeamPhase, type TeamStateData, type LoopLimits, DEFAULT_LOOP_LIMITS } from './state/team-state.js';
import { StatePersistence } from './state/persistence.js';
import { Registry } from './registry.js';
import { AgentSpawner } from './spawner/agent-spawner.js';
import { AgentProcess, ProcessState } from './spawner/agent-process.js';
import { PhaseController, type PhaseAction, type PhaseEvaluation } from './phases/phase-controller.js';
import { classifyComplexity } from './router/complexity-router.js';

// --- Configuration ---

export interface OrchestraConfig {
  registryPath: string;
  logDirectory: string;
  rolesDir: string;
  tickIntervalMs: number;
  maxConcurrentTeams: number;
  claudeBin?: string;
  spawnArgs?: string[];
  models?: Partial<Record<Role, string>>;
  /** Effort level overrides per role (controls reasoning depth) */
  efforts?: Partial<Record<Role, 'low' | 'medium' | 'high' | 'max'>>;
  /** Disallowed tools overrides per role (removes tools from agent context) */
  disallowedTools?: Partial<Record<Role, string[]>>;
  /** Max turns overrides per role (safety net against runaway agents) */
  maxTurns?: Partial<Record<Role, number>>;
  /** Global max budget per agent query (USD) */
  maxBudgetUsd?: number;
  limits?: Partial<LoopLimits>;
  maxRespawns?: number;
  maxMalformedRetries?: number;
}

const DEFAULT_CONFIG: Required<Omit<OrchestraConfig, 'claudeBin' | 'spawnArgs' | 'models' | 'limits' | 'efforts' | 'disallowedTools' | 'maxTurns' | 'maxBudgetUsd'>> & Pick<OrchestraConfig, 'claudeBin' | 'spawnArgs' | 'models' | 'limits' | 'efforts' | 'disallowedTools' | 'maxTurns' | 'maxBudgetUsd'> = {
  registryPath: './registry.json',
  logDirectory: './logs',
  rolesDir: './roles',
  tickIntervalMs: 1000,
  maxConcurrentTeams: 5,
  maxRespawns: 3,
  maxMalformedRetries: 3,
};

// --- Orchestrator events ---

export interface OrchestratorEvents {
  'team-created': [teamId: string];
  'task-assigned': [teamId: string, description: string];
  'task-classified': [teamId: string, complexity: string, agentCount: number];
  'phase-transition': [teamId: string, from: TeamPhase, to: TeamPhase, trigger: string];
  'task-complete': [teamId: string, phase: TeamPhase, durationMs: number];
  'message-routed': [teamId: string, message: AgentMessage];
  'agent-output': [teamId: string, instance: RoleInstance, data: string];
  'agent-progress': [teamId: string, instance: RoleInstance, text: string];
  'agent-message': [teamId: string, instance: RoleInstance, message: AgentMessage];
  'agent-crashed': [teamId: string, instance: RoleInstance, code: number | null];
  'agent-stderr': [teamId: string, instance: RoleInstance, data: string];
  'agent-respawned': [teamId: string, instance: RoleInstance];
  'malformed-output': [teamId: string, instance: RoleInstance, raw: string];
  'deadlock-detected': [teamId: string];
  'error': [teamId: string, error: Error];
  'feedback': [teamId: string, feedback: FeedbackPayload];
  'feedback-response': [teamId: string, feedbackId: string, value: string];
  'agent-task': [teamId: string, instance: RoleInstance, subtask: string];
  'tick': [teamId: string];
  'security-review': [teamId: string, data: { status: string; result?: string }];
  'shutdown': [];
}

export interface FeedbackPayload {
  id: string;
  type: 'info' | 'warning' | 'question' | 'decision';
  title: string;
  message: string;
  actions?: Array<{ label: string; value: string }>;
  blocking?: boolean;
  timestamp: string;
  sourceAgent?: string;
  highlightTerms?: string[];
}

// --- Per-team runtime context ---

interface TeamContext {
  state: TeamState;
  bus: MessageBus;
  /** Counts of consecutive malformed outputs per agent */
  malformedCounts: Map<RoleInstance, number>;
  /** Whether all agents have been spawned and are ready */
  agentsReady: boolean;
}

// --- Orchestrator ---

export class Orchestrator extends EventEmitter<OrchestratorEvents> {
  private readonly config: OrchestraConfig & typeof DEFAULT_CONFIG;
  private readonly persistence: StatePersistence;
  private readonly registry: Registry;
  private readonly spawner: AgentSpawner;
  private readonly phaseController: PhaseController;
  private readonly teams: Map<string, TeamContext> = new Map();

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;

  constructor(config: Partial<OrchestraConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config } as OrchestraConfig & typeof DEFAULT_CONFIG;

    this.persistence = new StatePersistence();
    this.registry = new Registry(this.config.registryPath);

    this.spawner = new AgentSpawner({
      claudeBin: this.config.claudeBin,
      spawnArgs: this.config.spawnArgs,
      rolesDir: this.config.rolesDir,
      models: this.config.models,
      efforts: this.config.efforts,
      disallowedTools: this.config.disallowedTools,
      maxTurns: this.config.maxTurns,
      maxBudgetUsd: this.config.maxBudgetUsd,
      maxRespawns: this.config.maxRespawns,
    });

    this.phaseController = new PhaseController();

    // Wire phase controller events
    this.phaseController.on('transition', (from, to, trigger) => {
      // Emit on any active team — resolved by callers that know the teamId
    });

    this.phaseController.on('error', (err) => {
      // Handled per-tick in processMessage
    });
  }

  // --- Team Lifecycle ---

  /**
   * Create a new team. Initializes state, data directories, and message bus.
   * Does NOT spawn agents yet — that happens on assignTask.
   */
  createTeam(name: string, projectPath: string): TeamState {
    if (this.shuttingDown) {
      throw new Error('Orchestrator is shutting down');
    }
    if (this.teams.size >= this.config.maxConcurrentTeams) {
      throw new Error(
        `Maximum concurrent teams (${this.config.maxConcurrentTeams}) reached. Terminate an existing team first.`
      );
    }

    const teamId = name; // Use name as teamId for simplicity
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

    // Initialize message bus
    const bus = new MessageBus({ teamDir });
    bus.init();

    // Create reports directories
    fs.mkdirSync(path.join(teamDir, 'reports', 'clearance'), { recursive: true });
    fs.mkdirSync(path.join(teamDir, 'reports', 'reviews'), { recursive: true });

    // Add registry entry
    this.registry.add({
      teamId,
      teamName: name,
      projectPath: resolvedProjectPath,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });

    const ctx: TeamContext = {
      state,
      bus,
      malformedCounts: new Map(),
      agentsReady: false,
    };

    this.teams.set(teamId, ctx);
    this.emit('team-created', teamId);

    return state;
  }

  /**
   * Assign a task to a team. Spawns agents and kicks off the pre-work phase
   * by sending the task to the Supervisor via stdin prompt.
   */
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
    this.spawner.resetRespawnCounts(teamId);

    // Spawn agents based on complexity routing
    let agents: AgentProcess[];
    if (complexity === 'simple') {
      // Simple: Supervisor-1 + Worker-1 only (skip Security, Reviewer, Worker-2)
      agents = this.spawner.spawnSelected(
        teamId,
        ctx.state.snapshot.projectPath,
        [Role.Supervisor, Role.Worker],
        ['Supervisor-1', 'Worker-1'] as RoleInstance[]
      );
    } else {
      // Standard: all 5 agents (full pipeline)
      agents = this.spawner.spawnTeam(teamId, ctx.state.snapshot.projectPath);
    }
    ctx.agentsReady = true;

    // Wire up agent events
    for (const agent of agents) {
      this.wireAgentEvents(teamId, agent);

      // Update PID in state
      ctx.state.setAgentPid(agent.instance, agent.pid);
      ctx.state.transitionAgent(agent.instance, AgentState.Active);
    }

    // Send the initial task to the Supervisor
    const supervisorAgent = this.spawner.getAgent(teamId, 'Supervisor-1' as RoleInstance);
    if (supervisorAgent) {
      const initialPrompt = this.buildTaskPrompt(taskDescription, ctx);
      supervisorAgent.send(initialPrompt);
    }

    // Persist state
    this.persistence.persistNow(ctx.state);
    this.emit('task-classified', teamId, complexity, agents.length);
    this.emit('task-assigned', teamId, taskDescription);
  }

  // --- Main Loop ---

  /**
   * Start the tick-based main loop.
   */
  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      this.tickAll();
    }, this.config.tickIntervalMs);
  }

  /**
   * Stop the main loop (does not terminate agents).
   */
  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * Run a single tick for all active teams.
   */
  tickAll(): void {
    for (const [teamId, ctx] of this.teams) {
      if (!ctx.state.isTerminal && ctx.agentsReady) {
        this.tick(teamId);
      }
    }
  }

  /**
   * Main loop iteration for a single team:
   * 1. Check agent health
   * 2. Check inboxes, inject messages into agents
   * 3. Process any outgoing messages from agents
   * 4. Check for deadlock
   * 5. Persist state
   */
  tick(teamId: string): void {
    const ctx = this.teams.get(teamId);
    if (!ctx || ctx.state.isTerminal) return;

    // 1. Health checks
    this.checkAgentHealth(teamId, ctx);

    // 2. Check each agent's inbox and inject messages
    this.processInboxes(teamId, ctx);

    // 3. Check for deadlock
    this.checkDeadlock(teamId, ctx);

    // 4. Persist state (debounced)
    this.persistence.persist(ctx.state);

    this.emit('tick', teamId);
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

  // --- Shutdown ---

  /**
   * Gracefully terminate a single team.
   */
  async terminateTeam(teamId: string): Promise<void> {
    const ctx = this.teams.get(teamId);
    if (!ctx) return;

    // Transition to cancelled if mid-task
    if (!ctx.state.isTerminal) {
      this.phaseController.forceCancel(ctx.state, 'Team terminated by orchestrator');
      this.emit('phase-transition', teamId, ctx.state.currentPhase, TeamPhase.Cancelled, 'manual termination');
    }

    // Persist final state
    this.persistence.persistNow(ctx.state);

    // Remove from registry
    this.registry.remove(teamId);

    // Terminate agents
    await this.spawner.terminateTeam(teamId);

    this.teams.delete(teamId);
  }

  /**
   * Graceful shutdown of the entire orchestrator.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.stop();

    // Persist and terminate all teams
    const teamIds = Array.from(this.teams.keys());
    for (const teamId of teamIds) {
      const ctx = this.teams.get(teamId)!;
      if (!ctx.state.isTerminal) {
        this.phaseController.forceCancel(ctx.state, 'Orchestrator shutdown');
      }
      this.persistence.persistNow(ctx.state);
    }

    // Terminate all agents in parallel
    await Promise.all(teamIds.map((id) => this.spawner.terminateTeam(id)));
    this.teams.clear();
    this.persistence.dispose();

    this.emit('shutdown');
  }

  /**
   * Force kill everything immediately.
   */
  forceKillAll(): void {
    this.stop();
    this.spawner.forceKillAll();

    // Best-effort persist
    for (const ctx of this.teams.values()) {
      try {
        this.persistence.persistNow(ctx.state);
      } catch {
        // Best effort
      }
    }

    this.teams.clear();
    this.persistence.dispose();
  }

  /**
   * Recover teams from persisted state on restart.
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
      const bus = new MessageBus({ teamDir });
      bus.init();

      const ctx: TeamContext = {
        state,
        bus,
        malformedCounts: new Map(),
        agentsReady: false,
      };

      this.teams.set(entry.teamId, ctx);

      // Respawn agents
      if (data.currentTask) {
        try {
          const agents = this.spawner.spawnTeam(entry.teamId, data.projectPath);
          ctx.agentsReady = true;

          for (const agent of agents) {
            this.wireAgentEvents(entry.teamId, agent);
            ctx.state.setAgentPid(agent.instance, agent.pid);

            // Send recovery prompt
            const recoveryPrompt = this.buildRecoveryPrompt(data, agent.instance, ctx);
            agent.send(recoveryPrompt);
          }
        } catch {
          // If spawning fails, mark as errored
          const fromPhase = state.currentPhase;
          this.phaseController.forceError(state, 'Failed to respawn agents on recovery');
          this.emit('phase-transition', entry.teamId, fromPhase, TeamPhase.Errored, 'recovery-spawn-failure');
          this.persistence.persistNow(state);
          continue;
        }
      }

      recovered.push(entry.teamId);
    }

    return recovered;
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

  // --- Private: Agent Event Wiring ---

  private wireAgentEvents(teamId: string, agent: AgentProcess): void {
    const ctx = this.teams.get(teamId);
    if (!ctx) return;

    // Handle structured messages from agent stdout
    agent.on('message', (raw: string) => {
      this.handleAgentMessage(teamId, agent.instance, raw, ctx);
    });

    // Handle general output
    agent.on('output', (data: string) => {
      ctx.state.touchAgentMessage(agent.instance);
      this.emit('agent-output', teamId, agent.instance, data);
    });

    // Handle stderr (error messages from SDK or process)
    agent.on('stderr', (data: string) => {
      this.emit('agent-stderr', teamId, agent.instance, data);
    });

    // Handle crashes
    agent.on('exit', (code: number | null, _signal: NodeJS.Signals | null) => {
      if (agent.state === ProcessState.Crashed) {
        this.emit('agent-crashed', teamId, agent.instance, code);
        this.handleAgentCrash(teamId, agent.instance, ctx);
      }
    });
  }

  // --- Private: Message Handling ---

  private handleAgentMessage(
    teamId: string,
    instance: RoleInstance,
    raw: string,
    ctx: TeamContext
  ): void {
    let parsed: AgentMessage;
    try {
      parsed = JSON.parse(raw) as AgentMessage;
    } catch {
      this.handleMalformedOutput(teamId, instance, raw, ctx);
      return;
    }

    // Validate the message
    const errors = validateMessage(parsed);
    if (errors.length > 0) {
      const errorSummary = errors.map(e => `${e.field}: ${e.message}`).join('; ');
      this.handleMalformedOutput(teamId, instance, `[Validation: ${errorSummary}] ${raw}`, ctx);
      return;
    }

    // Reset malformed counter on success
    ctx.malformedCounts.set(instance, 0);
    ctx.state.touchAgentMessage(instance);

    // Route the message through the bus
    try {
      ctx.bus.send(parsed);
    } catch (err) {
      this.emit('error', teamId, err as Error);
      return;
    }

    // Evaluate phase implications
    const evaluation = this.phaseController.evaluate(ctx.state, parsed);
    if (evaluation.shouldTransition && evaluation.targetPhase) {
      const from = ctx.state.currentPhase;
      this.phaseController.apply(ctx.state, evaluation);

      if (ctx.state.currentPhase !== from) {
        this.emit('phase-transition', teamId, from, ctx.state.currentPhase, evaluation.trigger ?? 'message');
        this.persistence.persistNow(ctx.state);

        // If we reached a terminal state, emit task-complete and clean up
        if (ctx.state.isTerminal) {
          this.handleTaskTerminal(teamId, ctx);
        }
      }
    }

    // Execute any actions from the evaluation
    for (const action of evaluation.actions) {
      this.executeAction(teamId, action, ctx, parsed);
    }

    this.emit('agent-message', teamId, instance, parsed);
  }

  private handleMalformedOutput(
    teamId: string,
    instance: RoleInstance,
    raw: string,
    ctx: TeamContext
  ): void {
    const count = (ctx.malformedCounts.get(instance) ?? 0) + 1;
    ctx.malformedCounts.set(instance, count);
    this.emit('malformed-output', teamId, instance, raw);

    const maxRetries = this.config.maxMalformedRetries ?? 3;

    if (count >= maxRetries) {
      // Mark agent as errored
      try {
        ctx.state.transitionAgent(instance, AgentState.Errored);
      } catch {
        // Already errored or invalid transition
      }
      return;
    }

    // Send corrective prompt
    const agent = this.spawner.getAgent(teamId, instance);
    if (agent?.isAlive) {
      agent.send(
        'Your previous output was not valid JSON matching the orchestra message schema. ' +
        'Please resend your message using the correct format:\n' +
        '---ORCHESTRA-MESSAGE-START---\n{valid JSON message}\n---ORCHESTRA-MESSAGE-END---'
      );
    }
  }

  // --- Private: Inbox Processing ---

  private processInboxes(teamId: string, ctx: TeamContext): void {
    for (const instance of VALID_INSTANCES) {
      const agent = this.spawner.getAgent(teamId, instance);
      if (!agent?.isAlive) continue;

      const messages = ctx.bus.receive(instance);
      if (messages.length === 0) continue;

      // Inject messages into agent context via stdin
      for (const msg of messages) {
        const prompt = this.buildInboxPrompt(msg, ctx);
        agent.send(prompt);

        // Acknowledge the message
        ctx.bus.acknowledge(msg.messageId, instance);
        ctx.state.touchAgentMessage(instance);
      }
    }
  }

  // --- Private: Action Execution ---

  private executeAction(
    teamId: string,
    action: PhaseAction,
    ctx: TeamContext,
    triggerMessage: AgentMessage
  ): void {
    switch (action.type) {
      case 'set-agent-states': {
        const targets = action.details.targets as RoleInstance[];
        const targetState = action.details.state as AgentState;
        for (const target of targets) {
          try {
            ctx.state.transitionAgent(target, targetState);
          } catch {
            // Transition may not be valid from current state
          }
        }
        break;
      }

      case 'send-sweep-request': {
        const sweepTaskDesc = ctx.state.snapshot.currentTask?.description ?? 'unknown task';
        const sweepProjectPath = ctx.state.snapshot.projectPath;

        const sweepMsg = ctx.bus.createMessage({
          threadId: triggerMessage.threadId,
          roleSource: Role.Supervisor,
          roleSourceInstance: 'Supervisor-1' as RoleInstance,
          roleTarget: Role.Security,
          roleTargetInstance: 'Security-1' as RoleInstance,
          flag: SupervisorToSecurityFlag.SweepRequest as unknown as MessageFlag,
          priority: Priority.High,
          phase: Phase.Handoff,
          content:
            `POST-WORK SECURITY SWEEP\n\n` +
            `Task: ${sweepTaskDesc}\n` +
            `Project directory: ${sweepProjectPath}\n\n` +
            `All workers have completed their tasks. Please perform a security sweep of the completed work ` +
            `in the project directory above.`,
          requiresResponse: true,
        });
        ctx.bus.send(sweepMsg);
        this.emit('message-routed', teamId, sweepMsg);
        break;
      }

      case 'send-review-request': {
        const cautionNotes = action.details.cautionNotes as string | null;

        // Build rich review context so the Reviewer can evaluate the work
        const taskDesc = ctx.state.snapshot.currentTask?.description ?? 'unknown task';
        const projectPath = ctx.state.snapshot.projectPath;

        // Gather worker completion summaries from the thread
        const threadMessages = ctx.bus.getThread(triggerMessage.threadId);
        const workerSummaries = threadMessages
          .filter(m => m.roleSource === Role.Worker && m.flag === 'task-complete')
          .map(m => `  - ${m.roleSourceInstance}: ${m.content.substring(0, 500)}`)
          .join('\n');

        let reviewContent =
          `REVIEW REQUEST\n\n` +
          `Task: ${taskDesc}\n` +
          `Project directory: ${projectPath}\n\n` +
          `Worker completion reports:\n${workerSummaries || '  (no completion reports found)'}\n\n` +
          `Security clearance: PASSED${cautionNotes ? ` (with notes: ${cautionNotes})` : ''}\n\n` +
          `Please evaluate the completed work against the task requirements. ` +
          `You have access to the project directory at ${projectPath} — read the files to verify the work.`;

        // Truncate to max content length
        if (reviewContent.length > 7900) {
          reviewContent = reviewContent.substring(0, 7900) + '\n...(truncated)';
        }

        const reviewMsg = ctx.bus.createMessage({
          threadId: triggerMessage.threadId,
          roleSource: Role.Supervisor,
          roleSourceInstance: 'Supervisor-1' as RoleInstance,
          roleTarget: Role.Reviewer,
          roleTargetInstance: 'Reviewer-1' as RoleInstance,
          flag: SupervisorToReviewerFlag.ReviewRequest as unknown as MessageFlag,
          priority: Priority.High,
          phase: Phase.Review,
          content: reviewContent,
          requiresResponse: true,
        });
        ctx.bus.send(reviewMsg);
        this.emit('message-routed', teamId, reviewMsg);
        break;
      }

      case 'send-revision-request': {
        const feedback = action.details.feedback as string;
        const reason = action.details.reason as string;
        for (const workerInstance of ROLE_INSTANCES[Role.Worker]) {
          const revMsg = ctx.bus.createMessage({
            threadId: triggerMessage.threadId,
            roleSource: Role.Supervisor,
            roleSourceInstance: 'Supervisor-1' as RoleInstance,
            roleTarget: Role.Worker,
            roleTargetInstance: workerInstance,
            flag: SupervisorToWorkerFlag.RevisionRequest as unknown as MessageFlag,
            priority: Priority.High,
            phase: Phase.Work,
            content: `Revision required (${reason}): ${feedback}`,
            requiresResponse: true,
          });
          ctx.bus.send(revMsg);
          this.emit('message-routed', teamId, revMsg);
        }
        break;
      }

      case 'replan-task': {
        const replanReason = action.details.reason as string;
        const originalTask = ctx.state.snapshot.currentTask ?? 'unknown task';
        const supervisor = this.spawner.getAgent(teamId, 'Supervisor-1' as RoleInstance);
        if (supervisor?.isAlive) {
          supervisor.send(
            `REVISION CYCLE — The Reviewer has rejected the work and sent it back for re-planning.\n\n` +
            `Original task: ${originalTask}\n\n` +
            `Reviewer feedback:\n${replanReason}\n\n` +
            `You must now re-plan and restart the pre-work phase:\n` +
            `1. Send a new scan-request to Security-1 for a fresh security sweep.\n` +
            `2. Once you receive the clearance-report, send new task-assignment messages to Worker-1 and Worker-2 addressing the Reviewer's feedback.\n` +
            `3. Wait for task-accepted from both Workers before work begins.\n\n` +
            `All agents have been reset and are ready for new assignments.`
          );
        }
        break;
      }
    }
  }

  // --- Private: Health Checks ---

  private checkAgentHealth(teamId: string, ctx: TeamContext): void {
    for (const instance of VALID_INSTANCES) {
      const agent = this.spawner.getAgent(teamId, instance);
      if (!agent) continue;

      // Check if process is alive
      if (agent.state === ProcessState.Running && !agent.checkAlive()) {
        // Process died without exit event being fired yet — it will come
        continue;
      }
    }
  }

  private handleAgentCrash(teamId: string, instance: RoleInstance, ctx: TeamContext): void {
    // Try to respawn
    const newAgent = this.spawner.respawnAgent(
      teamId,
      instance,
      ctx.state.snapshot.projectPath
    );

    if (!newAgent) {
      // Respawn budget exhausted
      try {
        ctx.state.transitionAgent(instance, AgentState.Errored);
      } catch {
        // May already be errored
      }
      this.persistence.persistNow(ctx.state);
      return;
    }

    // Wire events and send recovery prompt
    this.wireAgentEvents(teamId, newAgent);
    ctx.state.setAgentPid(instance, newAgent.pid);

    try {
      ctx.state.transitionAgent(instance, AgentState.Spawning);
      ctx.state.transitionAgent(instance, AgentState.Active);
    } catch {
      // Best effort state transition
    }

    const recoveryPrompt = this.buildRecoveryPrompt(ctx.state.snapshot, instance, ctx);
    newAgent.send(recoveryPrompt);

    this.emit('agent-respawned', teamId, instance);
    this.persistence.persistNow(ctx.state);
  }

  // --- Private: Deadlock Detection ---

  private checkDeadlock(teamId: string, ctx: TeamContext): void {
    const agentEntries = ctx.state.getAllAgents();

    let anyActive = false;
    let anyWaitingOrBlocked = false;

    for (const [, status] of agentEntries) {
      if (status.state === AgentState.Active) anyActive = true;
      if (status.state === AgentState.Waiting || status.state === AgentState.Blocked) {
        anyWaitingOrBlocked = true;
      }
    }

    // Deadlock: no agent active, at least one waiting/blocked, no pending messages
    if (!anyActive && anyWaitingOrBlocked) {
      // Check if there are pending messages in any inbox
      let hasPendingMessages = false;
      for (const instance of VALID_INSTANCES) {
        const msgs = ctx.bus.receive(instance);
        if (msgs.length > 0) {
          hasPendingMessages = true;
          break;
        }
      }

      if (!hasPendingMessages) {
        this.emit('deadlock-detected', teamId);
        this.phaseController.forceError(ctx.state, 'Deadlock detected: no active agents, no pending messages');
        this.emit('phase-transition', teamId, ctx.state.currentPhase, TeamPhase.Errored, 'deadlock');
        this.persistence.persistNow(ctx.state);
      }
    }
  }

  // --- Private: Terminal State Handling ---

  /**
   * Handle a team reaching a terminal state (done, errored, cancelled).
   * Emits task-complete, terminates agents, and persists final state.
   */
  private handleTaskTerminal(teamId: string, ctx: TeamContext): void {
    const phase = ctx.state.currentPhase;
    const task = ctx.state.snapshot.currentTask;
    const startTime = task?.assignedAt ? new Date(task.assignedAt).getTime() : 0;
    const durationMs = startTime > 0 ? Date.now() - startTime : 0;

    this.emit('task-complete', teamId, phase, durationMs);
    this.persistence.persistNow(ctx.state);

    // Terminate all agents in the background — they're no longer needed
    this.spawner.terminateTeam(teamId).catch(() => {
      // Best effort — agents may already be stopped
    });
  }

  // --- Private: Prompt Builders ---

  private buildTaskPrompt(taskDescription: string, ctx: TeamContext): string {
    const complexity = ctx.state.snapshot.currentTask?.complexity ?? 'standard';

    if (complexity === 'simple') {
      // Simple pipeline: only Supervisor-1 + Worker-1
      // Skip Security scan, skip Review, assign directly to Worker-1
      return (
        'You are the Supervisor for this team. A new task has been assigned.\n\n' +
        `TASK: ${taskDescription}\n\n` +
        'PIPELINE: SIMPLE — Only Worker-1 is available. No Security Agent. No Reviewer.\n\n' +
        'Begin immediately:\n' +
        '1. Send a task-assignment directly to Worker-1 with clear instructions.\n' +
        '2. Do NOT send scan-requests to Security (not available).\n' +
        '3. Do NOT send to Worker-2 (not available).\n\n' +
        'Use the ORCHESTRA-MESSAGE-START/END delimiters to send messages.'
      );
    }

    // Standard pipeline: full 5-agent team
    return (
      'You are the Supervisor for this team. A new task has been assigned.\n\n' +
      `TASK: ${taskDescription}\n\n` +
      'Begin the pre-work phase:\n' +
      '1. Send a scan-request to the Security Agent to scan the project.\n' +
      '2. Wait for the clearance-report.\n' +
      '3. Plan the task and send task-assignments to both Workers.\n\n' +
      'Use the ORCHESTRA-MESSAGE-START/END delimiters to send messages.'
    );
  }

  private buildInboxPrompt(message: AgentMessage, _ctx: TeamContext): string {
    return (
      `You have a new message in your inbox.\n\n` +
      `From: ${message.roleSourceInstance} (${message.roleSource})\n` +
      `Flag: ${message.flag}\n` +
      `Priority: ${message.priority}\n` +
      `Phase: ${message.phase}\n` +
      `Thread: ${message.threadId}\n` +
      `Message ID: ${message.messageId}\n` +
      `Requires Response: ${message.requiresResponse}\n\n` +
      `Content:\n${message.content}\n\n` +
      (message.references.length > 0
        ? `References: ${message.references.join(', ')}\n\n`
        : '') +
      'Process this message and respond as appropriate for your role. ' +
      'Use ORCHESTRA-MESSAGE-START/END delimiters for any outgoing messages.'
    );
  }

  private buildRecoveryPrompt(
    data: Readonly<TeamStateData>,
    instance: RoleInstance,
    ctx: TeamContext
  ): string {
    const agentStatus = data.agents[instance];
    const recentMessages = ctx.bus.receive(instance);
    const messagesSummary = recentMessages
      .slice(-5)
      .map(
        (m) => `  - [${m.flag}] from ${m.roleSourceInstance}: ${m.content.substring(0, 200)}`
      )
      .join('\n');

    return (
      '=== RECOVERY: You are being restarted after a crash ===\n\n' +
      `Your role: ${agentStatus.role} (${instance})\n` +
      `Team: ${data.teamId}\n` +
      `Current phase: ${data.currentPhase}\n` +
      `Task: ${data.currentTask?.description ?? 'none'}\n` +
      `Your last known state: ${agentStatus.state}\n` +
      `Your last job: ${agentStatus.currentJob}\n\n` +
      (messagesSummary
        ? `Recent messages in your inbox:\n${messagesSummary}\n\n`
        : 'No pending messages.\n\n') +
      'Please resume your work based on the above context. ' +
      'Use ORCHESTRA-MESSAGE-START/END delimiters for any outgoing messages.'
    );
  }
}
