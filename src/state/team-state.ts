// In-memory team state with validated transitions.
// Matches the state.json schema from docs/state-machine.md.

import { ROLE_INSTANCES, type Role, type RoleInstance } from '../roles/role-types.js';
import { AgentState } from '../types/index.js';

// --- Team Phase (superset of workflow Phase — includes terminal states) ---

export enum TeamPhase {
  PreWork = 'pre_work',
  Work = 'work',
  Handoff = 'handoff',
  Review = 'review',
  Done = 'done',
  PrOpen = 'pr_open',
  Merged = 'merged',
  Errored = 'errored',
  Cancelled = 'cancelled',
}

// --- Agent status within a team ---

export interface AgentStatus {
  role: Role;
  state: AgentState;
  currentJob: string;
  lastMessageAt: string | null;
  pid: number | null;
}

// --- Task info ---

export type TaskComplexity = 'simple' | 'standard' | 'complex';

export interface TaskInfo {
  description: string;
  assignedAt: string;
  complexity?: TaskComplexity;
  requirements?: string;
}

// --- Loop counters ---

export interface LoopCounters {
  revisions: number;
  rejections: number;
  totalBackwardTransitions: number;
}

// --- Limits (configurable) ---

export interface LoopLimits {
  maxRevisions: number;
  maxRejections: number;
  maxTotalBackwardTransitions: number;
}

export interface EnforcementReportSummary {
  phase: string;
  ok: boolean;
  checkedAt: string;
  findingCount: number;
  blockingCount: number;
  warningCount: number;
}

export interface EnforcementState {
  guardrailReports: EnforcementReportSummary[];
  lastError?: unknown;
}

export const DEFAULT_LOOP_LIMITS: LoopLimits = {
  maxRevisions: 3,
  maxRejections: 2,
  maxTotalBackwardTransitions: 5,
};

// --- Team state ---

export interface TeamStateData {
  teamId: string;
  teamName: string;
  projectPath: string;
  currentPhase: TeamPhase;
  agents: Record<RoleInstance, AgentStatus>;
  currentTask: TaskInfo | null;
  counters: LoopCounters;
  createdAt: string;
  updatedAt: string;
  branchName?: string;
  prNumber?: number;
  prUrl?: string;
  enforcement?: EnforcementState;
}

// --- Transition errors ---

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

// --- Valid phase transitions ---

const VALID_PHASE_TRANSITIONS: Record<TeamPhase, readonly TeamPhase[]> = {
  [TeamPhase.PreWork]: [TeamPhase.Work, TeamPhase.Errored, TeamPhase.Cancelled],
  [TeamPhase.Work]: [TeamPhase.Handoff, TeamPhase.Done, TeamPhase.Errored, TeamPhase.Cancelled],
  [TeamPhase.Handoff]: [TeamPhase.Review, TeamPhase.Work, TeamPhase.Errored, TeamPhase.Cancelled],
  [TeamPhase.Review]: [
    TeamPhase.Done,
    TeamPhase.Work,
    TeamPhase.PreWork,
    TeamPhase.Errored,
    TeamPhase.Cancelled,
  ],
  [TeamPhase.Done]: [TeamPhase.PreWork, TeamPhase.PrOpen],
  [TeamPhase.PrOpen]: [TeamPhase.Merged, TeamPhase.Done, TeamPhase.Cancelled],
  [TeamPhase.Merged]: [],
  [TeamPhase.Errored]: [TeamPhase.PreWork, TeamPhase.Cancelled],
  [TeamPhase.Cancelled]: [],
};

// --- Valid agent state transitions ---

const VALID_AGENT_TRANSITIONS: Record<AgentState, readonly AgentState[]> = {
  [AgentState.Spawning]: [AgentState.Active, AgentState.Errored],
  [AgentState.Active]: [
    AgentState.Idle,
    AgentState.Blocked,
    AgentState.Waiting,
    AgentState.Done,
    AgentState.Errored,
  ],
  [AgentState.Idle]: [AgentState.Active, AgentState.Errored],
  [AgentState.Blocked]: [AgentState.Active, AgentState.Errored],
  [AgentState.Waiting]: [AgentState.Active, AgentState.Errored],
  [AgentState.Done]: [AgentState.Active, AgentState.Idle],
  [AgentState.Errored]: [AgentState.Spawning],
};

// --- TeamState manager ---

export class TeamState {
  private data: TeamStateData;
  private limits: LoopLimits;
  private dirty = false;
  private phaseTransitioned = false;

  constructor(data: TeamStateData, limits: LoopLimits = DEFAULT_LOOP_LIMITS) {
    this.data = data;
    this.limits = limits;
  }

  /** Create a new team with all agents in spawning state. */
  static create(
    teamId: string,
    teamName: string,
    projectPath: string,
    limits: LoopLimits = DEFAULT_LOOP_LIMITS,
  ): TeamState {
    const now = new Date().toISOString();
    const agents: Record<string, AgentStatus> = {};

    for (const [role, instances] of Object.entries(ROLE_INSTANCES)) {
      for (const instance of instances) {
        agents[instance] = {
          role: role as Role,
          state: AgentState.Spawning,
          currentJob: '',
          lastMessageAt: null,
          pid: null,
        };
      }
    }

    const data: TeamStateData = {
      teamId,
      teamName,
      projectPath,
      currentPhase: TeamPhase.PreWork,
      agents: agents as Record<RoleInstance, AgentStatus>,
      currentTask: null,
      counters: { revisions: 0, rejections: 0, totalBackwardTransitions: 0 },
      createdAt: now,
      updatedAt: now,
    };

    return new TeamState(data, limits);
  }

  /** Restore from persisted data. */
  static fromData(data: TeamStateData, limits?: LoopLimits): TeamState {
    return new TeamState(data, limits ?? DEFAULT_LOOP_LIMITS);
  }

  // --- Accessors ---

  get snapshot(): Readonly<TeamStateData> {
    return this.data;
  }

  get teamId(): string {
    return this.data.teamId;
  }

  get currentPhase(): TeamPhase {
    return this.data.currentPhase;
  }

  get counters(): Readonly<LoopCounters> {
    return this.data.counters;
  }

  /** Whether state has changed since last persist. */
  get isDirty(): boolean {
    return this.dirty;
  }

  /** Whether a phase transition occurred (forces immediate persist). */
  get hasPhaseTransitioned(): boolean {
    return this.phaseTransitioned;
  }

  /** Clear dirty/transition flags after a persist. */
  markPersisted(): void {
    this.dirty = false;
    this.phaseTransitioned = false;
  }

  // --- Phase transitions ---

  /**
   * Transition to a new team phase. Validates the transition
   * and checks loop limits for backward transitions.
   */
  transitionPhase(newPhase: TeamPhase): void {
    const current = this.data.currentPhase;

    if (!VALID_PHASE_TRANSITIONS[current].includes(newPhase)) {
      throw new TransitionError(`Invalid phase transition: ${current} → ${newPhase}`);
    }

    // Check loop limits for backward transitions
    if (this.isBackwardTransition(current, newPhase)) {
      this.data.counters.totalBackwardTransitions++;

      if (current === TeamPhase.Handoff && newPhase === TeamPhase.Work) {
        this.data.counters.revisions++;
      } else if (current === TeamPhase.Review && newPhase === TeamPhase.Work) {
        this.data.counters.revisions++;
      } else if (current === TeamPhase.Review && newPhase === TeamPhase.PreWork) {
        this.data.counters.rejections++;
      }

      // Check limits
      if (this.data.counters.revisions > this.limits.maxRevisions) {
        this.data.currentPhase = TeamPhase.Errored;
        this.touch();
        this.phaseTransitioned = true;
        throw new TransitionError(
          `Maximum revision count (${this.limits.maxRevisions}) exceeded. Escalating to human.`,
        );
      }
      if (this.data.counters.rejections > this.limits.maxRejections) {
        this.data.currentPhase = TeamPhase.Errored;
        this.touch();
        this.phaseTransitioned = true;
        throw new TransitionError(
          `Maximum rejection count (${this.limits.maxRejections}) exceeded. Escalating to human.`,
        );
      }
      if (this.data.counters.totalBackwardTransitions > this.limits.maxTotalBackwardTransitions) {
        this.data.currentPhase = TeamPhase.Errored;
        this.touch();
        this.phaseTransitioned = true;
        throw new TransitionError(
          `Maximum total backward transitions (${this.limits.maxTotalBackwardTransitions}) exceeded. Escalating to human.`,
        );
      }
    }

    this.data.currentPhase = newPhase;
    this.touch();
    this.phaseTransitioned = true;
  }

  // --- Agent state transitions ---

  /**
   * Transition an agent to a new state. Validates the transition.
   */
  transitionAgent(instance: RoleInstance, newState: AgentState): void {
    const agent = this.data.agents[instance];
    if (!agent) {
      throw new TransitionError(`Unknown agent instance: ${instance}`);
    }

    if (!VALID_AGENT_TRANSITIONS[agent.state].includes(newState)) {
      throw new TransitionError(
        `Invalid agent transition for ${instance}: ${agent.state} → ${newState}`,
      );
    }

    agent.state = newState;
    this.touch();
  }

  /** Update an agent's current job description. */
  setAgentJob(instance: RoleInstance, job: string): void {
    const agent = this.data.agents[instance];
    if (!agent) throw new TransitionError(`Unknown agent instance: ${instance}`);
    agent.currentJob = job;
    this.touch();
  }

  /** Record that an agent sent or received a message. */
  touchAgentMessage(instance: RoleInstance): void {
    const agent = this.data.agents[instance];
    if (!agent) return;
    agent.lastMessageAt = new Date().toISOString();
    this.touch();
  }

  /** Set agent PID. */
  setAgentPid(instance: RoleInstance, pid: number | null): void {
    const agent = this.data.agents[instance];
    if (!agent) return;
    agent.pid = pid;
    this.touch();
  }

  /** Get an agent's status. */
  getAgent(instance: RoleInstance): Readonly<AgentStatus> | undefined {
    return this.data.agents[instance];
  }

  /** Get all agents. */
  getAllAgents(): ReadonlyArray<[RoleInstance, Readonly<AgentStatus>]> {
    return Object.entries(this.data.agents) as Array<[RoleInstance, AgentStatus]>;
  }

  // --- Task management ---

  assignTask(description: string): void {
    this.data.currentTask = {
      description,
      assignedAt: new Date().toISOString(),
    };
    this.data.counters = { revisions: 0, rejections: 0, totalBackwardTransitions: 0 };
    this.touch();
  }

  clearTask(): void {
    this.data.currentTask = null;
    this.data.counters = { revisions: 0, rejections: 0, totalBackwardTransitions: 0 };
    this.touch();
  }

  /** Reset all agents to Spawning state (used on re-launch). */
  resetAgents(): void {
    for (const agent of Object.values(this.data.agents)) {
      agent.state = AgentState.Spawning;
      agent.currentJob = '';
      agent.lastMessageAt = null;
      agent.pid = null;
    }
    this.touch();
  }

  setTaskComplexity(complexity: TaskComplexity): void {
    if (!this.data.currentTask) {
      throw new TransitionError('Cannot set complexity: no task assigned');
    }
    this.data.currentTask.complexity = complexity;
    this.touch();
  }

  setTaskRequirements(requirements: string): void {
    if (!this.data.currentTask) {
      throw new TransitionError('Cannot set requirements: no task assigned');
    }
    this.data.currentTask.requirements = requirements;
    this.touch();
  }

  recordGuardrailReport(report: EnforcementReportSummary): void {
    this.data.enforcement ??= { guardrailReports: [] };
    this.data.enforcement.guardrailReports.push(report);
    this.data.enforcement.guardrailReports = this.data.enforcement.guardrailReports.slice(-20);
    this.touch();
  }

  recordRuntimeError(error: unknown): void {
    this.data.enforcement ??= { guardrailReports: [] };
    this.data.enforcement.lastError = error;
    this.touch();
  }

  // --- Terminal state checks ---

  get isTerminal(): boolean {
    return (
      this.data.currentPhase === TeamPhase.Done ||
      this.data.currentPhase === TeamPhase.Merged ||
      this.data.currentPhase === TeamPhase.Cancelled ||
      this.data.currentPhase === TeamPhase.Errored
    );
  }

  // --- Branch & PR management ---

  setBranchName(name: string): void {
    this.data.branchName = name;
    this.touch();
  }

  setPrInfo(prNumber: number, prUrl: string): void {
    this.data.prNumber = prNumber;
    this.data.prUrl = prUrl;
    this.touch();
  }

  clearPrInfo(): void {
    this.data.prNumber = undefined;
    this.data.prUrl = undefined;
    this.touch();
  }

  // --- Private helpers ---

  private isBackwardTransition(from: TeamPhase, to: TeamPhase): boolean {
    return (
      (from === TeamPhase.Handoff && to === TeamPhase.Work) ||
      (from === TeamPhase.Review && to === TeamPhase.Work) ||
      (from === TeamPhase.Review && to === TeamPhase.PreWork)
    );
  }

  private touch(): void {
    this.data.updatedAt = new Date().toISOString();
    this.dirty = true;
  }
}
