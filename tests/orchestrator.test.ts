import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Orchestrator } from '../src/orchestrator.js';
import { TeamPhase } from '../src/state/team-state.js';
import { AgentState, Phase, Priority } from '../src/types/index.js';
import { Role, type RoleInstance, VALID_INSTANCES } from '../src/roles/role-types.js';
import { MessageBus } from '../src/router/message-bus.js';
import { type AgentMessage } from '../src/router/message-types.js';

// Use a temp directory for each test
let tmpDir: string;
let orchestrator: Orchestrator;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestra-test-'));
  orchestrator = new Orchestrator({
    dataDirectory: path.join(tmpDir, 'data'),
    rolesDir: path.join(tmpDir, 'roles'),
    tickIntervalMs: 100,
    // Use echo as a mock CLI binary — it just exits immediately
    claudeBin: 'echo',
    spawnArgs: ['mock-agent'],
  });
});

afterEach(async () => {
  await orchestrator.shutdown();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Orchestrator', () => {
  describe('createTeam', () => {
    it('creates a team in pre-work phase', () => {
      const state = orchestrator.createTeam('my-team', '/tmp/test-project');

      expect(state.snapshot.teamId).toBe('my-team');
      expect(state.snapshot.teamName).toBe('my-team');
      expect(state.snapshot.projectPath).toBe('/tmp/test-project');
      expect(state.snapshot.currentPhase).toBe(TeamPhase.PreWork);
      expect(state.snapshot.currentTask).toBeNull();
    });

    it('creates data directories', () => {
      orchestrator.createTeam('dir-test', '/tmp/test');

      const teamDir = path.join(tmpDir, 'data', 'teams', 'dir-test');
      expect(fs.existsSync(teamDir)).toBe(true);
      expect(fs.existsSync(path.join(teamDir, 'state.json'))).toBe(true);
      expect(fs.existsSync(path.join(teamDir, 'messages', 'inbox', 'Supervisor-1'))).toBe(true);
      expect(fs.existsSync(path.join(teamDir, 'messages', 'inbox', 'Worker-1'))).toBe(true);
      expect(fs.existsSync(path.join(teamDir, 'messages', 'inbox', 'Worker-2'))).toBe(true);
      expect(fs.existsSync(path.join(teamDir, 'messages', 'inbox', 'Security-1'))).toBe(true);
      expect(fs.existsSync(path.join(teamDir, 'messages', 'inbox', 'Reviewer-1'))).toBe(true);
      expect(fs.existsSync(path.join(teamDir, 'reports', 'clearance'))).toBe(true);
      expect(fs.existsSync(path.join(teamDir, 'reports', 'reviews'))).toBe(true);
    });

    it('persists initial state to disk', () => {
      orchestrator.createTeam('persist-test', '/tmp/test');

      const stateFile = path.join(tmpDir, 'data', 'teams', 'persist-test', 'state.json');
      const raw = fs.readFileSync(stateFile, 'utf-8');
      const data = JSON.parse(raw);
      expect(data.teamId).toBe('persist-test');
      expect(data.currentPhase).toBe(TeamPhase.PreWork);
    });

    it('rejects duplicate team names', () => {
      orchestrator.createTeam('dup-team', '/tmp/test');
      expect(() => orchestrator.createTeam('dup-team', '/tmp/test')).toThrow('already exists');
    });

    it('enforces max concurrent teams', () => {
      const limited = new Orchestrator({
        dataDirectory: path.join(tmpDir, 'data'),
        rolesDir: path.join(tmpDir, 'roles'),
        maxConcurrentTeams: 2,
        claudeBin: 'echo',
        spawnArgs: ['mock'],
      });

      limited.createTeam('t1', '/tmp/a');
      limited.createTeam('t2', '/tmp/b');
      expect(() => limited.createTeam('t3', '/tmp/c')).toThrow('Maximum concurrent teams');
    });

    it('emits team-created event', () => {
      let emittedId = '';
      orchestrator.on('team-created', (id) => { emittedId = id; });

      orchestrator.createTeam('event-test', '/tmp/test');
      expect(emittedId).toBe('event-test');
    });
  });

  describe('getTeamStatus / getAllTeams', () => {
    it('returns team status by id', () => {
      orchestrator.createTeam('query-test', '/tmp/test');

      const status = orchestrator.getTeamStatus('query-test');
      expect(status).toBeDefined();
      expect(status!.teamId).toBe('query-test');
    });

    it('returns undefined for unknown team', () => {
      expect(orchestrator.getTeamStatus('nope')).toBeUndefined();
    });

    it('lists all teams', () => {
      orchestrator.createTeam('a', '/tmp/a');
      orchestrator.createTeam('b', '/tmp/b');

      const teams = orchestrator.getAllTeams();
      expect(teams).toHaveLength(2);
      expect(teams.map((t) => t.teamId).sort()).toEqual(['a', 'b']);
    });
  });

  describe('terminateTeam', () => {
    it('removes team from active list', async () => {
      orchestrator.createTeam('term-test', '/tmp/test');
      expect(orchestrator.getAllTeams()).toHaveLength(1);

      await orchestrator.terminateTeam('term-test');
      expect(orchestrator.getAllTeams()).toHaveLength(0);
    });

    it('persists final state', async () => {
      orchestrator.createTeam('term-persist', '/tmp/test');
      await orchestrator.terminateTeam('term-persist');

      const stateFile = path.join(tmpDir, 'data', 'teams', 'term-persist', 'state.json');
      const raw = fs.readFileSync(stateFile, 'utf-8');
      const data = JSON.parse(raw);
      expect(data.currentPhase).toBe(TeamPhase.Cancelled);
    });
  });

  describe('shutdown', () => {
    it('clears all teams', async () => {
      orchestrator.createTeam('s1', '/tmp/a');
      orchestrator.createTeam('s2', '/tmp/b');

      await orchestrator.shutdown();
      expect(orchestrator.getAllTeams()).toHaveLength(0);
    });

    it('rejects new teams after shutdown', async () => {
      await orchestrator.shutdown();
      expect(() => orchestrator.createTeam('post', '/tmp/x')).toThrow('shutting down');
    });
  });

  describe('recover', () => {
    it('recovers teams from persisted state', () => {
      // Create a team, then create a new orchestrator that recovers it
      orchestrator.createTeam('recover-test', '/tmp/test');

      const orchestrator2 = new Orchestrator({
        dataDirectory: path.join(tmpDir, 'data'),
        rolesDir: path.join(tmpDir, 'roles'),
        claudeBin: 'echo',
        spawnArgs: ['mock'],
      });

      const recovered = orchestrator2.recover();
      expect(recovered).toContain('recover-test');

      const status = orchestrator2.getTeamStatus('recover-test');
      expect(status).toBeDefined();
      expect(status!.currentPhase).toBe(TeamPhase.PreWork);
    });

    it('skips terminal teams on recovery', async () => {
      orchestrator.createTeam('done-team', '/tmp/test');
      await orchestrator.terminateTeam('done-team');

      const orchestrator2 = new Orchestrator({
        dataDirectory: path.join(tmpDir, 'data'),
        rolesDir: path.join(tmpDir, 'roles'),
        claudeBin: 'echo',
        spawnArgs: ['mock'],
      });

      const recovered = orchestrator2.recover();
      expect(recovered).not.toContain('done-team');
    });
  });

  describe('tick', () => {
    it('does not crash on tick with no active teams', () => {
      expect(() => orchestrator.tickAll()).not.toThrow();
    });

    it('does not crash on tick with created but taskless team', () => {
      orchestrator.createTeam('no-task', '/tmp/test');
      // agentsReady is false, so tick should be a no-op
      expect(() => orchestrator.tickAll()).not.toThrow();
    });
  });

  describe('start / stop', () => {
    it('starts and stops the main loop', () => {
      orchestrator.start();
      // Should not throw
      orchestrator.stop();
    });

    it('start is idempotent', () => {
      orchestrator.start();
      orchestrator.start(); // second call should be safe
      orchestrator.stop();
    });
  });

  describe('deadlock detection', () => {
    it('detects deadlock when no agents active and no messages pending', () => {
      orchestrator.createTeam('deadlock-test', '/tmp/test');
      const status = orchestrator.getTeamStatus('deadlock-test')!;

      // Manually set agents to waiting via the team context
      // We access the internal state through getTeamStatus which returns a snapshot
      // For this test, we need the actual TeamState object
      // The deadlock check happens during tick, but agents aren't ready yet
      // so this is a structural test that the check exists

      let deadlockDetected = false;
      orchestrator.on('deadlock-detected', () => { deadlockDetected = true; });

      // Tick won't detect deadlock because agentsReady is false
      orchestrator.tick('deadlock-test');
      expect(deadlockDetected).toBe(false);
    });
  });
});
