import { describe, it, expect, beforeEach } from 'vitest';
import { Phase, Priority, MessageStatus, AgentState } from '../src/types/index.js';
import { Role, type RoleInstance } from '../src/roles/role-types.js';
import { TeamState, TeamPhase } from '../src/state/team-state.js';
import { type AgentMessage } from '../src/router/message-types.js';
import {
  PhaseController,
  type PhaseAction,
  type PhaseEvaluation,
} from '../src/phases/phase-controller.js';
import {
  WorkerToSupervisorFlag,
  SecurityToSupervisorFlag,
  ReviewerToSupervisorFlag,
  SupervisorToWorkerFlag,
} from '../src/router/flag-enums.js';

// --- Helpers ---

let msgCounter = 0;

function mockMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  msgCounter++;
  const id = String(msgCounter).padStart(12, '0');
  return {
    messageId: `msg-00000000-0000-0000-0000-${id}`,
    threadId: `thread-00000000-0000-0000-0000-000000000001`,
    timestamp: new Date().toISOString(),
    roleSource: Role.Worker,
    roleSourceInstance: 'Worker-1',
    roleTarget: Role.Supervisor,
    roleTargetInstance: 'Supervisor-1',
    flag: WorkerToSupervisorFlag.TaskAccepted,
    priority: Priority.Normal,
    phase: Phase.PreWork,
    content: 'test',
    references: [],
    requiresResponse: false,
    status: MessageStatus.Pending,
    ...overrides,
  } as AgentMessage;
}

function setupTeamAtPhase(phase: TeamPhase): TeamState {
  const team = TeamState.create('team-1', 'test', '/path');

  // Set all agents to active so transitions work
  for (const [inst] of team.getAllAgents()) {
    team.transitionAgent(inst, AgentState.Active);
  }

  // Walk through phases to reach the target
  if (phase === TeamPhase.PreWork) return team;

  team.transitionPhase(TeamPhase.Work);
  if (phase === TeamPhase.Work) return team;

  team.transitionPhase(TeamPhase.Handoff);
  if (phase === TeamPhase.Handoff) return team;

  team.transitionPhase(TeamPhase.Review);
  if (phase === TeamPhase.Review) return team;

  return team;
}

// =============================================
// Pre-Work phase
// =============================================

describe('Pre-Work phase', () => {
  let controller: PhaseController;
  let team: TeamState;

  beforeEach(() => {
    controller = new PhaseController();
    team = setupTeamAtPhase(TeamPhase.PreWork);
  });

  it('transitions to Work on task-accepted from Worker', () => {
    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskAccepted,
      roleSource: Role.Worker,
      roleSourceInstance: 'Worker-1',
      phase: Phase.PreWork,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(true);
    expect(result.targetPhase).toBe(TeamPhase.Work);
    expect(result.trigger).toContain('task-accepted');
  });

  it('includes set-agent-states action for workers', () => {
    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskAccepted,
      roleSource: Role.Worker,
      roleSourceInstance: 'Worker-2',
    });

    const result = controller.evaluate(team, msg);
    const stateAction = result.actions.find((a) => a.type === 'set-agent-states');
    expect(stateAction).toBeDefined();
    expect(stateAction!.details.state).toBe(AgentState.Active);
  });

  it('does not transition on non-task-accepted messages', () => {
    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.ProgressUpdate,
      roleSource: Role.Worker,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(false);
  });

  it('apply performs the transition', () => {
    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskAccepted,
      roleSource: Role.Worker,
      roleSourceInstance: 'Worker-1',
    });

    const result = controller.evaluate(team, msg);
    controller.apply(team, result);
    expect(team.currentPhase).toBe(TeamPhase.Work);
  });
});

// =============================================
// Work phase
// =============================================

describe('Work phase', () => {
  let controller: PhaseController;
  let team: TeamState;

  beforeEach(() => {
    controller = new PhaseController();
    team = setupTeamAtPhase(TeamPhase.Work);
  });

  it('transitions to Handoff on task-complete from Worker', () => {
    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskComplete,
      roleSource: Role.Worker,
      roleSourceInstance: 'Worker-1',
      phase: Phase.Work,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(true);
    expect(result.targetPhase).toBe(TeamPhase.Handoff);
  });

  it('emits send-sweep-request action on transition', () => {
    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskComplete,
      roleSource: Role.Worker,
      phase: Phase.Work,
    });

    const result = controller.evaluate(team, msg);
    expect(result.actions.some((a) => a.type === 'send-sweep-request')).toBe(true);
  });

  it('sets workers to done on transition', () => {
    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskComplete,
      roleSource: Role.Worker,
      phase: Phase.Work,
    });

    const result = controller.evaluate(team, msg);
    const stateAction = result.actions.find(
      (a) => a.type === 'set-agent-states' && (a.details.state as string) === AgentState.Done
    );
    expect(stateAction).toBeDefined();
  });

  it('does not transition if a worker is blocked', () => {
    team.transitionAgent('Worker-2', AgentState.Blocked);

    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskComplete,
      roleSource: Role.Worker,
      roleSourceInstance: 'Worker-1',
      phase: Phase.Work,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(false);
  });

  it('does not transition on non-task-complete messages', () => {
    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.ProgressUpdate,
      roleSource: Role.Worker,
      phase: Phase.Work,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(false);
  });

  // --- Complexity routing ---

  it('transitions to Done on task-complete when complexity is simple', () => {
    // Set task with simple complexity
    team.assignTask('Create hello.txt');
    team.setTaskComplexity('simple');

    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskComplete,
      roleSource: Role.Worker,
      roleSourceInstance: 'Worker-1',
      phase: Phase.Work,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(true);
    expect(result.targetPhase).toBe(TeamPhase.Done);
    expect(result.trigger).toContain('simple');
  });

  it('does not include send-sweep-request for simple tasks', () => {
    team.assignTask('Create hello.txt');
    team.setTaskComplexity('simple');

    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskComplete,
      roleSource: Role.Worker,
      roleSourceInstance: 'Worker-1',
      phase: Phase.Work,
    });

    const result = controller.evaluate(team, msg);
    expect(result.actions.some((a) => a.type === 'send-sweep-request')).toBe(false);
  });

  it('transitions to Handoff on task-complete when complexity is standard', () => {
    team.assignTask('Build an HTTP server with tests');
    team.setTaskComplexity('standard');

    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskComplete,
      roleSource: Role.Worker,
      roleSourceInstance: 'Worker-1',
      phase: Phase.Work,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(true);
    expect(result.targetPhase).toBe(TeamPhase.Handoff);
  });

  it('defaults to standard routing when no complexity is set', () => {
    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskComplete,
      roleSource: Role.Worker,
      roleSourceInstance: 'Worker-1',
      phase: Phase.Work,
    });

    const result = controller.evaluate(team, msg);
    expect(result.targetPhase).toBe(TeamPhase.Handoff);
  });
});

// =============================================
// Handoff phase
// =============================================

describe('Handoff phase', () => {
  let controller: PhaseController;
  let team: TeamState;

  beforeEach(() => {
    controller = new PhaseController();
    team = setupTeamAtPhase(TeamPhase.Handoff);
  });

  it('transitions to Review on APPROVED handoff-clearance', () => {
    const msg = mockMessage({
      flag: SecurityToSupervisorFlag.HandoffClearance,
      roleSource: Role.Security,
      roleSourceInstance: 'Security-1',
      roleTarget: Role.Supervisor,
      content: 'APPROVED\n\nAll checks passed.',
      phase: Phase.Handoff,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(true);
    expect(result.targetPhase).toBe(TeamPhase.Review);
    expect(result.trigger).toContain('APPROVED');
  });

  it('transitions to Review on FLAGGED handoff-clearance', () => {
    const msg = mockMessage({
      flag: SecurityToSupervisorFlag.HandoffClearance,
      roleSource: Role.Security,
      roleSourceInstance: 'Security-1',
      content: 'FLAGGED\n\nMinor concern about logging.',
      phase: Phase.Handoff,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(true);
    expect(result.targetPhase).toBe(TeamPhase.Review);
    expect(result.trigger).toContain('FLAGGED');
  });

  it('emits send-review-request on APPROVED', () => {
    const msg = mockMessage({
      flag: SecurityToSupervisorFlag.HandoffClearance,
      roleSource: Role.Security,
      roleSourceInstance: 'Security-1',
      content: 'APPROVED\n\nClean.',
      phase: Phase.Handoff,
    });

    const result = controller.evaluate(team, msg);
    expect(result.actions.some((a) => a.type === 'send-review-request')).toBe(true);
  });

  it('transitions back to Work on BLOCKED handoff-clearance', () => {
    const msg = mockMessage({
      flag: SecurityToSupervisorFlag.HandoffClearance,
      roleSource: Role.Security,
      roleSourceInstance: 'Security-1',
      content: 'BLOCKED\n\nHardcoded secret found in token.ts.',
      phase: Phase.Handoff,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(true);
    expect(result.targetPhase).toBe(TeamPhase.Work);
    expect(result.trigger).toContain('BLOCKED');
  });

  it('emits send-revision-request on BLOCKED', () => {
    const msg = mockMessage({
      flag: SecurityToSupervisorFlag.HandoffClearance,
      roleSource: Role.Security,
      roleSourceInstance: 'Security-1',
      content: 'BLOCKED\n\nIssues found.',
      phase: Phase.Handoff,
    });

    const result = controller.evaluate(team, msg);
    const revAction = result.actions.find((a) => a.type === 'send-revision-request');
    expect(revAction).toBeDefined();
    expect(revAction!.details.reason).toBe('security-blocked');
  });

  it('sets Security idle and Workers active on BLOCKED', () => {
    const msg = mockMessage({
      flag: SecurityToSupervisorFlag.HandoffClearance,
      roleSource: Role.Security,
      roleSourceInstance: 'Security-1',
      content: 'BLOCKED\n\nIssues.',
      phase: Phase.Handoff,
    });

    const result = controller.evaluate(team, msg);
    const secAction = result.actions.find(
      (a) =>
        a.type === 'set-agent-states' &&
        JSON.stringify(a.details.targets) === JSON.stringify(['Security-1'])
    );
    expect(secAction).toBeDefined();
    expect(secAction!.details.state).toBe(AgentState.Idle);
  });

  it('increments revision counter on BLOCKED transition', () => {
    const msg = mockMessage({
      flag: SecurityToSupervisorFlag.HandoffClearance,
      roleSource: Role.Security,
      roleSourceInstance: 'Security-1',
      content: 'BLOCKED\n\nIssues.',
      phase: Phase.Handoff,
    });

    const result = controller.evaluate(team, msg);
    controller.apply(team, result);

    expect(team.currentPhase).toBe(TeamPhase.Work);
    expect(team.counters.revisions).toBe(1);
    expect(team.counters.totalBackwardTransitions).toBe(1);
  });

  it('does not transition on non-handoff-clearance messages', () => {
    const msg = mockMessage({
      flag: SecurityToSupervisorFlag.SecurityAlert,
      roleSource: Role.Security,
      roleSourceInstance: 'Security-1',
      phase: Phase.Handoff,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(false);
  });
});

// =============================================
// Review phase
// =============================================

describe('Review phase', () => {
  let controller: PhaseController;
  let team: TeamState;

  beforeEach(() => {
    controller = new PhaseController();
    team = setupTeamAtPhase(TeamPhase.Review);
  });

  it('transitions to Done on review-approved', () => {
    const msg = mockMessage({
      flag: ReviewerToSupervisorFlag.ReviewApproved,
      roleSource: Role.Reviewer,
      roleSourceInstance: 'Reviewer-1',
      phase: Phase.Review,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(true);
    expect(result.targetPhase).toBe(TeamPhase.Done);
    expect(result.trigger).toBe('review-approved');
  });

  it('sets all agents to done on approval', () => {
    const msg = mockMessage({
      flag: ReviewerToSupervisorFlag.ReviewApproved,
      roleSource: Role.Reviewer,
      roleSourceInstance: 'Reviewer-1',
      phase: Phase.Review,
    });

    const result = controller.evaluate(team, msg);
    controller.apply(team, result);
    expect(team.currentPhase).toBe(TeamPhase.Done);
    expect(team.isTerminal).toBe(true);
  });

  it('transitions to Work on review-revise', () => {
    const msg = mockMessage({
      flag: ReviewerToSupervisorFlag.ReviewRevise,
      roleSource: Role.Reviewer,
      roleSourceInstance: 'Reviewer-1',
      content: 'Needs input validation on email.',
      phase: Phase.Review,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(true);
    expect(result.targetPhase).toBe(TeamPhase.Work);
    expect(result.trigger).toBe('review-revise');
  });

  it('emits send-revision-request on review-revise', () => {
    const msg = mockMessage({
      flag: ReviewerToSupervisorFlag.ReviewRevise,
      roleSource: Role.Reviewer,
      roleSourceInstance: 'Reviewer-1',
      content: 'Fix the login response.',
      phase: Phase.Review,
    });

    const result = controller.evaluate(team, msg);
    const revAction = result.actions.find((a) => a.type === 'send-revision-request');
    expect(revAction).toBeDefined();
    expect(revAction!.details.reason).toBe('reviewer-revise');
    expect(revAction!.details.feedback).toBe('Fix the login response.');
  });

  it('increments revision counter on review-revise', () => {
    const msg = mockMessage({
      flag: ReviewerToSupervisorFlag.ReviewRevise,
      roleSource: Role.Reviewer,
      roleSourceInstance: 'Reviewer-1',
      phase: Phase.Review,
    });

    const result = controller.evaluate(team, msg);
    controller.apply(team, result);

    expect(team.counters.revisions).toBe(1);
  });

  it('transitions to PreWork on review-rejected', () => {
    const msg = mockMessage({
      flag: ReviewerToSupervisorFlag.ReviewRejected,
      roleSource: Role.Reviewer,
      roleSourceInstance: 'Reviewer-1',
      content: 'Wrong approach entirely.',
      phase: Phase.Review,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(true);
    expect(result.targetPhase).toBe(TeamPhase.PreWork);
    expect(result.trigger).toBe('review-rejected');
  });

  it('emits replan-task on review-rejected', () => {
    const msg = mockMessage({
      flag: ReviewerToSupervisorFlag.ReviewRejected,
      roleSource: Role.Reviewer,
      roleSourceInstance: 'Reviewer-1',
      content: 'Wrong approach.',
      phase: Phase.Review,
    });

    const result = controller.evaluate(team, msg);
    const replanAction = result.actions.find((a) => a.type === 'replan-task');
    expect(replanAction).toBeDefined();
    expect(replanAction!.details.reason).toBe('Wrong approach.');
  });

  it('increments rejection counter on review-rejected', () => {
    const msg = mockMessage({
      flag: ReviewerToSupervisorFlag.ReviewRejected,
      roleSource: Role.Reviewer,
      roleSourceInstance: 'Reviewer-1',
      phase: Phase.Review,
    });

    const result = controller.evaluate(team, msg);
    controller.apply(team, result);

    expect(team.counters.rejections).toBe(1);
    expect(team.counters.totalBackwardTransitions).toBe(1);
  });

  it('does not transition on non-reviewer messages', () => {
    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.ProgressUpdate,
      roleSource: Role.Worker,
      phase: Phase.Review,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(false);
  });
});

// =============================================
// PhaseController — events and helpers
// =============================================

describe('PhaseController events', () => {
  it('emits transition event on apply', () => {
    const controller = new PhaseController();
    const team = setupTeamAtPhase(TeamPhase.PreWork);
    const transitions: Array<[TeamPhase, TeamPhase, string]> = [];

    controller.on('transition', (from, to, trigger) => {
      transitions.push([from, to, trigger]);
    });

    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskAccepted,
      roleSource: Role.Worker,
    });

    controller.processMessage(team, msg);
    expect(transitions).toHaveLength(1);
    expect(transitions[0][0]).toBe(TeamPhase.PreWork);
    expect(transitions[0][1]).toBe(TeamPhase.Work);
  });

  it('emits action-required events', () => {
    const controller = new PhaseController();
    const team = setupTeamAtPhase(TeamPhase.Work);
    const actions: PhaseAction[] = [];

    controller.on('action-required', (action) => {
      actions.push(action);
    });

    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.TaskComplete,
      roleSource: Role.Worker,
      phase: Phase.Work,
    });

    controller.processMessage(team, msg);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.type === 'send-sweep-request')).toBe(true);
  });
});

// =============================================
// Loop limit enforcement via PhaseController
// =============================================

describe('loop limit enforcement', () => {
  it('transitions to errored when revision limit exceeded', () => {
    const controller = new PhaseController();
    const team = TeamState.create('team-1', 'test', '/path', {
      maxRevisions: 1,
      maxRejections: 2,
      maxTotalBackwardTransitions: 5,
    });

    // Set all agents active
    for (const [inst] of team.getAllAgents()) {
      team.transitionAgent(inst, AgentState.Active);
    }

    // First: pre-work → work → handoff → work (rev 1)
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);

    const msg1 = mockMessage({
      flag: SecurityToSupervisorFlag.HandoffClearance,
      roleSource: Role.Security,
      roleSourceInstance: 'Security-1',
      content: 'BLOCKED\n\nIssue.',
      phase: Phase.Handoff,
    });

    controller.processMessage(team, msg1); // rev 1 → Work
    expect(team.currentPhase).toBe(TeamPhase.Work);

    // Second: work → handoff → work (rev 2 → exceeds limit)
    team.transitionPhase(TeamPhase.Handoff);

    const errors: string[] = [];
    controller.on('error', (err) => errors.push(err.message));
    controller.on('transition', (from, to) => {});

    const msg2 = mockMessage({
      flag: SecurityToSupervisorFlag.HandoffClearance,
      roleSource: Role.Security,
      roleSourceInstance: 'Security-1',
      content: 'BLOCKED\n\nAnother issue.',
      phase: Phase.Handoff,
    });

    controller.processMessage(team, msg2);
    expect(team.currentPhase).toBe(TeamPhase.Errored);
    expect(errors.some((e) => e.includes('Maximum revision'))).toBe(true);
  });
});

// =============================================
// forceError and forceCancel
// =============================================

describe('force transitions', () => {
  it('forceError transitions to errored', () => {
    const controller = new PhaseController();
    const team = setupTeamAtPhase(TeamPhase.Work);

    controller.forceError(team, 'timeout exceeded');
    expect(team.currentPhase).toBe(TeamPhase.Errored);
  });

  it('forceCancel transitions to cancelled', () => {
    const controller = new PhaseController();
    const team = setupTeamAtPhase(TeamPhase.Work);

    controller.forceCancel(team, 'human cancelled');
    expect(team.currentPhase).toBe(TeamPhase.Cancelled);
  });

  it('forceError emits transition event', () => {
    const controller = new PhaseController();
    const team = setupTeamAtPhase(TeamPhase.Work);
    const transitions: TeamPhase[] = [];

    controller.on('transition', (from, to) => transitions.push(to));
    controller.forceError(team, 'deadlock');

    expect(transitions).toContain(TeamPhase.Errored);
  });
});

// =============================================
// Terminal state handling
// =============================================

describe('terminal states', () => {
  it('does not transition from Done', () => {
    const controller = new PhaseController();
    const team = setupTeamAtPhase(TeamPhase.Review);

    const approveMsg = mockMessage({
      flag: ReviewerToSupervisorFlag.ReviewApproved,
      roleSource: Role.Reviewer,
      roleSourceInstance: 'Reviewer-1',
      phase: Phase.Review,
    });

    controller.processMessage(team, approveMsg);
    expect(team.currentPhase).toBe(TeamPhase.Done);

    // Further messages should not transition
    const msg = mockMessage({
      flag: WorkerToSupervisorFlag.ProgressUpdate,
      roleSource: Role.Worker,
    });

    const result = controller.evaluate(team, msg);
    expect(result.shouldTransition).toBe(false);
  });
});

// =============================================
// Full happy-path cycle
// =============================================

describe('full happy-path cycle', () => {
  it('pre-work → work → handoff → review → done', () => {
    const controller = new PhaseController();
    const team = TeamState.create('team-1', 'test', '/path');

    // Set all agents active
    for (const [inst] of team.getAllAgents()) {
      team.transitionAgent(inst, AgentState.Active);
    }

    // Pre-Work → Work (task-accepted)
    controller.processMessage(
      team,
      mockMessage({
        flag: WorkerToSupervisorFlag.TaskAccepted,
        roleSource: Role.Worker,
        roleSourceInstance: 'Worker-1',
      })
    );
    expect(team.currentPhase).toBe(TeamPhase.Work);

    // Work → Handoff (task-complete)
    controller.processMessage(
      team,
      mockMessage({
        flag: WorkerToSupervisorFlag.TaskComplete,
        roleSource: Role.Worker,
        roleSourceInstance: 'Worker-1',
        phase: Phase.Work,
      })
    );
    expect(team.currentPhase).toBe(TeamPhase.Handoff);

    // Handoff → Review (handoff-clearance APPROVED)
    controller.processMessage(
      team,
      mockMessage({
        flag: SecurityToSupervisorFlag.HandoffClearance,
        roleSource: Role.Security,
        roleSourceInstance: 'Security-1',
        content: 'APPROVED\n\nAll clear.',
        phase: Phase.Handoff,
      })
    );
    expect(team.currentPhase).toBe(TeamPhase.Review);

    // Review → Done (review-approved)
    controller.processMessage(
      team,
      mockMessage({
        flag: ReviewerToSupervisorFlag.ReviewApproved,
        roleSource: Role.Reviewer,
        roleSourceInstance: 'Reviewer-1',
        phase: Phase.Review,
      })
    );
    expect(team.currentPhase).toBe(TeamPhase.Done);
    expect(team.isTerminal).toBe(true);
    expect(team.counters.revisions).toBe(0);
    expect(team.counters.rejections).toBe(0);
  });
});
