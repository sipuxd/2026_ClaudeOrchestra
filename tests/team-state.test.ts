import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentState } from '../src/types/index.js';
import { Role } from '../src/roles/role-types.js';
import {
  TeamState,
  TeamPhase,
  TransitionError,
  DEFAULT_LOOP_LIMITS,
} from '../src/state/team-state.js';
import { StatePersistence } from '../src/state/persistence.js';

// =============================================
// TeamState — creation and accessors
// =============================================

describe('TeamState creation', () => {
  it('creates a team with all 5 agents in spawning state', () => {
    const team = TeamState.create('team-1', 'my-project', '/path/to/project');

    expect(team.teamId).toBe('team-1');
    expect(team.currentPhase).toBe(TeamPhase.PreWork);

    const agents = team.getAllAgents();
    expect(agents).toHaveLength(5);

    for (const [, agent] of agents) {
      expect(agent.state).toBe(AgentState.Spawning);
    }
  });

  it('has correct roles assigned to instances', () => {
    const team = TeamState.create('team-1', 'test', '/path');

    expect(team.getAgent('Worker-1')?.role).toBe(Role.Worker);
    expect(team.getAgent('Worker-2')?.role).toBe(Role.Worker);
    expect(team.getAgent('Security-1')?.role).toBe(Role.Security);
    expect(team.getAgent('Reviewer-1')?.role).toBe(Role.Reviewer);
    expect(team.getAgent('Coordinator-1')?.role).toBe(Role.Coordinator);
  });

  it('starts with zero counters', () => {
    const team = TeamState.create('team-1', 'test', '/path');
    expect(team.counters.revisions).toBe(0);
    expect(team.counters.rejections).toBe(0);
    expect(team.counters.totalBackwardTransitions).toBe(0);
  });

  it('starts not terminal', () => {
    const team = TeamState.create('team-1', 'test', '/path');
    expect(team.isTerminal).toBe(false);
  });
});

// =============================================
// Phase transitions
// =============================================

describe('phase transitions', () => {
  let team: TeamState;

  beforeEach(() => {
    team = TeamState.create('team-1', 'test', '/path');
  });

  it('allows pre_work → work', () => {
    team.transitionPhase(TeamPhase.Work);
    expect(team.currentPhase).toBe(TeamPhase.Work);
  });

  it('allows work → handoff', () => {
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    expect(team.currentPhase).toBe(TeamPhase.Handoff);
  });

  it('allows work → done (simple routing)', () => {
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Done);
    expect(team.currentPhase).toBe(TeamPhase.Done);
    expect(team.isTerminal).toBe(true);
  });

  it('allows handoff → review', () => {
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Review);
    expect(team.currentPhase).toBe(TeamPhase.Review);
  });

  it('allows review → done', () => {
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Review);
    team.transitionPhase(TeamPhase.Done);
    expect(team.currentPhase).toBe(TeamPhase.Done);
    expect(team.isTerminal).toBe(true);
  });

  it('allows handoff → work (security blocked)', () => {
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Work);
    expect(team.currentPhase).toBe(TeamPhase.Work);
    expect(team.counters.revisions).toBe(1);
  });

  it('allows review → work (revise)', () => {
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Review);
    team.transitionPhase(TeamPhase.Work);
    expect(team.currentPhase).toBe(TeamPhase.Work);
    expect(team.counters.revisions).toBe(1);
  });

  it('allows review → pre_work (rejected)', () => {
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Review);
    team.transitionPhase(TeamPhase.PreWork);
    expect(team.currentPhase).toBe(TeamPhase.PreWork);
    expect(team.counters.rejections).toBe(1);
  });

  it('allows any phase → errored', () => {
    team.transitionPhase(TeamPhase.Errored);
    expect(team.currentPhase).toBe(TeamPhase.Errored);
    expect(team.isTerminal).toBe(true);
  });

  it('allows any phase → cancelled', () => {
    team.transitionPhase(TeamPhase.Cancelled);
    expect(team.currentPhase).toBe(TeamPhase.Cancelled);
    expect(team.isTerminal).toBe(true);
  });

  it('allows errored → pre_work (retry)', () => {
    team.transitionPhase(TeamPhase.Errored);
    team.transitionPhase(TeamPhase.PreWork);
    expect(team.currentPhase).toBe(TeamPhase.PreWork);
  });

  it('allows errored → cancelled (abandon)', () => {
    team.transitionPhase(TeamPhase.Errored);
    team.transitionPhase(TeamPhase.Cancelled);
    expect(team.currentPhase).toBe(TeamPhase.Cancelled);
  });

  // --- Invalid transitions ---

  it('rejects pre_work → review (skipping work + handoff)', () => {
    expect(() => team.transitionPhase(TeamPhase.Review)).toThrow(TransitionError);
  });

  it('rejects pre_work → handoff (skipping work)', () => {
    expect(() => team.transitionPhase(TeamPhase.Handoff)).toThrow(TransitionError);
  });

  it('rejects pre_work → done (skipping everything)', () => {
    expect(() => team.transitionPhase(TeamPhase.Done)).toThrow(TransitionError);
  });

  it('rejects work → review (skipping handoff)', () => {
    team.transitionPhase(TeamPhase.Work);
    expect(() => team.transitionPhase(TeamPhase.Review)).toThrow(TransitionError);
  });

  it('rejects work → pre_work (no backward from work)', () => {
    team.transitionPhase(TeamPhase.Work);
    expect(() => team.transitionPhase(TeamPhase.PreWork)).toThrow(TransitionError);
  });

  it('allows done → pre_work (re-launch)', () => {
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Review);
    team.transitionPhase(TeamPhase.Done);
    team.transitionPhase(TeamPhase.PreWork);
    expect(team.currentPhase).toBe(TeamPhase.PreWork);
  });

  it('rejects done → work (must go through pre_work)', () => {
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Review);
    team.transitionPhase(TeamPhase.Done);
    expect(() => team.transitionPhase(TeamPhase.Work)).toThrow(TransitionError);
  });

  it('rejects transitions from cancelled', () => {
    team.transitionPhase(TeamPhase.Cancelled);
    expect(() => team.transitionPhase(TeamPhase.PreWork)).toThrow(TransitionError);
  });

  it('marks dirty and phaseTransitioned on transition', () => {
    team.markPersisted();
    expect(team.isDirty).toBe(false);

    team.transitionPhase(TeamPhase.Work);
    expect(team.isDirty).toBe(true);
    expect(team.hasPhaseTransitioned).toBe(true);
  });
});

// =============================================
// Loop limits
// =============================================

describe('loop limits', () => {
  it('errors after exceeding max revisions', () => {
    const team = TeamState.create('team-1', 'test', '/path', {
      maxRevisions: 2,
      maxRejections: 2,
      maxTotalBackwardTransitions: 10,
    });

    // Revision 1: handoff → work
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Work); // rev 1

    // Revision 2: review → work
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Review);
    team.transitionPhase(TeamPhase.Work); // rev 2

    // Revision 3: should error
    team.transitionPhase(TeamPhase.Handoff);
    expect(() => team.transitionPhase(TeamPhase.Work)).toThrow(
      /Maximum revision count/
    );
    expect(team.currentPhase).toBe(TeamPhase.Errored);
  });

  it('errors after exceeding max rejections', () => {
    const team = TeamState.create('team-1', 'test', '/path', {
      maxRevisions: 10,
      maxRejections: 1,
      maxTotalBackwardTransitions: 10,
    });

    // Rejection 1
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Review);
    team.transitionPhase(TeamPhase.PreWork); // rej 1

    // Rejection 2: should error
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Review);
    expect(() => team.transitionPhase(TeamPhase.PreWork)).toThrow(
      /Maximum rejection count/
    );
    expect(team.currentPhase).toBe(TeamPhase.Errored);
  });

  it('errors after exceeding total backward transitions', () => {
    const team = TeamState.create('team-1', 'test', '/path', {
      maxRevisions: 10,
      maxRejections: 10,
      maxTotalBackwardTransitions: 2,
    });

    // Backward 1
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Work); // total 1

    // Backward 2
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Review);
    team.transitionPhase(TeamPhase.Work); // total 2

    // Backward 3: should error
    team.transitionPhase(TeamPhase.Handoff);
    expect(() => team.transitionPhase(TeamPhase.Work)).toThrow(
      /Maximum total backward/
    );
    expect(team.currentPhase).toBe(TeamPhase.Errored);
  });
});

// =============================================
// Agent state transitions
// =============================================

describe('agent state transitions', () => {
  let team: TeamState;

  beforeEach(() => {
    team = TeamState.create('team-1', 'test', '/path');
  });

  it('allows spawning → active', () => {
    team.transitionAgent('Worker-1', AgentState.Active);
    expect(team.getAgent('Worker-1')?.state).toBe(AgentState.Active);
  });

  it('allows active → idle', () => {
    team.transitionAgent('Worker-1', AgentState.Active);
    team.transitionAgent('Worker-1', AgentState.Idle);
    expect(team.getAgent('Worker-1')?.state).toBe(AgentState.Idle);
  });

  it('allows active → blocked', () => {
    team.transitionAgent('Worker-1', AgentState.Active);
    team.transitionAgent('Worker-1', AgentState.Blocked);
    expect(team.getAgent('Worker-1')?.state).toBe(AgentState.Blocked);
  });

  it('allows active → waiting', () => {
    team.transitionAgent('Worker-1', AgentState.Active);
    team.transitionAgent('Worker-1', AgentState.Waiting);
    expect(team.getAgent('Worker-1')?.state).toBe(AgentState.Waiting);
  });

  it('allows active → done', () => {
    team.transitionAgent('Worker-1', AgentState.Active);
    team.transitionAgent('Worker-1', AgentState.Done);
    expect(team.getAgent('Worker-1')?.state).toBe(AgentState.Done);
  });

  it('allows blocked → active (unblocked)', () => {
    team.transitionAgent('Worker-1', AgentState.Active);
    team.transitionAgent('Worker-1', AgentState.Blocked);
    team.transitionAgent('Worker-1', AgentState.Active);
    expect(team.getAgent('Worker-1')?.state).toBe(AgentState.Active);
  });

  it('allows waiting → active (response received)', () => {
    team.transitionAgent('Worker-1', AgentState.Active);
    team.transitionAgent('Worker-1', AgentState.Waiting);
    team.transitionAgent('Worker-1', AgentState.Active);
    expect(team.getAgent('Worker-1')?.state).toBe(AgentState.Active);
  });

  it('allows done → active (next phase)', () => {
    team.transitionAgent('Worker-1', AgentState.Active);
    team.transitionAgent('Worker-1', AgentState.Done);
    team.transitionAgent('Worker-1', AgentState.Active);
    expect(team.getAgent('Worker-1')?.state).toBe(AgentState.Active);
  });

  it('allows errored → spawning (respawn)', () => {
    team.transitionAgent('Worker-1', AgentState.Active);
    team.transitionAgent('Worker-1', AgentState.Errored);
    team.transitionAgent('Worker-1', AgentState.Spawning);
    expect(team.getAgent('Worker-1')?.state).toBe(AgentState.Spawning);
  });

  it('allows any state → errored', () => {
    team.transitionAgent('Worker-1', AgentState.Active);
    team.transitionAgent('Worker-1', AgentState.Errored);
    expect(team.getAgent('Worker-1')?.state).toBe(AgentState.Errored);
  });

  // Invalid transitions
  it('rejects spawning → done (must go through active)', () => {
    expect(() =>
      team.transitionAgent('Worker-1', AgentState.Done)
    ).toThrow(TransitionError);
  });

  it('rejects idle → done', () => {
    team.transitionAgent('Worker-1', AgentState.Active);
    team.transitionAgent('Worker-1', AgentState.Idle);
    expect(() =>
      team.transitionAgent('Worker-1', AgentState.Done)
    ).toThrow(TransitionError);
  });

  it('rejects unknown instance', () => {
    expect(() =>
      team.transitionAgent('Worker-99' as any, AgentState.Active)
    ).toThrow(TransitionError);
  });
});

// =============================================
// Agent metadata
// =============================================

describe('agent metadata', () => {
  it('sets and reads currentJob', () => {
    const team = TeamState.create('team-1', 'test', '/path');
    team.setAgentJob('Worker-1', 'Implementing auth module');
    expect(team.getAgent('Worker-1')?.currentJob).toBe('Implementing auth module');
  });

  it('updates lastMessageAt', () => {
    const team = TeamState.create('team-1', 'test', '/path');
    team.touchAgentMessage('Worker-1');
    expect(team.getAgent('Worker-1')?.lastMessageAt).toBeTruthy();
  });

  it('sets and reads PID', () => {
    const team = TeamState.create('team-1', 'test', '/path');
    team.setAgentPid('Worker-1', 12345);
    expect(team.getAgent('Worker-1')?.pid).toBe(12345);
  });
});

// =============================================
// Task management
// =============================================

describe('task management', () => {
  it('assigns a task and resets counters', () => {
    const team = TeamState.create('team-1', 'test', '/path');

    // Increment some counters first
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Work); // rev 1

    team.assignTask('Add JWT authentication');
    expect(team.snapshot.currentTask?.description).toBe('Add JWT authentication');
    expect(team.counters.revisions).toBe(0);
    expect(team.counters.rejections).toBe(0);
    expect(team.counters.totalBackwardTransitions).toBe(0);
  });

  it('sets task complexity', () => {
    const team = TeamState.create('team-1', 'test', '/path');
    team.assignTask('Create hello.txt');
    team.setTaskComplexity('simple');
    expect(team.snapshot.currentTask?.complexity).toBe('simple');
  });

  it('sets task complexity to standard', () => {
    const team = TeamState.create('team-1', 'test', '/path');
    team.assignTask('Build an HTTP server with tests');
    team.setTaskComplexity('standard');
    expect(team.snapshot.currentTask?.complexity).toBe('standard');
  });

  it('throws when setting complexity without a task', () => {
    const team = TeamState.create('team-1', 'test', '/path');
    expect(() => team.setTaskComplexity('simple')).toThrow('Cannot set complexity');
  });
});

// =============================================
// Persistence
// =============================================

describe('StatePersistence', () => {
  let baseDir: string;
  let persistence: StatePersistence;

  beforeEach(() => {
    baseDir = path.join(os.tmpdir(), `test-state-${randomUUID()}`);
    persistence = new StatePersistence({ debounceMs: 50 });
  });

  afterEach(() => {
    persistence.dispose();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  /** Helper to register a team dir under baseDir. */
  function registerTeam(teamId: string): string {
    const teamDir = path.join(baseDir, 'teams', teamId);
    persistence.registerTeamDir(teamId, teamDir);
    return teamDir;
  }

  it('persists and loads team state', () => {
    registerTeam('team-1');
    const team = TeamState.create('team-1', 'test', '/path');
    persistence.ensureTeamDir('team-1');
    persistence.persistNow(team);

    const loaded = persistence.load('team-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.teamId).toBe('team-1');
    expect(loaded!.teamName).toBe('test');
    expect(loaded!.currentPhase).toBe(TeamPhase.PreWork);
    expect(Object.keys(loaded!.agents)).toHaveLength(5);
  });

  it('returns null for nonexistent team', () => {
    registerTeam('nonexistent');
    expect(persistence.load('nonexistent')).toBeNull();
  });

  it('loads state from a directory path', () => {
    const teamDir = registerTeam('team-1');
    const team1 = TeamState.create('team-1', 'a', '/a');
    persistence.ensureTeamDir('team-1');
    persistence.persistNow(team1);

    // loadFromDir works without prior registration
    const newPersistence = new StatePersistence({ debounceMs: 50 });
    const loaded = newPersistence.loadFromDir(teamDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.teamId).toBe('team-1');
  });

  it('restores state with fromData', () => {
    registerTeam('team-1');
    const team = TeamState.create('team-1', 'test', '/path');
    team.transitionPhase(TeamPhase.Work);
    persistence.ensureTeamDir('team-1');
    persistence.persistNow(team);

    const data = persistence.load('team-1')!;
    const restored = TeamState.fromData(data);
    expect(restored.currentPhase).toBe(TeamPhase.Work);
    expect(restored.teamId).toBe('team-1');
  });

  it('force-persists on phase transition', () => {
    registerTeam('team-1');
    const team = TeamState.create('team-1', 'test', '/path');
    persistence.ensureTeamDir('team-1');

    team.transitionPhase(TeamPhase.Work);
    persistence.persist(team); // Should write immediately (phase transition)

    const loaded = persistence.load('team-1');
    expect(loaded!.currentPhase).toBe(TeamPhase.Work);
  });

  it('appends chat messages to chat.jsonl and reloads them with the team', () => {
    const teamDir = registerTeam('team-1');
    persistence.ensureTeamDir('team-1');
    const team = TeamState.create('team-1', 'test', '/path');
    persistence.persistNow(team);

    persistence.appendChatMessage('team-1', {
      role: 'user',
      content: 'Build a settings page',
      timestamp: '2026-05-09T10:00:00.000Z',
    });
    persistence.appendChatMessage('team-1', {
      role: 'coordinator',
      content: 'Add a settings page at /settings',
      timestamp: '2026-05-09T10:00:01.000Z',
      verdict: 'TRIGGER_PIPELINE',
    });

    // chat.jsonl exists alongside state.json — and is line-delimited JSON.
    const chatPath = path.join(teamDir, 'chat.jsonl');
    expect(fs.existsSync(chatPath)).toBe(true);
    const raw = fs.readFileSync(chatPath, 'utf-8');
    expect(raw.split('\n').filter(Boolean)).toHaveLength(2);

    // load() hydrates chatHistory from chat.jsonl.
    const loaded = persistence.load('team-1');
    expect(loaded!.chatHistory).toHaveLength(2);
    expect(loaded!.chatHistory[0].role).toBe('user');
    expect(loaded!.chatHistory[1].verdict).toBe('TRIGGER_PIPELINE');
  });

  it('does NOT write chatHistory into state.json (chat.jsonl is canonical)', () => {
    const teamDir = registerTeam('team-1');
    persistence.ensureTeamDir('team-1');
    const team = TeamState.create('team-1', 'test', '/path');
    team.appendChatMessage({
      role: 'user',
      content: 'hello',
      timestamp: '2026-05-09T10:00:00.000Z',
    });
    persistence.persistNow(team);

    const stateJsonRaw = fs.readFileSync(path.join(teamDir, 'state.json'), 'utf-8');
    const parsed = JSON.parse(stateJsonRaw);
    // chatHistory must be absent from state.json — keeping it out of dirty-flush
    // writes is the whole reason chat.jsonl exists as the canonical store.
    expect(parsed.chatHistory).toBeUndefined();
  });

  it('debounces non-phase-transition writes', async () => {
    registerTeam('team-1');
    const team = TeamState.create('team-1', 'test', '/path');
    persistence.ensureTeamDir('team-1');
    persistence.persistNow(team); // Initial write
    team.markPersisted();

    team.setAgentJob('Worker-1', 'testing');
    persistence.persist(team); // Debounced

    // Should not be written yet
    const before = persistence.load('team-1');
    expect(before!.agents['Worker-1' as keyof typeof before.agents].currentJob).toBe('');

    // Wait for debounce to fire
    await new Promise((r) => setTimeout(r, 100));

    const after = persistence.load('team-1');
    expect((after!.agents as any)['Worker-1'].currentJob).toBe('testing');
  });

  it('marks state as not dirty after persist', () => {
    registerTeam('team-1');
    const team = TeamState.create('team-1', 'test', '/path');
    persistence.ensureTeamDir('team-1');

    // Make state dirty via a mutation
    team.setAgentJob('Worker-1', 'testing');
    expect(team.isDirty).toBe(true);

    persistence.persistNow(team);

    expect(team.isDirty).toBe(false);
    expect(team.hasPhaseTransitioned).toBe(false);
  });

  it('survives crash recovery — phase and counters preserved', () => {
    const teamDir = registerTeam('team-1');
    const team = TeamState.create('team-1', 'test', '/path');
    persistence.ensureTeamDir('team-1');
    team.transitionPhase(TeamPhase.Work);
    team.transitionPhase(TeamPhase.Handoff);
    team.transitionPhase(TeamPhase.Work); // rev 1
    persistence.persistNow(team);

    // Simulate crash and recovery — use loadFromDir (no prior registration)
    const newPersistence = new StatePersistence({ debounceMs: 50 });
    const data = newPersistence.loadFromDir(teamDir)!;
    const restored = TeamState.fromData(data);

    expect(restored.currentPhase).toBe(TeamPhase.Work);
    expect(restored.counters.revisions).toBe(1);
    expect(restored.counters.totalBackwardTransitions).toBe(1);

    newPersistence.dispose();
  });
});
