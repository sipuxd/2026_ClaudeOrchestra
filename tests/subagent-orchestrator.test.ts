import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { TeamPhase } from '../src/state/team-state.js';
import { Role } from '../src/roles/role-types.js';
import { createMockQuery, type MockQueryControls } from './mocks/mock-sdk.js';

// We'll mock the SDK query function before importing SubagentOrchestrator
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: vi.fn(),
  };
});

// Import after mocking
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { SubagentOrchestrator } from '../src/subagent-orchestrator.js';

describe('SubagentOrchestrator', () => {
  let tmpDir: string;
  let projectDir: string;
  let rolesDir: string;
  let orchestrator: SubagentOrchestrator;
  let mockControls: MockQueryControls;

  beforeEach(() => {
    // Create temp directories
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-test-'));
    projectDir = path.join(tmpDir, 'project');
    rolesDir = path.join(tmpDir, 'roles');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(rolesDir, { recursive: true });

    // Create minimal role prompt files
    fs.writeFileSync(path.join(rolesDir, 'supervisor.claude.md'), '# Supervisor\nYou orchestrate the team.');
    fs.writeFileSync(path.join(rolesDir, 'worker.claude.md'), '# Worker\nYou execute coding tasks.');
    fs.writeFileSync(path.join(rolesDir, 'security.claude.md'), '# Security\nYou scan for security issues.');
    fs.writeFileSync(path.join(rolesDir, 'reviewer.claude.md'), '# Reviewer\nYou review code quality.');

    // Set up mock query
    const { mockQueryFn, controls } = createMockQuery();
    mockControls = controls;
    vi.mocked(sdkQuery).mockImplementation(mockQueryFn as any);

    orchestrator = new SubagentOrchestrator({
      dataDirectory: path.join(tmpDir, 'data'),
      rolesDir,
      maxConcurrentTeams: 3,
    });
  });

  afterEach(async () => {
    try {
      await orchestrator.shutdown();
    } catch {
      // Best effort cleanup
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // --- Team Creation ---

  describe('createTeam', () => {
    it('creates a team and emits team-created event', () => {
      const events: string[] = [];
      orchestrator.on('team-created', (teamId) => events.push(teamId));

      const state = orchestrator.createTeam('test-team', projectDir);

      expect(state.snapshot.teamId).toBe('test-team');
      expect(state.currentPhase).toBe(TeamPhase.PreWork);
      expect(events).toEqual(['test-team']);
    });

    it('throws if team already exists', () => {
      orchestrator.createTeam('test-team', projectDir);
      expect(() => orchestrator.createTeam('test-team', projectDir)).toThrow('already exists');
    });

    it('respects maxConcurrentTeams', () => {
      orchestrator.createTeam('t1', projectDir);
      orchestrator.createTeam('t2', path.join(tmpDir, 'p2'));
      orchestrator.createTeam('t3', path.join(tmpDir, 'p3'));
      expect(() => orchestrator.createTeam('t4', path.join(tmpDir, 'p4'))).toThrow('Maximum concurrent teams');
    });

    it('throws during shutdown', async () => {
      await orchestrator.shutdown();
      expect(() => orchestrator.createTeam('test-team', projectDir)).toThrow('shutting down');
    });
  });

  // --- Task Assignment ---

  describe('assignTask', () => {
    it('classifies simple tasks and emits task-classified', () => {
      orchestrator.createTeam('test-team', projectDir);

      const classifiedEvents: Array<{ teamId: string; complexity: string; count: number }> = [];
      orchestrator.on('task-classified', (teamId, complexity, agentCount) => {
        classifiedEvents.push({ teamId, complexity, count: agentCount });
      });

      orchestrator.assignTask('test-team', 'Create hello.txt');

      // Auto-complete the query
      mockControls.complete();

      expect(classifiedEvents).toHaveLength(1);
      expect(classifiedEvents[0].complexity).toBe('simple');
      expect(classifiedEvents[0].count).toBe(2);
    });

    it('classifies standard tasks', () => {
      orchestrator.createTeam('test-team', projectDir);

      const classifiedEvents: Array<{ complexity: string; count: number }> = [];
      orchestrator.on('task-classified', (_, complexity, count) => {
        classifiedEvents.push({ complexity, count });
      });

      orchestrator.assignTask('test-team', 'Implement user authentication with tests');
      mockControls.complete();

      expect(classifiedEvents[0].complexity).toBe('standard');
      expect(classifiedEvents[0].count).toBe(5);
    });

    it('emits task-assigned event', () => {
      orchestrator.createTeam('test-team', projectDir);

      const assigned: string[] = [];
      orchestrator.on('task-assigned', (_, desc) => assigned.push(desc));

      orchestrator.assignTask('test-team', 'Create hello.txt');
      mockControls.complete();

      expect(assigned).toEqual(['Create hello.txt']);
    });

    it('throws for non-existent team', () => {
      expect(() => orchestrator.assignTask('no-team', 'task')).toThrow('not found');
    });

    it('throws if team already has active task', () => {
      orchestrator.createTeam('test-team', projectDir);
      orchestrator.assignTask('test-team', 'Create hello.txt');
      expect(() => orchestrator.assignTask('test-team', 'Another task')).toThrow('already has an active task');
      mockControls.complete();
    });

    it('sets task complexity on state', () => {
      orchestrator.createTeam('test-team', projectDir);
      orchestrator.assignTask('test-team', 'Create hello.txt');
      mockControls.complete();

      const status = orchestrator.getTeamStatus('test-team');
      expect(status?.currentTask?.complexity).toBe('simple');
    });
  });

  // --- Agent Definition Building ---

  describe('agent definitions', () => {
    it('creates 2 agent definitions for simple tasks (Supervisor + Worker-1)', () => {
      orchestrator.createTeam('test-team', projectDir);
      orchestrator.assignTask('test-team', 'Create hello.txt');

      // Check what was passed to query()
      const opts = mockControls.options;
      const agents = opts.agents as Record<string, any>;

      expect(Object.keys(agents)).toContain('Supervisor');
      expect(Object.keys(agents)).toContain('Worker-1');
      expect(Object.keys(agents)).not.toContain('Worker-2');
      expect(Object.keys(agents)).not.toContain('Security');
      expect(Object.keys(agents)).not.toContain('Reviewer');

      mockControls.complete();
    });

    it('creates 5 agent definitions for standard tasks', () => {
      orchestrator.createTeam('test-team', projectDir);
      orchestrator.assignTask('test-team', 'Implement user authentication with tests');

      const opts = mockControls.options;
      const agents = opts.agents as Record<string, any>;

      expect(Object.keys(agents)).toContain('Supervisor');
      expect(Object.keys(agents)).toContain('Worker-1');
      expect(Object.keys(agents)).toContain('Worker-2');
      expect(Object.keys(agents)).toContain('Security');
      expect(Object.keys(agents)).toContain('Reviewer');

      mockControls.complete();
    });

    it('sets correct model for each subagent', () => {
      orchestrator.createTeam('test-team', projectDir);
      orchestrator.assignTask('test-team', 'Implement user authentication with tests');

      const agents = (mockControls.options.agents as Record<string, any>);

      // Default models: Worker=haiku, Supervisor=sonnet, Security=opus, Reviewer=sonnet
      expect(agents['Supervisor'].model).toBe('sonnet');
      expect(agents['Worker-1'].model).toBe('haiku');
      expect(agents['Worker-2'].model).toBe('haiku');
      expect(agents['Security'].model).toBe('opus');
      expect(agents['Reviewer'].model).toBe('sonnet');

      mockControls.complete();
    });

    it('applies disallowed tools from defaults', () => {
      orchestrator.createTeam('test-team', projectDir);
      orchestrator.assignTask('test-team', 'Implement user authentication with tests');

      const agents = (mockControls.options.agents as Record<string, any>);

      // Workers: no disallowed tools (full access)
      expect(agents['Worker-1'].disallowedTools).toBeUndefined();
      // Supervisor, Security, Reviewer: Write, Edit, Bash disallowed
      expect(agents['Supervisor'].disallowedTools).toEqual(['Write', 'Edit', 'Bash']);
      expect(agents['Security'].disallowedTools).toEqual(['Write', 'Edit', 'Bash']);
      expect(agents['Reviewer'].disallowedTools).toEqual(['Write', 'Edit', 'Bash']);

      mockControls.complete();
    });

    it('applies max turns per role', () => {
      orchestrator.createTeam('test-team', projectDir);
      orchestrator.assignTask('test-team', 'Implement user authentication with tests');

      const agents = (mockControls.options.agents as Record<string, any>);

      expect(agents['Supervisor'].maxTurns).toBe(30);
      expect(agents['Worker-1'].maxTurns).toBe(50);
      expect(agents['Security'].maxTurns).toBe(20);
      expect(agents['Reviewer'].maxTurns).toBe(20);

      mockControls.complete();
    });

    it('sets query-level options correctly', () => {
      orchestrator.createTeam('test-team', projectDir);
      orchestrator.assignTask('test-team', 'Create hello.txt');

      const opts = mockControls.options;
      expect(opts.agent).toBe('Supervisor');
      expect(opts.effort).toBe('high');
      expect(opts.permissionMode).toBe('bypassPermissions');
      expect(opts.allowDangerouslySkipPermissions).toBe(true);
      expect(opts.persistSession).toBe(false);

      mockControls.complete();
    });
  });

  // --- Model Override ---

  describe('model overrides', () => {
    it('respects custom model configuration', () => {
      const customOrchestrator = new SubagentOrchestrator({
        dataDirectory: path.join(tmpDir, 'data2'),
        rolesDir,
        models: {
          [Role.Worker]: 'claude-opus-4-6',
        },
      });

      customOrchestrator.createTeam('custom-team', projectDir);
      customOrchestrator.assignTask('custom-team', 'Create hello.txt');

      const agents = (mockControls.options.agents as Record<string, any>);
      expect(agents['Worker-1'].model).toBe('opus');

      mockControls.complete();
      customOrchestrator.shutdown();
    });
  });

  // --- Phase Tracking via Hooks ---

  describe('phase tracking', () => {
    it('tracks simple flow: PreWork → Work → Done', async () => {
      orchestrator.createTeam('test-team', projectDir);

      const transitions: Array<{ from: string; to: string; trigger: string }> = [];
      orchestrator.on('phase-transition', (_, from, to, trigger) => {
        transitions.push({ from, to, trigger });
      });

      orchestrator.assignTask('test-team', 'Create hello.txt');

      // Simulate Worker-1 subagent lifecycle
      await mockControls.simulateSubagentStart('Worker-1');
      await mockControls.simulateSubagentStop('Worker-1');

      // Complete the query
      mockControls.complete();

      // Wait for stream consumption
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have: PreWork → Work (Worker-1 started), then Work → Done (query completed)
      expect(transitions.some(t => t.to === TeamPhase.Work)).toBe(true);
      expect(transitions.some(t => t.to === TeamPhase.Done)).toBe(true);
    });

    it('tracks standard flow with Security, Worker, and Reviewer', async () => {
      orchestrator.createTeam('test-team', projectDir);

      const transitions: Array<{ from: string; to: string }> = [];
      orchestrator.on('phase-transition', (_, from, to) => {
        transitions.push({ from, to });
      });

      orchestrator.assignTask('test-team', 'Implement user authentication with tests');

      // Simulate standard workflow
      // 1. Security pre-scan (already in PreWork, no transition)
      await mockControls.simulateSubagentStart('Security');
      await mockControls.simulateSubagentStop('Security');

      // 2. Workers start → transition to Work
      await mockControls.simulateSubagentStart('Worker-1');
      await mockControls.simulateSubagentStart('Worker-2');
      await mockControls.simulateSubagentStop('Worker-1');
      await mockControls.simulateSubagentStop('Worker-2');

      // 3. Security sweep → transition to Handoff
      await mockControls.simulateSubagentStart('Security');
      await mockControls.simulateSubagentStop('Security');

      // 4. Reviewer → transition to Review
      await mockControls.simulateSubagentStart('Reviewer');
      await mockControls.simulateSubagentStop('Reviewer');

      // Complete
      mockControls.complete();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify phase flow
      const phases = transitions.map(t => t.to);
      expect(phases).toContain(TeamPhase.Work);
      expect(phases).toContain(TeamPhase.Handoff);
      expect(phases).toContain(TeamPhase.Review);
      expect(phases).toContain(TeamPhase.Done);
    });

    it('distinguishes Security pre-scan from post-work sweep', async () => {
      orchestrator.createTeam('test-team', projectDir);

      const transitions: Array<{ to: string; trigger: string }> = [];
      orchestrator.on('phase-transition', (_, _from, to, trigger) => {
        transitions.push({ to, trigger });
      });

      orchestrator.assignTask('test-team', 'Implement user authentication with tests');

      // First Security call → no phase transition (already in PreWork)
      await mockControls.simulateSubagentStart('Security');
      await mockControls.simulateSubagentStop('Security');

      // Worker
      await mockControls.simulateSubagentStart('Worker-1');
      await mockControls.simulateSubagentStop('Worker-1');

      // Second Security call → Handoff transition
      await mockControls.simulateSubagentStart('Security');
      await mockControls.simulateSubagentStop('Security');

      mockControls.complete();
      await new Promise(resolve => setTimeout(resolve, 50));

      const handoffTransition = transitions.find(t => t.to === TeamPhase.Handoff);
      expect(handoffTransition).toBeDefined();
      expect(handoffTransition?.trigger).toContain('sweep');
    });
  });

  // --- Task Completion ---

  describe('task completion', () => {
    it('emits task-complete on query completion', async () => {
      orchestrator.createTeam('test-team', projectDir);

      const completions: Array<{ phase: string; durationMs: number }> = [];
      orchestrator.on('task-complete', (_, phase, durationMs) => {
        completions.push({ phase, durationMs });
      });

      orchestrator.assignTask('test-team', 'Create hello.txt');

      // Simulate work
      await mockControls.simulateSubagentStart('Worker-1');
      await mockControls.simulateSubagentStop('Worker-1');

      mockControls.complete();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(completions).toHaveLength(1);
      expect(completions[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('transitions to Errored on stream error', async () => {
      orchestrator.createTeam('test-team', projectDir);

      const errors: Error[] = [];
      const transitions: Array<{ to: string }> = [];
      orchestrator.on('error', (_, err) => errors.push(err));
      orchestrator.on('phase-transition', (_, _from, to) => transitions.push({ to }));

      orchestrator.assignTask('test-team', 'Create hello.txt');

      mockControls.fail(new Error('SDK exploded'));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('SDK stream error');
      expect(transitions.some(t => t.to === TeamPhase.Errored)).toBe(true);
    });
  });

  // --- Query Status ---

  describe('getTeamStatus / getAllTeams', () => {
    it('returns team status', () => {
      orchestrator.createTeam('test-team', projectDir);
      const status = orchestrator.getTeamStatus('test-team');
      expect(status).toBeDefined();
      expect(status?.teamId).toBe('test-team');
    });

    it('returns undefined for non-existent team', () => {
      expect(orchestrator.getTeamStatus('nope')).toBeUndefined();
    });

    it('lists all teams', () => {
      orchestrator.createTeam('t1', projectDir);
      orchestrator.createTeam('t2', path.join(tmpDir, 'p2'));
      const teams = orchestrator.getAllTeams();
      expect(teams).toHaveLength(2);
    });
  });

  // --- Task Prompt ---

  describe('task prompts', () => {
    it('generates simple pipeline prompt', () => {
      orchestrator.createTeam('test-team', projectDir);
      orchestrator.assignTask('test-team', 'Create hello.txt');

      const callArgs = vi.mocked(sdkQuery).mock.calls[0][0];
      const prompt = callArgs.prompt as string;

      expect(prompt).toContain('PIPELINE: SIMPLE');
      expect(prompt).toContain('Worker-1');
      expect(prompt).not.toContain('Worker-2');
      // Simple prompt mentions "No Security" to clarify they're unavailable
      expect(prompt).toContain('No Security');
      expect(prompt).not.toContain('Invoke the Security agent');

      mockControls.complete();
    });

    it('generates standard pipeline prompt', () => {
      orchestrator.createTeam('test-team', projectDir);
      orchestrator.assignTask('test-team', 'Implement user authentication with tests');

      const callArgs = vi.mocked(sdkQuery).mock.calls[0][0];
      const prompt = callArgs.prompt as string;

      expect(prompt).toContain('PIPELINE: STANDARD');
      expect(prompt).toContain('Worker-1');
      expect(prompt).toContain('Worker-2');
      expect(prompt).toContain('Security');
      expect(prompt).toContain('Reviewer');

      mockControls.complete();
    });
  });

  // --- Shutdown ---

  describe('shutdown', () => {
    it('closes active queries on shutdown', async () => {
      orchestrator.createTeam('test-team', projectDir);
      orchestrator.assignTask('test-team', 'Create hello.txt');

      await orchestrator.shutdown();

      // Query should have been closed — no hanging promises
      const status = orchestrator.getTeamStatus('test-team');
      expect(status).toBeUndefined(); // teams cleared on shutdown
    });

    it('emits shutdown event', async () => {
      const events: string[] = [];
      orchestrator.on('shutdown', () => events.push('shutdown'));

      await orchestrator.shutdown();

      expect(events).toEqual(['shutdown']);
    });

    it('forceKillAll cleans up', () => {
      orchestrator.createTeam('test-team', projectDir);
      orchestrator.assignTask('test-team', 'Create hello.txt');

      orchestrator.forceKillAll();

      expect(orchestrator.getAllTeams()).toHaveLength(0);
    });
  });

  // --- Recovery ---

  describe('recover', () => {
    it('recovers teams from persisted state', () => {
      // Create a team and persist it
      orchestrator.createTeam('recov-team', projectDir);
      const status = orchestrator.getTeamStatus('recov-team');
      expect(status).toBeDefined();

      // Create a new orchestrator pointing at same data directory
      const orchestrator2 = new SubagentOrchestrator({
        dataDirectory: path.join(tmpDir, 'data'),
        rolesDir,
        maxConcurrentTeams: 3,
      });

      // Team not in memory yet
      expect(orchestrator2.getTeamStatus('recov-team')).toBeUndefined();

      // Recover
      const recovered = orchestrator2.recover();
      expect(recovered).toEqual(['recov-team']);
      expect(orchestrator2.getTeamStatus('recov-team')).toBeDefined();
      expect(orchestrator2.getTeamStatus('recov-team')!.teamName).toBe('recov-team');

      orchestrator2.forceKillAll();
    });

    it('skips terminal teams during recovery', async () => {
      orchestrator.createTeam('done-team', projectDir);
      orchestrator.assignTask('done-team', 'Create hello.txt');

      // Complete the query to move team to Done
      mockControls.complete();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Create a new orchestrator
      const orchestrator2 = new SubagentOrchestrator({
        dataDirectory: path.join(tmpDir, 'data'),
        rolesDir,
        maxConcurrentTeams: 3,
      });

      const recovered = orchestrator2.recover();
      expect(recovered).toEqual([]); // Done teams are skipped

      orchestrator2.forceKillAll();
    });

    it('returns empty array when no teams exist', () => {
      const recovered = orchestrator.recover();
      expect(recovered).toEqual([]);
    });
  });

  // --- Config defaults ---

  describe('config defaults', () => {
    it('handles undefined config values without crashing', () => {
      // Simulates what happens when index.ts passes undefined dataDirectory
      const orch = new SubagentOrchestrator({
        dataDirectory: undefined as any,
        rolesDir,
      });
      // Should use default './data' and not crash
      expect(() => orch.getAllTeams()).not.toThrow();
      orch.forceKillAll();
    });
  });

  // --- Start / Stop compatibility ---

  describe('start / stop (no-ops)', () => {
    it('start() is a no-op', () => {
      expect(() => orchestrator.start()).not.toThrow();
    });

    it('stop() is a no-op', () => {
      expect(() => orchestrator.stop()).not.toThrow();
    });
  });
});
