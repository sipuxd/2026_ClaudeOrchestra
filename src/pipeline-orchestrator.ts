// PipelineOrchestrator — Deterministic code-driven orchestration.
//
// Eliminates the Supervisor LLM entirely. Code drives the pipeline:
//   Security scan → Workers (parallel) → Security sweep → Review
//
// Each agent gets its own SDK query() call with streaming input
// (PromptChannel) for warm sessions. First message pays ~12s cold start;
// subsequent messages are ~2-3s. All agents cold-start in parallel.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { Role } from './roles/role-types.js';
import { AgentState } from './types/index.js';
import { TeamState, TeamPhase, type TeamStateData, type LoopLimits, DEFAULT_LOOP_LIMITS } from './state/team-state.js';
import { StatePersistence } from './state/persistence.js';
import { classifyComplexity } from './router/complexity-router.js';
import type { OrchestratorEvents } from './orchestrator.js';
import {
  DEFAULT_MODELS,
  DEFAULT_DISALLOWED_TOOLS,
  DEFAULT_MAX_TURNS,
} from './spawner/agent-spawner.js';

// --- PromptChannel: bridges sync push() to async iterable for SDK ---
// Duplicated from agent-process.ts to keep that file untouched.

class PromptChannel {
  private queue: SDKUserMessage[] = [];
  private waiter: ((value: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(prompt: string): void {
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: prompt },
      parent_tool_use_id: null,
      session_id: '',
    };
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: msg, done: false });
    } else {
      this.queue.push(msg);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined as any, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
    };
  }
}

// --- Verdict types ---

export type SecurityVerdict = 'APPROVED' | 'FLAGGED' | 'BLOCKED';
export type ReviewVerdict = 'APPROVED' | 'REVISION_NEEDED' | 'REJECTED';

export interface ParsedVerdict<V extends string> {
  verdict: V;
  details: string;
}

export function parseSecurityVerdict(text: string): ParsedVerdict<SecurityVerdict> {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('APPROVED')) return { verdict: 'APPROVED', details: trimmed };
  if (trimmed.startsWith('FLAGGED')) return { verdict: 'FLAGGED', details: trimmed };
  if (trimmed.startsWith('BLOCKED')) return { verdict: 'BLOCKED', details: trimmed };
  // Default to APPROVED if no clear verdict (scan results may not start with verdict)
  return { verdict: 'APPROVED', details: trimmed };
}

export function parseReviewVerdict(text: string): ParsedVerdict<ReviewVerdict> {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('APPROVED')) return { verdict: 'APPROVED', details: trimmed };
  if (trimmed.startsWith('REVISION_NEEDED')) return { verdict: 'REVISION_NEEDED', details: trimmed };
  if (trimmed.startsWith('REJECTED')) return { verdict: 'REJECTED', details: trimmed };
  // Default to APPROVED if no clear verdict
  return { verdict: 'APPROVED', details: trimmed };
}

// --- AgentSession: wraps a warm SDK query() session ---

interface SessionOpts {
  model: string;
  cwd: string;
  effort: 'low' | 'medium' | 'high' | 'max';
  disallowedTools?: string[];
  maxTurns?: number;
}

class AgentSession {
  readonly name: string;
  private channel: PromptChannel;
  private queryGen: Query;
  private pendingResolve: ((text: string) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private accumulated = '';
  private consuming: Promise<void>;
  private _closed = false;

  constructor(name: string, systemPrompt: string, opts: SessionOpts) {
    this.name = name;
    this.channel = new PromptChannel();

    this.queryGen = query({
      prompt: this.channel as AsyncIterable<SDKUserMessage>,
      options: {
        model: opts.model,
        systemPrompt,
        cwd: opts.cwd,
        effort: opts.effort,
        maxTurns: opts.maxTurns,
        disallowedTools: opts.disallowedTools,
        allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        env: { ...process.env, CLAUDECODE: undefined },
      } as any,
    });

    // Start consuming the stream in the background
    this.consuming = this.consume();
  }

  get closed(): boolean {
    return this._closed;
  }

  /**
   * Send a message to this agent and wait for the complete response.
   * Returns the full accumulated text from the agent's turn.
   */
  async send(message: string): Promise<string> {
    if (this._closed) {
      throw new Error(`AgentSession "${this.name}" is closed`);
    }
    return new Promise<string>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.accumulated = '';
      this.channel.push(message);
    });
  }

  /**
   * Close this agent session. Terminates the SDK query.
   */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.channel.close();
    try {
      this.queryGen.close();
    } catch {
      // Best effort
    }
  }

  /**
   * Wait for the background consume loop to finish.
   */
  async waitForCompletion(): Promise<void> {
    await this.consuming;
  }

  private async consume(): Promise<void> {
    try {
      for await (const msg of this.queryGen) {
        // Extract text from assistant messages
        const text = extractSdkText(msg);
        if (text) {
          this.accumulated += text;
        }

        // Result message = turn complete
        if ((msg as any).type === 'result') {
          if (this.pendingResolve) {
            const result = this.accumulated;
            this.accumulated = '';
            const resolve = this.pendingResolve;
            this.pendingResolve = null;
            this.pendingReject = null;
            resolve(result);
          }
        }
      }
    } catch (err: any) {
      if (this.pendingReject) {
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this._closed = true;
    }
  }
}

// --- Pipeline Orchestrator Config ---

type EffortLevel = 'low' | 'medium' | 'high' | 'max';

export interface PipelineOrchestraConfig {
  dataDirectory: string;
  logDirectory: string;
  /** Directory containing role prompt files (reuses subagent prompts) */
  rolesDir: string;
  maxConcurrentTeams: number;
  /** Model overrides per role (full model IDs like 'claude-opus-4-6') */
  models?: Partial<Record<Role, string>>;
  /** Per-role effort levels. Pipeline advantage: each agent gets its own query(). */
  efforts?: Partial<Record<Role, EffortLevel>>;
  /** Disallowed tools overrides per role */
  disallowedTools?: Partial<Record<Role, string[]>>;
  /** Max turns overrides per role */
  maxTurns?: Partial<Record<Role, number>>;
  /** Loop limits for phase transitions */
  limits?: Partial<LoopLimits>;
}

// --- Pipeline-tuned defaults ---
// Key insight: each agent gets its own query(), so we can tune per-role.
// Workers need high effort (creative coding).
// Security/Reviewer need low effort (scanning/judging, not coding).

const DEFAULT_PIPELINE_EFFORTS: Record<Role, EffortLevel> = {
  [Role.Supervisor]: 'low',    // Not used in pipeline mode
  [Role.Worker]: 'high',       // Creative coding needs deep reasoning
  [Role.Security]: 'low',      // Pattern scanning, not creative work
  [Role.Reviewer]: 'low',      // Quick verdict, not deep analysis
};

const DEFAULT_PIPELINE_MAX_TURNS: Record<Role, number> = {
  [Role.Supervisor]: 1,        // Not used in pipeline mode
  [Role.Worker]: 50,           // Workers may need many turns for complex tasks
  [Role.Security]: 5,          // Scan or sweep is one pass
  [Role.Reviewer]: 5,          // Read code, issue verdict — 5 turns max
};

const DEFAULT_PIPELINE_CONFIG = {
  dataDirectory: './data',
  logDirectory: './data/logs',
  rolesDir: './roles/subagent',
  maxConcurrentTeams: 5,
};

// --- Per-team runtime context ---

interface PipelineTeamContext {
  state: TeamState;
  /** Active agent sessions (null if no task running) */
  sessions: AgentSession[];
  /** Whether a pipeline is currently running */
  pipelineRunning: boolean;
}

// --- PipelineOrchestrator ---

export class PipelineOrchestrator extends EventEmitter<OrchestratorEvents> {
  private readonly config: PipelineOrchestraConfig & typeof DEFAULT_PIPELINE_CONFIG;
  private readonly persistence: StatePersistence;
  private readonly models: Record<Role, string>;
  private readonly efforts: Record<Role, EffortLevel>;
  private readonly disallowedTools: Record<Role, string[]>;
  private readonly maxTurnsPerRole: Record<Role, number>;
  private readonly teams: Map<string, PipelineTeamContext> = new Map();
  private shuttingDown = false;

  constructor(config: Partial<PipelineOrchestraConfig> = {}) {
    super();

    // Filter out undefined values so they don't overwrite defaults
    const cleanConfig = Object.fromEntries(
      Object.entries(config).filter(([, v]) => v !== undefined)
    );
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...cleanConfig } as PipelineOrchestraConfig & typeof DEFAULT_PIPELINE_CONFIG;

    const teamsDir = path.join(this.config.dataDirectory, 'teams');
    this.persistence = new StatePersistence({ teamsDir });

    this.models = { ...DEFAULT_MODELS, ...config.models };
    this.efforts = { ...DEFAULT_PIPELINE_EFFORTS, ...config.efforts };
    this.disallowedTools = { ...DEFAULT_DISALLOWED_TOOLS, ...config.disallowedTools };
    this.maxTurnsPerRole = { ...DEFAULT_PIPELINE_MAX_TURNS, ...config.maxTurns };
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
    fs.mkdirSync(resolvedProjectPath, { recursive: true });

    const limits: LoopLimits = {
      ...DEFAULT_LOOP_LIMITS,
      ...this.config.limits,
    };

    const state = TeamState.create(teamId, name, resolvedProjectPath, limits);

    // Persist initial state
    this.persistence.ensureTeamDir(teamId);
    this.persistence.persistNow(state);

    const ctx: PipelineTeamContext = {
      state,
      sessions: [],
      pipelineRunning: false,
    };

    this.teams.set(teamId, ctx);
    this.emit('team-created', teamId);

    return state;
  }

  // --- Recovery ---

  recover(): string[] {
    const recovered: string[] = [];
    const teamIds = this.persistence.listTeams();

    for (const teamId of teamIds) {
      if (this.teams.has(teamId)) continue;

      const data = this.persistence.load(teamId);
      if (!data) continue;

      if (
        data.currentPhase === TeamPhase.Done ||
        data.currentPhase === TeamPhase.Cancelled ||
        data.currentPhase === TeamPhase.Errored
      ) {
        continue;
      }

      const limits: LoopLimits = { ...DEFAULT_LOOP_LIMITS, ...this.config.limits };
      const state = TeamState.fromData(data, limits);

      const ctx: PipelineTeamContext = {
        state,
        sessions: [],
        pipelineRunning: false,
      };

      this.teams.set(teamId, ctx);
      recovered.push(teamId);
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

    const agentCount = complexity === 'simple' ? 1 : 4;
    this.emit('task-classified', teamId, complexity, agentCount);
    this.emit('task-assigned', teamId, taskDescription);

    // Register agents in state
    ctx.state.transitionAgent('Worker-1' as any, AgentState.Active);
    if (complexity === 'standard') {
      ctx.state.transitionAgent('Worker-2' as any, AgentState.Active);
      ctx.state.transitionAgent('Security-1' as any, AgentState.Active);
      ctx.state.transitionAgent('Reviewer-1' as any, AgentState.Active);
    }

    this.persistence.persistNow(ctx.state);

    // Launch the pipeline in the background
    ctx.pipelineRunning = true;
    if (complexity === 'simple') {
      this.runSimplePipeline(teamId, ctx, taskDescription);
    } else {
      this.runStandardPipeline(teamId, ctx, taskDescription);
    }
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

  start(): void {
    // No-op — pipeline mode doesn't use a tick loop
  }

  stop(): void {
    // No-op
  }

  // --- Shutdown ---

  async terminateTeam(teamId: string): Promise<void> {
    const ctx = this.teams.get(teamId);
    if (!ctx) return;

    // Close all active sessions
    this.closeSessions(ctx);

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
    this.teams.delete(teamId);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    for (const [, ctx] of this.teams) {
      this.closeSessions(ctx);
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
      this.closeSessions(ctx);
      try {
        this.persistence.persistNow(ctx.state);
      } catch {
        // Best effort
      }
    }
    this.teams.clear();
    this.persistence.dispose();
  }

  // --- Private: Session Management ---

  private closeSessions(ctx: PipelineTeamContext): void {
    for (const session of ctx.sessions) {
      if (!session.closed) {
        session.close();
      }
    }
    ctx.sessions = [];
    ctx.pipelineRunning = false;
  }

  private createSession(name: string, role: Role, cwd: string): AgentSession {
    const systemPrompt = this.loadRolePrompt(
      role === Role.Worker ? 'worker.claude.md' :
        role === Role.Security ? 'security.claude.md' :
          'reviewer.claude.md'
    );

    return new AgentSession(name, systemPrompt, {
      model: this.models[role],
      cwd,
      effort: this.efforts[role],
      disallowedTools: this.disallowedTools[role].length > 0
        ? this.disallowedTools[role]
        : undefined,
      maxTurns: this.maxTurnsPerRole[role],
    });
  }

  // --- Private: Simple Pipeline ---

  private async runSimplePipeline(
    teamId: string,
    ctx: PipelineTeamContext,
    task: string
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Phase: Work
      const fromPhase = ctx.state.currentPhase;
      this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Work, 'simple pipeline start');

      // Create Worker-1 session
      const worker = this.createSession('Worker-1', Role.Worker, ctx.state.snapshot.projectPath);
      ctx.sessions.push(worker);

      this.emit('agent-output', teamId, 'Worker-1' as any, `[Pipeline] Starting simple task...`);

      // Send task to worker and wait for result
      const result = await worker.send(task);
      this.emit('agent-output', teamId, 'Worker-1' as any, result);

      // Done
      worker.close();
      this.completePipeline(teamId, ctx, startTime);
    } catch (err: any) {
      this.failPipeline(teamId, ctx, err, startTime);
    }
  }

  // --- Private: Standard Pipeline ---

  private async runStandardPipeline(
    teamId: string,
    ctx: PipelineTeamContext,
    task: string
  ): Promise<void> {
    const startTime = Date.now();
    const cwd = ctx.state.snapshot.projectPath;

    try {
      // Create all 4 agent sessions in parallel (cold starts happen simultaneously)
      const security = this.createSession('Security', Role.Security, cwd);
      const worker1 = this.createSession('Worker-1', Role.Worker, cwd);
      const worker2 = this.createSession('Worker-2', Role.Worker, cwd);
      const reviewer = this.createSession('Reviewer', Role.Reviewer, cwd);
      ctx.sessions = [security, worker1, worker2, reviewer];

      // Outer loop: handles REJECTED verdicts (restart from scan)
      let scanResult = '';
      outerLoop: while (true) {
        // --- Step 1: Security Scan ---
        {
          const fromPhase = ctx.state.currentPhase;
          this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.PreWork, 'security scan');
          this.persistence.persist(ctx.state);

          this.emit('agent-output', teamId, 'Security-1' as any,
            `[Pipeline] Security scan starting...`);

          scanResult = await security.send(
            `PRE-WORK SCAN REQUEST\n\n` +
            `Task: ${task}\n` +
            `Project path: ${cwd}\n\n` +
            `Scan all files in the task scope and produce a clearance report.`
          );

          this.emit('agent-output', teamId, 'Security-1' as any, scanResult);
        }

        // Inner loop: handles REVISION_NEEDED and BLOCKED verdicts
        let workerResults: { w1: string; w2: string } = { w1: '', w2: '' };
        innerLoop: while (true) {
          // --- Step 2: Workers (parallel) ---
          {
            const fromPhase = ctx.state.currentPhase;
            this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Work, 'workers start');
            this.persistence.persist(ctx.state);

            this.emit('agent-output', teamId, 'Worker-1' as any,
              `[Pipeline] Workers starting in parallel...`);

            const revisionCount = ctx.state.counters.revisions;
            const workerInstruction =
              `TASK: ${task}\n\n` +
              `SECURITY CLEARANCE:\n${scanResult}\n\n` +
              (revisionCount > 0 ? `REVISION ATTEMPT ${revisionCount + 1}:\nPrevious work needs revision. Address any feedback and fix issues.\n\n` : '') +
              `Implement the assigned work within the cleared scope.`;

            const [w1Result, w2Result] = await Promise.all([
              worker1.send(
                `You are Worker-1. ${workerInstruction}\n\nFocus on the primary implementation.`
              ),
              worker2.send(
                `You are Worker-2. ${workerInstruction}\n\nFocus on supporting work (tests, docs, edge cases).`
              ),
            ]);

            workerResults = { w1: w1Result, w2: w2Result };

            this.emit('agent-output', teamId, 'Worker-1' as any, w1Result);
            this.emit('agent-output', teamId, 'Worker-2' as any, w2Result);
          }

          // --- Step 3: Security Sweep ---
          {
            const fromPhase = ctx.state.currentPhase;
            this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Handoff, 'security sweep');
            this.persistence.persist(ctx.state);

            this.emit('agent-output', teamId, 'Security-1' as any,
              `[Pipeline] Security sweep starting...`);

            const sweepResult = await security.send(
              `POST-WORK SWEEP REQUEST\n\n` +
              `Task: ${task}\n\n` +
              `Worker-1 summary:\n${workerResults.w1.substring(0, 2000)}\n\n` +
              `Worker-2 summary:\n${workerResults.w2.substring(0, 2000)}\n\n` +
              `Sweep all changes made by Workers. Check for introduced vulnerabilities, ` +
              `leaked secrets, and scope violations. Begin your response with APPROVED, FLAGGED, or BLOCKED.`
            );

            this.emit('agent-output', teamId, 'Security-1' as any, sweepResult);

            const sweepVerdict = parseSecurityVerdict(sweepResult);

            if (sweepVerdict.verdict === 'BLOCKED') {
              this.emit('agent-output', teamId, 'Security-1' as any,
                `[Pipeline] Security BLOCKED — retrying workers...`);
              // Backward transition: Handoff → Work (auto-increments counters, checks limits)
              const fromPhase2 = ctx.state.currentPhase;
              ctx.state.transitionPhase(TeamPhase.Work);
              this.emit('phase-transition', teamId, fromPhase2, TeamPhase.Work, 'security blocked — retry');
              this.persistence.persist(ctx.state);
              continue innerLoop;
            }

            // APPROVED or FLAGGED — proceed to review
          }

          // --- Step 4: Review ---
          {
            const fromPhase = ctx.state.currentPhase;
            this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Review, 'review');
            this.persistence.persist(ctx.state);

            this.emit('agent-output', teamId, 'Reviewer-1' as any,
              `[Pipeline] Review starting...`);

            const reviewResult = await reviewer.send(
              `REVIEW REQUEST\n\n` +
              `Task: ${task}\n\n` +
              `Worker-1 summary:\n${workerResults.w1.substring(0, 2000)}\n\n` +
              `Worker-2 summary:\n${workerResults.w2.substring(0, 2000)}\n\n` +
              `Evaluate the quality and correctness of this work. ` +
              `Begin your response with APPROVED, REVISION_NEEDED, or REJECTED.`
            );

            this.emit('agent-output', teamId, 'Reviewer-1' as any, reviewResult);

            const reviewVerdict = parseReviewVerdict(reviewResult);

            if (reviewVerdict.verdict === 'APPROVED') {
              // Success — break out of both loops
              break outerLoop;
            }

            if (reviewVerdict.verdict === 'REVISION_NEEDED') {
              this.emit('agent-output', teamId, 'Reviewer-1' as any,
                `[Pipeline] REVISION_NEEDED — retrying workers with feedback...`);
              // Backward transition: Review → Work (auto-increments revisions + total)
              const fromPhase2 = ctx.state.currentPhase;
              ctx.state.transitionPhase(TeamPhase.Work);
              this.emit('phase-transition', teamId, fromPhase2, TeamPhase.Work, 'revision needed');
              this.persistence.persist(ctx.state);
              continue innerLoop;
            }

            if (reviewVerdict.verdict === 'REJECTED') {
              this.emit('agent-output', teamId, 'Reviewer-1' as any,
                `[Pipeline] REJECTED — restarting from security scan...`);
              // Backward transition: Review → PreWork (auto-increments rejections + total)
              const fromPhase2 = ctx.state.currentPhase;
              ctx.state.transitionPhase(TeamPhase.PreWork);
              this.emit('phase-transition', teamId, fromPhase2, TeamPhase.PreWork, 'rejected — restart');
              this.persistence.persist(ctx.state);
              continue outerLoop;
            }
          }

          // Default: break inner loop (shouldn't reach here)
          break innerLoop;
        }
      }

      // All loops exited normally — pipeline succeeded
      this.closeSessions(ctx);
      this.completePipeline(teamId, ctx, startTime);
    } catch (err: any) {
      this.closeSessions(ctx);
      this.failPipeline(teamId, ctx, err, startTime);
    }
  }

  // --- Private: Pipeline Completion ---

  private completePipeline(teamId: string, ctx: PipelineTeamContext, startTime: number): void {
    const fromPhase = ctx.state.currentPhase;
    this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Done, 'pipeline completed');
    ctx.pipelineRunning = false;

    const durationMs = Date.now() - startTime;
    this.emit('task-complete', teamId, TeamPhase.Done, durationMs);
    this.persistence.persistNow(ctx.state);
  }

  private failPipeline(teamId: string, ctx: PipelineTeamContext, err: any, startTime: number): void {
    if (this.shuttingDown) return;

    const error = err instanceof Error ? err : new Error(String(err));
    this.emit('error', teamId, error);

    const fromPhase = ctx.state.currentPhase;
    this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Errored, `pipeline error: ${error.message}`);
    ctx.pipelineRunning = false;

    const durationMs = Date.now() - startTime;
    this.emit('task-complete', teamId, TeamPhase.Errored, durationMs);
    this.persistence.persistNow(ctx.state);
  }

  // --- Private: Phase Transition Helper ---

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
      // Invalid transition — pipeline may re-enter same phase
    }
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
