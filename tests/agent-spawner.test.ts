import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Role } from '../src/roles/role-types.js';
import { AgentProcess, ProcessState, type AgentSpawnOptions } from '../src/spawner/agent-process.js';
import { AgentSpawner } from '../src/spawner/agent-spawner.js';

const MOCK_AGENT = path.resolve('tests/mocks/echo-agent.mjs');
const ROLES_DIR = path.resolve('roles');
const PROJECT_DIR = '/tmp';

// --- Helper to create a mock agent process ---

function createMockAgent(
  behavior: string = 'echo',
  overrides: Partial<AgentSpawnOptions> = {}
): AgentProcess {
  process.env.MOCK_BEHAVIOR = behavior;
  return new AgentProcess({
    claudeBin: 'node',
    spawnArgs: [MOCK_AGENT],
    model: 'test-model',
    systemPromptPath: MOCK_AGENT,
    cwd: PROJECT_DIR,
    role: Role.Worker,
    instance: 'Worker-1',
    teamId: 'test-team',
    ...overrides,
  });
}

function waitForEvent(agent: AgentProcess, event: string, timeoutMs: number = 5000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    agent.once(event as any, (...args: any[]) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

afterEach(() => {
  delete process.env.MOCK_BEHAVIOR;
});

// =============================================
// AgentProcess — basic lifecycle
// =============================================

describe('AgentProcess lifecycle', () => {
  let agent: AgentProcess;

  afterEach(async () => {
    if (agent?.isAlive) {
      await agent.terminate();
    }
  });

  it('spawns a process and reports running state', () => {
    agent = createMockAgent('echo');
    agent.spawn();

    expect(agent.state).toBe(ProcessState.Running);
    expect(agent.pid).toBeGreaterThan(0);
    expect(agent.isAlive).toBe(true);
  });

  it('captures stdout output', async () => {
    agent = createMockAgent('echo');
    agent.spawn();

    const outputPromise = waitForEvent(agent, 'output');
    agent.send('hello world');

    const [data] = await outputPromise;
    expect(data).toContain('ECHO: hello world');
  });

  it('parses ORCHESTRA-MESSAGE delimiters from stdout', async () => {
    agent = createMockAgent('message');
    agent.spawn();

    const msgPromise = waitForEvent(agent, 'message');
    agent.send('{"flag":"test"}');

    const [raw] = await msgPromise;
    expect(raw).toContain('{"flag":"test"}');
  });

  it('detects process crash', async () => {
    agent = createMockAgent('crash');
    agent.spawn();

    const exitPromise = waitForEvent(agent, 'exit');
    agent.send('trigger crash');

    const [code] = await exitPromise;
    expect(code).toBe(1);
    expect(agent.state).toBe(ProcessState.Crashed);
    expect(agent.isAlive).toBe(false);
  });

  it('terminates gracefully', async () => {
    agent = createMockAgent('echo');
    agent.spawn();
    expect(agent.isAlive).toBe(true);

    await agent.terminate();
    expect(agent.state).toBe(ProcessState.Stopped);
    expect(agent.isAlive).toBe(false);
  });

  it('tracks silence duration', async () => {
    agent = createMockAgent('echo');
    agent.spawn();

    // Before any output, silence is infinite
    expect(agent.silenceDurationMs()).toBe(Infinity);

    const outputPromise = waitForEvent(agent, 'output');
    agent.send('ping');
    await outputPromise;

    // After output, silence should be very small
    expect(agent.silenceDurationMs()).toBeLessThan(1000);
  });

  it('handles immediate exit process', async () => {
    agent = createMockAgent('immediate-exit');
    agent.spawn();

    const exitPromise = waitForEvent(agent, 'exit');
    const [code] = await exitPromise;
    expect(code).toBe(0);
    // Immediate clean exit without terminate() → treated as crash
    // because the engine didn't request the shutdown
    expect(agent.state).toBe(ProcessState.Crashed);
  });

  it('prevents double spawn', () => {
    agent = createMockAgent('echo');
    agent.spawn();

    expect(() => agent.spawn()).toThrow('already spawned');
  });

  it('errors when sending to non-writable stdin', async () => {
    agent = createMockAgent('echo');
    agent.spawn();
    await agent.terminate();

    expect(() => agent.send('test')).toThrow('not writable');
  });

  it('checkAlive returns true for running process', () => {
    agent = createMockAgent('echo');
    agent.spawn();
    expect(agent.checkAlive()).toBe(true);
  });

  it('checkAlive returns false after termination', async () => {
    agent = createMockAgent('echo');
    agent.spawn();
    await agent.terminate();
    expect(agent.checkAlive()).toBe(false);
  });

  it('exposes role and instance info', () => {
    agent = createMockAgent('echo', { role: Role.Security, instance: 'Security-1' });
    expect(agent.role).toBe(Role.Security);
    expect(agent.instance).toBe('Security-1');
    expect(agent.teamId).toBe('test-team');
  });
});

// =============================================
// AgentSpawner — team management
// =============================================

describe('AgentSpawner', () => {
  let spawner: AgentSpawner;

  beforeEach(() => {
    fs.mkdirSync(ROLES_DIR, { recursive: true });
    process.env.MOCK_BEHAVIOR = 'echo';
    spawner = new AgentSpawner({
      claudeBin: 'node',
      spawnArgs: [MOCK_AGENT],
      rolesDir: ROLES_DIR,
      models: {
        [Role.Supervisor]: 'test',
        [Role.Worker]: 'test',
        [Role.Security]: 'test',
        [Role.Reviewer]: 'test',
      },
    });
  });

  afterEach(async () => {
    spawner.forceKillAll();
    delete process.env.MOCK_BEHAVIOR;
  });

  it('tracks agents per team', () => {
    expect(spawner.totalAliveAgents).toBe(0);
  });

  it('spawns a full team of 5 agents', () => {
    const agents = spawner.spawnTeam('team-1', PROJECT_DIR);
    expect(agents).toHaveLength(5);
    expect(spawner.totalAliveAgents).toBe(5);

    // Verify all roles are represented
    const roles = agents.map((a) => a.role);
    expect(roles).toContain(Role.Supervisor);
    expect(roles).toContain(Role.Worker);
    expect(roles).toContain(Role.Security);
    expect(roles).toContain(Role.Reviewer);
    expect(roles.filter((r) => r === Role.Worker)).toHaveLength(2);
  });

  it('prevents duplicate team spawn', () => {
    spawner.spawnTeam('team-1', PROJECT_DIR);
    expect(() => spawner.spawnTeam('team-1', PROJECT_DIR)).toThrow('already has');
  });

  it('prevents duplicate agent spawn', () => {
    spawner.spawnAgent('team-1', Role.Worker, 'Worker-1', PROJECT_DIR);
    expect(() =>
      spawner.spawnAgent('team-1', Role.Worker, 'Worker-1', PROJECT_DIR)
    ).toThrow('already running');
  });

  it('retrieves agent by team and instance', () => {
    spawner.spawnAgent('team-1', Role.Worker, 'Worker-1', PROJECT_DIR);

    const agent = spawner.getAgent('team-1', 'Worker-1');
    expect(agent).toBeDefined();
    expect(agent?.role).toBe(Role.Worker);
    expect(agent?.instance).toBe('Worker-1');
  });

  it('returns undefined for non-existent agent', () => {
    expect(spawner.getAgent('team-1', 'Worker-1')).toBeUndefined();
  });

  it('lists team agents', () => {
    spawner.spawnAgent('team-1', Role.Worker, 'Worker-1', PROJECT_DIR);
    spawner.spawnAgent('team-1', Role.Worker, 'Worker-2', PROJECT_DIR);

    const agents = spawner.getTeamAgents('team-1');
    expect(agents).toHaveLength(2);
  });

  it('tracks respawn counts', () => {
    spawner.spawnAgent('team-1', Role.Worker, 'Worker-1', PROJECT_DIR);
    expect(spawner.getRespawnCount('team-1', 'Worker-1')).toBe(0);
  });

  it('terminates team and cleans up', async () => {
    spawner.spawnAgent('team-1', Role.Worker, 'Worker-1', PROJECT_DIR);

    await spawner.terminateTeam('team-1');
    expect(spawner.getTeamAgents('team-1')).toHaveLength(0);
  }, 15000);

  it('respawns crashed agents within budget', async () => {
    process.env.MOCK_BEHAVIOR = 'crash';
    const agent = spawner.spawnAgent('team-1', Role.Worker, 'Worker-1', PROJECT_DIR);

    // Wait for crash
    await new Promise<void>((resolve) => {
      agent.once('exit', () => resolve());
      agent.send('trigger crash');
    });

    // Respawn
    process.env.MOCK_BEHAVIOR = 'echo';
    const newAgent = spawner.respawnAgent('team-1', 'Worker-1', PROJECT_DIR);
    expect(newAgent).not.toBeNull();
    expect(newAgent?.isAlive).toBe(true);
    expect(spawner.getRespawnCount('team-1', 'Worker-1')).toBe(1);
  });

  it('refuses respawn after budget exhausted', async () => {
    const limitedSpawner = new AgentSpawner({
      claudeBin: 'node',
      spawnArgs: [MOCK_AGENT],
      rolesDir: ROLES_DIR,
      maxRespawns: 1,
      models: {
        [Role.Supervisor]: 'test',
        [Role.Worker]: 'test',
        [Role.Security]: 'test',
        [Role.Reviewer]: 'test',
      },
    });

    process.env.MOCK_BEHAVIOR = 'crash';
    const agent = limitedSpawner.spawnAgent('team-1', Role.Worker, 'Worker-1', PROJECT_DIR);

    await new Promise<void>((resolve) => {
      agent.once('exit', () => resolve());
      agent.send('trigger crash');
    });

    // First respawn should work
    process.env.MOCK_BEHAVIOR = 'echo';
    const r1 = limitedSpawner.respawnAgent('team-1', 'Worker-1', PROJECT_DIR);
    expect(r1).not.toBeNull();

    await r1!.terminate();

    // Second respawn should be refused (budget = 1)
    const r2 = limitedSpawner.respawnAgent('team-1', 'Worker-1', PROJECT_DIR);
    expect(r2).toBeNull();

    limitedSpawner.forceKillAll();
  });

  it('resets respawn counts', () => {
    spawner.spawnAgent('team-1', Role.Worker, 'Worker-1', PROJECT_DIR);

    spawner.resetRespawnCounts('team-1');
    expect(spawner.getRespawnCount('team-1', 'Worker-1')).toBe(0);
  });

  it('force kills all agents across teams', () => {
    spawner.spawnAgent('team-1', Role.Worker, 'Worker-1', PROJECT_DIR);
    spawner.spawnAgent('team-2', Role.Security, 'Security-1', PROJECT_DIR);

    spawner.forceKillAll();
    expect(spawner.totalAliveAgents).toBe(0);
    expect(spawner.getTeamAgents('team-1')).toHaveLength(0);
  });
});
