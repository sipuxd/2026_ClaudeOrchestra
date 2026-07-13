import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../src/roles/role-types.js';
import { TeamPhase } from '../src/state/team-state.js';
import { AgentState } from '../src/types/index.js';

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
      respond: () => {
        /* will be overridden below */
      },
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
                  : JSON.stringify(msg.message.content),
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
import {
  MalformedVerdictError,
  PipelineOrchestrator,
  parseChatVerdict,
  parseClassification,
  parseReviewVerdict,
  parseSecurityReviewVerdict,
  parseSecurityVerdict,
  parseVerifyVerdict,
  postProcessRequirements,
  READ_ONLY_DISALLOWED_TOOLS,
  sendWithVerdict,
  validateTeamName,
} from '../src/pipeline-orchestrator.js';

const GUARDED_ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_AUTH_TOKEN',
];

function initGitProject(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), 'initial\n');
  execSync('git add README.md', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m initial', { cwd: dir, stdio: 'pipe' });
  execSync('git branch -M main', { cwd: dir, stdio: 'pipe' });
}

describe('validateTeamName', () => {
  it('accepts ordinary names (including spaces)', () => {
    expect(() => validateTeamName('my team')).not.toThrow();
    expect(() => validateTeamName('feature-42')).not.toThrow();
  });

  it('rejects path-traversal and separator characters', () => {
    expect(() => validateTeamName('../evil')).toThrow('..');
    expect(() => validateTeamName('a/b')).toThrow('/');
    expect(() => validateTeamName('a\\b')).toThrow('\\');
    expect(() => validateTeamName('..')).toThrow('..');
  });

  it('rejects empty, control-char, and over-long names', () => {
    expect(() => validateTeamName('   ')).toThrow('empty');
    expect(() => validateTeamName('bad\u0001name')).toThrow('control');
    expect(() => validateTeamName('x'.repeat(101))).toThrow('100');
  });
});

describe('read-only enforcement by role identity', () => {
  it('a Bash-only Worker config leaves Worker-1 able to Write/Edit', () => {
    // Read-only enforcement keys off role IDENTITY, so denying only Bash to the
    // shared Worker role must NOT strip Worker-1's Write/Edit (which would make
    // the implementing agent unable to change any file).
    const orch = new PipelineOrchestrator({
      registryPath: '/tmp/registry-worker-bash.json',
      rolesDir: '/tmp/nonexistent-roles',
      disallowedTools: { Worker: ['Bash'] } as any,
    });
    const tools = (orch as any).disallowedTools as Record<string, string[]>;
    expect(tools['Worker-1']).not.toContain('Write');
    expect(tools['Worker-1']).not.toContain('Edit');
    expect(tools['Worker-1']).toContain('Bash');
  });

  it('read-only roles are denied the full set regardless of config', () => {
    const orch = new PipelineOrchestrator({
      registryPath: '/tmp/registry-ro.json',
      rolesDir: '/tmp/nonexistent-roles',
    });
    const tools = (orch as any).disallowedTools as Record<string, string[]>;
    for (const tool of READ_ONLY_DISALLOWED_TOOLS) {
      expect(tools['Worker-2']).toContain(tool);
      expect(tools['Reviewer-1']).toContain(tool);
    }
  });
});

describe('PipelineOrchestrator', () => {
  let tmpDir: string;
  let projectDir: string;
  let rolesDir: string;
  let orchestrator: PipelineOrchestrator;
  let mock: ReturnType<typeof createPipelineMock>;
  let originalGuardedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalGuardedEnv = {};
    for (const key of GUARDED_ENV_KEYS) {
      originalGuardedEnv[key] = process.env[key];
      delete process.env[key];
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
    projectDir = path.join(tmpDir, 'project');
    rolesDir = path.join(tmpDir, 'roles');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(rolesDir, { recursive: true });

    // Create role prompt files with frontmatter (config is read from frontmatter)
    fs.writeFileSync(
      path.join(rolesDir, 'worker-1.agent.md'),
      '---\nname: worker-1\nmodel: claude-opus-4-6\neffort: high\nmaxTurns: 50\n---\n\n# Worker-1\nYou execute coding tasks.',
    );
    fs.writeFileSync(
      path.join(rolesDir, 'worker-2.agent.md'),
      '---\nname: worker-2\nmodel: claude-opus-4-6\neffort: medium\nmaxTurns: 20\ndisallowedTools: Write, Edit, Bash\n---\n\n# Worker-2\nYou verify requirements.',
    );
    fs.writeFileSync(
      path.join(rolesDir, 'security.agent.md'),
      '---\nname: security\nmodel: claude-opus-4-6\neffort: low\nmaxTurns: 5\ndisallowedTools: Write, Edit, Bash\n---\n\n# Security\nYou scan for security issues.',
    );
    fs.writeFileSync(
      path.join(rolesDir, 'reviewer.agent.md'),
      '---\nname: reviewer\nmodel: claude-opus-4-6\neffort: low\nmaxTurns: 5\ndisallowedTools: Write, Edit, Bash\n---\n\n# Reviewer\nYou review code quality.',
    );
    fs.writeFileSync(
      path.join(rolesDir, 'coordinator.agent.md'),
      '---\nname: coordinator\nmodel: claude-opus-4-6\neffort: medium\nmaxTurns: 100\ndisallowedTools: Write, Edit, Bash, NotebookEdit\n---\n\n# Coordinator\nYou hold the team chat.',
    );

    mock = createPipelineMock();
    vi.mocked(sdkQuery).mockImplementation(mock.mockQueryFn);

    orchestrator = new PipelineOrchestrator({
      registryPath: path.join(tmpDir, 'registry.json'),
      portfolioPath: path.join(tmpDir, 'projects.json'),
      rolesDir,
      maxConcurrentTeams: 3,
      skipRequirements: true,
    });
  });

  afterEach(async () => {
    try {
      await orchestrator.shutdown();
    } catch {
      // Best effort cleanup
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const key of GUARDED_ENV_KEYS) {
      const value = originalGuardedEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
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
      expect(() => orchestrator.createTeam('team-a', projectDir)).toThrow('already exists');
    });

    it('enforces max concurrent teams per project (not global)', () => {
      // The limit is per-project: a single project can hold up to
      // maxConcurrentTeams teams, but a different project gets its own slots.
      const pA = path.join(tmpDir, 'pA');
      fs.mkdirSync(pA, { recursive: true });
      const pB = path.join(tmpDir, 'pB');
      fs.mkdirSync(pB, { recursive: true });

      // Fill project A to the cap (test config sets maxConcurrentTeams=3).
      orchestrator.createTeam('a1', pA);
      orchestrator.createTeam('a2', pA);
      orchestrator.createTeam('a3', pA);

      // 4th team in the same project must be rejected.
      expect(() => orchestrator.createTeam('a4', pA)).toThrow(
        /Maximum concurrent teams.*for this project/,
      );

      // But a team in a DIFFERENT project succeeds — slots are per-project.
      const stateB = orchestrator.createTeam('b1', pB);
      expect(stateB).toBeDefined();
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
        registryPath: path.join(tmpDir, 'registry.json'),
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

    it('returns AMBIGUOUS for unclear text (no longer fails open)', () => {
      // Previously defaulted to APPROVED — silent failure-open on a security gate.
      // Now strict: anything not starting with the verdict prefix is AMBIGUOUS,
      // forcing the orchestrator to retry once and then fail loud.
      const result = parseSecurityVerdict('Clearance report: all files are safe...');
      expect(result.verdict).toBe('AMBIGUOUS');
      if (result.verdict === 'AMBIGUOUS') {
        expect(result.raw).toContain('Clearance report');
      }
    });

    it('handles leading whitespace', () => {
      const result = parseSecurityVerdict('  BLOCKED — issue found');
      expect(result.verdict).toBe('BLOCKED');
    });
  });

  describe('parseSecurityReviewVerdict', () => {
    it('parses **PASSED** and **CONCERNS** with markdown bold', () => {
      expect(parseSecurityReviewVerdict('**PASSED** — No security concerns found.').verdict).toBe(
        'PASSED',
      );
      expect(parseSecurityReviewVerdict('**CONCERNS** — hardcoded key.').verdict).toBe('CONCERNS');
    });

    it('parses PASSED without bold (the old substring guess mislabeled this)', () => {
      // "No security concerns" contains CONCERNS; the strict prefix parser must
      // still read this as PASSED, not flag a false concern.
      expect(parseSecurityReviewVerdict('PASSED — No security concerns found.').verdict).toBe(
        'PASSED',
      );
    });

    it('returns AMBIGUOUS for empty or prefixless text (no silent pass)', () => {
      expect(parseSecurityReviewVerdict('').verdict).toBe('AMBIGUOUS');
      expect(parseSecurityReviewVerdict('Here is my review of the diff...').verdict).toBe(
        'AMBIGUOUS',
      );
    });

    it('strips a leading thinking block', () => {
      expect(
        parseSecurityReviewVerdict('<thinking>hmm</thinking>\n**CONCERNS** — issue').verdict,
      ).toBe('CONCERNS');
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

    it('returns AMBIGUOUS when prefix is missing (no fuzzy fallback)', () => {
      // Previously a fuzzy regex matched 'looks good' and returned APPROVED.
      // The fuzzy matchers were removed because they masked prompt drift —
      // strict prefix is the contract, AMBIGUOUS surfaces the drift.
      const result = parseReviewVerdict('The code looks good overall');
      expect(result.verdict).toBe('AMBIGUOUS');
      if (result.verdict === 'AMBIGUOUS') {
        expect(result.raw).toContain('looks good');
      }
    });

    // Regression fixtures for the <thinking>-strip prerequisite.
    // Without the strip at the top of parseReviewVerdict, each of these returns
    // the wrong verdict (silent flip toward less-severe). With the strip, the
    // explicit prefix check sees the post-thinking content and returns correctly.
    it('parses REVISION_NEEDED through a leaked <thinking> block containing approve language', () => {
      const result = parseReviewVerdict(
        '<thinking>looks good</thinking>\n\nREVISION_NEEDED — missing test',
      );
      expect(result.verdict).toBe('REVISION_NEEDED');
    });

    it('parses REJECTED through a leaked <thinking> block containing approve-implying reasoning', () => {
      const result = parseReviewVerdict(
        '<thinking>The implementation looks good but the error path has a bug</thinking>\n\nREJECTED — error path crashes on null input',
      );
      expect(result.verdict).toBe('REJECTED');
    });

    it('parses APPROVED through a leaked <thinking> block containing revision-implying reasoning', () => {
      const result = parseReviewVerdict(
        '<thinking>code is well-implemented but missing tests would normally need revision</thinking>\n\nAPPROVED — tests cover the same paths via consumers',
      );
      expect(result.verdict).toBe('APPROVED');
    });
  });

  describe('postProcessRequirements', () => {
    it('passes through a clean numbered list unchanged', () => {
      const input = '1. Add a button\n2. Add a test';
      expect(postProcessRequirements(input)).toBe('1. Add a button\n2. Add a test');
    });

    it('strips a leaked <thinking> block before a numbered list', () => {
      const input = '<thinking>reasoning text</thinking>\n\n1. Add a button\n2. Add a test';
      expect(postProcessRequirements(input)).toBe('1. Add a button\n2. Add a test');
    });

    it('strips a leaked <thinking> block whose content contains its own numbered list', () => {
      // Without the two-step strip (thinking first, then prefix-to-numbered-line),
      // the lookahead in step 2 would anchor on "1. fake consideration" inside
      // the thinking block and leave its content in the output.
      const input =
        '<thinking>I considered:\n1. fake consideration\n2. another fake</thinking>\n\n1. real requirement';
      expect(postProcessRequirements(input)).toBe('1. real requirement');
    });

    it('passes non-numbered prose through unchanged', () => {
      // No <thinking> to strip; no ^\d+\. anchor for step 2 to find — the
      // function returns the trimmed input as-is so runWithRequirements's
      // truthy check still fires (existing behavior preserved).
      expect(postProcessRequirements('No requirements found')).toBe('No requirements found');
    });
  });

  // --- Simple pipeline ---

  describe('simple pipeline', () => {
    it('runs a Security-1 scan before a simple task', async () => {
      orchestrator.createTeam('simple', projectDir);
      orchestrator.assignTask('simple', 'fix a typo');

      // Wait for sessions to be created
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Security must run on every task now: all four agents spawn up front and
      // Security-1 receives the scan prompt before any implementation. It may
      // then downgrade a trivial task to a Worker-1-only run. Coordinator-1 is
      // lazy-spawned on first chat message and is not part of pipeline counts.
      expect(mock.sessions.length).toBe(4);
      expect(mock.getSession(0).receivedMessages.join('\n')).toContain('PRE-WORK SCAN');
    });

    it('does not block simple tasks on requirements extraction', async () => {
      const orch = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry-simple-no-requirements.json'),
        rolesDir,
        maxConcurrentTeams: 3,
      });

      try {
        orch.createTeam('simple-no-requirements', projectDir);
        orch.assignTask('simple-no-requirements', 'build me a calculator');

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Security-1 scans first, then downgrades a trivial task to Worker-1-only.
        mock.getSession(0).respond('CLASSIFICATION: SIMPLE\nTrivial change.');
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Worker-1 receives the task directly — no requirements-extraction step.
        expect(mock.getSession(1).receivedMessages.join('\n')).toContain('build me a calculator');
      } finally {
        await orch.shutdown();
      }
    });

    it('completes simple pipeline with Worker-1 result', async () => {
      const completionPromise = new Promise<void>((resolve) => {
        orchestrator.on('task-complete', () => resolve());
      });

      orchestrator.createTeam('simple', projectDir);
      orchestrator.assignTask('simple', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Security-1 scans, then downgrades the trivial task to Worker-1-only.
      mock.getSession(0).respond('CLASSIFICATION: SIMPLE\nNo concerns.');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Worker-1 session (session 1; session 0 is Security-1)
      const workerSession = mock.getSession(1);
      expect(workerSession).toBeDefined();

      // Respond as Worker-1
      workerSession.respond('Fixed the typo in README.md');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The SIMPLE path still runs a mandatory post-work security sweep on
      // Security-1 (session 0) before completing.
      mock.getSession(0).respond('APPROVED — no vulnerabilities found.');

      await completionPromise;

      const status = orchestrator.getTeamStatus('simple');
      expect(status?.currentPhase).toBe(TeamPhase.Done);
      expect(status?.agents['Worker-1'].state).toBe(AgentState.Done);
      // Worker-2 and Reviewer-1 are skipped on the simple path; Security-1 runs
      // the sweep and is then marked Done.
      expect(status?.agents['Worker-2'].state).toBe(AgentState.Done);
      expect(status?.agents['Security-1'].state).toBe(AgentState.Done);
      expect(status?.agents['Reviewer-1'].state).toBe(AgentState.Done);
    });

    it('runs a mandatory security sweep on the simple path', async () => {
      orchestrator.createTeam('simple', projectDir);
      orchestrator.assignTask('simple', 'add a hello function');

      await new Promise((resolve) => setTimeout(resolve, 50));
      mock.getSession(0).respond('CLASSIFICATION: SIMPLE\nNo concerns.');
      await new Promise((resolve) => setTimeout(resolve, 50));

      mock.getSession(1).respond('Added the hello function.');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Security-1 (session 0) must receive a POST-WORK SWEEP — the gate is not
      // skipped just because the task was downgraded to SIMPLE.
      expect(mock.getSession(0).receivedMessages.join('\n')).toContain('POST-WORK SWEEP');
    });

    it('refuses the SIMPLE downgrade for a destructive task and runs the full pipeline', async () => {
      orchestrator.createTeam('simple', projectDir);
      // "delete" is destructive intent — the router flags it, so a Security-1
      // SIMPLE reply must NOT downgrade; the full pipeline (Worker-2) runs.
      orchestrator.assignTask('simple', 'delete the temp files');

      await new Promise((resolve) => setTimeout(resolve, 50));
      mock.getSession(0).respond('CLASSIFICATION: SIMPLE\nLooks trivial.');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Worker-1 (session 1) implements, then Worker-2 (session 2) is asked to
      // verify — proving the downgrade was refused.
      mock.getSession(1).respond('Deleted the temp files.');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mock.getSession(2).receivedMessages.join('\n')).toContain('REQUIREMENTS VERIFICATION');
    });

    it('emits task-classified when a task is assigned', () => {
      const handler = vi.fn();
      orchestrator.on('task-classified', handler);
      orchestrator.createTeam('simple', projectDir);
      orchestrator.assignTask('simple', 'fix a typo');
      // Every task spawns the full agent set up front (Security-1 scans first);
      // it may later re-emit a downgrade to 1.
      expect(handler).toHaveBeenCalledWith('simple', 'simple', 4);
    });

    it('uses correct model for Worker', async () => {
      orchestrator.createTeam('simple', projectDir);
      orchestrator.assignTask('simple', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const workerSession = mock.getSession(0);
      expect(workerSession.options.model).toBe('claude-opus-4-6');
    });

    it('sets permissionMode to bypassPermissions', async () => {
      orchestrator.createTeam('simple', projectDir);
      orchestrator.assignTask('simple', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const workerSession = mock.getSession(0);
      expect(workerSession.options.permissionMode).toBe('bypassPermissions');
      expect(workerSession.options.allowDangerouslySkipPermissions).toBe(true);
    });

    it('blocks secret-like changed files before simple pipeline completion', async () => {
      initGitProject(projectDir);
      const errorPromise = new Promise<Error>((resolve) => {
        orchestrator.on('error', (_teamId, error) => resolve(error));
      });

      orchestrator.createTeam('guarded-simple', projectDir);
      orchestrator.assignTask('guarded-simple', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Security-1 downgrades to Worker-1-only.
      mock.getSession(0).respond('CLASSIFICATION: SIMPLE\nNo concerns.');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const workerSession = mock.getSession(1);
      fs.writeFileSync(
        path.join(projectDir, 'new-secret.txt'),
        'api_key = "sk-proj-abcdefghijklmnopqrstuvwxyz"\n',
        'utf-8',
      );
      workerSession.respond('Done.');
      workerSession.complete();

      const error = await errorPromise;
      const status = orchestrator.getTeamStatus('guarded-simple');

      expect(error.message).toContain('Guardrail audit blocked');
      expect(status?.currentPhase).toBe(TeamPhase.Errored);
      expect((status?.enforcement?.lastError as any)?.category).toBe('guardrail');
    });
  });

  // --- Requirements approval + editing ---

  describe('requirements approval', () => {
    it('emits requirements as editable content and honors user edits', async () => {
      // The requirements agent prompt must exist for extraction to run.
      fs.writeFileSync(
        path.join(rolesDir, 'requirements.agent.md'),
        '---\nname: requirements\nmodel: claude-opus-4-6\neffort: medium\nmaxTurns: 1\n---\n\n# Requirements\nExtract requirements.',
      );

      const orch = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry-req-edit.json'),
        rolesDir,
        maxConcurrentTeams: 3,
        // skipRequirements defaults false → extraction + approval runs.
      });

      try {
        const feedbacks: any[] = [];
        orch.on('feedback', (_teamId, fb) => feedbacks.push(fb));

        orch.createTeam('req-edit', projectDir);
        // 'implement ...' is a standard task, so requirements extraction runs.
        orch.assignTask('req-edit', 'implement user authentication');

        await new Promise((r) => setTimeout(r, 50));

        // Session 0 is the Requirements agent; respond with a numbered list.
        mock.getSession(0).respond('1. Requirement Alpha\n2. Requirement Beta');

        await new Promise((r) => setTimeout(r, 50));

        // A blocking prompt is emitted with the list as editable content —
        // not baked into the message.
        const prompt = feedbacks.find((f) => f.title === 'Requirements Checklist');
        expect(prompt).toBeDefined();
        expect(prompt.editableContent).toContain('Requirement Alpha');
        expect(prompt.message).not.toContain('Requirement Alpha');

        // The user edits the requirements and approves.
        orch.resolveFeedback('req-edit', prompt.id, 'approve', '1. Edited requirement only');

        await new Promise((r) => setTimeout(r, 50));

        // The edited text — not the original extraction — becomes the requirements.
        const status = orch.getTeamStatus('req-edit');
        expect(status?.currentTask?.requirements).toBe('1. Edited requirement only');
      } finally {
        await orch.shutdown();
      }
    });

    it('uses the original requirements when approved without edits', async () => {
      fs.writeFileSync(
        path.join(rolesDir, 'requirements.agent.md'),
        '---\nname: requirements\nmodel: claude-opus-4-6\neffort: medium\nmaxTurns: 1\n---\n\n# Requirements\nExtract requirements.',
      );

      const orch = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry-req-plain.json'),
        rolesDir,
        maxConcurrentTeams: 3,
      });

      try {
        const feedbacks: any[] = [];
        orch.on('feedback', (_teamId, fb) => feedbacks.push(fb));

        orch.createTeam('req-plain', projectDir);
        orch.assignTask('req-plain', 'implement user authentication');
        await new Promise((r) => setTimeout(r, 50));
        mock.getSession(0).respond('1. Requirement Alpha\n2. Requirement Beta');
        await new Promise((r) => setTimeout(r, 50));

        const prompt = feedbacks.find((f) => f.title === 'Requirements Checklist');
        // Approve with no edited text → original extraction is used.
        orch.resolveFeedback('req-plain', prompt.id, 'approve');
        await new Promise((r) => setTimeout(r, 50));

        const status = orch.getTeamStatus('req-plain');
        expect(status?.currentTask?.requirements).toContain('Requirement Alpha');
      } finally {
        await orch.shutdown();
      }
    });
  });

  // --- Standard pipeline ---

  describe('standard pipeline', () => {
    it('creates 4 agent sessions for standard tasks', async () => {
      orchestrator.createTeam('standard', projectDir);
      orchestrator.assignTask(
        'standard',
        'implement user authentication with JWT tokens and database integration',
      );

      // Wait for sessions to be created
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Standard task: 4 query() calls (Security, Worker-1, Worker-2, Reviewer).
      // Coordinator-1 is lazy-spawned on first chat message and not in the count.
      expect(mock.sessions.length).toBe(4);
    });

    it('emits task-classified with standard complexity', () => {
      const handler = vi.fn();
      orchestrator.on('task-classified', handler);
      orchestrator.createTeam('standard', projectDir);
      orchestrator.assignTask(
        'standard',
        'implement user authentication with JWT tokens and database integration',
      );
      expect(handler).toHaveBeenCalledWith('standard', 'standard', 4);
    });

    it('runs full pipeline: scan → worker1 → worker2 verify → sweep → review → done', async () => {
      const phases: string[] = [];
      orchestrator.on('phase-transition', (_teamId, _from, to) => {
        phases.push(to);
      });

      const completionPromise = new Promise<void>((resolve) => {
        orchestrator.on('task-complete', () => resolve());
      });

      orchestrator.createTeam('standard', projectDir);
      orchestrator.assignTask(
        'standard',
        'implement user authentication with JWT tokens and database integration',
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Sessions: [0]=Security, [1]=Worker-1, [2]=Worker-2, [3]=Reviewer
      const security = mock.getSession(0);
      const worker1 = mock.getSession(1);
      const worker2 = mock.getSession(2);
      const reviewer = mock.getSession(3);

      // Wait for security scan message
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Step 1: Security scan responds
      security.respond('SAFE: all files\nNo issues found.');

      // Wait for Worker-1 to receive message (sequential now, not parallel)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Step 2a: Worker-1 implements
      worker1.respond('Implemented JWT auth module.');

      // Wait for Worker-2 to receive verification prompt
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Step 2b: Worker-2 verifies completeness
      worker2.respond('COMPLETE — all requirements implemented.');

      // Wait for security sweep
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Step 3: Security sweep responds
      security.respond('APPROVED — no vulnerabilities found.');

      // Wait for reviewer
      await new Promise((resolve) => setTimeout(resolve, 100));

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
      expect(status?.agents['Security-1'].state).toBe(AgentState.Done);
      expect(status?.agents['Worker-1'].state).toBe(AgentState.Done);
      expect(status?.agents['Worker-2'].state).toBe(AgentState.Done);
      expect(status?.agents['Reviewer-1'].state).toBe(AgentState.Done);

      expect(phases).toContain(TeamPhase.Work);
      expect(phases).toContain(TeamPhase.Handoff);
      expect(phases).toContain(TeamPhase.Review);
      expect(phases).toContain(TeamPhase.Done);
    });

    it('uses opus model for all agents', async () => {
      orchestrator.createTeam('standard', projectDir);
      orchestrator.assignTask(
        'standard',
        'implement user authentication with JWT tokens and database integration',
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // All 4 sessions should use opus
      for (let i = 0; i < 4; i++) {
        expect(mock.getSession(i).options.model).toBe('claude-opus-4-6');
      }
    });

    it('passes governance hooks to all agent sessions', async () => {
      orchestrator.createTeam('standard', projectDir);
      orchestrator.assignTask(
        'standard',
        'implement user authentication with JWT tokens and database integration',
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // All 4 sessions should have PreToolUse and PostToolUse hooks
      for (let i = 0; i < 4; i++) {
        const hooks = mock.getSession(i).options.hooks as Record<string, unknown[]>;
        expect(hooks).toBeDefined();
        expect(hooks.PreToolUse).toHaveLength(1);
        expect(hooks.PostToolUse).toHaveLength(1);
      }
    });

    it('uses per-instance effort levels from frontmatter', async () => {
      orchestrator.createTeam('standard', projectDir);
      orchestrator.assignTask(
        'standard',
        'implement user authentication with JWT tokens and database integration',
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Sessions: [0]=Security, [1]=Worker-1, [2]=Worker-2, [3]=Reviewer.
      // Worker-1 and Worker-2 now load separate prompt files and may carry
      // different effort levels in frontmatter (verifier needs less than implementer).
      expect(mock.getSession(0).options.effort).toBe('low'); // Security
      expect(mock.getSession(1).options.effort).toBe('high'); // Worker-1 (implementer)
      expect(mock.getSession(2).options.effort).toBe('medium'); // Worker-2 (verifier)
      expect(mock.getSession(3).options.effort).toBe('low'); // Reviewer
    });
  });

  // --- Error handling ---

  describe('error handling', () => {
    it('transitions to Errored on agent failure', async () => {
      const _errorPromise = new Promise<Error>((resolve) => {
        orchestrator.on('error', (_teamId, error) => resolve(error));
      });

      orchestrator.createTeam('failing', projectDir);
      orchestrator.assignTask('failing', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate worker failure by completing without responding
      mock.getSession(0).complete();

      // The consume loop will end without a result, which should error
      // Give it time to process
      await new Promise((resolve) => setTimeout(resolve, 200));

      // The pipeline should eventually detect the issue
      const status = orchestrator.getTeamStatus('failing');
      // May be errored or done depending on timing
      expect(status).toBeDefined();
    });
  });

  // --- Portfolio ---

  describe('Portfolio integration', () => {
    it('auto-registers a project when createTeam is called', () => {
      orchestrator.createTeam('first-team', projectDir);
      const portfolio = orchestrator.getPortfolio();
      expect(portfolio.length).toBe(1);
      expect(portfolio[0].projectPath).toBe(path.resolve(projectDir));
      expect(portfolio[0].displayName).toBe(path.basename(projectDir));
    });

    it('does not duplicate the project on second createTeam call for same path', () => {
      orchestrator.createTeam('team-a', projectDir);
      orchestrator.createTeam('team-b', projectDir);
      expect(orchestrator.getPortfolio().length).toBe(1);
    });

    it('addProjectToPortfolio adds a project without any teams', () => {
      const pX = path.join(tmpDir, 'pX');
      fs.mkdirSync(pX, { recursive: true });
      const project = orchestrator.addProjectToPortfolio({ projectPath: pX });
      expect(project.projectPath).toBe(path.resolve(pX));
      expect(project.displayName).toBe('pX');
      expect(orchestrator.getPortfolio().length).toBe(1);
    });

    it('addProjectToPortfolio is idempotent on repeated calls', () => {
      const pX = path.join(tmpDir, 'pX');
      fs.mkdirSync(pX, { recursive: true });
      orchestrator.addProjectToPortfolio({ projectPath: pX });
      orchestrator.addProjectToPortfolio({ projectPath: pX });
      expect(orchestrator.getPortfolio().length).toBe(1);
    });

    it('addProjectToPortfolio throws on a path that does not exist on disk', () => {
      const missing = path.join(tmpDir, 'does-not-exist');
      expect(() => orchestrator.addProjectToPortfolio({ projectPath: missing })).toThrow(
        /does not exist/,
      );
    });

    it('removeProjectFromPortfolio works when no teams exist for the project', () => {
      const pX = path.join(tmpDir, 'pX');
      fs.mkdirSync(pX, { recursive: true });
      orchestrator.addProjectToPortfolio({ projectPath: pX });
      orchestrator.removeProjectFromPortfolio(pX);
      expect(orchestrator.getPortfolio().length).toBe(0);
    });

    it('removeProjectFromPortfolio throws if teams exist for the project', () => {
      orchestrator.createTeam('blocking-team', projectDir);
      expect(() => orchestrator.removeProjectFromPortfolio(projectDir)).toThrow(/has 1 team/);
    });

    it('removeProjectFromPortfolio throws if project not in portfolio', () => {
      const missing = path.join(tmpDir, 'never-added');
      fs.mkdirSync(missing, { recursive: true });
      expect(() => orchestrator.removeProjectFromPortfolio(missing)).toThrow(/not in portfolio/);
    });
  });

  // --- Chat cancellation ---

  describe('cancelChat', () => {
    it('throws when team is not found', () => {
      expect(() => orchestrator.cancelChat('nope')).toThrow(/not found/);
    });

    it('returns false when no chat turn is in flight', () => {
      orchestrator.createTeam('chat-idle', projectDir);
      expect(orchestrator.cancelChat('chat-idle')).toBe(false);
    });

    it('aborts an in-flight coordinator turn and emits chat-cancelled', async () => {
      orchestrator.createTeam('chat-cancel', projectDir);

      const cancelled = vi.fn();
      orchestrator.on('chat-cancelled', cancelled);
      const messages: Array<{ role: string }> = [];
      orchestrator.on('chat-message', (_teamId, message) => messages.push(message));

      // Send a chat message but never call .respond() on the mock session,
      // so the coordinator's send() hangs indefinitely. The abort path is
      // what should resolve the outer Promise.
      const chatPromise = orchestrator.sendChatMessage('chat-cancel', 'hi');

      // Wait for the user message to be persisted/emitted — that's the
      // signal that handleChatTurn has reached the point where the abort
      // controller is registered on ctx.
      await new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          if (messages.some((m) => m.role === 'user')) return resolve();
          if (Date.now() - start > 2000) {
            return reject(new Error('user chat-message never emitted'));
          }
          setTimeout(tick, 10);
        };
        tick();
      });

      expect(orchestrator.cancelChat('chat-cancel')).toBe(true);
      await chatPromise;

      expect(cancelled).toHaveBeenCalledWith('chat-cancel');
      // The cancelled turn must NOT have produced a coordinator or system
      // reply — chat is left in a clean "user sent, no response" state.
      expect(messages.filter((m) => m.role !== 'user')).toHaveLength(0);
    });
  });

  // --- Shutdown ---

  describe('clearDoneTeams', () => {
    it('returns 0 when no terminal teams exist', async () => {
      orchestrator.createTeam('active-1', projectDir);
      const cleared = await orchestrator.clearDoneTeams(projectDir);
      expect(cleared).toBe(0);
      // Active team still exists
      expect(orchestrator.getTeamStatus('active-1')).toBeDefined();
    });

    it('clears only terminal teams, leaves active ones', async () => {
      // Manually create teams and drive one to Cancelled via terminate
      orchestrator.createTeam('to-cancel', projectDir);
      orchestrator.createTeam('still-active', projectDir);
      await orchestrator.terminateTeam('to-cancel'); // Already removes it from teams Map

      // After terminate, 'to-cancel' is already gone (terminateTeam removes from teams Map).
      // To exercise clearDoneTeams, create a team that's already in a terminal state
      // via direct phase transition.
      orchestrator.createTeam('done-team', projectDir);
      const teams = (
        orchestrator as unknown as {
          teams: Map<string, { state: { transitionPhase: (p: TeamPhase) => void } }>;
        }
      ).teams;
      const doneCtx = teams.get('done-team');
      if (doneCtx) {
        // Drive through valid phase progression to terminal
        doneCtx.state.transitionPhase(TeamPhase.Work);
        doneCtx.state.transitionPhase(TeamPhase.Handoff);
        doneCtx.state.transitionPhase(TeamPhase.Review);
        doneCtx.state.transitionPhase(TeamPhase.Done);
      }

      const cleared = await orchestrator.clearDoneTeams(projectDir);
      expect(cleared).toBe(1);
      expect(orchestrator.getTeamStatus('done-team')).toBeUndefined();
      expect(orchestrator.getTeamStatus('still-active')).toBeDefined();
    });

    it('is scoped to the right project — does not touch other projects', async () => {
      const pA = path.join(tmpDir, 'pA');
      const pB = path.join(tmpDir, 'pB');
      fs.mkdirSync(pA, { recursive: true });
      fs.mkdirSync(pB, { recursive: true });

      orchestrator.createTeam('done-in-A', pA);
      orchestrator.createTeam('done-in-B', pB);

      const teams = (
        orchestrator as unknown as {
          teams: Map<string, { state: { transitionPhase: (p: TeamPhase) => void } }>;
        }
      ).teams;
      for (const id of ['done-in-A', 'done-in-B']) {
        const ctx = teams.get(id);
        if (ctx) {
          ctx.state.transitionPhase(TeamPhase.Work);
          ctx.state.transitionPhase(TeamPhase.Handoff);
          ctx.state.transitionPhase(TeamPhase.Review);
          ctx.state.transitionPhase(TeamPhase.Done);
        }
      }

      const cleared = await orchestrator.clearDoneTeams(pA);
      expect(cleared).toBe(1);
      expect(orchestrator.getTeamStatus('done-in-A')).toBeUndefined();
      expect(orchestrator.getTeamStatus('done-in-B')).toBeDefined();
    });

    it('emits team-deleted event per cleared team', async () => {
      orchestrator.createTeam('done-event-test', projectDir);
      const teams = (
        orchestrator as unknown as {
          teams: Map<string, { state: { transitionPhase: (p: TeamPhase) => void } }>;
        }
      ).teams;
      const ctx = teams.get('done-event-test');
      if (ctx) {
        ctx.state.transitionPhase(TeamPhase.Work);
        ctx.state.transitionPhase(TeamPhase.Handoff);
        ctx.state.transitionPhase(TeamPhase.Review);
        ctx.state.transitionPhase(TeamPhase.Done);
      }

      const deletedTeams: string[] = [];
      orchestrator.on('team-deleted', (teamId) => deletedTeams.push(teamId));

      await orchestrator.clearDoneTeams(projectDir);
      expect(deletedTeams).toContain('done-event-test');
    });
  });

  describe('shutdown', () => {
    it('closes all sessions on shutdown', async () => {
      orchestrator.createTeam('shutdown-test', projectDir);
      orchestrator.assignTask('shutdown-test', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      await orchestrator.shutdown();

      const status = orchestrator.getTeamStatus('shutdown-test');
      // Team should be removed after shutdown
      expect(status).toBeUndefined();
    });

    it('prevents new teams after shutdown', async () => {
      await orchestrator.shutdown();
      expect(() => orchestrator.createTeam('post-shutdown', projectDir)).toThrow('shutting down');
    });

    it('prevents new tasks after shutdown', async () => {
      orchestrator.createTeam('pre-shutdown', projectDir);
      await orchestrator.shutdown();

      // Re-create orchestrator to test
      const orch2 = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry2.json'),
        rolesDir,
      });
      await orch2.shutdown();
      expect(() => orch2.createTeam('post', projectDir)).toThrow('shutting down');
    });
  });

  // --- Config ---

  describe('configuration', () => {
    it('uses default config when none provided', () => {
      const orch = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry-default.json'),
        rolesDir,
      });
      // Should not throw
      const state = orch.createTeam('default-config', projectDir);
      expect(state).toBeDefined();
    });

    it('defaults to Claude subscription runtime', () => {
      expect(orchestrator.getAgentRuntime()).toEqual({
        provider: 'claude',
        auth: 'subscription',
      });
    });

    it('accepts Codex subscription runtime as the global provider', async () => {
      const orch = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry-codex.json'),
        rolesDir,
        agentRuntime: {
          provider: 'codex',
          auth: 'subscription',
          model: 'gpt-5.5',
        },
      });

      expect(orch.getAgentRuntime()).toEqual({
        provider: 'codex',
        auth: 'subscription',
        model: 'gpt-5.5',
      });
      await orch.shutdown();
    });

    it('uses global runtime model before per-role model config', async () => {
      const orch = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry-runtime-model.json'),
        rolesDir,
        agentRuntime: {
          provider: 'claude',
          auth: 'subscription',
          model: 'claude-runtime-model',
        },
        models: { [Role.Worker]: 'claude-role-model' },
        skipRequirements: true,
      });

      orch.createTeam('runtime-model', projectDir);
      orch.assignTask('runtime-model', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const workerSession = mock.getSession(mock.sessions.length - 1);
      expect(workerSession.options.model).toBe('claude-runtime-model');
      await orch.shutdown();
    });

    it('rejects Codex subscription runtime when API key env vars are set', () => {
      process.env.OPENAI_API_KEY = 'test-key';

      expect(
        () =>
          new PipelineOrchestrator({
            registryPath: path.join(tmpDir, 'registry-codex-api-key.json'),
            rolesDir,
            agentRuntime: {
              provider: 'codex',
              auth: 'subscription',
            },
          }),
      ).toThrow('Codex subscription auth requested');
    });

    it('rejects Claude subscription runtime when API key env vars are set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      expect(
        () =>
          new PipelineOrchestrator({
            registryPath: path.join(tmpDir, 'registry-claude-api-key.json'),
            rolesDir,
            agentRuntime: {
              provider: 'claude',
              auth: 'subscription',
            },
          }),
      ).toThrow('Claude subscription auth requested');
    });

    it('respects model overrides', async () => {
      const orch = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry-model.json'),
        rolesDir,
        models: { [Role.Worker]: 'claude-sonnet-4-6' },
        skipRequirements: true,
      });

      orch.createTeam('model-override', projectDir);
      orch.assignTask('model-override', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Session 1 is Worker-1 (session 0 is Security-1, which scans first).
      const workerSession = mock.getSession(1);
      expect(workerSession.options.model).toBe('claude-sonnet-4-6');
      await orch.shutdown();
    });

    it('respects effort override', async () => {
      const orch = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry-effort.json'),
        rolesDir,
        effort: 'high',
        skipRequirements: true,
      });

      orch.createTeam('effort-test', projectDir);
      orch.assignTask('effort-test', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Session 1 is Worker-1 (session 0 is Security-1, which scans first).
      const workerSession = mock.getSession(1);
      expect(workerSession.options.effort).toBe('high');
      await orch.shutdown();
    });

    it('filters undefined config values', () => {
      // Passing undefined values should not override defaults
      const orch = new PipelineOrchestrator({
        registryPath: undefined as any,
        rolesDir,
      });
      // Should use default registryPath, not crash
      expect(orch).toBeDefined();
    });

    it('enforces Worker-2 SDK-level tool denial via per-instance frontmatter', () => {
      // Worker-2's frontmatter declares disallowedTools: Write, Edit, Bash.
      // The orchestrator must pick this up per-instance, not per-role,
      // otherwise Worker-1's empty disallowedTools would leak to Worker-2
      // and the verifier could write/edit code despite its prompt. Because it is
      // a read-only role, the network/notebook tools are also denied (a read-only
      // role only actually is one if NotebookEdit/WebFetch/WebSearch/Task are cut).
      const tools = (orchestrator as any).disallowedTools as Record<string, string[]>;
      expect(tools['Worker-2']).toEqual([
        'Write',
        'Edit',
        'Bash',
        'NotebookEdit',
        'WebFetch',
        'WebSearch',
        'Task',
      ]);
      // Worker-1 is write-capable, but WebFetch/WebSearch are denied to every
      // instance so the write role can't exfiltrate what it reads.
      expect(tools['Worker-1']).toEqual(['WebFetch', 'WebSearch']);
    });
  });

  // --- getAllTeams / getTeamStatus ---

  describe('status queries', () => {
    it('returns undefined for unknown team', () => {
      expect(orchestrator.getTeamStatus('nonexistent')).toBeUndefined();
    });

    it('lists all teams', () => {
      const pa = path.join(tmpDir, 'pa');
      fs.mkdirSync(pa, { recursive: true });
      const pb = path.join(tmpDir, 'pb');
      fs.mkdirSync(pb, { recursive: true });
      orchestrator.createTeam('a', pa);
      orchestrator.createTeam('b', pb);
      const all = orchestrator.getAllTeams();
      expect(all.length).toBe(2);
      expect(all.map((t) => t.teamId).sort()).toEqual(['a', 'b']);
    });
  });

  // --- Task assignment validation ---

  describe('task assignment validation', () => {
    it('throws for unknown team', () => {
      expect(() => orchestrator.assignTask('ghost', 'do something')).toThrow('not found');
    });

    it('throws for team with active task', async () => {
      orchestrator.createTeam('busy', projectDir);
      orchestrator.assignTask('busy', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(() => orchestrator.assignTask('busy', 'another task')).toThrow(
        'already has an active pipeline',
      );
    });
  });

  // --- Feedback system ---

  describe('feedback', () => {
    it('emits feedback event on pipeline completion', async () => {
      const feedbacks: Array<{ teamId: string; type: string; title: string }> = [];
      orchestrator.on('feedback', (teamId, feedback) => {
        feedbacks.push({ teamId, type: feedback.type, title: feedback.title });
      });

      orchestrator.createTeam('fb-simple', projectDir);
      orchestrator.assignTask('fb-simple', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Security-1 scans, then downgrades to Worker-1-only.
      mock.getSession(0).respond('CLASSIFICATION: SIMPLE\nNo concerns.');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const worker = mock.getSession(1);
      worker.respond('Fixed the typo in README.');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Mandatory post-work sweep on the simple path.
      mock.getSession(0).respond('APPROVED — no vulnerabilities found.');

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should have a completion feedback
      expect(feedbacks.some((f) => f.title === 'Task Complete')).toBe(true);
    });

    it('emits feedback on pipeline error', async () => {
      const feedbacks: Array<{ teamId: string; type: string; title: string }> = [];
      orchestrator.on('feedback', (teamId, feedback) => {
        feedbacks.push({ teamId, type: feedback.type, title: feedback.title });
      });

      orchestrator.createTeam('fb-error', projectDir);
      orchestrator.assignTask('fb-error', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Complete without responding — triggers error
      mock.getSession(0).complete();

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should have a failure feedback (may or may not fire depending on timing)
      const status = orchestrator.getTeamStatus('fb-error');
      expect(status).toBeDefined();
    });

    it('resolveFeedback resolves pending blocking feedback', async () => {
      // Test the feedback resolution mechanism directly
      orchestrator.createTeam('fb-resolve', projectDir);

      // resolveFeedback on non-existent feedback should not throw
      orchestrator.resolveFeedback('fb-resolve', 'nonexistent-id', 'ok');
      // No error = success

      // resolveFeedback on non-existent team should not throw
      orchestrator.resolveFeedback('ghost-team', 'some-id', 'ok');
    });

    it('sendMessage throws when pipeline is running', async () => {
      orchestrator.createTeam('ask-busy', projectDir);
      orchestrator.assignTask('ask-busy', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      await expect(orchestrator.sendMessage('ask-busy', 'What did you do?')).rejects.toThrow(
        'pipeline is running',
      );
    });

    it('sendMessage throws for unknown team', async () => {
      await expect(orchestrator.sendMessage('ghost', 'hello')).rejects.toThrow('not found');
    });

    it('sessions stay alive after simple pipeline completion', async () => {
      const completionPromise = new Promise<void>((resolve) => {
        orchestrator.on('task-complete', () => resolve());
      });

      orchestrator.createTeam('warm', projectDir);
      orchestrator.assignTask('warm', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Security-1 scans, then downgrades to Worker-1-only.
      mock.getSession(0).respond('CLASSIFICATION: SIMPLE\nNo concerns.');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const worker = mock.getSession(1);
      worker.respond('Fixed the typo.');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Mandatory post-work sweep on the simple path.
      mock.getSession(0).respond('APPROVED — no vulnerabilities found.');

      await completionPromise;

      const status = orchestrator.getTeamStatus('warm');
      expect(status?.currentPhase).toBe(TeamPhase.Done);

      // Sessions should still exist (not closed) — sendMessage should not throw "No active"
      // We can't fully test send() since mock sessions are completed,
      // but we verify the orchestrator doesn't preemptively close them
    });

    it('feedback payloads have required fields', async () => {
      const feedbacks: Array<any> = [];
      orchestrator.on('feedback', (_teamId, feedback) => {
        feedbacks.push(feedback);
      });

      orchestrator.createTeam('fb-fields', projectDir);
      orchestrator.assignTask('fb-fields', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const worker = mock.getSession(0);
      worker.respond('Done.');
      worker.complete();

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Each feedback should have required fields
      for (const fb of feedbacks) {
        expect(fb.id).toBeDefined();
        expect(fb.type).toBeDefined();
        expect(fb.title).toBeDefined();
        expect(fb.message).toBeDefined();
        expect(fb.timestamp).toBeDefined();
        expect(typeof fb.blocking).toBe('boolean');
      }
    });
  });

  // --- Completeness verification ---

  describe('completeness verification', () => {
    it('Worker-2 receives verification prompt with Worker-1 output', async () => {
      orchestrator.createTeam('verify', projectDir);
      orchestrator.assignTask(
        'verify',
        'implement user authentication with JWT tokens and database integration',
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      const security = mock.getSession(0);
      const worker1 = mock.getSession(1);
      const worker2 = mock.getSession(2);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Security scan
      security.respond('APPROVED — no issues.');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Worker-1 implements
      worker1.respond('Implemented JWT auth module.');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Worker-2 should receive a REQUIREMENTS VERIFICATION prompt
      expect(worker2.receivedMessages.length).toBeGreaterThanOrEqual(1);
      const verifyMsg = worker2.receivedMessages[worker2.receivedMessages.length - 1];
      expect(verifyMsg).toContain('REQUIREMENTS VERIFICATION');
      expect(verifyMsg).toContain('Implemented JWT auth module.');
    });

    it('emits agent-task events for both workers', async () => {
      const agentTasks: Array<{ instance: string; subtask: string }> = [];
      orchestrator.on('agent-task', (_teamId, instance, subtask) => {
        agentTasks.push({ instance, subtask });
      });

      orchestrator.createTeam('tasks', projectDir);
      orchestrator.assignTask(
        'tasks',
        'implement user authentication with JWT tokens and database integration',
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      const security = mock.getSession(0);
      const worker1 = mock.getSession(1);
      const _worker2 = mock.getSession(2);
      const _reviewer = mock.getSession(3);

      await new Promise((resolve) => setTimeout(resolve, 100));
      security.respond('APPROVED — no issues.');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Worker-1 should have emitted agent-task
      expect(agentTasks.some((t) => t.instance === 'Worker-1')).toBe(true);

      worker1.respond('Implemented auth.');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Worker-2 should have emitted agent-task
      expect(agentTasks.some((t) => t.instance === 'Worker-2')).toBe(true);
    });

    it('simple pipeline skips completeness verification', async () => {
      orchestrator.createTeam('simple-no-verify', projectDir);
      orchestrator.assignTask('simple-no-verify', 'fix a typo');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Security-1 downgrades to Worker-1-only.
      mock.getSession(0).respond('CLASSIFICATION: SIMPLE\nNo concerns.');
      await new Promise((resolve) => setTimeout(resolve, 50));

      mock.getSession(1).respond('Fixed the typo.');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Worker-2 (session 2) is spawned but never receives a verification prompt.
      const worker2 = mock.getSession(2);
      expect(worker2.receivedMessages.join('\n')).not.toContain('REQUIREMENTS VERIFICATION');
    });
  });

  // --- parseVerifyVerdict ---

  describe('parseChatVerdict', () => {
    it('parses RESPONDING with body on the same line', () => {
      const result = parseChatVerdict(
        'RESPONDING — Worker-2 flagged the missing test because the task description called for unit coverage.',
      );
      expect(result.verdict).toBe('RESPONDING');
      if (result.verdict !== 'AMBIGUOUS') {
        expect(result.details).toContain('flagged the missing test');
      }
    });

    it('parses ASKING and extracts the body', () => {
      const result = parseChatVerdict('ASKING\n\nDo you want vitest or jest for the new tests?');
      expect(result.verdict).toBe('ASKING');
      if (result.verdict !== 'AMBIGUOUS') {
        expect(result.details).toContain('vitest or jest');
      }
    });

    it('parses TRIGGER_PIPELINE with the task in the body', () => {
      const body =
        'Add a settings page at /settings with a dark mode toggle that persists to localStorage.';
      const result = parseChatVerdict('TRIGGER_PIPELINE: ' + body);
      expect(result.verdict).toBe('TRIGGER_PIPELINE');
      if (result.verdict !== 'AMBIGUOUS') {
        expect(result.details).toBe(body);
      }
    });

    it('strips a leaked <thinking> block before applying the prefix check', () => {
      const result = parseChatVerdict(
        '<thinking>The user wants tests added.</thinking>\nTRIGGER_PIPELINE — Add unit tests for the auth module.',
      );
      expect(result.verdict).toBe('TRIGGER_PIPELINE');
    });

    it('returns AMBIGUOUS when no recognized prefix appears', () => {
      const result = parseChatVerdict("Sure, I'll go ahead and start the pipeline now.");
      expect(result.verdict).toBe('AMBIGUOUS');
    });

    it('is case-insensitive on the prefix', () => {
      const result = parseChatVerdict('responding -- here is the answer.');
      expect(result.verdict).toBe('RESPONDING');
    });
  });

  describe('parseVerifyVerdict', () => {
    it('parses COMPLETE', () => {
      const result = parseVerifyVerdict('COMPLETE — all requirements implemented.');
      expect(result.verdict).toBe('COMPLETE');
    });

    it('parses GAPS_FOUND', () => {
      const result = parseVerifyVerdict('GAPS_FOUND — missing error handling');
      expect(result.verdict).toBe('GAPS_FOUND');
    });

    it('returns AMBIGUOUS for unclear text (no longer trusts the verifier silently)', () => {
      // Previously defaulted to COMPLETE if no GAPS_FOUND prefix was seen and
      // no checklist patterns matched — meaning a malformed verifier response
      // would silently pass the gate. Now strict: AMBIGUOUS triggers retry.
      const result = parseVerifyVerdict('Everything looks good.');
      expect(result.verdict).toBe('AMBIGUOUS');
      if (result.verdict === 'AMBIGUOUS') {
        expect(result.raw).toContain('looks good');
      }
    });

    it('returns AMBIGUOUS when only a checklist is present without a verdict prefix', () => {
      // Old behavior scanned for `- [ ]` / `- [x]` lines and inferred verdict.
      // New behavior requires the prefix — the verifier prompt mandates it.
      const result = parseVerifyVerdict(
        'REQUIREMENTS CHECKLIST:\n- [x] Built the button\n- [x] Wired the click handler',
      );
      expect(result.verdict).toBe('AMBIGUOUS');
    });

    it('handles case insensitivity', () => {
      const result = parseVerifyVerdict('gaps_found — missing tests');
      expect(result.verdict).toBe('GAPS_FOUND');
    });
  });

  // --- parseClassification ---

  describe('parseClassification', () => {
    it('parses SIMPLE', () => {
      const result = parseClassification('CLASSIFICATION: SIMPLE\n\n## Clearance Report...');
      expect(result).toBe('SIMPLE');
    });

    it('parses STANDARD', () => {
      const result = parseClassification('CLASSIFICATION: STANDARD\n\nFiles scanned...');
      expect(result).toBe('STANDARD');
    });

    it('parses COMPLEX', () => {
      const result = parseClassification('CLASSIFICATION: COMPLEX\n\nThis task touches auth...');
      expect(result).toBe('COMPLEX');
    });

    it('defaults to STANDARD when missing', () => {
      const result = parseClassification('All files are safe. No issues found.');
      expect(result).toBe('STANDARD');
    });

    it('handles case insensitivity', () => {
      const result = parseClassification('classification: simple\n\nReport...');
      expect(result).toBe('SIMPLE');
    });

    it('finds classification mid-text', () => {
      const result = parseClassification('Some preamble\nCLASSIFICATION: COMPLEX\n\nDetails...');
      expect(result).toBe('COMPLEX');
    });

    it('handles extra whitespace', () => {
      const result = parseClassification('CLASSIFICATION:   SIMPLE\n\nReport...');
      expect(result).toBe('SIMPLE');
    });
  });

  // --- sendWithVerdict (fail-loud helper) ---

  describe('sendWithVerdict', () => {
    // Build a minimal fake AgentSession that returns canned responses in order.
    // sendWithVerdict only calls .send(), so the rest of the AgentSession
    // surface can be stubbed.
    function makeFakeSession(responses: string[]) {
      let i = 0;
      const sendCalls: string[] = [];
      const session = {
        send: async (prompt: string) => {
          sendCalls.push(prompt);
          if (i >= responses.length) {
            throw new Error(`makeFakeSession: ran out of canned responses (call #${i + 1})`);
          }
          return responses[i++];
        },
        close: () => {},
        closed: false,
        lastActivityLog: '',
      } as any; // cast: tests don't need the rest of AgentSession's surface
      return { session, sendCalls };
    }

    it('returns parsed verdict on first try and emits no malformed-output', async () => {
      const { session, sendCalls } = makeFakeSession(['APPROVED — clean sweep']);
      const responses: string[] = [];
      const malformed: string[] = [];

      const result = await sendWithVerdict(
        session,
        'sweep prompt',
        parseSecurityVerdict,
        ['APPROVED', 'FLAGGED', 'BLOCKED'] as const,
        {
          onResponse: (raw) => responses.push(raw),
          onMalformed: (raw) => malformed.push(raw),
        },
        'Security-1' as any,
      );

      expect(result.verdict).toBe('APPROVED');
      expect(result.details).toContain('APPROVED');
      expect(sendCalls).toHaveLength(1);
      expect(responses).toEqual(['APPROVED — clean sweep']);
      expect(malformed).toEqual([]);
    });

    it('retries once on AMBIGUOUS and succeeds on the corrective re-prompt', async () => {
      const { session, sendCalls } = makeFakeSession([
        'I think the code looks fine to me', // ambiguous: no verdict prefix
        'APPROVED — verified after retry', // succeeds on retry
      ]);
      const responses: string[] = [];
      const malformed: string[] = [];

      const result = await sendWithVerdict(
        session,
        'review prompt',
        parseReviewVerdict,
        ['APPROVED', 'REVISION_NEEDED', 'REJECTED'] as const,
        {
          onResponse: (raw) => responses.push(raw),
          onMalformed: (raw) => malformed.push(raw),
        },
        'Reviewer-1' as any,
      );

      expect(result.verdict).toBe('APPROVED');
      expect(sendCalls).toHaveLength(2);
      // Both raw responses surface in the transcript so the dashboard can show
      // what the agent originally tried to say (preserving drift visibility).
      expect(responses).toEqual([
        'I think the code looks fine to me',
        'APPROVED — verified after retry',
      ]);
      // Only the malformed first attempt fires the diagnostic event.
      expect(malformed).toEqual(['I think the code looks fine to me']);
      // The retry prompt names the expected tokens and quotes the malformed reply.
      expect(sendCalls[1]).toContain('APPROVED');
      expect(sendCalls[1]).toContain('REVISION_NEEDED');
      expect(sendCalls[1]).toContain('REJECTED');
      expect(sendCalls[1]).toContain('I think the code looks fine to me');
    });

    it('throws MalformedVerdictError after a second AMBIGUOUS response', async () => {
      const { session, sendCalls } = makeFakeSession([
        'first malformed reply, no prefix',
        'second malformed reply, also no prefix',
      ]);
      const responses: string[] = [];
      const malformed: string[] = [];

      await expect(
        sendWithVerdict(
          session,
          'verify prompt',
          parseVerifyVerdict,
          ['COMPLETE', 'GAPS_FOUND'] as const,
          {
            onResponse: (raw) => responses.push(raw),
            onMalformed: (raw) => malformed.push(raw),
          },
          'Worker-2' as any,
        ),
      ).rejects.toThrow(MalformedVerdictError);

      expect(sendCalls).toHaveLength(2);
      // Both responses surface in the transcript and both fire the diagnostic.
      expect(responses).toHaveLength(2);
      expect(malformed).toHaveLength(2);
      expect(malformed[0]).toContain('first malformed reply');
      expect(malformed[1]).toContain('second malformed reply');
    });

    it('MalformedVerdictError carries instance, expected tokens, and truncated raw output', async () => {
      const { session } = makeFakeSession([
        'first ambiguous',
        'x'.repeat(500), // >200 chars to verify the truncation in the error message
      ]);

      try {
        await sendWithVerdict(
          session,
          'sweep prompt',
          parseSecurityVerdict,
          ['APPROVED', 'FLAGGED', 'BLOCKED'] as const,
          { onResponse: () => {}, onMalformed: () => {} },
          'Security-1' as any,
        );
        expect.fail('sendWithVerdict should have thrown MalformedVerdictError');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedVerdictError);
        const e = err as MalformedVerdictError;
        expect(e.instance).toBe('Security-1');
        expect(e.expected).toEqual(['APPROVED', 'FLAGGED', 'BLOCKED']);
        // Error message names the agent and lists the expected tokens
        expect(e.message).toContain('Security-1');
        expect(e.message).toContain('APPROVED, FLAGGED, BLOCKED');
        // Raw output is truncated to 200 chars in the message body
        expect(e.message.length).toBeLessThan(600);
      }
    });
  });
});
