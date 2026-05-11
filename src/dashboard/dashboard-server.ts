// DashboardServer — Live dashboard for PipelineOrchestrator.
//
// Serves a single-page dashboard over HTTP and streams real-time
// orchestrator events via SSE. Uses Node.js built-in http module
// (no Express or WebSocket dependencies).

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { PipelineOrchestrator } from '../pipeline-orchestrator.js';
import { CodeServerManager } from './code-server-manager.js';
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
  private directoryPickerInFlight = false;
  private codeServer: CodeServerManager = new CodeServerManager();

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

    // Detect code-server in the background — non-blocking. The Code tab
    // checks status before lazy-spawning, so we just want to know whether
    // the binary exists by the time the user clicks the tab.
    this.codeServer.detect().catch(() => {
      /* recorded in status */
    });

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
      try {
        client.end();
      } catch {
        /* best effort */
      }
    }
    this.sseClients.clear();

    // Stop the embedded code-server if it was spawned.
    await this.codeServer.stop();

    // Close HTTP server
    return new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  // --- Event Subscription ---

  private attach(): void {
    this.orchestrator.on('team-created', (teamId) => {
      const status = this.orchestrator.getTeamStatus(teamId);
      const enriched = status
        ? { ...status, projectHasPreview: this.checkProjectHasPreview(status.projectPath) }
        : null;
      this.broadcast('team-created', { teamId, team: enriched });
    });

    this.orchestrator.on('task-assigned', (teamId, description) => {
      this.broadcast('task-assigned', { teamId, description, timestamp: new Date().toISOString() });
    });

    this.orchestrator.on('task-classified', (teamId, complexity, agentCount) => {
      this.broadcast('task-classified', { teamId, complexity, agentCount });
    });

    this.orchestrator.on('phase-transition', (teamId, from, to, trigger) => {
      this.broadcast('phase-transition', {
        teamId,
        from,
        to,
        trigger,
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

    this.orchestrator.on('pr-created', (teamId, prNumber, prUrl) => {
      this.broadcast('pr-created', { teamId, prNumber, prUrl });
    });

    this.orchestrator.on('team-archived', (teamId, prUrl) => {
      this.broadcast('team-archived', { teamId, prUrl });
    });

    this.orchestrator.on('team-deleted', (teamId) => {
      this.broadcast('team-deleted', { teamId });
    });

    this.orchestrator.on('chat-message', (teamId, message) => {
      this.broadcast('chat-message', { teamId, message });
    });

    this.orchestrator.on('shutdown', () => {
      this.broadcast('shutdown', {});
      for (const client of this.sseClients) {
        try {
          client.end();
        } catch {
          /* best effort */
        }
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
    if (method === 'GET' && pathname === '/') {
      this.serveHTML(res);
      return;
    }
    if (method === 'GET' && pathname === '/events') {
      this.serveSSE(req, res);
      return;
    }
    if (method === 'GET' && pathname === '/api/teams') {
      this.handleGetTeams(res);
      return;
    }
    if (method === 'GET' && pathname === '/api/runtime') {
      this.handleGetRuntime(res);
      return;
    }
    if (method === 'GET' && pathname === '/api/registry') {
      this.handleGetRegistry(res);
      return;
    }
    if (method === 'POST' && pathname === '/api/pick-directory') {
      this.handlePickDirectory(res);
      return;
    }
    if (method === 'POST' && pathname === '/api/resolve-directory') {
      this.handleResolveDirectory(req, res);
      return;
    }
    if (method === 'POST' && pathname === '/api/projects/clear-done') {
      this.handleClearDoneTeams(req, res);
      return;
    }
    if (method === 'GET' && pathname === '/api/code-server/status') {
      this.handleCodeServerStatus(res);
      return;
    }
    if (method === 'POST' && pathname === '/api/code-server/start') {
      this.handleCodeServerStart(res);
      return;
    }

    // /api/teams/:id patterns — decode URI component for team names with spaces/special chars
    const teamMatch = pathname.match(/^\/api\/teams\/([^/]+)$/);
    if (teamMatch && method === 'GET') {
      this.handleGetTeam(decodeURIComponent(teamMatch[1]), res);
      return;
    }

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

    const createPrMatch = pathname.match(/^\/api\/teams\/([^/]+)\/create-pr$/);
    if (createPrMatch && method === 'POST') {
      this.handleCreatePr(decodeURIComponent(createPrMatch[1]), res);
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

    // Team-level Coordinator-1 chat. POST sends a user message, GET returns
    // the team's full chat history. Both routes resolve the team by name
    // (decoded so names with spaces/slashes work).
    const chatPostMatch = pathname.match(/^\/api\/teams\/([^/]+)\/chat$/);
    if (chatPostMatch && method === 'POST') {
      this.handleSendChatMessage(decodeURIComponent(chatPostMatch[1]), req, res);
      return;
    }
    if (chatPostMatch && method === 'GET') {
      this.handleGetChatHistory(decodeURIComponent(chatPostMatch[1]), res);
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
      Connection: 'keep-alive',
    });

    // Send initial state dump (enriched with projectHasPreview, same as REST)
    const teams = this.orchestrator.getAllTeams().map((t) => ({
      ...t,
      projectHasPreview: this.checkProjectHasPreview(t.projectPath),
    }));
    const runtime = this.orchestrator.getAgentRuntime();
    res.write(`event: init\ndata: ${JSON.stringify({ teams, runtime })}\n\n`);

    this.sseClients.add(res);

    req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  private handleGetTeams(res: http.ServerResponse): void {
    const teams = this.orchestrator.getAllTeams();
    this.sendJSON(
      res,
      teams.map((t) => ({ ...t, projectHasPreview: this.checkProjectHasPreview(t.projectPath) })),
    );
  }

  // Cache project-has-preview flags so we don't hit the disk on every poll/render.
  // 30s TTL is short enough that a Worker producing the first HTML file becomes
  // visible quickly, long enough to absorb the SSE-driven re-render churn.
  private previewCache = new Map<string, { has: boolean; checkedAt: number }>();
  private static readonly PREVIEW_CACHE_TTL_MS = 30_000;
  private static readonly PREVIEW_SCAN_DIRS = ['', 'dist', 'build', 'public', 'out'];

  private checkProjectHasPreview(projectPath: string): boolean {
    const cached = this.previewCache.get(projectPath);
    if (cached && Date.now() - cached.checkedAt < DashboardServer.PREVIEW_CACHE_TTL_MS) {
      return cached.has;
    }
    let has = false;
    for (const sub of DashboardServer.PREVIEW_SCAN_DIRS) {
      const dir = sub ? path.join(projectPath, sub) : projectPath;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        if (entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith('.html'))) {
          has = true;
          break;
        }
      } catch {
        // Directory missing or unreadable — try the next candidate
      }
    }
    this.previewCache.set(projectPath, { has, checkedAt: Date.now() });
    return has;
  }

  private handleGetRuntime(res: http.ServerResponse): void {
    this.sendJSON(res, this.orchestrator.getAgentRuntime());
  }

  private handleGetTeam(teamId: string, res: http.ServerResponse): void {
    const status = this.orchestrator.getTeamStatus(teamId);
    if (!status) {
      this.sendJSON(res, { error: `Team "${teamId}" not found` }, 404);
      return;
    }
    this.sendJSON(res, {
      ...status,
      projectHasPreview: this.checkProjectHasPreview(status.projectPath),
    });
  }

  private async handleCreateTeam(
    req: http.IncomingMessage,
    res: http.ServerResponse,
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
    res: http.ServerResponse,
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

  private async handleStopTeam(teamId: string, res: http.ServerResponse): Promise<void> {
    try {
      await this.orchestrator.terminateTeam(teamId);
      this.sendJSON(res, { ok: true });
    } catch (err: any) {
      this.sendJSON(res, { error: err.message }, 400);
    }
  }

  private async handleClearDoneTeams(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const body = JSON.parse(await this.readBody(req));
      const projectPath = body.projectPath;
      if (!projectPath || typeof projectPath !== 'string') {
        this.sendJSON(res, { error: 'projectPath is required' }, 400);
        return;
      }
      const cleared = await this.orchestrator.clearDoneTeams(projectPath);
      this.sendJSON(res, { cleared });
    } catch (err: any) {
      this.sendJSON(res, { error: err.message }, 400);
    }
  }

  private handleGetRegistry(res: http.ServerResponse): void {
    const entries = this.orchestrator.getRegistryEntries();
    this.sendJSON(res, entries);
  }

  private handleCreatePr(teamId: string, res: http.ServerResponse): void {
    try {
      const status = this.orchestrator.getTeamStatus(teamId);
      if (!status) {
        this.sendJSON(res, { error: `Team "${teamId}" not found` }, 404);
        return;
      }

      const result = this.orchestrator.createPr(teamId);
      this.sendJSON(res, result, result.success ? 200 : 500);
    } catch (err: any) {
      this.sendJSON(res, { error: err.message }, 500);
    }
  }

  private handlePushMerge(teamId: string, res: http.ServerResponse): void {
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
    res: http.ServerResponse,
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
    res: http.ServerResponse,
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

  // POST /api/teams/:id/chat — body { message: string }. Fire-and-forget;
  // both the user message and the coordinator's reply (and any TRIGGER_PIPELINE
  // synthetic notes) flow back to the dashboard via the chat-message SSE event,
  // so the route returns 202 immediately.
  private async handleSendChatMessage(
    teamId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const body = JSON.parse(await this.readBody(req));
      const message = typeof body?.message === 'string' ? body.message.trim() : '';
      if (!message) {
        this.sendJSON(res, { error: 'message is required' }, 400);
        return;
      }
      this.orchestrator.sendChatMessage(teamId, message).catch((err) => {
        // Surface as a chat-message system note so the user sees what failed.
        this.broadcast('chat-message', {
          teamId,
          message: {
            role: 'system',
            content: `Could not deliver chat message: ${err.message}`,
            timestamp: new Date().toISOString(),
          },
        });
      });
      this.sendJSON(res, { ok: true }, 202);
    } catch (err: any) {
      this.sendJSON(res, { error: err.message }, 400);
    }
  }

  // GET /api/teams/:id/chat — returns the team's chat history (read from the
  // in-memory snapshot, which is hydrated from chat.jsonl on team load).
  private handleGetChatHistory(teamId: string, res: http.ServerResponse): void {
    const status = this.orchestrator.getTeamStatus(teamId);
    if (!status) {
      this.sendJSON(res, { error: `Team "${teamId}" not found` }, 404);
      return;
    }
    this.sendJSON(res, { messages: status.chatHistory ?? [] });
  }

  private handleSecurityReview(teamId: string, res: http.ServerResponse): void {
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
    forceBrowse: boolean = false,
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
      res.writeHead(302, {
        Location: `/preview/${encodeURIComponent(teamId)}/${encodeURIComponent(newest)}`,
      });
      res.end();
      return;
    }

    // File browser (fallback or explicit ?browse)
    htmlFiles.sort((a, b) => a.name.localeCompare(b.name));
    const fileListHtml =
      htmlFiles.length > 0
        ? htmlFiles
            .map(
              (f) =>
                `<a href="/preview/${encodeURIComponent(teamId)}/${encodeURIComponent(f.name)}" class="file-link">` +
                `<span class="file-icon">&#128196;</span> ${this.escapeHTML(f.name)}</a>`,
            )
            .join('\n')
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
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private handlePreview(teamId: string, filePath: string, res: http.ServerResponse): void {
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
    if (this.directoryPickerInFlight) {
      this.sendJSON(
        res,
        {
          error:
            'Folder picker is already opening. Finish or cancel the current picker before opening another.',
        },
        409,
      );
      return;
    }

    this.directoryPickerInFlight = true;
    const startedAt = Date.now();
    this.pickDirectoryNative((_err, selected, unsupported) => {
      this.directoryPickerInFlight = false;
      const durationMs = Date.now() - startedAt;

      if (selected) {
        const cleanPath = selected.endsWith('/') ? selected.slice(0, -1) : selected;
        this.sendJSON(res, { cancelled: false, path: cleanPath, durationMs });
        return;
      }

      if (unsupported) {
        this.sendJSON(
          res,
          {
            cancelled: true,
            path: null,
            error: unsupported,
            durationMs,
          },
          501,
        );
        return;
      }

      this.sendJSON(res, { cancelled: true, path: null, durationMs });
    });
  }

  // Resolves the absolute disk path of a directory chosen via the browser-
  // native HTML5 directory picker (<input type="file" webkitdirectory>).
  // The browser refuses, by design, to give JS the absolute filesystem path
  // of any selected file/dir — we only learn the directory's NAME (from the
  // first file's webkitRelativePath). Spotlight (mdfind) then locates the
  // matching directory on disk in ~50-200ms. Result: same instant native
  // picker as Phone-test's file-upload pattern, with no subprocess-spawn cost.
  private async handleResolveDirectory(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const body = JSON.parse(await this.readBody(req));
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name) {
        this.sendJSON(res, { error: 'name is required' }, 400);
        return;
      }
      // Escape any double quotes in the name to keep the mdfind query well-formed
      const safeName = name.replace(/"/g, '\\"');
      const query = `kMDItemFSName == "${safeName}"`;
      execFile('mdfind', [query], { timeout: 8000 }, (err, stdout) => {
        if (err) {
          this.sendJSON(res, {
            paths: [],
            error: 'Spotlight search failed; paste the path manually.',
          });
          return;
        }
        const candidates = stdout
          .split('\n')
          .map((p) => p.trim())
          .filter(Boolean);
        // Filter to existing directories only (mdfind returns files too)
        const dirs = candidates.filter((p) => {
          try {
            return fs.statSync(p).isDirectory();
          } catch {
            return false;
          }
        });
        // Cap to keep the response small even if the user has dozens of
        // identically-named directories (rare in practice)
        this.sendJSON(res, { paths: dirs.slice(0, 20) });
      });
    } catch (err: any) {
      this.sendJSON(res, { error: err.message }, 400);
    }
  }

  // Cheap status read for the Code tab — no spawn side-effects.
  private handleCodeServerStatus(res: http.ServerResponse): void {
    this.sendJSON(res, this.codeServer.getStatus());
  }

  // Idempotent lazy spawn. The UI calls this when the user first opens the
  // Code tab. Returns the final status (resolved after /healthz) so the UI
  // can immediately render the iframe — no follow-up polling needed.
  private async handleCodeServerStart(res: http.ServerResponse): Promise<void> {
    try {
      const status = await this.codeServer.start();
      this.sendJSON(res, status);
    } catch (err: any) {
      this.sendJSON(res, { state: 'error', error: err.message }, 500);
    }
  }

  private pickDirectoryNative(
    callback: (err: Error | null, selected: string | null, unsupported?: string) => void,
  ): void {
    if (process.platform === 'darwin') {
      // Spawn the precompiled `pick-folder` Swift binary that opens
      // NSOpenPanel directly. This is the same NSOpenPanel that GitHub
      // Desktop opens via Electron's dialog.showOpenDialog — just delivered
      // as a standalone CLI so we can call it from a non-Electron Node
      // server. Skipping AppleScript / JavaScriptCore / AppleScriptObjC
      // bridges removes the ~300-500ms cold-start cost of the prior
      // osascript implementation, plus avoids the focus-flicker issue
      // where the dialog auto-cancelled when activation didn't stick.
      const binPath = path.resolve(process.cwd(), 'tools', 'pick-folder');
      execFile(binPath, [], { timeout: 60000 }, (err, stdout) => {
        callback(err, stdout.trim() || null);
      });
      return;
    }

    if (process.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$dialog.Description = "Select project folder"',
        '$dialog.ShowNewFolderButton = $false',
        '$result = $dialog.ShowDialog()',
        'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
        '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        '  Write-Output $dialog.SelectedPath',
        '  exit 0',
        '}',
        'exit 1',
      ].join('; ');
      execFile(
        'powershell.exe',
        ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: 60000 },
        (err, stdout) => {
          callback(err, stdout.trim() || null);
        },
      );
      return;
    }

    const runKdialog = () => {
      execFile(
        'kdialog',
        ['--getexistingdirectory', process.env.HOME ?? '.'],
        { timeout: 60000 },
        (err, stdout) => {
          const enoent = (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
          callback(
            err,
            stdout.trim() || null,
            enoent
              ? 'No supported Linux folder picker found. Install zenity or kdialog, or paste the path manually.'
              : undefined,
          );
        },
      );
    };

    execFile(
      'zenity',
      ['--file-selection', '--directory', '--title=Select project folder'],
      { timeout: 60000 },
      (err, stdout) => {
        if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          runKdialog();
          return;
        }
        callback(err, stdout.trim() || null);
      },
    );
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
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
