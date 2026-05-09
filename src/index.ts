#!/usr/bin/env node

// CLI entry point for ClaudeOrchestra.
// Commands: create-team, assign-task, status, list, dashboard

import * as path from 'node:path';
import { PipelineOrchestrator, type PipelineOrchestraConfig } from './pipeline-orchestrator.js';
import { DashboardServer } from './dashboard/index.js';
import { TeamPhase } from './state/team-state.js';
import { Logger } from './logger/logger.js';
import { applyCliOverrides, buildPipelineConfig, loadConfig, resolveConfigPath } from './config.js';

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
  --port <n>                 Dashboard port (default: 3460)
  --registry <path>          Registry file path (default: ./registry.json)
  --tick-interval <ms>       Main loop interval (default: 1000)
  --max-teams <n>            Max concurrent teams (default: 5)
  --provider <name>          Agent provider: claude or codex
  --auth <mode>              Auth mode: subscription
  --model <id>               Global model override (e.g. gpt-5.5, default)
  --config <path>            Config file path (default: ./orchestra.config.json)
`);
}

function showStatus(orchestrator: PipelineOrchestrator, teamId: string): void {
  const status = orchestrator.getTeamStatus(teamId);
  if (!status) {
    logError(`Team "${teamId}" not found`);
    process.exit(1);
  }

  const phaseColor = PHASE_COLORS[status.currentPhase] ?? colors.reset;
  const runtime = orchestrator.getAgentRuntime();

  console.log(`
${colors.bold}Team:${colors.reset} ${status.teamName} (${status.teamId})
${colors.bold}Phase:${colors.reset} ${phaseColor}${status.currentPhase}${colors.reset}
${colors.bold}Runtime:${colors.reset} ${runtime.provider} / ${runtime.auth} / ${runtime.model ?? 'default'}
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

function showList(orchestrator: PipelineOrchestrator): void {
  const teams = orchestrator.getAllTeams();
  const runtime = orchestrator.getAgentRuntime();
  if (teams.length === 0) {
    console.log(`No active teams. Runtime: ${runtime.provider} / ${runtime.auth} / ${runtime.model ?? 'default'}.`);
    return;
  }

  console.log(`\n${colors.bold}Active Teams:${colors.reset} ${colors.dim}(runtime: ${runtime.provider} / ${runtime.auth} / ${runtime.model ?? 'default'})${colors.reset}\n`);
  for (const t of teams) {
    const phaseColor = PHASE_COLORS[t.currentPhase] ?? colors.reset;
    console.log(
      `  ${t.teamId}: ${phaseColor}${t.currentPhase}${colors.reset}` +
      (t.currentTask ? ` — ${t.currentTask.description.substring(0, 60)}` : '')
    );
  }
  console.log();
}

function recoverTeams(orchestrator: PipelineOrchestrator): string[] {
  return orchestrator.recover();
}

// --- Main ---

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.command === 'help' || parsed.command === '--help') {
    printUsage();
    return;
  }

  // Load config. --config and CLAUDE_ORCHESTRA_CONFIG select the file;
  // individual CLI flags then override values from that file.
  const configPath = resolveConfigPath(parsed.flags);
  const fileConfig = loadConfig(configPath);
  const config: Partial<PipelineOrchestraConfig> = applyCliOverrides(fileConfig, parsed.flags);
  const orchestratorConfig = buildPipelineConfig(config);

  // Create pipeline orchestrator
  const orchestrator = new PipelineOrchestrator(orchestratorConfig);

  // Create and attach structured logger
  const logDir = config.logDirectory ?? './logs';

  const logger = new Logger({
    logDirectory: logDir,
    teamsDirectory: path.join(logDir, 'teams'),
  });
  logger.attach(orchestrator);

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

      log(`${colors.bold}Pipeline started${colors.reset}. Press Ctrl+C to stop.`);
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
      await new Promise<void>(() => {});
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
      const port = parseInt(parsed.flags['--port'] ?? '3460', 10);

      // Recover existing teams
      recoverTeams(orchestrator);

      // Start dashboard server
      const dashboard = new DashboardServer({
        orchestrator,
        port,
      });

      await dashboard.start();
      const runtime = orchestrator.getAgentRuntime();
      log(`${colors.green}Dashboard running at${colors.reset} ${colors.bold}http://localhost:${port}${colors.reset}`);
      log(`${colors.green}Agent runtime:${colors.reset} ${colors.bold}${runtime.provider}${colors.reset} / ${runtime.auth} / ${runtime.model ?? 'default'}`);
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
