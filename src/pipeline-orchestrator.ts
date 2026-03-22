// PipelineOrchestrator — Deterministic code-driven orchestration.
//
// Eliminates the Supervisor LLM entirely. Code drives the pipeline:
//   Security scan → Worker-1 implements → Worker-2 verifies → Security sweep → Review
//
// Worker-2 acts as a completeness verifier: it checks Worker-1's output
// against the original task and reports gaps. Worker-1 fixes gaps, Worker-2
// re-checks (max 2 loops). Worker-2 never modifies code — report only.
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
import { Registry } from './registry.js';
import { GitOps } from './git.js';
import { classifyComplexity } from './router/complexity-router.js';
import { randomUUID } from 'node:crypto';
import type { OrchestratorEvents, FeedbackPayload } from './orchestrator.js';
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

  push(prompt: string, images?: Array<{ media_type: string; data: string }>): void {
    let content: string | Array<{ type: string; [key: string]: any }>;
    if (images && images.length > 0) {
      content = [
        { type: 'text', text: prompt },
        ...images.map(img => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.media_type, data: img.data },
        })),
      ];
    } else {
      content = prompt;
    }
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
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
export type VerifyVerdict = 'COMPLETE' | 'GAPS_FOUND';

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
  const upper = trimmed.toUpperCase();

  // Check explicit prefix first
  if (upper.startsWith('APPROVED')) return { verdict: 'APPROVED', details: trimmed };
  if (upper.startsWith('REVISION_NEEDED')) return { verdict: 'REVISION_NEEDED', details: trimmed };
  if (upper.startsWith('REJECTED')) return { verdict: 'REJECTED', details: trimmed };

  // Scan full response for verdict indicators when prefix is missing
  const rejectPatterns = [/\brejected?\b/i, /\bfundamentally\s+flawed\b/i, /\bstart\s+over\b/i];
  const revisionPatterns = [
    /\brevision\s*(needed|required)\b/i,
    /\bneeds?\s+(revision|fix|change|work|improvement)/i,
    /\bfix\s+(required|needed|before)\b/i,
    /\bnot\s+(ready|acceptable|approved)\b/i,
    /\bcannot\s+approve\b/i,
    /\bsend\s+back\b/i,
  ];
  const approvePatterns = [
    /\bapproved?\b/i,
    /\blooks?\s+good\b/i,
    /\bwell[\s-]implemented\b/i,
    /\bready\s+(to\s+)?(merge|ship|deploy)\b/i,
  ];

  const hasReject = rejectPatterns.some(p => p.test(trimmed));
  const hasRevision = revisionPatterns.some(p => p.test(trimmed));
  const hasApprove = approvePatterns.some(p => p.test(trimmed));

  if (hasReject && !hasApprove) return { verdict: 'REJECTED', details: trimmed };
  if (hasRevision && !hasApprove) return { verdict: 'REVISION_NEEDED', details: trimmed };
  if (hasApprove && !hasRevision && !hasReject) return { verdict: 'APPROVED', details: trimmed };

  // Ambiguous or no signals — err on side of caution, request revision
  return { verdict: 'REVISION_NEEDED', details: trimmed };
}

export function parseVerifyVerdict(text: string): ParsedVerdict<VerifyVerdict> {
  const trimmed = text.trimStart();
  const upper = trimmed.toUpperCase();

  // Check explicit prefix first (strongest signal)
  if (upper.startsWith('GAPS_FOUND')) return { verdict: 'GAPS_FOUND', details: trimmed };
  if (upper.startsWith('COMPLETE')) return { verdict: 'COMPLETE', details: trimmed };

  // Scan full response for gap indicators when prefix is missing
  const gapPatterns = [
    /\bgaps?\s*found\b/i,
    /\baction\s*required\b/i,
    /\bmissing\s+(requirement|implementation|test|file)/i,
    /\bnot\s+(complete|fully\s+implemented|met)\b/i,
    /\bincomplete\b/i,
    /\bfail(s|ed|ing|ure)?\b/i,
    /\bfix\s+(required|needed)\b/i,
  ];
  const completePatterns = [
    /\ball\s+(requirements|tasks?)\s+(are\s+)?(fully\s+)?met\b/i,
    /\bfully\s+(complete|implemented|met)\b/i,
    /\bno\s+gaps?\s*(found)?\b/i,
    /\bverified\s+complete\b/i,
    /\blooks?\s+good\b/i,
    /\bno\s+(issues?|problems?|concerns?)\b/i,
  ];

  const hasGaps = gapPatterns.some(p => p.test(trimmed));
  const hasComplete = completePatterns.some(p => p.test(trimmed));

  // If gap signals found (and no competing complete signals), treat as gaps
  if (hasGaps && !hasComplete) return { verdict: 'GAPS_FOUND', details: trimmed };
  if (hasComplete && !hasGaps) return { verdict: 'COMPLETE', details: trimmed };

  // Ambiguous or no signals — default to GAPS_FOUND (err on the side of thoroughness)
  return { verdict: 'GAPS_FOUND', details: trimmed };
}

const MAX_VERIFY_PASSES = 2;

// --- AgentSession: wraps a warm SDK query() session ---

interface SessionOpts {
  model: string;
  cwd: string;
  effort: 'low' | 'medium' | 'high' | 'max';
  disallowedTools?: string[];
  maxTurns?: number;
  onProgress?: (accumulated: string) => void;
}

class AgentSession {
  readonly name: string;
  private channel: PromptChannel;
  private queryGen: Query;
  private pendingResolve: ((text: string) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private accumulated = '';
  private activityLog = '';
  private onProgress?: (accumulated: string) => void;
  private consuming: Promise<void>;
  private _closed = false;

  constructor(name: string, systemPrompt: string, opts: SessionOpts) {
    this.name = name;
    this.onProgress = opts.onProgress;
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

  /** Last activity log from the most recent send() call. */
  get lastActivityLog(): string {
    return this.activityLog;
  }

  /**
   * Send a message to this agent and wait for the complete response.
   * Returns the full accumulated text from the agent's turn.
   */
  async send(message: string, images?: Array<{ media_type: string; data: string }>): Promise<string> {
    if (this._closed) {
      throw new Error(`AgentSession "${this.name}" is closed`);
    }
    return new Promise<string>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.accumulated = '';
      this.activityLog = '';
      this.channel.push(message, images);
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
        // Extract tool use activity for dashboard streaming (separate from accumulated result)
        if ((msg as any).type === 'assistant' && this.onProgress) {
          const content = (msg as any).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use') {
                const tool = block.name || 'unknown';
                const input = block.input || {};
                let detail = '';
                if (input.file_path) detail = input.file_path;
                else if (input.command) detail = input.command.substring(0, 120);
                else if (input.pattern) detail = input.pattern;
                const line = detail ? `${tool}: ${detail}` : tool;
                this.activityLog += (this.activityLog ? '\n' : '') + line;
                this.onProgress(this.activityLog);
              }
              if (block.type === 'thinking' && block.thinking) {
                const preview = block.thinking.substring(0, 200);
                this.activityLog += (this.activityLog ? '\n' : '') + '💭 ' + preview;
                this.onProgress(this.activityLog);
              }
            }
          }
        }
        // Extract text from assistant messages
        const text = extractSdkText(msg);
        if (text) {
          this.accumulated += text;
          // Notify progress listener (for dashboard streaming)
          if (this.onProgress) {
            this.onProgress(this.accumulated);
          }
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
  registryPath: string;
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
  registryPath: './registry.json',
  logDirectory: './logs',
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
  /** Pending blocking feedback requests awaiting user response */
  pendingFeedback: Map<string, { resolve: (value: string) => void; feedback: FeedbackPayload }>;
  /** Active final security review session (if running) */
  securityReviewSession?: AgentSession;
}

// --- PipelineOrchestrator ---

export class PipelineOrchestrator extends EventEmitter<OrchestratorEvents> {
  private readonly config: PipelineOrchestraConfig & typeof DEFAULT_PIPELINE_CONFIG;
  private readonly persistence: StatePersistence;
  private readonly registry: Registry;
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

    this.persistence = new StatePersistence();
    this.registry = new Registry(this.config.registryPath);

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

    // Ensure we're on a dev branch — create one if on main
    this.ensureDevBranch(resolvedProjectPath);

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

    const ctx: PipelineTeamContext = {
      state,
      sessions: [],
      pipelineRunning: false,
      pendingFeedback: new Map(),
    };

    this.teams.set(teamId, ctx);
    this.emit('team-created', teamId);

    return state;
  }

  // --- Recovery ---

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

      const ctx: PipelineTeamContext = {
        state,
        sessions: [],
        pipelineRunning: false,
        pendingFeedback: new Map(),
      };

      this.teams.set(entry.teamId, ctx);
      recovered.push(entry.teamId);
    }

    return recovered;
  }

  // --- Task Assignment ---

  assignTask(teamId: string, taskDescription: string, images?: Array<{ media_type: string; data: string }>): void {
    if (this.shuttingDown) {
      throw new Error('Orchestrator is shutting down');
    }

    const ctx = this.teams.get(teamId);
    if (!ctx) throw new Error(`Team "${teamId}" not found`);
    if (ctx.pipelineRunning) throw new Error(`Team "${teamId}" already has an active pipeline`);

    // Clean up previous sessions if re-assigning after completion
    if (ctx.sessions.length > 0) {
      this.closeSessions(ctx);
    }

    // Clean up any running security review
    if (ctx.securityReviewSession && !ctx.securityReviewSession.closed) {
      ctx.securityReviewSession.close();
      ctx.securityReviewSession = undefined;
    }

    // Reset from terminal state for re-launch
    if (ctx.state.isTerminal) {
      ctx.state.transitionPhase(TeamPhase.PreWork);
    }

    // Clear any previous task and reset agents for re-launch
    if (ctx.state.snapshot.currentTask) {
      ctx.state.clearTask();
    }
    ctx.state.resetAgents();

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
      this.runSimplePipeline(teamId, ctx, taskDescription, images);
    } else {
      this.runStandardPipeline(teamId, ctx, taskDescription, images);
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

    // Remove from registry
    this.registry.remove(teamId);

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

  // --- Registry Access (for dashboard) ---

  getRegistryEntries(): import('./registry.js').RegistryEntry[] {
    return this.registry.load();
  }

  // --- Git Operations (user-initiated) ---

  /**
   * Push current branch and merge to main. User-initiated only.
   * Returns git result with combined output.
   */
  pushAndMerge(teamId: string): import('./git.js').GitResult {
    const ctx = this.teams.get(teamId);
    if (!ctx) {
      return { success: false, output: `Team "${teamId}" not found` };
    }
    return GitOps.pushAndMerge(ctx.state.snapshot.projectPath);
  }

  // --- Final Security Review (user-initiated) ---

  /**
   * Spawn a fresh agent to perform a comprehensive security review
   * of all changes on the current branch vs main. Results stream
   * to the Security-1 panel and a security-review event is emitted.
   */
  async runSecurityReview(teamId: string): Promise<void> {
    const ctx = this.teams.get(teamId);
    if (!ctx) throw new Error(`Team "${teamId}" not found`);
    if (ctx.pipelineRunning) throw new Error('Cannot run security review while pipeline is running');

    // Close any previous security review session
    if (ctx.securityReviewSession && !ctx.securityReviewSession.closed) {
      ctx.securityReviewSession.close();
    }

    const cwd = ctx.state.snapshot.projectPath;

    // Get the full branch diff
    const diffResult = GitOps.diff(cwd);
    if (!diffResult.success) {
      this.emit('security-review', teamId, { status: 'concerns', result: `Failed to get diff: ${diffResult.output}` });
      return;
    }
    if (!diffResult.output.trim()) {
      this.emit('security-review', teamId, { status: 'passed', result: 'No changes to review — branch is identical to main.' });
      return;
    }

    this.emit('security-review', teamId, { status: 'running' });
    this.emit('agent-output', teamId, 'Security-1' as any, '[Security Review] Starting comprehensive review...');

    try {
      const systemPrompt = this.loadRolePrompt('security-review.claude.md');
      const session = new AgentSession('SecurityReview', systemPrompt, {
        model: this.models[Role.Security],
        cwd,
        effort: 'high' as any,
        maxTurns: 15,
        onProgress: (text: string) => {
          this.emit('agent-progress', teamId, 'Security-1' as any, text);
        },
      });
      ctx.securityReviewSession = session;

      // Truncate large diffs to avoid exceeding context
      const MAX_DIFF_CHARS = 80_000;
      let diffText = diffResult.output;
      if (diffText.length > MAX_DIFF_CHARS) {
        diffText = diffText.substring(0, MAX_DIFF_CHARS) +
          '\n\n[DIFF TRUNCATED — use `git diff main...HEAD` via Bash to see the full diff]';
      }

      const response = await session.send(
        'Review the following git diff for security concerns. Analyze every change.\n\n' + diffText
      );

      // Parse verdict from response
      const upper = response.toUpperCase();
      const hasConcerns = upper.includes('CONCERNS') && !upper.startsWith('**PASSED');
      const status = hasConcerns ? 'concerns' : 'passed';

      this.emit('agent-output', teamId, 'Security-1' as any, response);
      this.emit('security-review', teamId, { status, result: response });

      session.close();
      ctx.securityReviewSession = undefined;
    } catch (err: any) {
      this.emit('security-review', teamId, { status: 'idle' });
      this.emit('feedback', teamId, {
        id: randomUUID(),
        type: 'error' as any,
        title: 'Security review failed',
        message: err.message || 'Unknown error',
        blocking: false,
        timestamp: new Date().toISOString(),
      });
      ctx.securityReviewSession = undefined;
    }
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

  // --- Private: Dev Branch Setup ---

  private ensureDevBranch(projectPath: string): void {
    const current = GitOps.currentBranch(projectPath);
    if (current !== 'main') return; // already on a non-main branch

    const { execSync } = require('node:child_process');
    try {
      // Check if local dev branch already exists
      execSync('git rev-parse --verify dev', { cwd: projectPath, stdio: 'pipe' });
      // dev exists locally, just check it out
      execSync('git checkout dev', { cwd: projectPath, stdio: 'pipe' });
    } catch {
      // No local dev branch — create it and push to origin
      execSync('git checkout -b dev', { cwd: projectPath, stdio: 'pipe' });
      try {
        execSync('git push -u origin dev', { cwd: projectPath, stdio: 'pipe' });
      } catch {
        // Push may fail if no remote — that's fine, local dev is created
      }
    }
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

  private createSession(
    name: string,
    role: Role,
    cwd: string,
    onProgress?: (accumulated: string) => void
  ): AgentSession {
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
      onProgress,
    });
  }

  // --- Private: Simple Pipeline ---

  private async runSimplePipeline(
    teamId: string,
    ctx: PipelineTeamContext,
    task: string,
    images?: Array<{ media_type: string; data: string }>
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Phase: Work
      const fromPhase = ctx.state.currentPhase;
      this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Work, 'simple pipeline start');

      // Create Worker-1 session
      const worker = this.createSession('Worker-1', Role.Worker, ctx.state.snapshot.projectPath,
        (text) => this.emit('agent-progress', teamId, 'Worker-1' as any, text));
      ctx.sessions.push(worker);

      this.emit('agent-output', teamId, 'Worker-1' as any, `[Pipeline] Starting simple task...`);

      // Send task to worker and wait for result
      const result = await worker.send(task, images);
      const simpleDisplay = result.trim() || worker.lastActivityLog || '(no text output)';
      this.emit('agent-output', teamId, 'Worker-1' as any, simpleDisplay);

      // Done — keep session alive for Q&A
      this.completePipeline(teamId, ctx, startTime);
    } catch (err: any) {
      this.failPipeline(teamId, ctx, err, startTime);
    }
  }

  // --- Private: Standard Pipeline ---

  private async runStandardPipeline(
    teamId: string,
    ctx: PipelineTeamContext,
    task: string,
    images?: Array<{ media_type: string; data: string }>
  ): Promise<void> {
    const startTime = Date.now();
    const cwd = ctx.state.snapshot.projectPath;

    try {
      // Create all 4 agent sessions in parallel (cold starts happen simultaneously)
      const security = this.createSession('Security', Role.Security, cwd,
        (text) => this.emit('agent-progress', teamId, 'Security-1' as any, text));
      const worker1 = this.createSession('Worker-1', Role.Worker, cwd,
        (text) => this.emit('agent-progress', teamId, 'Worker-1' as any, text));
      const worker2 = this.createSession('Worker-2', Role.Worker, cwd,
        (text) => this.emit('agent-progress', teamId, 'Worker-2' as any, text));
      const reviewer = this.createSession('Reviewer', Role.Reviewer, cwd,
        (text) => this.emit('agent-progress', teamId, 'Reviewer-1' as any, text));
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
          // --- Step 2: Worker-1 implements, Worker-2 verifies ---
          {
            const fromPhase = ctx.state.currentPhase;
            this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Work, 'workers start');
            this.persistence.persist(ctx.state);

            const revisionCount = ctx.state.counters.revisions;
            const workerInstruction =
              `TASK: ${task}\n\n` +
              `SECURITY CLEARANCE:\n${scanResult}\n\n` +
              (revisionCount > 0 ? `REVISION ATTEMPT ${revisionCount + 1}:\nPrevious work needs revision. Address any feedback and fix issues.\n\n` : '') +
              `Implement the assigned work within the cleared scope.`;

            // --- Worker-1: Implement ---
            this.emit('agent-task', teamId, 'Worker-1' as any, 'Implementing full task');
            this.emit('agent-output', teamId, 'Worker-1' as any,
              `[Pipeline] Worker-1 implementing...`);

            const w1Result = await worker1.send(
              `You are Worker-1. ${workerInstruction}`,
              images
            );
            // Use activity log as fallback display when text result is empty (most work is tool_use)
            const w1Display = w1Result.trim() || worker1.lastActivityLog || '(no text output)';
            this.emit('agent-output', teamId, 'Worker-1' as any, w1Display);

            // --- Worker-2: Verify completeness (loop up to MAX_VERIFY_PASSES) ---
            let w2Result = '';
            let verifyPass = 0;
            let currentW1Result = w1Result;

            while (verifyPass < MAX_VERIFY_PASSES) {
              verifyPass++;
              const verifyLabel = verifyPass === 1
                ? 'Verifying completeness'
                : `Re-verifying completeness (pass ${verifyPass})`;

              this.emit('agent-task', teamId, 'Worker-2' as any, verifyLabel);
              this.emit('agent-output', teamId, 'Worker-2' as any,
                `[Pipeline] Worker-2 ${verifyLabel.toLowerCase()}...`);

              w2Result = await worker2.send(
                `COMPLETENESS VERIFICATION\n\n` +
                `You are Worker-2. Your job is to verify that Worker-1's implementation ` +
                `is complete against the original task requirements. Do NOT modify any code.\n\n` +
                `ORIGINAL TASK: ${task}\n\n` +
                `SECURITY CLEARANCE:\n${scanResult.substring(0, 1000)}\n\n` +
                `WORKER-1 OUTPUT:\n${currentW1Result.substring(0, 3000)}\n\n` +
                `Check for:\n` +
                `- Missing requirements from the task description\n` +
                `- Unhandled edge cases\n` +
                `- Missing error handling\n` +
                `- Incomplete implementations (TODOs, placeholder code)\n` +
                `- Missing files that should have been created\n\n` +
                `Begin your response with COMPLETE or GAPS_FOUND.\n` +
                `If GAPS_FOUND, list each gap clearly so Worker-1 can fix them.`
              );
              this.emit('agent-output', teamId, 'Worker-2' as any, w2Result);

              const verifyVerdict = parseVerifyVerdict(w2Result);

              if (verifyVerdict.verdict === 'COMPLETE') {
                this.emit('agent-task', teamId, 'Worker-2' as any, 'Verified complete');
                break;
              }

              // GAPS_FOUND — send Worker-1 back to fix
              this.notifyUser(teamId, 'info', 'Gaps Found',
                `Worker-2 found gaps (pass ${verifyPass}) — Worker-1 is fixing them.`);

              this.emit('agent-task', teamId, 'Worker-1' as any, `Fixing gaps (attempt ${verifyPass})`);
              this.emit('agent-output', teamId, 'Worker-1' as any,
                `[Pipeline] Worker-1 fixing gaps (attempt ${verifyPass})...`);

              currentW1Result = await worker1.send(
                `COMPLETENESS GAPS — FIX REQUIRED (attempt ${verifyPass})\n\n` +
                `Worker-2 found the following gaps in your implementation:\n\n` +
                `${w2Result.substring(0, 3000)}\n\n` +
                `Fix all reported gaps. Do not re-implement what already works.`
              );
              const fixDisplay = currentW1Result.trim() || worker1.lastActivityLog || '(no text output)';
              this.emit('agent-output', teamId, 'Worker-1' as any, fixDisplay);
            }

            workerResults = { w1: currentW1Result, w2: w2Result };
          }

          // Auto-commit after work phase (safety checkpoint)
          GitOps.commit(cwd, 'WIP: work phase complete');

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
              this.notifyUser(teamId, 'warning', 'Security Blocked',
                'Security sweep found issues — retrying workers with updated constraints.');
              // Backward transition: Handoff → Work (auto-increments counters, checks limits)
              const fromPhase2 = ctx.state.currentPhase;
              ctx.state.transitionPhase(TeamPhase.Work);
              this.emit('phase-transition', teamId, fromPhase2, TeamPhase.Work, 'security blocked — retry');
              this.persistence.persist(ctx.state);
              continue innerLoop;
            }

            // APPROVED or FLAGGED — proceed to review
            // Auto-commit after security sweep passes (safety checkpoint)
            GitOps.commit(cwd, 'WIP: security sweep passed');
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
              this.notifyUser(teamId, 'info', 'Revision Requested',
                'Reviewer requested changes — sending feedback to workers for another pass.');
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
              this.notifyUser(teamId, 'warning', 'Work Rejected',
                'Reviewer rejected the work — restarting pipeline from security scan.');
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
      // Final auto-commit with the task description
      GitOps.commit(cwd, task.substring(0, 72));

      // Keep sessions alive for Q&A after completion
      this.completePipeline(teamId, ctx, startTime);
    } catch (err: any) {
      this.closeSessions(ctx);
      this.failPipeline(teamId, ctx, err, startTime);
    }
  }

  // --- Feedback ---

  /** Non-blocking: fire-and-forget notification to the dashboard */
  private notifyUser(
    teamId: string,
    type: FeedbackPayload['type'],
    title: string,
    message: string
  ): void {
    this.emit('feedback', teamId, {
      id: randomUUID(),
      type,
      title,
      message,
      blocking: false,
      timestamp: new Date().toISOString(),
    });
  }

  /** Blocking: pause pipeline until user responds via dashboard */
  private askUser(
    teamId: string,
    title: string,
    message: string,
    actions: Array<{ label: string; value: string }>
  ): Promise<string> {
    const ctx = this.teams.get(teamId);
    if (!ctx) return Promise.resolve('');

    const id = randomUUID();
    const feedback: FeedbackPayload = {
      id,
      type: 'question',
      title,
      message,
      actions,
      blocking: true,
      timestamp: new Date().toISOString(),
    };

    return new Promise<string>((resolve) => {
      ctx.pendingFeedback.set(id, { resolve, feedback });
      this.emit('feedback', teamId, feedback);
    });
  }

  /** Called when user responds from dashboard — resolves pending promise */
  resolveFeedback(teamId: string, feedbackId: string, value: string): void {
    const ctx = this.teams.get(teamId);
    const pending = ctx?.pendingFeedback?.get(feedbackId);
    if (pending) {
      pending.resolve(value);
      ctx!.pendingFeedback.delete(feedbackId);
      this.emit('feedback-response', teamId, feedbackId, value);
    }
  }

  // --- User Q&A ---

  /** Send a user question to a warm agent session and emit the response as feedback */
  async sendMessage(teamId: string, message: string, images?: Array<{ media_type: string; data: string }>): Promise<void> {
    const ctx = this.teams.get(teamId);
    if (!ctx) throw new Error(`Team "${teamId}" not found`);
    if (ctx.pipelineRunning) throw new Error('Cannot ask while pipeline is running');

    // Find a live session
    const liveSession = ctx.sessions.find(s => !s.closed);
    if (!liveSession) throw new Error('No active agent sessions — start a new task first');

    const instance = (liveSession.name === 'Reviewer' ? 'Reviewer-1'
      : liveSession.name === 'Worker-1' ? 'Worker-1'
      : liveSession.name + '-1') as any;

    // Show user's question in feedback bar
    this.emit('feedback', teamId, {
      id: randomUUID(),
      type: 'question' as const,
      title: 'You asked',
      message,
      blocking: false,
      timestamp: new Date().toISOString(),
    });

    // Stream progress while agent is thinking
    this.emit('agent-output', teamId, instance,
      `[Q&A] Processing your question...`);

    const response = await liveSession.send(
      `USER QUESTION (not a new task — just answer this question about ` +
      `the work you just completed):\n\n${message}`,
      images
    );

    this.emit('agent-output', teamId, instance, response);

    // Show response summary in feedback bar
    this.emit('feedback', teamId, {
      id: randomUUID(),
      type: 'info' as const,
      title: liveSession.name + ' responded',
      message: response.length > 500 ? response.substring(0, 497) + '...' : response,
      blocking: false,
      timestamp: new Date().toISOString(),
    });
  }

  // --- Private: Pipeline Completion ---

  private completePipeline(teamId: string, ctx: PipelineTeamContext, startTime: number): void {
    // Auto-commit any remaining changes before marking done
    const cwd = ctx.state.snapshot.projectPath;
    const task = ctx.state.snapshot.currentTask?.description ?? teamId;
    GitOps.commit(cwd, task.substring(0, 72));

    const fromPhase = ctx.state.currentPhase;
    this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Done, 'pipeline completed');
    ctx.pipelineRunning = false;

    const durationMs = Date.now() - startTime;
    this.emit('task-complete', teamId, TeamPhase.Done, durationMs);
    this.notifyUser(teamId, 'info', 'Task Complete',
      `Pipeline finished in ${(durationMs / 1000).toFixed(1)}s — ready for push & merge.`);
    this.persistence.persistNow(ctx.state);
  }

  private failPipeline(teamId: string, ctx: PipelineTeamContext, err: any, startTime: number): void {
    if (this.shuttingDown) return;

    const error = err instanceof Error ? err : new Error(String(err));
    this.emit('error', teamId, error);
    this.notifyUser(teamId, 'warning', 'Pipeline Failed',
      `Error: ${error.message}`);

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
