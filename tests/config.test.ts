import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyCliOverrides,
  buildPipelineConfig,
  loadConfig,
  resolveConfigPath,
} from '../src/config.js';
import { Role } from '../src/roles/role-types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('config loading', () => {
  it('loads all orchestrator config sections from JSON', () => {
    const configPath = path.join(tmpDir, 'orchestra.config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentRuntime: {
          provider: 'codex',
          auth: 'subscription',
          model: 'gpt-5.5',
        },
        engine: {
          registryPath: './registry.test.json',
          logDirectory: './test-logs',
          rolesDir: './test-agents',
        },
        teams: {
          maxConcurrentTeams: 2,
        },
        limits: {
          maxRevisions: 4,
        },
        models: {
          Worker: 'claude-sonnet-4-6',
        },
        efforts: {
          Worker: 'xhigh',
          Security: 'high',
        },
        disallowedTools: {
          Security: ['Write', 'Edit', 'Bash'],
        },
        maxTurns: {
          Worker: 50,
        },
        guardrails: {
          enabled: true,
          abortCodexOnForbiddenStreamEvent: false,
        },
        skipRequirements: true,
      }),
      'utf-8',
    );

    const config = loadConfig(configPath);

    expect(config.agentRuntime).toEqual({
      provider: 'codex',
      auth: 'subscription',
      model: 'gpt-5.5',
    });
    expect(config.registryPath).toBe('./registry.test.json');
    expect(config.logDirectory).toBe('./test-logs');
    expect(config.rolesDir).toBe('./test-agents');
    expect(config.maxConcurrentTeams).toBe(2);
    expect(config.limits).toEqual({
      maxRevisions: 4,
      maxRejections: 2,
      maxTotalBackwardTransitions: 5,
    });
    expect(config.models?.[Role.Worker]).toBe('claude-sonnet-4-6');
    expect(config.efforts?.[Role.Worker]).toBe('xhigh');
    expect(config.efforts?.[Role.Security]).toBe('high');
    expect(config.disallowedTools?.[Role.Security]).toEqual(['Write', 'Edit', 'Bash']);
    expect(config.maxTurns?.[Role.Worker]).toBe(50);
    expect(config.guardrails).toEqual({
      enabled: true,
      abortCodexOnForbiddenStreamEvent: false,
    });
    expect(config.skipRequirements).toBe(true);
  });

  it('honors explicit zero limits instead of falling back to defaults', () => {
    const configPath = path.join(tmpDir, 'orchestra.config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        limits: {
          maxRevisions: 0,
          maxRejections: 0,
          maxTotalBackwardTransitions: 0,
        },
      }),
      'utf-8',
    );

    const config = loadConfig(configPath);
    // A truthiness guard/merge would drop these zeros to 3/2/5; the ?? merge
    // must preserve the explicit 0 ("never allow a revision").
    expect(config.limits).toEqual({
      maxRevisions: 0,
      maxRejections: 0,
      maxTotalBackwardTransitions: 0,
    });
  });

  it('uses CLI flags as value overrides after loading the selected config file', () => {
    const config = applyCliOverrides(
      {
        registryPath: './from-file.json',
        agentRuntime: {
          provider: 'claude',
          auth: 'subscription',
          model: 'claude-opus-4-6',
        },
        models: {
          [Role.Worker]: 'claude-role-model',
        },
      },
      {
        '--registry': './from-cli.json',
        '--provider': 'codex',
        '--model': 'gpt-5.5',
        '--model-worker': 'gpt-5.5-worker',
        '--max-teams': '7',
      },
    );

    expect(config.registryPath).toBe('./from-cli.json');
    expect(config.agentRuntime).toEqual({
      provider: 'codex',
      auth: 'subscription',
      model: 'gpt-5.5',
    });
    expect(config.models?.[Role.Worker]).toBe('gpt-5.5-worker');
    expect(config.maxConcurrentTeams).toBe(7);
  });

  it('passes parsed runtime knobs through to PipelineOrchestrator config', () => {
    const config = buildPipelineConfig({
      rolesDir: './custom-agents',
      efforts: {
        [Role.Worker]: 'xhigh',
      },
      disallowedTools: {
        [Role.Reviewer]: ['Write', 'Edit', 'Bash'],
      },
      maxTurns: {
        [Role.Worker]: 25,
      },
      skipRequirements: true,
      guardrails: {
        enabled: true,
      },
    });

    expect(config.rolesDir).toBe(path.resolve('./custom-agents'));
    expect(config.efforts?.[Role.Worker]).toBe('xhigh');
    expect(config.disallowedTools?.[Role.Reviewer]).toEqual(['Write', 'Edit', 'Bash']);
    expect(config.maxTurns?.[Role.Worker]).toBe(25);
    expect(config.skipRequirements).toBe(true);
    expect(config.guardrails?.enabled).toBe(true);
  });

  it('selects the config file path before applying value overrides', () => {
    expect(
      resolveConfigPath(
        { '--config': './cli.json' },
        {
          CLAUDE_ORCHESTRA_CONFIG: './env.json',
        },
      ),
    ).toBe('./cli.json');
    expect(
      resolveConfigPath(
        {},
        {
          CLAUDE_ORCHESTRA_CONFIG: './env.json',
        },
      ),
    ).toBe('./env.json');
    expect(resolveConfigPath({}, {})).toBe('./orchestra.config.json');
  });
});
