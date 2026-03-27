// DashboardServer — Live dashboard for PipelineOrchestrator.
//
// Serves a single-page dashboard over HTTP and streams real-time
// orchestrator events via SSE. Uses Node.js built-in http module
// (no Express or WebSocket dependencies).

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import type { PipelineOrchestrator } from '../pipeline-orchestrator.js';
import type { RoleInstance } from '../roles/role-types.js';
import { buildDashboardHTML } from './dashboard-ui.js';

export interface DashboardServerOptions {
  orchestrator: PipelineOrchestrator;
  port: number;
  host?: string;
}

export class DashboardServer {
  private readonly orchestrator: PipelineOrchestrator;
  private readonly port: number;
  private readonly host: string;
  private server: http.Server | null = null;
  private sseClients: Set<http.ServerResponse> = new Set();
  private cachedHTML: string | null = null;

  // Throttle agent-progress events to avoid flooding SSE clients
  private progressThrottles: Map<string, number> = new Map();
  private readonly PROGRESS_THROTTLE_MS = 500;

  constructor(options: DashboardServerOptions) {
    this.orchestrator = options.orchestrator;
    this.port = options.port;
    this.host = options.host ?? '0.0.0.0';
  }

  /**
   * Start the HTTP server and attach to orchestrator events.
   */
  async start(): Promise<void> {
    this.cachedHTML = buildDashboardHTML();
    this.attach();

    return new Promise<void>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);

      this.server.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  /**
   * Close the server and all SSE connections.
   */
  async close(): Promise<void> {
    // Close all SSE connections
    for (const client of this.sseClients) {
      try { client.end(); } catch { /* best effort */ }
    }
    this.sseClients.clear();

    // Close HTTP server
    return new Promise<void>((resolve) => {
      if (!this.server) { resolve(); return; }
      this.server.close(() => resolve());
    });
  }

  // --- Event Subscription ---

  private attach(): void {
    this.orchestrator.on('team-created', (teamId) => {
      const status = this.orchestrator.getTeamStatus(teamId);
      this.broadcast('team-created', { teamId, team: status ?? null });
    });

    this.orchestrator.on('task-assigned', (teamId, description) => {
      this.broadcast('task-assigned', { teamId, description, timestamp: new Date().toISOString() });
    });

    this.orchestrator.on('task-classified', (teamId, complexity, agentCount) => {
      this.broadcast('task-classified', { teamId, complexity, agentCount });
    });

    this.orchestrator.on('phase-transition', (teamId, from, to, trigger) => {
      this.broadcast('phase-transition', {
        teamId, from, to, trigger,
        timestamp: new Date().toISOString(),
      });
    });

    this.orchestrator.on('agent-output', (teamId, instance, data) => {
      this.broadcast('agent-output', { teamId, instance, text: data });
    });

    this.orchestrator.on('agent-progress', (teamId, instance, text) => {
      // Throttle progress events per agent
      const key = `${teamId}:${instance}`;
      const now = Date.now();
      const last = this.progressThrottles.get(key) ?? 0;
      if (now - last < this.PROGRESS_THROTTLE_MS) return;
      this.progressThrottles.set(key, now);
      this.broadcast('agent-progress', { teamId, instance, text });
    });

    this.orchestrator.on('agent-task', (teamId, instance, subtask) => {
      this.broadcast('agent-task', { teamId, instance, subtask });
    });

    this.orchestrator.on('task-complete', (teamId, phase, durationMs) => {
      this.broadcast('task-complete', { teamId, phase, durationMs });
    });

    this.orchestrator.on('error', (teamId, error) => {
      this.broadcast('error', { teamId, message: error.message });
    });

    this.orchestrator.on('feedback', (teamId, feedback) => {
      this.broadcast('feedback', { teamId, ...feedback });
    });

    this.orchestrator.on('security-review', (teamId, data) => {
      this.broadcast('security-review', { teamId, ...data });
    });

    this.orchestrator.on('shutdown', () => {
      this.broadcast('shutdown', {});
      for (const client of this.sseClients) {
        try { client.end(); } catch { /* best effort */ }
      }
      this.sseClients.clear();
    });
  }

  // --- SSE Broadcasting ---

  private broadcast(event: string, data: object): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        // Client disconnected, clean up on next request
        this.sseClients.delete(client);
      }
    }
  }

  // --- HTTP Request Handling ---

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Route matching
    if (method === 'GET' && pathname === '/') return this.serveHTML(res);
    if (method === 'GET' && pathname === '/events') return this.serveSSE(req, res);
    if (method === 'GET' && pathname === '/api/teams') return this.handleGetTeams(res);
    if (method === 'GET' && pathname === '/api/registry') return this.handleGetRegistry(res);
    if (method === 'POST' && pathname === '/api/pick-directory') { this.handlePickDirectory(res); return; }

    // /api/teams/:id patterns — decode URI component for team names with spaces/special chars
    const teamMatch = pathname.match(/^\/api\/teams\/([^/]+)$/);
    if (teamMatch && method === 'GET') return this.handleGetTeam(decodeURIComponent(teamMatch[1]), res);

    const taskMatch = pathname.match(/^\/api\/teams\/([^/]+)\/task$/);
    if (taskMatch && method === 'POST') {
      this.handleAssignTask(decodeURIComponent(taskMatch[1]), req, res);
      return;
    }

    const stopMatch = pathname.match(/^\/api\/teams\/([^/]+)\/stop$/);
    if (stopMatch && method === 'POST') {
      this.handleStopTeam(decodeURIComponent(stopMatch[1]), res);
      return;
    }

    const pushMergeMatch = pathname.match(/^\/api\/teams\/([^/]+)\/push-merge$/);
    if (pushMergeMatch && method === 'POST') {
      this.handlePushMerge(decodeURIComponent(pushMergeMatch[1]), res);
      return;
    }

    const feedbackMatch = pathname.match(/^\/api\/teams\/([^/]+)\/feedback$/);
    if (feedbackMatch && method === 'POST') {
      this.handleFeedbackResponse(decodeURIComponent(feedbackMatch[1]), req, res);
      return;
    }

    const askMatch = pathname.match(/^\/api\/teams\/([^/]+)\/ask$/);
    if (askMatch && method === 'POST') {
      this.handleAskAgent(decodeURIComponent(askMatch[1]), req, res);
      return;
    }

    const secReviewMatch = pathname.match(/^\/api\/teams\/([^/]+)\/security-review$/);
    if (secReviewMatch && method === 'POST') {
      this.handleSecurityReview(decodeURIComponent(secReviewMatch[1]), res);
      return;
    }

    if (method === 'POST' && pathname === '/api/teams') {
      this.handleCreateTeam(req, res);
      return;
    }

    // Preview: auto-open newest HTML file, or file browser with ?browse
    const previewBrowseMatch = pathname.match(/^\/preview\/([^/]+)\/?$/);
    if (previewBrowseMatch && method === 'GET') {
      const browse = url.searchParams.has('browse');
      this.handlePreviewBrowser(decodeURIComponent(previewBrowseMatch[1]), res, browse);
      return;
    }
    const previewMatch = pathname.match(/^\/preview\/([^/]+)\/(.+)$/);
    if (previewMatch && method === 'GET') {
      this.handlePreview(decodeURIComponent(previewMatch[1]), previewMatch[2], res);
      return;
    }

    this.send404(res);
  }

  // --- Route Handlers ---

  private serveHTML(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(this.cachedHTML);
  }

  private serveSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial state dump
    const teams = this.orchestrator.getAllTeams();
    res.write(`event: init\ndata: ${JSON.stringify({ teams })}\n\n`);

    this.sseClients.add(res);

    req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  private handleGetTeams(res: http.ServerResponse): void {
    const teams = this.orchestrator.getAllTeams();
    this.sendJSON(res, teams);
  }

  private handleGetTeam(teamId: string, res: http.ServerResponse): void {
    const status = this.orchestrator.getTeamStatus(teamId);
    if (!status) {
      this.sendJSON(res, { error: `Team "${teamId}" not found` }, 404);
      return;
    }
    this.sendJSON(res, status);
  }

  private async handleCreateTeam(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = JSON.parse(await this.readBody(req));
      const { name, projectPath, task, images } = body;

      if (!name || !projectPath) {
        this.sendJSON(res, { error: 'name and projectPath are required' }, 400);
        return;
      }

      const state = this.orchestrator.createTeam(name, projectPath);

      if (task) {
        this.orchestrator.assignTask(name, task, images);
      }

      this.sendJSON(res, state.snapshot, 201);
    } catch (err: any) {
      this.sendJSON(res, { error: err.message }, 400);
    }
  }

  private async handleAssignTask(
    teamId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = JSON.parse(await this.readBody(req));
      const { description, images } = body;

      if (!description) {
        this.sendJSON(res, { error: 'description is required' }, 400);
        return;
      }

      this.orchestrator.assignTask(teamId, description, images);
      this.sendJSON(res, { ok: true });
    } catch (err: any) {
      this.sendJSON(res, { error: err.message }, 400);
    }
  }

  private async handleStopTeam(
    teamId: string,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      await this.orchestrator.terminateTeam(teamId);
      this.sendJSON(res, { ok: true });
    } catch (err: any) {
      this.sendJSON(res, { error: err.message }, 400);
    }
  }

  private handleGetRegistry(res: http.ServerResponse): void {
    const entries = this.orchestrator.getRegistryEntries();
    this.sendJSON(res, entries);
  }

  private handlePushMerge(
    teamId: string,
    res: http.ServerResponse
  ): void {
    try {
      const status = this.orchestrator.getTeamStatus(teamId);
      if (!status) {
        this.sendJSON(res, { error: `Team "${teamId}" not found` }, 404);
        return;
      }

      const result = this.orchestrator.pushAndMerge(teamId);
      this.sendJSON(res, result, result.success ? 200 : 500);
    } catch (err: any) {
      this.sendJSON(res, { error: err.message }, 500);
    }
  }

  private async handleFeedbackResponse(
    teamId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = JSON.parse(await this.readBody(req));
      const { feedbackId, value } = body;

      if (!feedbackId || value === undefined) {
        this.sendJSON(res, { error: 'feedbackId and value are required' }, 400);
        return;
      }

      this.orchestrator.resolveFeedback(teamId, feedbackId, value);
      this.sendJSON(res, { ok: true });
    } catch (err: any) {
      this.sendJSON(res, { error: err.message }, 400);
    }
  }

  private async handleAskAgent(
    teamId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = JSON.parse(await this.readBody(req));
      const { message, images } = body;

      if (!message) {
        this.sendJSON(res, { error: 'message is required' }, 400);
        return;
      }

      // Fire and forget — response comes via SSE feedback events
      this.orchestrator.sendMessage(teamId, message, images).catch(() => {
        // Errors are emitted as feedback events
      });
      this.sendJSON(res, { ok: true });
    } catch (err: any) {
      this.sendJSON(res, { error: err.message }, 400);
    }
  }

  private handleSecurityReview(
    teamId: string,
    res: http.ServerResponse
  ): void {
    try {
      const status = this.orchestrator.getTeamStatus(teamId);
      if (!status) {
        this.sendJSON(res, { error: `Team "${teamId}" not found` }, 404);
        return;
      }

      // Fire and forget — results come via SSE security-review events
      this.orchestrator.runSecurityReview(teamId).catch(() => {
        // Errors are emitted as feedback events
      });
      this.sendJSON(res, { ok: true });
    } catch (err: any) {
      this.sendJSON(res, { error: err.message }, 400);
    }
  }

  private handlePreviewBrowser(
    teamId: string,
    res: http.ServerResponse,
    forceBrowse: boolean = false
  ): void {
    const status = this.orchestrator.getTeamStatus(teamId);
    if (!status) {
      this.sendJSON(res, { error: `Team "${teamId}" not found` }, 404);
      return;
    }

    const projectPath = status.projectPath;
    if (!projectPath) {
      this.sendJSON(res, { error: 'No project path for team' }, 400);
      return;
    }

    // Collect HTML files with modification times
    const htmlFiles: { name: string; mtime: number }[] = [];
    try {
      const entries = fs.readdirSync(projectPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.html')) {
          const stat = fs.statSync(path.join(projectPath, entry.name));
          htmlFiles.push({ name: entry.name, mtime: stat.mtimeMs });
        }
      }
    } catch {
      this.sendJSON(res, { error: 'Cannot read project directory' }, 500);
      return;
    }

    // Auto-redirect to the most recently modified HTML file (unless ?browse)
    if (!forceBrowse && htmlFiles.length > 0) {
      htmlFiles.sort((a, b) => b.mtime - a.mtime);
      const newest = htmlFiles[0].name;
      res.writeHead(302, { Location: `/preview/${encodeURIComponent(teamId)}/${encodeURIComponent(newest)}` });
      res.end();
      return;
    }

    // File browser (fallback or explicit ?browse)
    htmlFiles.sort((a, b) => a.name.localeCompare(b.name));
    const fileListHtml = htmlFiles.length > 0
      ? htmlFiles.map(f =>
          `<a href="/preview/${encodeURIComponent(teamId)}/${encodeURIComponent(f.name)}" class="file-link">`
          + `<span class="file-icon">&#128196;</span> ${this.escapeHTML(f.name)}</a>`
        ).join('\n')
      : '<p class="empty">No HTML files found in project root.</p>';

    const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Preview — ${this.escapeHTML(teamId)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;padding:40px;min-height:100vh}
h1{font-size:1.4rem;color:#f0f6fc;margin-bottom:6px}
.project-path{font-size:.8rem;color:#484f58;font-family:'SF Mono','Fira Code',monospace;margin-bottom:24px}
.file-list{display:flex;flex-direction:column;gap:8px;max-width:600px}
.file-link{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#161b22;border:1px solid #30363d;border-radius:8px;color:#58a6ff;text-decoration:none;font-size:.95rem;transition:background .15s,border-color .15s}
.file-link:hover{background:#1c2128;border-color:#58a6ff}
.file-icon{font-size:1.1rem}
.empty{color:#484f58;font-size:.9rem}
</style>
</head><body>
<h1>Preview — ${this.escapeHTML(teamId)}</h1>
<div class="project-path">${this.escapeHTML(projectPath)}</div>
<div class="file-list">
${fileListHtml}
</div>
</body></html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private escapeHTML(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private handlePreview(
    teamId: string,
    filePath: string,
    res: http.ServerResponse
  ): void {
    const status = this.orchestrator.getTeamStatus(teamId);
    if (!status) {
      this.sendJSON(res, { error: `Team "${teamId}" not found` }, 404);
      return;
    }

    const projectPath = status.projectPath;
    if (!projectPath) {
      this.sendJSON(res, { error: 'No project path for team' }, 400);
      return;
    }

    // Resolve and validate the file path stays within the project
    const resolved = path.resolve(projectPath, filePath);
    if (!resolved.startsWith(path.resolve(projectPath))) {
      this.sendJSON(res, { error: 'Invalid path' }, 403);
      return;
    }

    try {
      const content = fs.readFileSync(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
      };
      const contentType = mimeTypes[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      this.send404(res);
    }
  }

  // --- Helpers ---

  private handlePickDirectory(res: http.ServerResponse): void {
    const script = 'POSIX path of (choose folder with prompt "Select project folder")';
    execFile('osascript', ['-e', script], { timeout: 60000 }, (err, stdout) => {
      if (err) {
        // User cancelled the dialog or timeout
        this.sendJSON(res, { cancelled: true, path: null });
        return;
      }
      const selected = stdout.trim();
      // Remove trailing slash from osascript output
      const cleanPath = selected.endsWith('/') ? selected.slice(0, -1) : selected;
      this.sendJSON(res, { cancelled: false, path: cleanPath });
    });
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  private sendJSON(res: http.ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private send404(res: http.ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}
