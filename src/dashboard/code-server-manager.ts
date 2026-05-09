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
import * as http from 'node:http';

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

    const args = [
      '--auth=none',
      `--bind-addr=127.0.0.1:${this.port}`,
      '--disable-telemetry',
      '--disable-update-check',
      // Don't open a workspace by default — the iframe URL drives folder selection.
    ];

    try {
      this.process = spawn(this.binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
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
