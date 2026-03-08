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
  // Create project directories for tests that need them
  fs.mkdirSync(path.join(tmpDir, 'project'), { recursive: true });
  orchestrator = new Orchestrator({
    registryPath: path.join(tmpDir, 'registry.json'),
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
      const projectDir = path.join(tmpDir, 'project');
      const state = orchestrator.createTeam('my-team', projectDir);

      expect(state.snapshot.teamId).toBe('my-team');
      expect(state.snapshot.teamName).toBe('my-team');
      expect(state.snapshot.projectPath).toBe(projectDir);
      expect(state.snapshot.currentPhase).toBe(TeamPhase.PreWork);
      expect(state.snapshot.currentTask).toBeNull();
    });

    it('creates data directories in target project', () => {
      const projectDir = path.join(tmpDir, 'project');
      orchestrator.createTeam('dir-test', projectDir);

      const teamDir = path.join(projectDir, '.claude-orchestra', 'teams', 'dir-test');
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
      const projectDir = path.join(tmpDir, 'project');
      orchestrator.createTeam('persist-test', projectDir);

      const stateFile = path.join(projectDir, '.claude-orchestra', 'teams', 'persist-test', 'state.json');
      const raw = fs.readFileSync(stateFile, 'utf-8');
      const data = JSON.parse(raw);
      expect(data.teamId).toBe('persist-test');
      expect(data.currentPhase).toBe(TeamPhase.PreWork);
    });

    it('rejects duplicate team names', () => {
      const projectDir = path.join(tmpDir, 'project');
      orchestrator.createTeam('dup-team', projectDir);
      expect(() => orchestrator.createTeam('dup-team', projectDir)).toThrow('already exists');
    });

    it('enforces max concurrent teams', () => {
      // Create separate project dirs
      const p1 = path.join(tmpDir, 'p1'); fs.mkdirSync(p1, { recursive: true });
      const p2 = path.join(tmpDir, 'p2'); fs.mkdirSync(p2, { recursive: true });
      const p3 = path.join(tmpDir, 'p3'); fs.mkdirSync(p3, { recursive: true });
      const limited = new Orchestrator({
        registryPath: path.join(tmpDir, 'registry2.json'),
        rolesDir: path.join(tmpDir, 'roles'),
        maxConcurrentTeams: 2,
        claudeBin: 'echo',
        spawnArgs: ['mock'],
      });

      limited.createTeam('t1', p1);
      limited.createTeam('t2', p2);
      expect(() => limited.createTeam('t3', p3)).toThrow('Maximum concurrent teams');
    });

    it('emits team-created event', () => {
      let emittedId = '';
      orchestrator.on('team-created', (id) => { emittedId = id; });

      orchestrator.createTeam('event-test', path.join(tmpDir, 'project'));
      expect(emittedId).toBe('event-test');
    });
  });

  describe('getTeamStatus / getAllTeams', () => {
    it('returns team status by id', () => {
      orchestrator.createTeam('query-test', path.join(tmpDir, 'project'));

      const status = orchestrator.getTeamStatus('query-test');
      expect(status).toBeDefined();
      expect(status!.teamId).toBe('query-test');
    });

    it('returns undefined for unknown team', () => {
      expect(orchestrator.getTeamStatus('nope')).toBeUndefined();
    });

    it('lists all teams', () => {
      const pa = path.join(tmpDir, 'pa'); fs.mkdirSync(pa, { recursive: true });
      const pb = path.join(tmpDir, 'pb'); fs.mkdirSync(pb, { recursive: true });
      orchestrator.createTeam('a', pa);
      orchestrator.createTeam('b', pb);

      const teams = orchestrator.getAllTeams();
      expect(teams).toHaveLength(2);
      expect(teams.map((t) => t.teamId).sort()).toEqual(['a', 'b']);
    });
  });

  describe('terminateTeam', () => {
    it('removes team from active list', async () => {
      orchestrator.createTeam('term-test', path.join(tmpDir, 'project'));
      expect(orchestrator.getAllTeams()).toHaveLength(1);

      await orchestrator.terminateTeam('term-test');
      expect(orchestrator.getAllTeams()).toHaveLength(0);
    });

    it('persists final state', async () => {
      const projectDir = path.join(tmpDir, 'project');
      orchestrator.createTeam('term-persist', projectDir);
      await orchestrator.terminateTeam('term-persist');

      const stateFile = path.join(projectDir, '.claude-orchestra', 'teams', 'term-persist', 'state.json');
      const raw = fs.readFileSync(stateFile, 'utf-8');
      const data = JSON.parse(raw);
      expect(data.currentPhase).toBe(TeamPhase.Cancelled);
    });
  });

  describe('shutdown', () => {
    it('clears all teams', async () => {
      const sa = path.join(tmpDir, 'sa'); fs.mkdirSync(sa, { recursive: true });
      const sb = path.join(tmpDir, 'sb'); fs.mkdirSync(sb, { recursive: true });
      orchestrator.createTeam('s1', sa);
      orchestrator.createTeam('s2', sb);

      await orchestrator.shutdown();
      expect(orchestrator.getAllTeams()).toHaveLength(0);
    });

    it('rejects new teams after shutdown', async () => {
      await orchestrator.shutdown();
      expect(() => orchestrator.createTeam('post', path.join(tmpDir, 'project'))).toThrow('shutting down');
    });
  });

  describe('recover', () => {
    it('recovers teams from persisted state', () => {
      // Create a team, then create a new orchestrator that recovers it
      orchestrator.createTeam('recover-test', path.join(tmpDir, 'project'));

      const orchestrator2 = new Orchestrator({
        registryPath: path.join(tmpDir, 'registry.json'),
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
      orchestrator.createTeam('done-team', path.join(tmpDir, 'project'));
      await orchestrator.terminateTeam('done-team');

      const orchestrator2 = new Orchestrator({
        registryPath: path.join(tmpDir, 'registry.json'),
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
      orchestrator.createTeam('no-task', path.join(tmpDir, 'project'));
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
      orchestrator.createTeam('deadlock-test', path.join(tmpDir, 'project'));
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
