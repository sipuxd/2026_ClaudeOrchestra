import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the SDK before importing anything that uses it
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => {
    async function* gen(): AsyncGenerator<any> {
      /* yields nothing */
    }
    const g = gen();
    return Object.assign(g, { close: () => {} });
  }),
}));

import { DashboardServer } from '../src/dashboard/dashboard-server.js';
import { PipelineOrchestrator } from '../src/pipeline-orchestrator.js';

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

// --- Test helpers ---

function httpRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: object,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 500, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function getRandomPort(): number {
  return 30000 + Math.floor(Math.random() * 20000);
}

// --- Tests ---

describe('DashboardServer', () => {
  let tmpDir: string;
  let rolesDir: string;
  let orchestrator: PipelineOrchestrator;
  let dashboard: DashboardServer;
  let port: number;
  let originalGuardedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    originalGuardedEnv = {};
    for (const key of GUARDED_ENV_KEYS) {
      originalGuardedEnv[key] = process.env[key];
      delete process.env[key];
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-test-'));
    rolesDir = path.join(tmpDir, 'roles');
    fs.mkdirSync(rolesDir, { recursive: true });
    fs.writeFileSync(path.join(rolesDir, 'worker-1.agent.md'), '# Worker-1');
    fs.writeFileSync(path.join(rolesDir, 'worker-2.agent.md'), '# Worker-2');
    fs.writeFileSync(path.join(rolesDir, 'security.agent.md'), '# Security');
    fs.writeFileSync(path.join(rolesDir, 'reviewer.agent.md'), '# Reviewer');

    orchestrator = new PipelineOrchestrator({
      registryPath: path.join(tmpDir, 'registry.json'),
      rolesDir,
    });

    port = getRandomPort();
    dashboard = new DashboardServer({ orchestrator, port });
    await dashboard.start();
  });

  afterEach(async () => {
    await dashboard.close();
    await orchestrator.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const key of GUARDED_ENV_KEYS) {
      const value = originalGuardedEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  // --- HTML ---

  describe('GET /', () => {
    it('serves the dashboard HTML', async () => {
      const res = await httpRequest(port, 'GET', '/');
      expect(res.status).toBe(200);
      expect(res.body).toContain('<!DOCTYPE html>');
      expect(res.body).toContain('ClaudeOrchestra');
    });
  });

  // --- Teams API ---

  describe('GET /api/teams', () => {
    it('returns empty array when no teams', async () => {
      const res = await httpRequest(port, 'GET', '/api/teams');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns teams after creation', async () => {
      const projectPath = path.join(tmpDir, 'project1');
      fs.mkdirSync(projectPath, { recursive: true });
      orchestrator.createTeam('test-team', projectPath);

      const res = await httpRequest(port, 'GET', '/api/teams');
      const teams = JSON.parse(res.body);
      expect(teams).toHaveLength(1);
      expect(teams[0].teamId).toBe('test-team');
    });
  });

  describe('GET /api/runtime', () => {
    it('returns the active agent runtime', async () => {
      const res = await httpRequest(port, 'GET', '/api/runtime');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        provider: 'claude',
        auth: 'subscription',
      });
    });
  });

  describe('GET /api/teams/:id', () => {
    it('returns team status', async () => {
      const projectPath = path.join(tmpDir, 'project2');
      fs.mkdirSync(projectPath, { recursive: true });
      orchestrator.createTeam('detail-team', projectPath);

      const res = await httpRequest(port, 'GET', '/api/teams/detail-team');
      expect(res.status).toBe(200);
      const team = JSON.parse(res.body);
      expect(team.teamId).toBe('detail-team');
      expect(team.currentPhase).toBe('pre_work');
    });

    it('returns 404 for unknown team', async () => {
      const res = await httpRequest(port, 'GET', '/api/teams/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/teams', () => {
    it('creates a team', async () => {
      const projectPath = path.join(tmpDir, 'new-project');
      fs.mkdirSync(projectPath, { recursive: true });
      const res = await httpRequest(port, 'POST', '/api/teams', {
        name: 'http-team',
        projectPath,
      });
      expect(res.status).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.teamId).toBe('http-team');
      expect(body.projectPath).toBe(projectPath);
    });

    it('returns 400 for missing name', async () => {
      const res = await httpRequest(port, 'POST', '/api/teams', {
        projectPath: '/tmp/test',
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain('required');
    });

    it('returns 400 for missing projectPath', async () => {
      const res = await httpRequest(port, 'POST', '/api/teams', {
        name: 'no-path',
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain('required');
    });

    it('returns 400 for duplicate team name', async () => {
      const projectPath = path.join(tmpDir, 'dup-project');
      fs.mkdirSync(projectPath, { recursive: true });
      fs.mkdirSync(projectPath + '2', { recursive: true });
      await httpRequest(port, 'POST', '/api/teams', {
        name: 'dup-team',
        projectPath,
      });
      const res = await httpRequest(port, 'POST', '/api/teams', {
        name: 'dup-team',
        projectPath: projectPath + '2',
      });
      expect(res.status).toBe(400);
    });
  });

  // --- Task API ---

  describe('POST /api/teams/:id/task', () => {
    it('returns 400 for missing description', async () => {
      const projectPath = path.join(tmpDir, 'task-project');
      fs.mkdirSync(projectPath, { recursive: true });
      orchestrator.createTeam('task-team', projectPath);

      const res = await httpRequest(port, 'POST', '/api/teams/task-team/task', {});
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain('required');
    });
  });

  // --- Stop API ---

  describe('POST /api/teams/:id/stop', () => {
    it('terminates a team', async () => {
      const projectPath = path.join(tmpDir, 'stop-project');
      fs.mkdirSync(projectPath, { recursive: true });
      orchestrator.createTeam('stoppable', projectPath);

      const res = await httpRequest(port, 'POST', '/api/teams/stoppable/stop');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
    });
  });

  // --- SSE ---

  describe('GET /events (SSE)', () => {
    it('returns text/event-stream content type', async () => {
      return new Promise<void>((resolve) => {
        const req = http.get(`http://localhost:${port}/events`, (res) => {
          expect(res.headers['content-type']).toBe('text/event-stream');
          req.destroy();
          resolve();
        });
      });
    });

    it('sends init event with current teams', async () => {
      const projectPath = path.join(tmpDir, 'sse-project');
      fs.mkdirSync(projectPath, { recursive: true });
      orchestrator.createTeam('sse-test', projectPath);

      return new Promise<void>((resolve) => {
        const req = http.get(`http://localhost:${port}/events`, (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: init')) {
              const match = data.match(/data: (.+)\n/);
              if (match) {
                const parsed = JSON.parse(match[1]);
                expect(parsed.teams).toHaveLength(1);
                expect(parsed.teams[0].teamId).toBe('sse-test');
                expect(parsed.runtime).toEqual({
                  provider: 'claude',
                  auth: 'subscription',
                });
                req.destroy();
                resolve();
              }
            }
          });
        });
      });
    });

    it('broadcasts team-created events', async () => {
      return new Promise<void>((resolve) => {
        const req = http.get(`http://localhost:${port}/events`, (res) => {
          let data = '';
          let gotInit = false;
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            // Wait for init event first, then create a team
            if (!gotInit && data.includes('event: init')) {
              gotInit = true;
              const projectPath = path.join(tmpDir, 'broadcast-project');
              fs.mkdirSync(projectPath, { recursive: true });
              orchestrator.createTeam('broadcast-test', projectPath);
            }
            // Check for team-created event
            if (gotInit && data.includes('event: team-created')) {
              const lines = data.split('\n');
              const teamCreatedIdx = lines.indexOf('event: team-created');
              if (teamCreatedIdx >= 0 && lines[teamCreatedIdx + 1]) {
                const eventData = JSON.parse(lines[teamCreatedIdx + 1].replace('data: ', ''));
                expect(eventData.teamId).toBe('broadcast-test');
                req.destroy();
                resolve();
              }
            }
          });
        });
      });
    });
  });

  // --- 404 ---

  describe('unknown routes', () => {
    it('returns 404 for unknown paths', async () => {
      const res = await httpRequest(port, 'GET', '/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns 404 for unknown API paths', async () => {
      const res = await httpRequest(port, 'GET', '/api/unknown');
      expect(res.status).toBe(404);
    });
  });

  // --- Pipeline isolation ---

  describe('pipeline isolation', () => {
    it('dashboard does not interfere with orchestrator events', () => {
      const handler = vi.fn();
      orchestrator.on('team-created', handler);

      const projectPath = path.join(tmpDir, 'isolated-project');
      fs.mkdirSync(projectPath, { recursive: true });
      orchestrator.createTeam('isolated', projectPath);

      expect(handler).toHaveBeenCalledWith('isolated');
    });
  });

  // --- Ask endpoint ---

  describe('POST /api/teams/:id/ask', () => {
    it('returns 200 on valid ask request', async () => {
      const projectPath = path.join(tmpDir, 'ask-project');
      fs.mkdirSync(projectPath, { recursive: true });
      orchestrator.createTeam('ask-team', projectPath);

      const res = await httpRequest(port, 'POST', '/api/teams/ask-team/ask', {
        message: 'What did you change?',
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
    });

    it('returns 400 when message is missing', async () => {
      const projectPath = path.join(tmpDir, 'ask-missing');
      fs.mkdirSync(projectPath, { recursive: true });
      orchestrator.createTeam('ask-missing', projectPath);

      const res = await httpRequest(port, 'POST', '/api/teams/ask-missing/ask', {});
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain('required');
    });
  });

  // --- Feedback endpoint ---

  describe('POST /api/teams/:id/feedback', () => {
    it('returns 200 on valid feedback response', async () => {
      const projectPath = path.join(tmpDir, 'fb-project');
      fs.mkdirSync(projectPath, { recursive: true });
      orchestrator.createTeam('fb-team', projectPath);

      const res = await httpRequest(port, 'POST', '/api/teams/fb-team/feedback', {
        feedbackId: 'test-id-123',
        value: 'approve',
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
    });

    it('returns 400 when feedbackId is missing', async () => {
      const projectPath = path.join(tmpDir, 'fb-missing');
      fs.mkdirSync(projectPath, { recursive: true });
      orchestrator.createTeam('fb-missing', projectPath);

      const res = await httpRequest(port, 'POST', '/api/teams/fb-missing/feedback', {
        value: 'approve',
      });
      expect(res.status).toBe(400);
    });

    it('broadcasts feedback events via SSE', async () => {
      return new Promise<void>((resolve) => {
        const req = http.get(`http://localhost:${port}/events`, (res) => {
          let data = '';
          let gotInit = false;
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (!gotInit && data.includes('event: init')) {
              gotInit = true;
              // Emit a feedback event from the orchestrator
              const projectPath = path.join(tmpDir, 'fb-sse-project');
              fs.mkdirSync(projectPath, { recursive: true });
              orchestrator.createTeam('fb-sse', projectPath);
              orchestrator.emit('feedback', 'fb-sse', {
                id: 'test-fb-1',
                type: 'info' as const,
                title: 'Test Feedback',
                message: 'This is a test notification',
                blocking: false,
                timestamp: new Date().toISOString(),
              });
            }
            if (gotInit && data.includes('event: feedback')) {
              const lines = data.split('\n');
              const fbIdx = lines.indexOf('event: feedback');
              if (fbIdx >= 0 && lines[fbIdx + 1]) {
                const eventData = JSON.parse(lines[fbIdx + 1].replace('data: ', ''));
                expect(eventData.teamId).toBe('fb-sse');
                expect(eventData.title).toBe('Test Feedback');
                req.destroy();
                resolve();
              }
            }
          });
        });
      });
    });
  });
});
