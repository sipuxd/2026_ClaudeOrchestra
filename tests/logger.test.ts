import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LogEntry, Logger, LogLevel } from '../src/logger/logger.js';
import { PipelineOrchestrator } from '../src/pipeline-orchestrator.js';
import { TeamPhase } from '../src/state/team-state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readLogEntries(filePath: string): LogEntry[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEntry);
}

describe('Logger', () => {
  describe('file output', () => {
    it('writes structured JSON to the main log file', () => {
      const logDir = path.join(tmpDir, 'logs');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: path.join(tmpDir, 'teams'),
        terminal: false,
      });

      logger.info('team_created', 'Test team created', { teamId: 'test-1' });
      logger.dispose();

      const entries = readLogEntries(path.join(logDir, 'orchestra.log'));
      expect(entries).toHaveLength(1);
      expect(entries[0].event).toBe('team_created');
      expect(entries[0].level).toBe('info');
      expect(entries[0].teamId).toBe('test-1');
      expect(entries[0].message).toBe('Test team created');
      expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('writes errors to both main and error log', () => {
      const logDir = path.join(tmpDir, 'logs');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: path.join(tmpDir, 'teams'),
        terminal: false,
      });

      logger.error('deadlock_detected', 'Deadlock in team-x', { teamId: 'team-x' });
      logger.dispose();

      const mainEntries = readLogEntries(path.join(logDir, 'orchestra.log'));
      const errorEntries = readLogEntries(path.join(logDir, 'orchestra.error.log'));
      expect(mainEntries).toHaveLength(1);
      expect(errorEntries).toHaveLength(1);
      expect(errorEntries[0].event).toBe('deadlock_detected');
    });

    it('does not write info to the error log', () => {
      const logDir = path.join(tmpDir, 'logs');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: path.join(tmpDir, 'teams'),
        terminal: false,
      });

      logger.info('team_created', 'Created');
      logger.dispose();

      const errorEntries = readLogEntries(path.join(logDir, 'orchestra.error.log'));
      expect(errorEntries).toHaveLength(0);
    });

    it('writes to per-team log file when teamId is present', () => {
      const logDir = path.join(tmpDir, 'logs');
      const teamsDir = path.join(tmpDir, 'teams');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: teamsDir,
        terminal: false,
      });

      logger.info('task_assigned', 'Task assigned', { teamId: 'my-team' });
      logger.dispose();

      const teamEntries = readLogEntries(path.join(teamsDir, 'my-team', 'team.log'));
      expect(teamEntries).toHaveLength(1);
      expect(teamEntries[0].teamId).toBe('my-team');
    });

    it('does not write team log when teamId is absent', () => {
      const logDir = path.join(tmpDir, 'logs');
      const teamsDir = path.join(tmpDir, 'teams');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: teamsDir,
        terminal: false,
      });

      logger.info('shutdown_initiated', 'Shutting down');
      logger.dispose();

      expect(fs.existsSync(teamsDir)).toBe(false);
    });
  });

  describe('log levels', () => {
    it('respects minimum log level', () => {
      const logDir = path.join(tmpDir, 'logs');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: path.join(tmpDir, 'teams'),
        level: LogLevel.Warn,
        terminal: false,
      });

      logger.debug('message_sent', 'debug msg');
      logger.info('team_created', 'info msg');
      logger.warn('message_malformed', 'warn msg');
      logger.error('deadlock_detected', 'error msg');
      logger.dispose();

      const entries = readLogEntries(path.join(logDir, 'orchestra.log'));
      expect(entries).toHaveLength(2);
      expect(entries[0].level).toBe('warn');
      expect(entries[1].level).toBe('error');
    });

    it('debug level captures everything', () => {
      const logDir = path.join(tmpDir, 'logs');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: path.join(tmpDir, 'teams'),
        level: LogLevel.Debug,
        terminal: false,
      });

      logger.debug('message_sent', 'a');
      logger.info('team_created', 'b');
      logger.warn('message_malformed', 'c');
      logger.error('agent_errored', 'd');
      logger.dispose();

      const entries = readLogEntries(path.join(logDir, 'orchestra.log'));
      expect(entries).toHaveLength(4);
    });
  });

  describe('structured entry fields', () => {
    it('populates all context fields', () => {
      const logDir = path.join(tmpDir, 'logs');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: path.join(tmpDir, 'teams'),
        level: LogLevel.Debug,
        terminal: false,
      });

      logger.debug('message_received', 'Worker-1 sent progress', {
        teamId: 'team-a',
        phase: 'work',
        roleSourceInstance: 'Worker-1',
        roleTarget: 'Security',
        flag: 'progress-update',
        data: { percent: 50 },
      });
      logger.dispose();

      const entries = readLogEntries(path.join(logDir, 'orchestra.log'));
      expect(entries).toHaveLength(1);
      const e = entries[0];
      expect(e.teamId).toBe('team-a');
      expect(e.phase).toBe('work');
      expect(e.roleSourceInstance).toBe('Worker-1');
      expect(e.roleTarget).toBe('Security');
      expect(e.flag).toBe('progress-update');
      expect(e.data).toEqual({ percent: 50 });
    });

    it('defaults null for missing context fields', () => {
      const logDir = path.join(tmpDir, 'logs');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: path.join(tmpDir, 'teams'),
        terminal: false,
      });

      logger.info('shutdown_initiated', 'bye');
      logger.dispose();

      const e = readLogEntries(path.join(logDir, 'orchestra.log'))[0];
      expect(e.teamId).toBeNull();
      expect(e.phase).toBeNull();
      expect(e.roleSourceInstance).toBeNull();
      expect(e.roleTarget).toBeNull();
      expect(e.flag).toBeNull();
    });
  });

  describe('orchestrator integration', () => {
    it('logs team_created event via attach', () => {
      const logDir = path.join(tmpDir, 'logs');
      const teamsDir = path.join(tmpDir, 'data', 'teams');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: teamsDir,
        terminal: false,
      });

      const projDir = path.join(tmpDir, 'proj');
      fs.mkdirSync(projDir, { recursive: true });
      const rolesDir = path.join(tmpDir, 'roles');
      fs.mkdirSync(rolesDir, { recursive: true });
      fs.writeFileSync(path.join(rolesDir, 'worker-1.agent.md'), '# Worker-1');
      fs.writeFileSync(path.join(rolesDir, 'worker-2.agent.md'), '# Worker-2');
      fs.writeFileSync(path.join(rolesDir, 'security.agent.md'), '# Security');
      fs.writeFileSync(path.join(rolesDir, 'reviewer.agent.md'), '# Reviewer');
      fs.writeFileSync(path.join(rolesDir, 'coordinator.agent.md'), '# Coordinator');
      const orchestrator = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry.json'),
        rolesDir,
      });

      logger.attach(orchestrator);
      orchestrator.createTeam('int-test', projDir);

      logger.dispose();

      const entries = readLogEntries(path.join(logDir, 'orchestra.log'));
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].event).toBe('team_created');
      expect(entries[0].teamId).toBe('int-test');
    });

    it('logs phase_transition on terminate', async () => {
      const logDir = path.join(tmpDir, 'logs');
      const teamsDir = path.join(tmpDir, 'data', 'teams');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: teamsDir,
        terminal: false,
      });

      const projDir = path.join(tmpDir, 'proj2');
      fs.mkdirSync(projDir, { recursive: true });
      const rolesDir = path.join(tmpDir, 'roles');
      fs.mkdirSync(rolesDir, { recursive: true });
      fs.writeFileSync(path.join(rolesDir, 'worker-1.agent.md'), '# Worker-1');
      fs.writeFileSync(path.join(rolesDir, 'worker-2.agent.md'), '# Worker-2');
      fs.writeFileSync(path.join(rolesDir, 'security.agent.md'), '# Security');
      fs.writeFileSync(path.join(rolesDir, 'reviewer.agent.md'), '# Reviewer');
      fs.writeFileSync(path.join(rolesDir, 'coordinator.agent.md'), '# Coordinator');
      const orchestrator = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry2.json'),
        rolesDir,
      });

      logger.attach(orchestrator);
      orchestrator.createTeam('term-test', projDir);
      await orchestrator.terminateTeam('term-test');

      logger.dispose();

      const entries = readLogEntries(path.join(logDir, 'orchestra.log'));
      const transitionEntries = entries.filter((e) => e.event === 'phase_transition');
      expect(transitionEntries.length).toBeGreaterThanOrEqual(1);
      expect(transitionEntries[0].data.to).toBe(TeamPhase.Cancelled);
    });

    it('logs shutdown event', async () => {
      const logDir = path.join(tmpDir, 'logs');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: path.join(tmpDir, 'teams'),
        terminal: false,
      });

      const rolesDir = path.join(tmpDir, 'roles');
      fs.mkdirSync(rolesDir, { recursive: true });
      fs.writeFileSync(path.join(rolesDir, 'worker-1.agent.md'), '# Worker-1');
      fs.writeFileSync(path.join(rolesDir, 'worker-2.agent.md'), '# Worker-2');
      fs.writeFileSync(path.join(rolesDir, 'security.agent.md'), '# Security');
      fs.writeFileSync(path.join(rolesDir, 'reviewer.agent.md'), '# Reviewer');
      fs.writeFileSync(path.join(rolesDir, 'coordinator.agent.md'), '# Coordinator');
      const orchestrator = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry3.json'),
        rolesDir,
      });

      logger.attach(orchestrator);
      await orchestrator.shutdown();

      logger.dispose();

      const entries = readLogEntries(path.join(logDir, 'orchestra.log'));
      const shutdownEntries = entries.filter((e) => e.event === 'shutdown_initiated');
      expect(shutdownEntries).toHaveLength(1);
    });
  });

  describe('dispose', () => {
    it('can be called multiple times safely', () => {
      const logger = new Logger({
        logDirectory: path.join(tmpDir, 'logs'),
        teamsDirectory: path.join(tmpDir, 'teams'),
        terminal: false,
      });

      expect(() => {
        logger.dispose();
        logger.dispose();
      }).not.toThrow();
    });
  });

  describe('file output disabled', () => {
    it('does not create log files when fileOutput is false', () => {
      const logDir = path.join(tmpDir, 'logs-disabled');
      const logger = new Logger({
        logDirectory: logDir,
        teamsDirectory: path.join(tmpDir, 'teams'),
        terminal: false,
        fileOutput: false,
      });

      logger.info('team_created', 'Test');
      logger.dispose();

      expect(fs.existsSync(logDir)).toBe(false);
    });
  });
});
