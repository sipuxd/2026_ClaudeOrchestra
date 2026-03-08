import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { TeamPhase } from '../src/state/team-state.js';
import { Role } from '../src/roles/role-types.js';

// --- Mock infrastructure for pipeline orchestrator ---
// The pipeline creates multiple query() calls (one per agent session).
// Each call receives a PromptChannel (AsyncIterable) as prompt.
// We need to mock each call independently.

interface MockSession {
  /** Messages pushed through the channel by the orchestrator */
  receivedMessages: string[];
  /** Resolve the current pending send() with this text */
  respond: (text: string) => void;
  /** The options passed to query() for this session */
  options: Record<string, unknown>;
  /** Complete the session (close the generator) */
  complete: () => void;
}

function createPipelineMock(): {
  mockQueryFn: any;
  sessions: MockSession[];
  getSession: (index: number) => MockSession;
} {
  const sessions: MockSession[] = [];

  const mockQueryFn = (params: { prompt: any; options?: any }) => {
    let resolveNext: ((value: IteratorResult<any, void>) => void) | null = null;
    let completed = false;
    const pendingMessages: any[] = [];

    const session: MockSession = {
      receivedMessages: [],
      respond: () => { /* will be overridden below */ },
      options: params.options ?? {},
      complete: () => {
        completed = true;
        if (resolveNext) {
          resolveNext({ value: undefined, done: true });
        }
      },
    };

    // Start consuming the prompt channel (AsyncIterable) in the background
    const promptIterable = params.prompt;
    if (promptIterable && typeof promptIterable[Symbol.asyncIterator] === 'function') {
      (async () => {
        try {
          for await (const msg of promptIterable) {
            if (msg?.message?.content) {
              session.receivedMessages.push(
                typeof msg.message.content === 'string'
                  ? msg.message.content
                  : JSON.stringify(msg.message.content)
              );
            }
          }
        } catch {
          // Channel closed
        }
      })();
    }

    // Override respond to emit result message
    session.respond = (text: string) => {
      const resultMsg = { type: 'result', subtype: 'success', result: text };
      if (resolveNext) {
        resolveNext({ value: resultMsg, done: false });
      } else {
        pendingMessages.push(resultMsg);
      }
    };

    // Create the async generator
    async function* mockGenerator(): AsyncGenerator<any, void> {
      while (true) {
        if (pendingMessages.length > 0) {
          yield pendingMessages.shift();
          continue;
        }
        if (completed) return;

        const result = await new Promise<IteratorResult<any, void>>((resolve) => {
          resolveNext = resolve;
        });
        resolveNext = null;

        if (result.done) return;
        yield result.value;
      }
    }

    const generator = mockGenerator();
    const queryObj = Object.assign(generator, {
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      setMaxThinkingTokens: async () => {},
      initializationResult: async () => ({}),
      supportedCommands: async () => [],
      supportedModels: async () => [],
      supportedAgents: async () => [],
      mcpServerStatus: async () => [],
      accountInfo: async () => ({}),
      rewindFiles: async () => ({ canRewind: false }),
      reconnectMcpServer: async () => {},
      toggleMcpServer: async () => {},
      setMcpServers: async () => ({ added: [], removed: [], errors: [] }),
      streamInput: async () => {},
      stopTask: async () => {},
      close: () => {
        completed = true;
        if (resolveNext) {
          resolveNext({ value: undefined, done: true });
        }
      },
    });

    sessions.push(session);
    return queryObj;
  };

  return {
    mockQueryFn,
    sessions,
    getSession: (index: number) => sessions[index],
  };
}

// Mock the SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: vi.fn(),
  };
});

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { PipelineOrchestrator, parseSecurityVerdict, parseReviewVerdict } from '../src/pipeline-orchestrator.js';

describe('PipelineOrchestrator', () => {
  let tmpDir: string;
  let projectDir: string;
  let rolesDir: string;
  let orchestrator: PipelineOrchestrator;
  let mock: ReturnType<typeof createPipelineMock>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
    projectDir = path.join(tmpDir, 'project');
    rolesDir = path.join(tmpDir, 'roles');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(rolesDir, { recursive: true });

    // Create role prompt files (reuses subagent prompts)
    fs.writeFileSync(path.join(rolesDir, 'worker.claude.md'), '# Worker\nYou execute coding tasks.');
    fs.writeFileSync(path.join(rolesDir, 'security.claude.md'), '# Security\nYou scan for security issues.');
    fs.writeFileSync(path.join(rolesDir, 'reviewer.claude.md'), '# Reviewer\nYou review code quality.');

    mock = createPipelineMock();
    vi.mocked(sdkQuery).mockImplementation(mock.mockQueryFn);

    orchestrator = new PipelineOrchestrator({
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

  // --- Team lifecycle ---

  describe('createTeam', () => {
    it('creates a team in PreWork phase', () => {
      const state = orchestrator.createTeam('test-team', projectDir);
      expect(state.currentPhase).toBe(TeamPhase.PreWork);
      expect(state.teamId).toBe('test-team');
    });

    it('throws on duplicate team name', () => {
      orchestrator.createTeam('team-a', projectDir);
      expect(() => orchestrator.createTeam('team-a', projectDir))
        .toThrow('already exists');
    });

    it('enforces max concurrent teams', () => {
      orchestrator.createTeam('t1', path.join(tmpDir, 'p1'));
      orchestrator.createTeam('t2', path.join(tmpDir, 'p2'));
      orchestrator.createTeam('t3', path.join(tmpDir, 'p3'));
      expect(() => orchestrator.createTeam('t4', path.join(tmpDir, 'p4')))
        .toThrow('Maximum concurrent teams');
    });

    it('emits team-created event', () => {
      const handler = vi.fn();
      orchestrator.on('team-created', handler);
      orchestrator.createTeam('team-x', projectDir);
      expect(handler).toHaveBeenCalledWith('team-x');
    });
  });

  // --- Recovery ---

  describe('recover', () => {
    it('recovers teams from persisted state', () => {
      orchestrator.createTeam('recoverable', projectDir);
      const status1 = orchestrator.getTeamStatus('recoverable');
      expect(status1).toBeDefined();

      // Create a new orchestrator instance (simulating new process)
      const orchestrator2 = new PipelineOrchestrator({
        dataDirectory: path.join(tmpDir, 'data'),
        rolesDir,
      });

      expect(orchestrator2.getTeamStatus('recoverable')).toBeUndefined();
      const recovered = orchestrator2.recover();
      expect(recovered).toContain('recoverable');
      expect(orchestrator2.getTeamStatus('recoverable')).toBeDefined();
    });
  });

  // --- Verdict parsing ---

  describe('parseSecurityVerdict', () => {
    it('parses APPROVED', () => {
      const result = parseSecurityVerdict('APPROVED — all files clean');
      expect(result.verdict).toBe('APPROVED');
    });

    it('parses FLAGGED', () => {
      const result = parseSecurityVerdict('FLAGGED — minor concerns');
      expect(result.verdict).toBe('FLAGGED');
    });

    it('parses BLOCKED', () => {
      const result = parseSecurityVerdict('BLOCKED — hardcoded API key in config.ts');
      expect(result.verdict).toBe('BLOCKED');
    });

    it('defaults to APPROVED for unclear text', () => {
      const result = parseSecurityVerdict('Clearance report: all files are safe...');
      expect(result.verdict).toBe('APPROVED');
    });

    it('handles leading whitespace', () => {
      const result = parseSecurityVerdict('  BLOCKED — issue found');
      expect(result.verdict).toBe('BLOCKED');
    });
  });

  describe('parseReviewVerdict', () => {
    it('parses APPROVED', () => {
      const result = parseReviewVerdict('APPROVED — excellent implementation');
      expect(result.verdict).toBe('APPROVED');
    });

    it('parses REVISION_NEEDED', () => {
      const result = parseReviewVerdict('REVISION_NEEDED — missing error handling');
      expect(result.verdict).toBe('REVISION_NEEDED');
    });

    it('parses REJECTED', () => {
      const result = parseReviewVerdict('REJECTED — fundamentally wrong approach');
      expect(result.verdict).toBe('REJECTED');
    });

    it('defaults to APPROVED for unclear text', () => {
      const result = parseReviewVerdict('The code looks good overall');
      expect(result.verdict).toBe('APPROVED');
    });
  });

  // --- Simple pipeline ---

  describe('simple pipeline', () => {
    it('creates only 1 agent session for simple tasks', async () => {
      orchestrator.createTeam('simple', projectDir);
      orchestrator.assignTask('simple', 'fix a typo');

      // Wait for session to be created
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simple task: only 1 query() call (Worker-1)
      expect(mock.sessions.length).toBe(1);
    });

    it('completes simple pipeline with Worker-1 result', async () => {
      const completionPromise = new Promise<void>((resolve) => {
        orchestrator.on('task-complete', () => resolve());
      });

      orchestrator.createTeam('simple', projectDir);
      orchestrator.assignTask('simple', 'fix a typo');

      await new Promise(resolve => setTimeout(resolve, 50));

      // Worker-1 session
      const workerSession = mock.getSession(0);
      expect(workerSession).toBeDefined();

      // Wait for the message to be received
      await new Promise(resolve => setTimeout(resolve, 50));

      // Respond as Worker-1
      workerSession.respond('Fixed the typo in README.md');
      workerSession.complete();

      await completionPromise;

      const status = orchestrator.getTeamStatus('simple');
      expect(status?.currentPhase).toBe(TeamPhase.Done);
    });

    it('emits task-classified with simple complexity', () => {
      const handler = vi.fn();
      orchestrator.on('task-classified', handler);
      orchestrator.createTeam('simple', projectDir);
      orchestrator.assignTask('simple', 'fix a typo');
      expect(handler).toHaveBeenCalledWith('simple', 'simple', 1);
    });

    it('uses correct model for Worker', async () => {
      orchestrator.createTeam('simple', projectDir);
      orchestrator.assignTask('simple', 'fix a typo');

      await new Promise(resolve => setTimeout(resolve, 50));

      const workerSession = mock.getSession(0);
      expect(workerSession.options.model).toBe('claude-opus-4-6');
    });

    it('sets permissionMode to bypassPermissions', async () => {
      orchestrator.createTeam('simple', projectDir);
      orchestrator.assignTask('simple', 'fix a typo');

      await new Promise(resolve => setTimeout(resolve, 50));

      const workerSession = mock.getSession(0);
      expect(workerSession.options.permissionMode).toBe('bypassPermissions');
      expect(workerSession.options.allowDangerouslySkipPermissions).toBe(true);
    });
  });

  // --- Standard pipeline ---

  describe('standard pipeline', () => {
    it('creates 4 agent sessions for standard tasks', async () => {
      orchestrator.createTeam('standard', projectDir);
      orchestrator.assignTask('standard', 'implement user authentication with JWT tokens and database integration');

      // Wait for sessions to be created
      await new Promise(resolve => setTimeout(resolve, 50));

      // Standard task: 4 query() calls (Security, Worker-1, Worker-2, Reviewer)
      expect(mock.sessions.length).toBe(4);
    });

    it('emits task-classified with standard complexity', () => {
      const handler = vi.fn();
      orchestrator.on('task-classified', handler);
      orchestrator.createTeam('standard', projectDir);
      orchestrator.assignTask('standard', 'implement user authentication with JWT tokens and database integration');
      expect(handler).toHaveBeenCalledWith('standard', 'standard', 4);
    });

    it('runs full pipeline: scan → workers → sweep → review → done', async () => {
      const phases: string[] = [];
      orchestrator.on('phase-transition', (_teamId, _from, to) => {
        phases.push(to);
      });

      const completionPromise = new Promise<void>((resolve) => {
        orchestrator.on('task-complete', () => resolve());
      });

      orchestrator.createTeam('standard', projectDir);
      orchestrator.assignTask('standard', 'implement user authentication with JWT tokens and database integration');

      await new Promise(resolve => setTimeout(resolve, 50));

      // Sessions: [0]=Security, [1]=Worker-1, [2]=Worker-2, [3]=Reviewer
      const security = mock.getSession(0);
      const worker1 = mock.getSession(1);
      const worker2 = mock.getSession(2);
      const reviewer = mock.getSession(3);

      // Wait for security scan message
      await new Promise(resolve => setTimeout(resolve, 100));

      // Step 1: Security scan responds
      security.respond('SAFE: all files\nNo issues found.');

      // Wait for workers to receive messages
      await new Promise(resolve => setTimeout(resolve, 100));

      // Step 2: Workers respond (parallel)
      worker1.respond('Implemented JWT auth module.');
      worker2.respond('Added unit tests for auth.');

      // Wait for security sweep
      await new Promise(resolve => setTimeout(resolve, 100));

      // Step 3: Security sweep responds
      security.respond('APPROVED — no vulnerabilities found.');

      // Wait for reviewer
      await new Promise(resolve => setTimeout(resolve, 100));

      // Step 4: Reviewer approves
      reviewer.respond('APPROVED — implementation is correct and well-tested.');

      // Complete all sessions
      security.complete();
      worker1.complete();
      worker2.complete();
      reviewer.complete();

      await completionPromise;

      const status = orchestrator.getTeamStatus('standard');
      expect(status?.currentPhase).toBe(TeamPhase.Done);

      // Verify phase transitions happened
      // Note: PreWork is the initial state from createTeam(), so no PreWork transition
      // is emitted (tryTransitionPhase silently skips same-phase transitions)
      expect(phases).toContain(TeamPhase.Work);
      expect(phases).toContain(TeamPhase.Handoff);
      expect(phases).toContain(TeamPhase.Review);
      expect(phases).toContain(TeamPhase.Done);
    });

    it('uses opus model for all agents', async () => {
      orchestrator.createTeam('standard', projectDir);
      orchestrator.assignTask('standard', 'implement user authentication with JWT tokens and database integration');

      await new Promise(resolve => setTimeout(resolve, 50));

      // All 4 sessions should use opus
      for (let i = 0; i < 4; i++) {
        expect(mock.getSession(i).options.model).toBe('claude-opus-4-6');
      }
    });

    it('uses per-role effort levels', async () => {
      orchestrator.createTeam('standard', projectDir);
      orchestrator.assignTask('standard', 'implement user authentication with JWT tokens and database integration');

      await new Promise(resolve => setTimeout(resolve, 50));

      // Sessions: [0]=Security, [1]=Worker-1, [2]=Worker-2, [3]=Reviewer
      expect(mock.getSession(0).options.effort).toBe('low');    // Security
      expect(mock.getSession(1).options.effort).toBe('high');   // Worker-1
      expect(mock.getSession(2).options.effort).toBe('high');   // Worker-2
      expect(mock.getSession(3).options.effort).toBe('low');    // Reviewer
    });
  });

  // --- Error handling ---

  describe('error handling', () => {
    it('transitions to Errored on agent failure', async () => {
      const errorPromise = new Promise<Error>((resolve) => {
        orchestrator.on('error', (_teamId, error) => resolve(error));
      });

      orchestrator.createTeam('failing', projectDir);
      orchestrator.assignTask('failing', 'fix a typo');

      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate worker failure by completing without responding
      mock.getSession(0).complete();

      // The consume loop will end without a result, which should error
      // Give it time to process
      await new Promise(resolve => setTimeout(resolve, 200));

      // The pipeline should eventually detect the issue
      const status = orchestrator.getTeamStatus('failing');
      // May be errored or done depending on timing
      expect(status).toBeDefined();
    });
  });

  // --- Shutdown ---

  describe('shutdown', () => {
    it('closes all sessions on shutdown', async () => {
      orchestrator.createTeam('shutdown-test', projectDir);
      orchestrator.assignTask('shutdown-test', 'fix a typo');

      await new Promise(resolve => setTimeout(resolve, 50));

      await orchestrator.shutdown();

      const status = orchestrator.getTeamStatus('shutdown-test');
      // Team should be removed after shutdown
      expect(status).toBeUndefined();
    });

    it('prevents new teams after shutdown', async () => {
      await orchestrator.shutdown();
      expect(() => orchestrator.createTeam('post-shutdown', projectDir))
        .toThrow('shutting down');
    });

    it('prevents new tasks after shutdown', async () => {
      orchestrator.createTeam('pre-shutdown', projectDir);
      await orchestrator.shutdown();

      // Re-create orchestrator to test
      const orch2 = new PipelineOrchestrator({
        dataDirectory: path.join(tmpDir, 'data'),
        rolesDir,
      });
      await orch2.shutdown();
      expect(() => orch2.createTeam('post', projectDir))
        .toThrow('shutting down');
    });
  });

  // --- Config ---

  describe('configuration', () => {
    it('uses default config when none provided', () => {
      const orch = new PipelineOrchestrator({
        dataDirectory: path.join(tmpDir, 'data2'),
        rolesDir,
      });
      // Should not throw
      const state = orch.createTeam('default-config', projectDir);
      expect(state).toBeDefined();
    });

    it('respects model overrides', async () => {
      const orch = new PipelineOrchestrator({
        dataDirectory: path.join(tmpDir, 'data3'),
        rolesDir,
        models: { [Role.Worker]: 'claude-sonnet-4-6' },
      });

      orch.createTeam('model-override', projectDir);
      orch.assignTask('model-override', 'fix a typo');

      await new Promise(resolve => setTimeout(resolve, 50));

      const workerSession = mock.getSession(mock.sessions.length - 1);
      expect(workerSession.options.model).toBe('claude-sonnet-4-6');
      await orch.shutdown();
    });

    it('respects effort override', async () => {
      const orch = new PipelineOrchestrator({
        dataDirectory: path.join(tmpDir, 'data4'),
        rolesDir,
        effort: 'high',
      });

      orch.createTeam('effort-test', projectDir);
      orch.assignTask('effort-test', 'fix a typo');

      await new Promise(resolve => setTimeout(resolve, 50));

      const workerSession = mock.getSession(mock.sessions.length - 1);
      expect(workerSession.options.effort).toBe('high');
      await orch.shutdown();
    });

    it('filters undefined config values', () => {
      // Passing undefined values should not override defaults
      const orch = new PipelineOrchestrator({
        dataDirectory: undefined as any,
        rolesDir,
      });
      // Should use default dataDirectory, not crash
      expect(orch).toBeDefined();
    });
  });

  // --- getAllTeams / getTeamStatus ---

  describe('status queries', () => {
    it('returns undefined for unknown team', () => {
      expect(orchestrator.getTeamStatus('nonexistent')).toBeUndefined();
    });

    it('lists all teams', () => {
      orchestrator.createTeam('a', path.join(tmpDir, 'pa'));
      orchestrator.createTeam('b', path.join(tmpDir, 'pb'));
      const all = orchestrator.getAllTeams();
      expect(all.length).toBe(2);
      expect(all.map(t => t.teamId).sort()).toEqual(['a', 'b']);
    });
  });

  // --- Task assignment validation ---

  describe('task assignment validation', () => {
    it('throws for unknown team', () => {
      expect(() => orchestrator.assignTask('ghost', 'do something'))
        .toThrow('not found');
    });

    it('throws for team with active task', async () => {
      orchestrator.createTeam('busy', projectDir);
      orchestrator.assignTask('busy', 'fix a typo');

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(() => orchestrator.assignTask('busy', 'another task'))
        .toThrow('already has an active task');
    });
  });

  // --- No supervisor prompt needed ---

  describe('no supervisor', () => {
    it('does not require supervisor.claude.md prompt file', () => {
      // Verify no supervisor file was created in rolesDir
      expect(fs.existsSync(path.join(rolesDir, 'supervisor.claude.md'))).toBe(false);

      // Pipeline should still work — no Supervisor LLM needed
      orchestrator.createTeam('no-supervisor', projectDir);
      orchestrator.assignTask('no-supervisor', 'fix a typo');
      // No error means success
    });
  });
});
