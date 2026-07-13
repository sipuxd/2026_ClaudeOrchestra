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

import { DashboardServer, isLoopbackHost } from '../src/dashboard/dashboard-server.js';
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

/** Like httpRequest but exposes response headers and lets tests set headers/raw body. */
function rawRequest(
  port: number,
  method: string,
  urlPath: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method, headers: opts.headers ?? {} },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 500, headers: res.headers, body: data }),
        );
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
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
    fs.writeFileSync(path.join(rolesDir, 'coordinator.agent.md'), '# Coordinator');

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

  // --- Security hardening ---

  describe('security hardening', () => {
    it('recognizes loopback vs network-exposed hosts', () => {
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('localhost')).toBe(true);
      expect(isLoopbackHost('::1')).toBe(true);
      expect(isLoopbackHost('0.0.0.0')).toBe(false);
      expect(isLoopbackHost('192.168.1.5')).toBe(false);
    });

    it('does not advertise a wildcard CORS origin', async () => {
      const res = await rawRequest(port, 'GET', '/');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rejects a cross-origin mutating request with 403', async () => {
      const res = await rawRequest(port, 'POST', '/api/teams', {
        headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
        body: JSON.stringify({ name: 'x', projectPath: tmpDir }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects a request with a foreign Host header (DNS-rebinding defense)', async () => {
      // Simulate a DNS-rebinding request: connects to loopback but carries the
      // attacker's Host (and Origin), which the Origin==Host check alone would
      // allow. The Host allowlist refuses it.
      const res = await rawRequest(port, 'POST', '/api/teams', {
        headers: {
          'Content-Type': 'application/json',
          Host: 'evil.example:' + port,
          Origin: 'http://evil.example:' + port,
        },
        body: JSON.stringify({ name: 'x', projectPath: tmpDir }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects a non-JSON mutating request with 415', async () => {
      const res = await rawRequest(port, 'POST', '/api/teams', {
        headers: { 'Content-Type': 'text/plain' },
        body: 'name=x',
      });
      expect(res.status).toBe(415);
    });

    it('allows a same-origin JSON POST (no foreign Origin)', async () => {
      const projectPath = path.join(tmpDir, 'ok-project');
      fs.mkdirSync(projectPath, { recursive: true });
      const res = await rawRequest(port, 'POST', '/api/teams', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'allowed-team', projectPath }),
      });
      // Not blocked by CSRF/content-type guards — team is created.
      expect(res.status).toBe(201);
    });

    it('rejects a path-traversal team name with 400', async () => {
      const res = await rawRequest(port, 'POST', '/api/teams', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '../evil', projectPath: tmpDir }),
      });
      expect(res.status).toBe(400);
      expect(res.body).toContain('..');
    });
  });

  // --- Crash resistance (T1) ---

  describe('crash resistance', () => {
    it('answers 400 (not a crash) for a malformed percent-encoded route param', async () => {
      // decodeURIComponent('%') throws URIError; the handler must catch it.
      const res = await rawRequest(port, 'GET', '/api/teams/%');
      expect(res.status).toBe(400);
      // Server is still alive: a normal request succeeds afterward.
      const after = await rawRequest(port, 'GET', '/api/teams');
      expect(after.status).toBe(200);
    });

    it('answers 400 (not a crash) for a malformed Host header', async () => {
      // new URL('http://a b') throws; the handler must catch it before routing.
      const res = await rawRequest(port, 'GET', '/', { headers: { Host: 'a b' } });
      expect(res.status).toBe(400);
      const after = await rawRequest(port, 'GET', '/api/teams');
      expect(after.status).toBe(200);
    });

    it('rejects an oversized request body with 413', async () => {
      const projectPath = path.join(tmpDir, 'big-body');
      fs.mkdirSync(projectPath, { recursive: true });
      const huge = 'x'.repeat(6 * 1024 * 1024); // 6MB > 5MB cap
      const res = await rawRequest(port, 'POST', '/api/teams', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'big', projectPath, note: huge }),
      });
      expect(res.status).toBe(413);
    });
  });

  // --- Team creation edge cases (T3) ---

  describe('team creation', () => {
    it('creates + assigns under the trimmed teamId for a whitespace-padded name', async () => {
      const projectPath = path.join(tmpDir, 'ws-project');
      fs.mkdirSync(projectPath, { recursive: true });
      const res = await rawRequest(port, 'POST', '/api/teams', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '  spaced-team  ', projectPath, task: 'do X' }),
      });
      // createTeam trims to "spaced-team"; assignTask must use that id, not the
      // raw padded name (which would 400 with "team not found").
      expect(res.status).toBe(201);
      const after = await rawRequest(port, 'GET', '/api/teams/spaced-team');
      expect(after.status).toBe(200);
    });
  });

  describe('allowedHosts', () => {
    it('accepts a configured non-loopback Host header while bound to loopback', async () => {
      const orch2 = new PipelineOrchestrator({
        registryPath: path.join(tmpDir, 'registry-ah.json'),
        rolesDir,
      });
      const p2 = getRandomPort();
      const dash2 = new DashboardServer({
        orchestrator: orch2,
        port: p2,
        allowedHosts: ['tunnel.example.com'],
      });
      await dash2.start();
      try {
        // Allowlisted host passes; a random foreign host is still 403'd.
        const ok = await rawRequest(p2, 'GET', '/api/teams', {
          headers: { Host: 'tunnel.example.com' },
        });
        expect(ok.status).toBe(200);
        const bad = await rawRequest(p2, 'GET', '/api/teams', {
          headers: { Host: 'evil.example.com' },
        });
        expect(bad.status).toBe(403);
      } finally {
        await dash2.close();
        await orch2.shutdown();
      }
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

    it('init event teams include chatHistory for panel hydration', async () => {
      const projectPath = path.join(tmpDir, 'hydrate-project');
      fs.mkdirSync(projectPath, { recursive: true });
      orchestrator.createTeam('chat-hydrate', projectPath);
      // getTeamStatus returns the live snapshot (this.data by reference), so the
      // push reaches the array the init snapshot serializes.
      (orchestrator.getTeamStatus('chat-hydrate') as any).chatHistory.push({
        role: 'user',
        content: 'hello',
        timestamp: new Date().toISOString(),
      });

      return new Promise<void>((resolve) => {
        const req = http.get(`http://localhost:${port}/events`, (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: init')) {
              const match = data.match(/data: (.+)\n/);
              if (match) {
                const parsed = JSON.parse(match[1]);
                expect(Array.isArray(parsed.teams[0].chatHistory)).toBe(true);
                expect(parsed.teams[0].chatHistory).toContainEqual(
                  expect.objectContaining({ role: 'user', content: 'hello' }),
                );
                req.destroy();
                resolve();
              }
            }
          });
        });
      });
    });

    it('broadcasts pipeline errors as a "pipeline-error" event (not native "error")', async () => {
      return new Promise<void>((resolve) => {
        const req = http.get(`http://localhost:${port}/events`, (res) => {
          let data = '';
          let gotInit = false;
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (!gotInit && data.includes('event: init')) {
              gotInit = true;
              // Emitting the orchestrator 'error' must reach the client as an SSE
              // 'pipeline-error' event — naming it 'error' would collide with
              // EventSource's native connection-error event.
              orchestrator.emit('error', 'some-team', new Error('boom'));
            }
            if (gotInit && data.includes('event: pipeline-error')) {
              expect(data).not.toContain('event: error\n');
              expect(data).toContain('boom');
              req.destroy();
              resolve();
            }
          });
        });
      });
    });
  });

  // --- Preview file route ---

  describe('GET /preview/:teamId/:file', () => {
    it('blocks path traversal to a sibling directory with 403', async () => {
      const siteDir = path.join(tmpDir, 'site');
      fs.mkdirSync(siteDir, { recursive: true });
      fs.writeFileSync(path.join(siteDir, 'index.html'), '<h1>site</h1>');
      const evilDir = path.join(tmpDir, 'site-evil');
      fs.mkdirSync(evilDir, { recursive: true });
      fs.writeFileSync(path.join(evilDir, 'secret.txt'), 'TOPSECRET');
      orchestrator.createTeam('previewteam', siteDir);

      // `<root>-evil/secret.txt` would pass a bare startsWith(root) check.
      const res = await rawRequest(port, 'GET', '/preview/previewteam/..%2fsite-evil%2fsecret.txt');
      expect(res.status).toBe(403);
      expect(res.body).not.toContain('TOPSECRET');
    });

    it('resolves a percent-encoded filename (spaces) with 200', async () => {
      const siteDir = path.join(tmpDir, 'site2');
      fs.mkdirSync(siteDir, { recursive: true });
      fs.writeFileSync(path.join(siteDir, 'my page.html'), '<h1>hello preview</h1>');
      orchestrator.createTeam('previewteam2', siteDir);

      const res = await rawRequest(port, 'GET', '/preview/previewteam2/my%20page.html');
      expect(res.status).toBe(200);
      expect(res.body).toContain('hello preview');
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

  // --- SSE bridges for orchestrator events ---

  describe('SSE bridges', () => {
    it('broadcasts malformed-output events via SSE', async () => {
      return new Promise<void>((resolve) => {
        const req = http.get(`http://localhost:${port}/events`, (res) => {
          let data = '';
          let gotInit = false;
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (!gotInit && data.includes('event: init')) {
              gotInit = true;
              orchestrator.emit(
                'malformed-output',
                'mf-team',
                'Worker-2' as any,
                'gibberish-not-a-verdict',
              );
            }
            if (gotInit && data.includes('event: malformed-output')) {
              const lines = data.split('\n');
              const idx = lines.indexOf('event: malformed-output');
              if (idx >= 0 && lines[idx + 1]) {
                const eventData = JSON.parse(lines[idx + 1].replace('data: ', ''));
                expect(eventData.teamId).toBe('mf-team');
                expect(eventData.instance).toBe('Worker-2');
                expect(eventData.raw).toBe('gibberish-not-a-verdict');
                req.destroy();
                resolve();
              }
            }
          });
        });
      });
    });

    it('broadcasts feedback-response events via SSE', async () => {
      return new Promise<void>((resolve) => {
        const req = http.get(`http://localhost:${port}/events`, (res) => {
          let data = '';
          let gotInit = false;
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (!gotInit && data.includes('event: init')) {
              gotInit = true;
              orchestrator.emit('feedback-response', 'fbr-team', 'fb-xyz', 'approve');
            }
            if (gotInit && data.includes('event: feedback-response')) {
              const lines = data.split('\n');
              const idx = lines.indexOf('event: feedback-response');
              if (idx >= 0 && lines[idx + 1]) {
                const eventData = JSON.parse(lines[idx + 1].replace('data: ', ''));
                expect(eventData.teamId).toBe('fbr-team');
                expect(eventData.feedbackId).toBe('fb-xyz');
                expect(eventData.value).toBe('approve');
                req.destroy();
                resolve();
              }
            }
          });
        });
      });
    });

    // Multi-tab dismissal: two SSE clients subscribed at the same time both
    // receive `feedback-response`. Without this bridge, a feedback prompt
    // answered in one tab would stay visible in any other open tab.
    it('delivers feedback-response to multiple concurrent SSE clients', async () => {
      const waitForFeedbackResponse = (): Promise<{
        teamId: string;
        feedbackId: string;
        value: string;
      }> =>
        new Promise((resolve, reject) => {
          const req = http.get(`http://localhost:${port}/events`, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString();
              if (data.includes('event: feedback-response')) {
                const lines = data.split('\n');
                const idx = lines.indexOf('event: feedback-response');
                if (idx >= 0 && lines[idx + 1]) {
                  const eventData = JSON.parse(lines[idx + 1].replace('data: ', ''));
                  req.destroy();
                  resolve(eventData);
                }
              }
            });
            res.on('error', reject);
          });
          req.on('error', reject);
        });

      const clientA = waitForFeedbackResponse();
      const clientB = waitForFeedbackResponse();

      // Allow both SSE clients to register before emitting. The first message
      // SSE sends is `init`, so a small delay is enough to ensure both clients
      // are in the broadcast set when the event fires.
      await new Promise((r) => setTimeout(r, 100));
      orchestrator.emit('feedback-response', 'multi-team', 'fb-multi', 'reject');

      const [a, b] = await Promise.all([clientA, clientB]);
      expect(a.teamId).toBe('multi-team');
      expect(a.feedbackId).toBe('fb-multi');
      expect(a.value).toBe('reject');
      expect(b).toEqual(a);
    });
  });
});
