#!/usr/bin/env node

// CLI entry point for ClaudeOrchestra.
// Commands: create-team, assign-task, status, list, dashboard

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Orchestrator, type OrchestraConfig } from './orchestrator.js';
import { SubagentOrchestrator, type SubagentOrchestraConfig } from './subagent-orchestrator.js';
import { PipelineOrchestrator, type PipelineOrchestraConfig } from './pipeline-orchestrator.js';
import { DashboardServer } from './dashboard/index.js';
import { TeamPhase } from './state/team-state.js';
import { Role } from './roles/role-types.js';
import { Logger } from './logger/logger.js';

type AnyOrchestrator = Orchestrator | SubagentOrchestrator | PipelineOrchestrator;

// --- Config Loading ---

function loadConfig(configPath: string): Partial<OrchestraConfig> {
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const config: Partial<OrchestraConfig> = {};

    if (parsed.engine?.registryPath) config.registryPath = parsed.engine.registryPath;
    if (parsed.engine?.logDirectory) config.logDirectory = parsed.engine.logDirectory;
    if (parsed.engine?.tickIntervalMs) config.tickIntervalMs = parsed.engine.tickIntervalMs;
    if (parsed.teams?.maxConcurrentTeams) config.maxConcurrentTeams = parsed.teams.maxConcurrentTeams;
    if (parsed.limits?.maxRevisions || parsed.limits?.maxRejections || parsed.limits?.maxTotalBackwardTransitions) {
      config.limits = {
        maxRevisions: parsed.limits.maxRevisions ?? 3,
        maxRejections: parsed.limits.maxRejections ?? 2,
        maxTotalBackwardTransitions: parsed.limits.maxTotalBackwardTransitions ?? 5,
      };
    }
    if (parsed.limits?.maxRespawnsPerAgent) config.maxRespawns = parsed.limits.maxRespawnsPerAgent;
    if (parsed.limits?.maxMalformedRetries) config.maxMalformedRetries = parsed.limits.maxMalformedRetries;
    if (parsed.models) {
      config.models = {};
      for (const [role, model] of Object.entries(parsed.models)) {
        config.models[role as Role] = model as string;
      }
    }

    // Performance tuning
    if (parsed.efforts) {
      config.efforts = {};
      for (const [role, effort] of Object.entries(parsed.efforts)) {
        config.efforts[role as Role] = effort as 'low' | 'medium' | 'high' | 'max';
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
    if (parsed.maxBudgetUsd) config.maxBudgetUsd = parsed.maxBudgetUsd;

    return config;
  } catch {
    return {};
  }
}

// --- CLI Argument Parsing ---

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const command = args[0] ?? 'help';
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i];
      const val = args[i + 1] ?? '';
      flags[key] = val;
      i++;
    } else {
      positional.push(args[i]);
    }
  }

  return { command, positional, flags };
}

// --- Terminal Colors ---

const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  purple: '\x1b[35m',
  brightRed: '\x1b[91m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

const PHASE_COLORS: Record<string, string> = {
  [TeamPhase.PreWork]: colors.blue,
  [TeamPhase.Work]: colors.green,
  [TeamPhase.Handoff]: colors.yellow,
  [TeamPhase.Review]: colors.purple,
  [TeamPhase.Done]: colors.green,
  [TeamPhase.Errored]: colors.brightRed,
  [TeamPhase.Cancelled]: colors.dim,
};

function log(msg: string): void {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`${colors.dim}[${ts}]${colors.reset} ${msg}`);
}

function logError(msg: string): void {
  console.error(`${colors.brightRed}ERROR:${colors.reset} ${msg}`);
}


function getRoleColor(instance: string): string {
  if (instance.startsWith('Supervisor')) return colors.blue;
  if (instance.startsWith('Worker')) return colors.green;
  if (instance.startsWith('Security')) return colors.red;
  if (instance.startsWith('Reviewer')) return colors.yellow;
  return colors.reset;
}

// --- Commands ---

function printUsage(): void {
  console.log(`
${colors.bold}ClaudeOrchestra${colors.reset} — Multi-Agent Orchestration Engine

${colors.bold}Usage:${colors.reset}
  claude-orchestra <command> [args] [flags]

${colors.bold}Commands:${colors.reset}
  dashboard                            Start live dashboard (pipeline mode)
  create-team <name> <project-path>   Create a new agent team
  assign-task <team-id> <description>  Assign a task to a team
  status <team-id>                     Show team status
  list                                 List all teams
  recover                              Recover teams from persisted state

${colors.bold}Flags:${colors.reset}
  --mode <legacy|subagent|pipeline>  Orchestration mode (default: legacy)
  --port <n>                 Dashboard port (default: 3460)
  --registry <path>          Registry file path (default: ./registry.json)
  --tick-interval <ms>       Main loop interval (default: 1000)
  --max-teams <n>            Max concurrent teams (default: 5)
  --config <path>            Config file path (default: ./orchestra.config.json)
`);
}

function showStatus(orchestrator: AnyOrchestrator, teamId: string): void {
  const status = orchestrator.getTeamStatus(teamId);
  if (!status) {
    logError(`Team "${teamId}" not found`);
    process.exit(1);
  }

  const phaseColor = PHASE_COLORS[status.currentPhase] ?? colors.reset;

  console.log(`
${colors.bold}Team:${colors.reset} ${status.teamName} (${status.teamId})
${colors.bold}Phase:${colors.reset} ${phaseColor}${status.currentPhase}${colors.reset}
${colors.bold}Project:${colors.reset} ${status.projectPath}
${colors.bold}Task:${colors.reset} ${status.currentTask?.description ?? 'none'}
${colors.bold}Counters:${colors.reset} revisions=${status.counters.revisions} rejections=${status.counters.rejections} backward=${status.counters.totalBackwardTransitions}
${colors.bold}Created:${colors.reset} ${status.createdAt}
${colors.bold}Updated:${colors.reset} ${status.updatedAt}

${colors.bold}Agents:${colors.reset}`);

  for (const [instance, agent] of Object.entries(status.agents)) {
    const roleColor = getRoleColor(instance);
    const stateIndicator = agent.state === 'active' ? colors.green + 'active' :
      agent.state === 'errored' ? colors.brightRed + 'errored' :
      agent.state === 'idle' ? colors.dim + 'idle' :
      colors.yellow + agent.state;
    console.log(
      `  ${roleColor}${instance}${colors.reset}: ${stateIndicator}${colors.reset}` +
      (agent.currentJob ? ` — ${agent.currentJob}` : '') +
      (agent.pid ? ` (pid ${agent.pid})` : '')
    );
  }
  console.log();
}

function showList(orchestrator: AnyOrchestrator): void {
  const teams = orchestrator.getAllTeams();
  if (teams.length === 0) {
    console.log('No active teams.');
    return;
  }

  console.log(`\n${colors.bold}Active Teams:${colors.reset}\n`);
  for (const t of teams) {
    const phaseColor = PHASE_COLORS[t.currentPhase] ?? colors.reset;
    console.log(
      `  ${t.teamId}: ${phaseColor}${t.currentPhase}${colors.reset}` +
      (t.currentTask ? ` — ${t.currentTask.description.substring(0, 60)}` : '')
    );
  }
  console.log();
}

// --- Helper: recover teams across all orchestrator types ---

function recoverTeams(orchestrator: AnyOrchestrator): string[] {
  if (orchestrator instanceof Orchestrator) {
    return orchestrator.recover();
  } else if (orchestrator instanceof SubagentOrchestrator) {
    return orchestrator.recover();
  } else if (orchestrator instanceof PipelineOrchestrator) {
    return orchestrator.recover();
  }
  return [];
}

// --- Main ---

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.command === 'help' || parsed.command === '--help') {
    printUsage();
    return;
  }

  // Load config
  const configPath = parsed.flags['--config'] ??
    process.env.CLAUDE_ORCHESTRA_CONFIG ??
    './orchestra.config.json';
  const fileConfig = loadConfig(configPath);

  // Apply CLI flag overrides
  const config: Partial<OrchestraConfig> = { ...fileConfig };
  if (parsed.flags['--registry']) config.registryPath = parsed.flags['--registry'];
  if (parsed.flags['--tick-interval']) config.tickIntervalMs = parseInt(parsed.flags['--tick-interval'], 10);
  if (parsed.flags['--max-teams']) config.maxConcurrentTeams = parseInt(parsed.flags['--max-teams'], 10);
  if (parsed.flags['--model-supervisor']) {
    config.models = config.models ?? {};
    config.models[Role.Supervisor] = parsed.flags['--model-supervisor'];
  }
  if (parsed.flags['--model-worker']) {
    config.models = config.models ?? {};
    config.models[Role.Worker] = parsed.flags['--model-worker'];
  }
  if (parsed.flags['--model-security']) {
    config.models = config.models ?? {};
    config.models[Role.Security] = parsed.flags['--model-security'];
  }
  if (parsed.flags['--model-reviewer']) {
    config.models = config.models ?? {};
    config.models[Role.Reviewer] = parsed.flags['--model-reviewer'];
  }

  // Resolve rolesDir relative to CWD
  if (!config.rolesDir) {
    config.rolesDir = path.resolve('roles');
  }

  // Select orchestration mode
  const mode = parsed.flags['--mode'] ?? 'legacy';
  let orchestrator: AnyOrchestrator;

  if (mode === 'pipeline') {
    const pipelineConfig: Partial<PipelineOrchestraConfig> = {
      registryPath: config.registryPath,
      rolesDir: path.resolve('roles/subagent'),
      maxConcurrentTeams: config.maxConcurrentTeams,
      models: config.models,
      disallowedTools: config.disallowedTools,
      maxTurns: config.maxTurns,
      limits: config.limits,
    };
    orchestrator = new PipelineOrchestrator(pipelineConfig);
    log(`${colors.green}Mode: pipeline${colors.reset} (deterministic code-driven orchestration)`);
  } else if (mode === 'subagent') {
    const subagentConfig: Partial<SubagentOrchestraConfig> = {
      registryPath: config.registryPath,
      rolesDir: path.resolve('roles/subagent'),
      maxConcurrentTeams: config.maxConcurrentTeams,
      models: config.models,
      disallowedTools: config.disallowedTools,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      limits: config.limits,
    };
    orchestrator = new SubagentOrchestrator(subagentConfig);
    log(`${colors.purple}Mode: subagent${colors.reset} (SDK-native subagent orchestration)`);
  } else {
    orchestrator = new Orchestrator(config);
    log(`${colors.dim}Mode: legacy${colors.reset} (multi-process orchestration)`);
  }

  // Create and attach structured logger
  const logDir = config.logDirectory ?? './logs';

  const logger = new Logger({
    logDirectory: logDir,
    teamsDirectory: path.join(logDir, 'teams'),
  });
  // Logger.attach() expects Orchestrator but both emit compatible events
  logger.attach(orchestrator as Orchestrator);

  // Signal handling
  let shutdownRequested = false;
  const handleShutdown = async () => {
    if (shutdownRequested) {
      log(`${colors.brightRed}Force kill — second signal received${colors.reset}`);
      orchestrator.forceKillAll();
      process.exit(1);
    }
    shutdownRequested = true;
    log(`${colors.yellow}Shutting down gracefully...${colors.reset}`);
    await orchestrator.shutdown();
    logger.dispose();
    process.exit(0);
  };

  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);

  // Execute command
  switch (parsed.command) {
    case 'create-team': {
      const name = parsed.positional[0];
      const projectPath = parsed.positional[1];
      if (!name || !projectPath) {
        logError('Usage: create-team <name> <project-path>');
        process.exit(1);
      }
      orchestrator.createTeam(name, projectPath);
      showStatus(orchestrator, name);
      break;
    }

    case 'assign-task': {
      const teamId = parsed.positional[0];
      const description = parsed.positional.slice(1).join(' ');
      if (!teamId || !description) {
        logError('Usage: assign-task <team-id> <task-description>');
        process.exit(1);
      }

      // Recover existing teams from persisted state
      recoverTeams(orchestrator);

      if (!orchestrator.getTeamStatus(teamId)) {
        logError(`Team "${teamId}" not found. Create it first with create-team.`);
        process.exit(1);
      }

      orchestrator.assignTask(teamId, description);

      // Start the main loop (no-op for subagent/pipeline modes)
      if (orchestrator instanceof Orchestrator) {
        log(`${colors.bold}Main loop started${colors.reset} (tick every ${config.tickIntervalMs ?? 1000}ms). Press Ctrl+C to stop.`);
      } else if (orchestrator instanceof PipelineOrchestrator) {
        log(`${colors.bold}Pipeline started${colors.reset}. Press Ctrl+C to stop.`);
      } else {
        log(`${colors.bold}Subagent query started${colors.reset}. Press Ctrl+C to stop.`);
      }
      orchestrator.start();

      // Auto-exit when task reaches terminal state
      orchestrator.on('task-complete', async (_completedTeamId, _phase, _durationMs) => {
        // Give a moment for final log output to flush
        setTimeout(async () => {
          await orchestrator.shutdown();
          logger.dispose();
          process.exit(0);
        }, 2000);
      });

      // Keep process alive until task completes or Ctrl+C
      await new Promise<void>(() => {
        // Legacy: process stays alive via tick interval timer.
        // Subagent: process stays alive via SDK query async generator.
        // Pipeline: process stays alive via SDK query async generators.
        // Exit is handled by task-complete or signal handlers.
      });
      break;
    }

    case 'status': {
      const teamId = parsed.positional[0];
      if (!teamId) {
        logError('Usage: status <team-id>');
        process.exit(1);
      }
      recoverTeams(orchestrator);
      showStatus(orchestrator, teamId);
      break;
    }

    case 'list': {
      recoverTeams(orchestrator);
      showList(orchestrator);
      break;
    }

    case 'recover': {
      const recovered = recoverTeams(orchestrator);
      if (recovered.length === 0) {
        console.log('No teams to recover.');
      } else {
        log(`Recovered ${recovered.length} team(s): ${recovered.join(', ')}`);
        orchestrator.start();
        await new Promise<void>(() => {});
      }
      break;
    }

    case 'dashboard': {
      // Dashboard mode requires pipeline orchestrator
      if (mode !== 'pipeline') {
        logError('Dashboard requires --mode pipeline');
        process.exit(1);
      }

      const port = parseInt(parsed.flags['--port'] ?? '3460', 10);

      // Recover existing teams
      recoverTeams(orchestrator);

      // Start dashboard server
      const dashboard = new DashboardServer({
        orchestrator: orchestrator as PipelineOrchestrator,
        port,
      });

      await dashboard.start();
      log(`${colors.green}Dashboard running at${colors.reset} ${colors.bold}http://localhost:${port}${colors.reset}`);
      log(`${colors.dim}Create teams and launch tasks from the browser. Press Ctrl+C to stop.${colors.reset}`);

      // Auto-open browser (best effort, macOS/Linux/Windows)
      try {
        const { exec } = await import('node:child_process');
        const openCmd = process.platform === 'darwin' ? 'open' :
                        process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} http://localhost:${port}`);
      } catch {
        // Silent fail — user can open manually
      }

      // Override shutdown to close dashboard first
      process.removeListener('SIGTERM', handleShutdown);
      process.removeListener('SIGINT', handleShutdown);

      const dashboardShutdown = async () => {
        if (shutdownRequested) {
          orchestrator.forceKillAll();
          process.exit(1);
        }
        shutdownRequested = true;
        log(`${colors.yellow}Shutting down dashboard + orchestrator...${colors.reset}`);
        await dashboard.close();
        await orchestrator.shutdown();
        logger.dispose();
        process.exit(0);
      };

      process.on('SIGTERM', dashboardShutdown);
      process.on('SIGINT', dashboardShutdown);

      // Keep process alive
      await new Promise<void>(() => {});
      break;
    }

    default:
      logError(`Unknown command: ${parsed.command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  logError(err.message);
  process.exit(1);
});
