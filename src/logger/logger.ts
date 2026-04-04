// Structured logging for ClaudeOrchestra.
// Dual output: colored terminal + JSON log files.
// Supports log rotation, per-team log files, and env-based level override.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Role, type RoleInstance } from '../roles/role-types.js';
import { TeamPhase } from '../state/team-state.js';
import type { PipelineOrchestrator } from '../pipeline-orchestrator.js';

// --- Log Levels ---

export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.Debug]: 'debug',
  [LogLevel.Info]: 'info',
  [LogLevel.Warn]: 'warn',
  [LogLevel.Error]: 'error',
};

function parseLogLevel(value: string | undefined): LogLevel {
  switch (value?.toLowerCase()) {
    case 'debug': return LogLevel.Debug;
    case 'info': return LogLevel.Info;
    case 'warn': return LogLevel.Warn;
    case 'error': return LogLevel.Error;
    default: return LogLevel.Info;
  }
}

// --- Event Types ---

export type LogEvent =
  | 'team_created'
  | 'task_assigned'
  | 'task_classified'
  | 'task_complete'
  | 'agent_spawned'
  | 'agent_errored'
  | 'agent_respawned'
  | 'message_sent'
  | 'message_received'
  | 'message_malformed'
  | 'phase_transition'
  | 'timeout_warning'
  | 'timeout_exceeded'
  | 'deadlock_detected'
  | 'loop_limit_reached'
  | 'shutdown_initiated'
  | 'health_check_failed'
  | 'validation_error'
  | 'agent_output';

// --- Structured Log Entry ---

export interface LogEntry {
  timestamp: string;
  level: string;
  teamId: string | null;
  phase: string | null;
  roleSource: string | null;
  roleSourceInstance: string | null;
  roleTarget: string | null;
  messageId: string | null;
  flag: string | null;
  event: LogEvent;
  message: string;
  data: Record<string, unknown>;
}

// --- ANSI Colors ---

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  purple: '\x1b[35m',
  brightRed: '\x1b[91m',
  cyan: '\x1b[36m',
};

const ROLE_COLORS: Record<string, string> = {
  Worker: ANSI.green,
  Security: ANSI.red,
  Reviewer: ANSI.yellow,
};

const PHASE_COLORS: Record<string, string> = {
  [TeamPhase.PreWork]: ANSI.blue,
  [TeamPhase.Work]: ANSI.green,
  [TeamPhase.Handoff]: ANSI.yellow,
  [TeamPhase.Review]: ANSI.purple,
  [TeamPhase.Done]: ANSI.green,
  [TeamPhase.Errored]: ANSI.brightRed,
  [TeamPhase.Cancelled]: ANSI.dim,
};

const LEVEL_COLORS: Record<string, string> = {
  debug: ANSI.dim,
  info: ANSI.cyan,
  warn: ANSI.yellow,
  error: ANSI.brightRed,
};

const LEVEL_LABELS: Record<string, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};

// --- Log file rotation ---

const MAX_MAIN_LOG_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ERROR_LOG_BYTES = 5 * 1024 * 1024;  // 5 MB

// --- Logger ---

export interface LoggerOptions {
  /** Directory for global log files (default: data/logs) */
  logDirectory: string;
  /** Directory for per-team data (default: data/teams) */
  teamsDirectory: string;
  /** Minimum level to output (default: from env or info) */
  level?: LogLevel;
  /** Whether to write to terminal (default: true) */
  terminal?: boolean;
  /** Whether to write to log files (default: true) */
  fileOutput?: boolean;
}

export class Logger {
  private readonly logDir: string;
  private readonly teamsDir: string;
  private readonly level: LogLevel;
  private readonly terminal: boolean;
  private readonly fileOutput: boolean;

  private mainLogPath: string;
  private errorLogPath: string;
  private mainLogFd: number | null = null;
  private errorLogFd: number | null = null;
  private teamLogFds: Map<string, number> = new Map();

  constructor(options: LoggerOptions) {
    this.logDir = options.logDirectory;
    this.teamsDir = options.teamsDirectory;
    this.level = options.level ?? parseLogLevel(process.env.CLAUDE_ORCHESTRA_LOG_LEVEL);
    this.terminal = options.terminal ?? true;
    this.fileOutput = options.fileOutput ?? true;

    this.mainLogPath = path.join(this.logDir, 'orchestra.log');
    this.errorLogPath = path.join(this.logDir, 'orchestra.error.log');

    if (this.fileOutput) {
      fs.mkdirSync(this.logDir, { recursive: true });
      this.mainLogFd = fs.openSync(this.mainLogPath, 'a');
      this.errorLogFd = fs.openSync(this.errorLogPath, 'a');
    }
  }

  // --- Core log method ---

  log(
    level: LogLevel,
    event: LogEvent,
    message: string,
    context?: {
      teamId?: string;
      phase?: string;
      roleSource?: string;
      roleSourceInstance?: string;
      roleTarget?: string;
      messageId?: string;
      flag?: string;
      data?: Record<string, unknown>;
    }
  ): void {
    if (level < this.level) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LOG_LEVEL_NAMES[level],
      teamId: context?.teamId ?? null,
      phase: context?.phase ?? null,
      roleSource: context?.roleSource ?? null,
      roleSourceInstance: context?.roleSourceInstance ?? null,
      roleTarget: context?.roleTarget ?? null,
      messageId: context?.messageId ?? null,
      flag: context?.flag ?? null,
      event,
      message,
      data: context?.data ?? {},
    };

    // Terminal output
    if (this.terminal) {
      this.writeTerminal(entry);
    }

    // File output
    if (this.fileOutput) {
      const json = JSON.stringify(entry) + '\n';
      this.writeToMainLog(json);

      if (level >= LogLevel.Error) {
        this.writeToErrorLog(json);
      }

      if (entry.teamId) {
        this.writeToTeamLog(entry.teamId, json);
      }
    }
  }

  // --- Convenience methods ---

  debug(event: LogEvent, message: string, context?: Parameters<Logger['log']>[3]): void {
    this.log(LogLevel.Debug, event, message, context);
  }

  info(event: LogEvent, message: string, context?: Parameters<Logger['log']>[3]): void {
    this.log(LogLevel.Info, event, message, context);
  }

  warn(event: LogEvent, message: string, context?: Parameters<Logger['log']>[3]): void {
    this.log(LogLevel.Warn, event, message, context);
  }

  error(event: LogEvent, message: string, context?: Parameters<Logger['log']>[3]): void {
    this.log(LogLevel.Error, event, message, context);
  }

  // --- Orchestrator integration ---

  /**
   * Wire all orchestrator events to structured log output.
   */
  attach(orchestrator: PipelineOrchestrator): void {
    orchestrator.on('team-created', (teamId) => {
      this.info('team_created', `Team created: ${teamId}`, { teamId });
    });

    orchestrator.on('task-classified', (teamId, complexity, agentCount) => {
      this.info('task_classified', `Complexity: ${complexity} (${agentCount} agents)`, {
        teamId,
        data: { complexity, agentCount },
      });
    });

    orchestrator.on('task-assigned', (teamId, description) => {
      this.info('task_assigned', `Task assigned: ${description}`, {
        teamId,
        data: { description },
      });
    });

    orchestrator.on('phase-transition', (teamId, from, to, trigger) => {
      const level = to === TeamPhase.Errored ? LogLevel.Error :
        to === TeamPhase.Cancelled ? LogLevel.Warn : LogLevel.Info;
      const isLoopLimit = to === TeamPhase.Errored &&
        (trigger.includes('revision') || trigger.includes('rejection') || trigger.includes('backward'));
      const event: LogEvent = isLoopLimit ? 'loop_limit_reached' : 'phase_transition';

      this.log(level, event, `${teamId}: ${from} -> ${to} (${trigger})`, {
        teamId,
        phase: to,
        data: { from, to, trigger },
      });
    });

    orchestrator.on('task-complete', (teamId, phase, durationMs) => {
      const seconds = (durationMs / 1000).toFixed(1);
      const outcome = phase === TeamPhase.Done ? 'SUCCESS' :
        phase === TeamPhase.Errored ? 'ERRORED' : 'CANCELLED';
      this.info('task_complete', `Task ${outcome} in ${seconds}s`, {
        teamId,
        phase,
        data: { outcome, durationMs, durationSeconds: parseFloat(seconds) },
      });
    });

    orchestrator.on('agent-output', (teamId, instance, data) => {
      const truncated = data.length > 200 ? data.substring(0, 200) + '...' : data;
      this.debug('agent_output', `${instance}: ${truncated}`, {
        teamId,
        roleSourceInstance: instance,
        data: { length: data.length },
      });
    });

    orchestrator.on('agent-stderr', (teamId, instance, data) => {
      this.error('agent_errored', `${instance} stderr: ${data}`, {
        teamId,
        roleSourceInstance: instance,
        data: { stderr: data },
      });
    });

    orchestrator.on('agent-crashed', (teamId, instance, code) => {
      this.error('agent_errored', `${instance} crashed (exit ${code})`, {
        teamId,
        roleSourceInstance: instance,
        data: { exitCode: code },
      });
    });

    orchestrator.on('agent-respawned', (teamId, instance) => {
      this.warn('agent_respawned', `${instance} respawned`, {
        teamId,
        roleSourceInstance: instance,
      });
    });

    orchestrator.on('malformed-output', (teamId, instance, raw) => {
      const preview = raw.length > 100 ? raw.substring(0, 100) + '...' : raw;
      this.warn('message_malformed', `${instance} sent invalid output: ${preview}`, {
        teamId,
        roleSourceInstance: instance,
        data: { rawLength: raw.length },
      });
    });

    orchestrator.on('deadlock-detected', (teamId) => {
      this.error('deadlock_detected', `Deadlock detected in ${teamId}`, { teamId });
    });

    orchestrator.on('error', (teamId, err) => {
      const event: LogEvent = err.message.includes('validation')
        ? 'validation_error' : 'agent_errored';
      this.error(event, `${teamId}: ${err.message}`, {
        teamId,
        data: { error: err.message },
      });
    });

    orchestrator.on('shutdown', () => {
      this.info('shutdown_initiated', 'Orchestrator shutdown complete');
    });
  }

  // --- Cleanup ---

  dispose(): void {
    if (this.mainLogFd !== null) {
      fs.closeSync(this.mainLogFd);
      this.mainLogFd = null;
    }
    if (this.errorLogFd !== null) {
      fs.closeSync(this.errorLogFd);
      this.errorLogFd = null;
    }
    for (const fd of this.teamLogFds.values()) {
      fs.closeSync(fd);
    }
    this.teamLogFds.clear();
  }

  // --- Private: Terminal formatting ---

  private writeTerminal(entry: LogEntry): void {
    const time = entry.timestamp.substring(11, 23); // HH:MM:SS.mmm
    const levelColor = LEVEL_COLORS[entry.level] ?? ANSI.reset;
    const levelLabel = LEVEL_LABELS[entry.level] ?? entry.level.toUpperCase();

    // Build the prefix: [time] LEVEL
    let line = `${ANSI.dim}${time}${ANSI.reset} ${levelColor}${levelLabel}${ANSI.reset} `;

    // Add team context if present
    if (entry.teamId) {
      line += `${ANSI.dim}[${entry.teamId}]${ANSI.reset} `;
    }

    // Format based on event type
    switch (entry.event) {
      case 'phase_transition': {
        const from = entry.data.from as string;
        const to = entry.data.to as string;
        const trigger = entry.data.trigger as string;
        const toColor = PHASE_COLORS[to] ?? ANSI.reset;
        line += `${ANSI.bold}Phase:${ANSI.reset} ${from} ${ANSI.dim}->${ANSI.reset} ${toColor}${to}${ANSI.reset} (${trigger})`;
        break;
      }

      case 'message_sent':
      case 'message_received': {
        const srcColor = this.instanceColor(entry.roleSourceInstance);
        const arrow = entry.event === 'message_sent' ? '=>' : '->';
        line += `${srcColor}${entry.roleSourceInstance}${ANSI.reset} ${arrow} ` +
          `[${ANSI.bold}${entry.flag}${ANSI.reset}] ${arrow} ${entry.roleTarget}`;
        break;
      }

      case 'agent_output': {
        const roleColor = this.instanceColor(entry.roleSourceInstance);
        line += `${roleColor}${entry.roleSourceInstance}${ANSI.reset} ${ANSI.dim}output:${ANSI.reset} ${entry.message.substring((entry.roleSourceInstance?.length ?? 0) + 2)}`;
        break;
      }

      case 'agent_errored': {
        line += `${ANSI.brightRed}CRASH${ANSI.reset} ${entry.roleSourceInstance ?? ''}: ${entry.message}`;
        break;
      }

      case 'agent_respawned': {
        line += `${ANSI.yellow}RESPAWN${ANSI.reset} ${entry.roleSourceInstance}`;
        break;
      }

      case 'message_malformed': {
        line += `${ANSI.yellow}MALFORMED${ANSI.reset} ${entry.roleSourceInstance}: invalid output`;
        break;
      }

      case 'deadlock_detected': {
        line += `${ANSI.brightRed}${ANSI.bold}DEADLOCK${ANSI.reset} No active agents, no pending messages`;
        break;
      }

      case 'loop_limit_reached': {
        line += `${ANSI.brightRed}${ANSI.bold}LOOP LIMIT${ANSI.reset} ${entry.message}`;
        break;
      }

      case 'team_created': {
        line += `${ANSI.bold}Team created${ANSI.reset}`;
        break;
      }

      case 'task_classified': {
        const cplx = entry.data.complexity as string;
        const count = entry.data.agentCount as number;
        const cplxColor = cplx === 'simple' ? ANSI.green : ANSI.cyan;
        line += `${ANSI.bold}Route:${ANSI.reset} ${cplxColor}${cplx}${ANSI.reset} pipeline (${count} agents)`;
        break;
      }

      case 'task_assigned': {
        const desc = entry.data.description as string;
        const truncated = desc.length > 80 ? desc.substring(0, 80) + '...' : desc;
        line += `${ANSI.bold}Task:${ANSI.reset} ${truncated}`;
        break;
      }

      case 'task_complete': {
        const outcome = entry.data.outcome as string;
        const secs = entry.data.durationSeconds as number;
        const outcomeColor = outcome === 'SUCCESS' ? ANSI.green :
          outcome === 'ERRORED' ? ANSI.brightRed : ANSI.yellow;
        line += `\n` +
          `${outcomeColor}${ANSI.bold}════════════════════════════════════════${ANSI.reset}\n` +
          `${outcomeColor}${ANSI.bold}  TASK ${outcome}${ANSI.reset}  ⏱  ${secs}s\n` +
          `${outcomeColor}${ANSI.bold}════════════════════════════════════════${ANSI.reset}`;
        break;
      }

      case 'shutdown_initiated': {
        line += `${ANSI.purple}${entry.message}${ANSI.reset}`;
        break;
      }

      default:
        line += entry.message;
    }

    console.log(line);
  }

  private instanceColor(instance: string | null): string {
    if (!instance) return ANSI.reset;
    for (const [role, color] of Object.entries(ROLE_COLORS)) {
      if (instance.startsWith(role)) return color;
    }
    return ANSI.reset;
  }

  // --- Private: File output ---

  private writeToMainLog(json: string): void {
    if (this.mainLogFd === null) return;
    try {
      this.rotateIfNeeded(this.mainLogPath, this.mainLogFd, MAX_MAIN_LOG_BYTES, () => {
        this.mainLogFd = fs.openSync(this.mainLogPath, 'a');
      });
      fs.writeSync(this.mainLogFd, json);
    } catch {
      // Best effort
    }
  }

  private writeToErrorLog(json: string): void {
    if (this.errorLogFd === null) return;
    try {
      this.rotateIfNeeded(this.errorLogPath, this.errorLogFd, MAX_ERROR_LOG_BYTES, () => {
        this.errorLogFd = fs.openSync(this.errorLogPath, 'a');
      });
      fs.writeSync(this.errorLogFd, json);
    } catch {
      // Best effort
    }
  }

  private writeToTeamLog(teamId: string, json: string): void {
    try {
      let fd = this.teamLogFds.get(teamId);
      if (fd === undefined) {
        const teamDir = path.join(this.teamsDir, teamId);
        fs.mkdirSync(teamDir, { recursive: true });
        fd = fs.openSync(path.join(teamDir, 'team.log'), 'a');
        this.teamLogFds.set(teamId, fd);
      }
      fs.writeSync(fd, json);
    } catch {
      // Best effort
    }
  }

  private rotateIfNeeded(
    filePath: string,
    fd: number,
    maxBytes: number,
    reopen: () => void
  ): void {
    try {
      const stat = fs.fstatSync(fd);
      if (stat.size >= maxBytes) {
        fs.closeSync(fd);
        const rotatedPath = filePath + '.1';
        // Simple single-file rotation: .log -> .log.1
        if (fs.existsSync(rotatedPath)) {
          fs.unlinkSync(rotatedPath);
        }
        fs.renameSync(filePath, rotatedPath);
        reopen();
      }
    } catch {
      // Best effort
    }
  }
}
