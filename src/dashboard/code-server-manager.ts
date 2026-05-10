// CodeServerManager — lazy-spawns a local code-server process so the
// dashboard's Code tab can iframe a real VS Code at any project path.
//
// Lifecycle:
//   detect()  → checks if code-server is on PATH (no spawn)
//   start()   → idempotent; spawns process + polls /healthz until ready
//   getStatus() → snapshot for the UI
//   stop()    → SIGTERM (called on dashboard shutdown)
//
// One process serves all projects via ?folder=<path> on the iframe URL,
// so we never need per-project spawning.

import { type ChildProcess, execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

export type CodeServerState =
  | 'unavailable' // binary not installed
  | 'idle' // installed but not started
  | 'starting' // spawned, waiting for /healthz
  | 'ready' // /healthz responded OK
  | 'error'; // spawn or health check failed

export interface CodeServerStatus {
  state: CodeServerState;
  port?: number;
  binaryPath?: string;
  installCommand?: string;
  error?: string;
}

const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_INTERVAL_MS = 300;

// AI coding extensions are gated to the dashboard's team chat panel — the
// whole architectural premise of the feature is that all Claude/agent
// interactions for a team flow through one place. Allowing these extensions
// to be invoked from inside the iframe code-view would create parallel,
// untracked conversations the orchestrator can't see. Language servers,
// linters, and Git UI are intentionally NOT in this list — code-view should
// still be a fully usable read/edit surface.
//
// Mechanism: code-server is spawned with EXTENSIONS_GALLERY pointing at an
// invalid serviceUrl, which makes the marketplace return "Cannot connect" for
// every search/install. We also pin --user-data-dir and --extensions-dir to
// a project-local path so any user-installed VSIX stays scoped (and the wipe
// is a single rm). The list below is documentation — the gallery shutoff
// blocks all extensions, not just these.
// biome-ignore lint/correctness/noUnusedVariables: documentation of which extensions the gallery shutoff is intended to block; referenced by name in the comment block above.
const AI_CODING_EXTENSIONS: readonly string[] = [
  'anthropic.claude-code',
  'github.copilot',
  'github.copilot-chat',
  'cursor.cursor',
  'continue.continue',
];

// Project-local code-server state dir. Keeps the user's global
// ~/.local/share/code-server install untouched and makes wipes scoped:
// rm -rf .code-server-data/ resets the embedded code-view entirely.
const PROJECT_DATA_DIR = path.resolve(process.cwd(), '.code-server-data');
const PROJECT_USER_DIR = path.join(PROJECT_DATA_DIR, 'User');
const PROJECT_EXT_DIR = path.join(PROJECT_DATA_DIR, 'extensions');
const PROJECT_SETTINGS_FILE = path.join(PROJECT_USER_DIR, 'settings.json');

// Settings written into the project-local user-data-dir on first spawn.
// Three groups:
//   1. Extension auto-update suppression (belt-and-suspenders alongside the
//      EXTENSIONS_GALLERY env override that kills the marketplace).
//   2. UI lockdown — hide the activity bar (icon column) and secondary side
//      bar so the embedded view is just file tree + editor. The primary
//      side bar with the file tree stays visible.
//   3. Welcome / chat suppression — no welcome page on startup, no
//      walkthrough popups, AI/chat features disabled (the agent panel
//      is a built-in code-server feature, not an extension, so the
//      marketplace shutoff doesn't catch it).
const DEFAULT_USER_SETTINGS = {
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'workbench.activityBar.location': 'hidden',
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.startupEditor': 'none',
  'workbench.welcomePage.walkthroughs.openOnInstall': false,
  'chat.disableAIFeatures': true,
  'chat.commandCenter.enabled': false,
  'chat.agent.enabled': false,
  'chat.tips.enabled': false,
  'chat.viewProgressBadge.enabled': false,
  'chat.restoreLastPanelSession': false,
  'chat.detectParticipant.enabled': false,
} as const;

function ensureProjectDataDir(): void {
  fs.mkdirSync(PROJECT_USER_DIR, { recursive: true });
  fs.mkdirSync(PROJECT_EXT_DIR, { recursive: true });
  if (!fs.existsSync(PROJECT_SETTINGS_FILE)) {
    fs.writeFileSync(PROJECT_SETTINGS_FILE, `${JSON.stringify(DEFAULT_USER_SETTINGS, null, 2)}\n`);
  }
}

export class CodeServerManager {
  private state: CodeServerState = 'idle';
  private port: number;
  private binaryPath: string | null = null;
  private process: ChildProcess | null = null;
  private startPromise: Promise<CodeServerStatus> | null = null;
  private lastError: string | null = null;

  constructor(port = 8888) {
    this.port = port;
  }

  /**
   * Resolve whether code-server is installed. Caches the binary path so
   * subsequent calls are free. Does NOT spawn the process.
   */
  async detect(): Promise<boolean> {
    if (this.binaryPath) return true;
    try {
      const path = await this.which('code-server');
      this.binaryPath = path;
      return true;
    } catch {
      this.state = 'unavailable';
      return false;
    }
  }

  getStatus(): CodeServerStatus {
    return {
      state: this.state,
      ...(this.port !== undefined && this.state !== 'unavailable' ? { port: this.port } : {}),
      ...(this.binaryPath ? { binaryPath: this.binaryPath } : {}),
      ...(this.state === 'unavailable' ? { installCommand: 'brew install code-server' } : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  /**
   * Idempotent: if already starting or ready, returns the current status.
   * On first call, spawns code-server and polls /healthz until ready
   * (or HEALTH_TIMEOUT_MS elapses).
   */
  async start(): Promise<CodeServerStatus> {
    if (this.state === 'ready') return this.getStatus();
    if (this.startPromise) return this.startPromise;

    if (!(await this.detect())) {
      return this.getStatus();
    }

    this.startPromise = this.spawnAndWait();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    const proc = this.process;
    this.process = null;
    this.state = 'idle';
    try {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            /* already dead */
          }
          resolve();
        }, 2000);
        proc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } catch {
      // best effort
    }
  }

  private async spawnAndWait(): Promise<CodeServerStatus> {
    if (!this.binaryPath) {
      this.state = 'unavailable';
      return this.getStatus();
    }

    this.state = 'starting';
    this.lastError = null;

    ensureProjectDataDir();

    const args = [
      '--auth=none',
      `--bind-addr=127.0.0.1:${this.port}`,
      '--disable-telemetry',
      '--disable-update-check',
      `--user-data-dir=${PROJECT_DATA_DIR}`,
      `--extensions-dir=${PROJECT_EXT_DIR}`,
      // Don't open a workspace by default — the iframe URL drives folder selection.
    ];

    try {
      this.process = spawn(this.binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: {
          ...process.env,
          // Override the extensions marketplace gallery with empty endpoints
          // so search/install round-trips fail with "Cannot connect to
          // marketplace" — the actual lockdown for AI_CODING_EXTENSIONS.
          EXTENSIONS_GALLERY: JSON.stringify({
            serviceUrl: '',
            itemUrl: '',
            cacheUrl: '',
          }),
        },
      });
    } catch (err) {
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      return this.getStatus();
    }

    // If code-server dies unexpectedly, surface that in status.
    this.process.once('exit', (code, signal) => {
      if (this.state === 'ready' || this.state === 'starting') {
        this.state = 'error';
        this.lastError = `code-server exited (code=${code}, signal=${signal})`;
      }
      this.process = null;
    });

    // Poll /healthz until ready or timeout.
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.isHealthy()) {
        this.state = 'ready';
        return this.getStatus();
      }
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }

    this.state = 'error';
    this.lastError = `code-server did not become healthy within ${HEALTH_TIMEOUT_MS}ms`;
    await this.stop();
    return this.getStatus();
  }

  private isHealthy(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const req = http.get(
        { hostname: '127.0.0.1', port: this.port, path: '/healthz', timeout: 1000 },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  private which(cmd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      execFile('/usr/bin/which', [cmd], (err, stdout) => {
        if (err) return reject(err);
        const path = stdout.trim();
        if (!path) return reject(new Error(`${cmd} not found`));
        resolve(path);
      });
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
