import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EffortLevel, PipelineOrchestraConfig } from './pipeline-orchestrator.js';
import { Role } from './roles/role-types.js';

export type ConfigFlags = Record<string, string>;

export function resolveConfigPath(
  flags: ConfigFlags,
  env: NodeJS.ProcessEnv = process.env
): string {
  return flags['--config'] ?? env.CLAUDE_ORCHESTRA_CONFIG ?? './orchestra.config.json';
}

export function loadConfig(configPath: string): Partial<PipelineOrchestraConfig> {
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const config: Partial<PipelineOrchestraConfig> = {};

    if (parsed.engine?.registryPath) config.registryPath = parsed.engine.registryPath;
    if (parsed.engine?.logDirectory) config.logDirectory = parsed.engine.logDirectory;
    if (parsed.engine?.rolesDir) config.rolesDir = parsed.engine.rolesDir;
    if (typeof parsed.skipRequirements === 'boolean') {
      config.skipRequirements = parsed.skipRequirements;
    }
    if (parsed.teams?.maxConcurrentTeams) config.maxConcurrentTeams = parsed.teams.maxConcurrentTeams;
    if (parsed.agentRuntime) {
      config.agentRuntime = {};
      if (parsed.agentRuntime.provider) config.agentRuntime.provider = parsed.agentRuntime.provider;
      if (parsed.agentRuntime.auth) config.agentRuntime.auth = parsed.agentRuntime.auth;
      if (parsed.agentRuntime.model) config.agentRuntime.model = parsed.agentRuntime.model;
    }
    if (parsed.limits?.maxRevisions || parsed.limits?.maxRejections || parsed.limits?.maxTotalBackwardTransitions) {
      config.limits = {
        maxRevisions: parsed.limits.maxRevisions ?? 3,
        maxRejections: parsed.limits.maxRejections ?? 2,
        maxTotalBackwardTransitions: parsed.limits.maxTotalBackwardTransitions ?? 5,
      };
    }
    if (parsed.models) {
      config.models = {};
      for (const [role, model] of Object.entries(parsed.models)) {
        config.models[role as Role] = model as string;
      }
    }
    if (parsed.efforts) {
      config.efforts = {};
      for (const [role, effort] of Object.entries(parsed.efforts)) {
        config.efforts[role as Role] = effort as EffortLevel;
      }
    }
    if (parsed.disallowedTools) {
      config.disallowedTools = {};
      for (const [role, tools] of Object.entries(parsed.disallowedTools)) {
        config.disallowedTools[role as Role] = tools as string[];
      }
    }
    if (parsed.maxTurns) {
      config.maxTurns = {};
      for (const [role, turns] of Object.entries(parsed.maxTurns)) {
        config.maxTurns[role as Role] = turns as number;
      }
    }
    if (parsed.guardrails) {
      config.guardrails = {};
      if (typeof parsed.guardrails.enabled === 'boolean') {
        config.guardrails.enabled = parsed.guardrails.enabled;
      }
      if (typeof parsed.guardrails.abortCodexOnForbiddenStreamEvent === 'boolean') {
        config.guardrails.abortCodexOnForbiddenStreamEvent = parsed.guardrails.abortCodexOnForbiddenStreamEvent;
      }
    }
    if (parsed.contracts) {
      config.contracts = {};
      if (parsed.contracts.mode) config.contracts.mode = parsed.contracts.mode;
      if (typeof parsed.contracts.validationRetries === 'number') {
        config.contracts.validationRetries = parsed.contracts.validationRetries;
      }
    }
    if (parsed.review) {
      config.review = {};
      if (typeof parsed.review.complexFileThreshold === 'number') {
        config.review.complexFileThreshold = parsed.review.complexFileThreshold;
      }
      if (typeof parsed.review.complexDiffLineThreshold === 'number') {
        config.review.complexDiffLineThreshold = parsed.review.complexDiffLineThreshold;
      }
      if (typeof parsed.review.maxFilesPerBatch === 'number') {
        config.review.maxFilesPerBatch = parsed.review.maxFilesPerBatch;
      }
    }
    if (parsed.recovery) {
      config.recovery = {};
      if (typeof parsed.recovery.maxProviderRetries === 'number') {
        config.recovery.maxProviderRetries = parsed.recovery.maxProviderRetries;
      }
      if (typeof parsed.recovery.initialBackoffMs === 'number') {
        config.recovery.initialBackoffMs = parsed.recovery.initialBackoffMs;
      }
    }
    return config;
  } catch {
    return {};
  }
}

export function applyCliOverrides(
  fileConfig: Partial<PipelineOrchestraConfig>,
  flags: ConfigFlags
): Partial<PipelineOrchestraConfig> {
  const config: Partial<PipelineOrchestraConfig> = { ...fileConfig };

  if (flags['--registry']) config.registryPath = flags['--registry'];
  if (flags['--max-teams']) config.maxConcurrentTeams = parseInt(flags['--max-teams'], 10);
  if (flags['--provider'] || flags['--auth'] || flags['--model']) {
    config.agentRuntime = { ...config.agentRuntime };
    if (flags['--provider']) config.agentRuntime.provider = flags['--provider'] as any;
    if (flags['--auth']) config.agentRuntime.auth = flags['--auth'] as any;
    if (flags['--model']) config.agentRuntime.model = flags['--model'];
  }
  if (flags['--model-worker']) {
    config.models = config.models ?? {};
    config.models[Role.Worker] = flags['--model-worker'];
  }
  if (flags['--model-security']) {
    config.models = config.models ?? {};
    config.models[Role.Security] = flags['--model-security'];
  }
  if (flags['--model-reviewer']) {
    config.models = config.models ?? {};
    config.models[Role.Reviewer] = flags['--model-reviewer'];
  }

  return config;
}

export function buildPipelineConfig(
  config: Partial<PipelineOrchestraConfig>
): Partial<PipelineOrchestraConfig> {
  return {
    registryPath: config.registryPath,
    logDirectory: config.logDirectory,
    rolesDir: path.resolve(config.rolesDir ?? 'agents'),
    maxConcurrentTeams: config.maxConcurrentTeams,
    agentRuntime: config.agentRuntime,
    models: config.models,
    efforts: config.efforts,
    disallowedTools: config.disallowedTools,
    maxTurns: config.maxTurns,
    limits: config.limits,
    skipRequirements: config.skipRequirements,
    guardrails: config.guardrails,
    contracts: config.contracts,
    review: config.review,
    recovery: config.recovery,
  };
}
