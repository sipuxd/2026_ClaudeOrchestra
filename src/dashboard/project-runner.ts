// ProjectRunnerManager — spawns a project's real dev server (`npm run
// storybook`, `npm run dev`, etc.) and exposes its URL so the dashboard's
// Run button can open the live app in a tab.
//
// Modelled on CodeServerManager: lifecycle methods + event emitter for the
// SSE layer. One running dev server per projectPath; restart kills the old
// process before starting a new one.

import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type RunnerState = 'idle' | 'starting' | 'ready' | 'error' | 'stopped';

export interface RunnerStatus {
  projectPath: string;
  state: RunnerState;
  framework: string | null;
  command: string | null;
  url: string | null;
  startedAt: string | null;
  lastError: string | null;
  stdoutTail: string[];
}

export interface DetectedFramework {
  name: string;
  command: string;
  args: string[];
  // Each regex captures either a full URL (group 1) or a port number (group 1
  // when `portOnly` is true and the URL is built as http://localhost:<port>).
  readyMatchers: { regex: RegExp; portOnly?: boolean }[];
}

interface RunnerInternal {
  projectPath: string;
  process: ChildProcess;
  state: RunnerState;
  framework: string;
  command: string;
  url: string | null;
  startedAt: Date;
  stdoutTail: string[];
  lastError: string | null;
  readyTimer: ReturnType<typeof setTimeout> | null;
}

export type ProjectRunnerEvents = {
  'runner-starting': [{ projectPath: string; framework: string; command: string }];
  'runner-ready': [{ projectPath: string; url: string }];
  'runner-error': [{ projectPath: string; reason: string; stdoutTail: string[] }];
  'runner-stopped': [{ projectPath: string }];
};

const READY_TIMEOUT_MS = 30_000;
const STDOUT_TAIL_LINES = 50;
const STOP_GRACE_MS = 2_000;

export class ProjectRunnerManager extends EventEmitter<ProjectRunnerEvents> {
  private running: Map<string, RunnerInternal> = new Map();

  // Idempotent: if a runner is already starting or ready for this path,
  // returns the current status. Errored/stopped runners are replaced.
  async start(projectPath: string): Promise<RunnerStatus> {
    const existing = this.running.get(projectPath);
    if (existing && (existing.state === 'starting' || existing.state === 'ready')) {
      return this.toStatus(existing);
    }
    if (existing) {
      await this.stop(projectPath);
    }

    const detected = this.detectFramework(projectPath);
    if (!detected) {
      throw new Error(
        "Couldn't detect framework. Project needs a package.json with a known framework dep, or an HTML file at the project root.",
      );
    }

    let child: ChildProcess;
    try {
      child = spawn(detected.command, detected.args, {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CI: '1', // suppress interactive prompts in most dev tools
          BROWSER: 'none', // stop CRA/Vite/Storybook from opening a browser tab
          FORCE_COLOR: '0', // ANSI escapes would foul up our URL regexes
        },
      });
    } catch (err) {
      const reason = `Couldn't start dev server: ${err instanceof Error ? err.message : String(err)}`;
      this.emit('runner-error', { projectPath, reason, stdoutTail: [] });
      throw new Error(reason);
    }

    const command = `${detected.command} ${detected.args.join(' ')}`;
    const state: RunnerInternal = {
      projectPath,
      process: child,
      state: 'starting',
      framework: detected.name,
      command,
      url: null,
      startedAt: new Date(),
      stdoutTail: [],
      lastError: null,
      readyTimer: null,
    };
    this.running.set(projectPath, state);
    this.emit('runner-starting', { projectPath, framework: detected.name, command });

    const handleData = (buf: Buffer | string) => {
      const text = typeof buf === 'string' ? buf : buf.toString();
      const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
      state.stdoutTail.push(...lines);
      if (state.stdoutTail.length > STDOUT_TAIL_LINES) {
        state.stdoutTail.splice(0, state.stdoutTail.length - STDOUT_TAIL_LINES);
      }
      if (state.state === 'starting') {
        const url = matchReady(text, detected.readyMatchers);
        if (url) {
          state.url = url;
          state.state = 'ready';
          if (state.readyTimer) {
            clearTimeout(state.readyTimer);
            state.readyTimer = null;
          }
          this.emit('runner-ready', { projectPath, url });
        }
      }
    };

    child.stdout?.on('data', handleData);
    child.stderr?.on('data', handleData);

    child.on('error', (err) => {
      // Most spawn-time errors come through here (e.g. ENOENT for the command).
      if (state.readyTimer) {
        clearTimeout(state.readyTimer);
        state.readyTimer = null;
      }
      if (state.state === 'starting' || state.state === 'ready') {
        state.state = 'error';
        state.lastError = `Dev server error: ${err.message}`;
        this.emit('runner-error', {
          projectPath,
          reason: state.lastError,
          stdoutTail: state.stdoutTail.slice(),
        });
      }
    });

    child.on('exit', (code, signal) => {
      if (state.readyTimer) {
        clearTimeout(state.readyTimer);
        state.readyTimer = null;
      }
      if (state.state === 'stopped') {
        // We initiated the stop — no error.
        return;
      }
      if (state.state === 'starting') {
        state.state = 'error';
        state.lastError = `Dev server exited (code=${code}, signal=${signal}) before becoming ready.`;
      } else if (state.state === 'ready') {
        state.state = 'error';
        state.lastError = `Dev server exited unexpectedly (code=${code}, signal=${signal}).`;
      } else {
        return;
      }
      this.emit('runner-error', {
        projectPath,
        reason: state.lastError,
        stdoutTail: state.stdoutTail.slice(),
      });
    });

    state.readyTimer = setTimeout(() => {
      if (state.state === 'starting') {
        state.state = 'error';
        state.lastError = `Server didn't print a URL within ${READY_TIMEOUT_MS / 1000}s. Last ${state.stdoutTail.length} lines below may show why.`;
        this.emit('runner-error', {
          projectPath,
          reason: state.lastError,
          stdoutTail: state.stdoutTail.slice(),
        });
        // Kill the lingering child so it doesn't stay running unmonitored.
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }
    }, READY_TIMEOUT_MS);

    return this.toStatus(state);
  }

  async stop(projectPath: string): Promise<void> {
    const state = this.running.get(projectPath);
    if (!state) return;
    if (state.readyTimer) {
      clearTimeout(state.readyTimer);
      state.readyTimer = null;
    }
    state.state = 'stopped';
    const proc = state.process;
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      proc.once('exit', finish);
      try {
        proc.kill('SIGTERM');
      } catch {
        /* already dead */
      }
      setTimeout(() => {
        if (!proc.killed) {
          try {
            proc.kill('SIGKILL');
          } catch {
            /* already dead */
          }
        }
        // Give SIGKILL a beat to actually deliver, then resolve regardless.
        setTimeout(finish, 200);
      }, STOP_GRACE_MS);
    });
    this.running.delete(projectPath);
    this.emit('runner-stopped', { projectPath });
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.running.keys()).map((p) => this.stop(p)));
  }

  getStatus(projectPath: string): RunnerStatus {
    const state = this.running.get(projectPath);
    if (!state) {
      return {
        projectPath,
        state: 'idle',
        framework: null,
        command: null,
        url: null,
        startedAt: null,
        lastError: null,
        stdoutTail: [],
      };
    }
    return this.toStatus(state);
  }

  getAllStatuses(): RunnerStatus[] {
    return Array.from(this.running.values()).map((s) => this.toStatus(s));
  }

  private toStatus(state: RunnerInternal): RunnerStatus {
    return {
      projectPath: state.projectPath,
      state: state.state,
      framework: state.framework,
      command: state.command,
      url: state.url,
      startedAt: state.startedAt.toISOString(),
      lastError: state.lastError,
      stdoutTail: state.stdoutTail.slice(),
    };
  }

  // --- Framework detection (pure, side-effect free other than reading
  // package.json / project root). Public for testability. ---
  detectFramework(projectPath: string): DetectedFramework | null {
    const pkg = readPackageJson(projectPath);
    if (pkg) {
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      const scripts: Record<string, string> = pkg.scripts ?? {};

      // Storybook — check deps + script
      if (Object.keys(deps).some((d) => d.startsWith('@storybook/')) && scripts.storybook) {
        return {
          name: 'storybook',
          command: 'npm',
          args: ['run', 'storybook'],
          readyMatchers: GENERIC_URL_MATCHERS,
        };
      }

      // Next.js
      if (deps.next) {
        const script = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
        if (script) {
          return {
            name: 'next',
            command: 'npm',
            args: ['run', script],
            readyMatchers: [
              { regex: /Local:\s*(https?:\/\/\S+)/i },
              { regex: /started server on .*?(https?:\/\/\S+)/i },
              { regex: /ready on (https?:\/\/\S+)/i },
              { regex: /(https?:\/\/localhost:\d+)/ },
            ],
          };
        }
      }

      // Vite
      if (deps.vite) {
        const script = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
        if (script) {
          return {
            name: 'vite',
            command: 'npm',
            args: ['run', script],
            readyMatchers: GENERIC_URL_MATCHERS,
          };
        }
      }

      // Angular
      if (deps['@angular/core']) {
        const script = scripts.start ? 'start' : scripts.dev ? 'dev' : null;
        if (script) {
          return {
            name: 'angular',
            command: 'npm',
            args: ['run', script],
            readyMatchers: GENERIC_URL_MATCHERS,
          };
        }
      }

      // Vue / Svelte
      if (deps.vue || deps.svelte) {
        const script = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
        if (script) {
          return {
            name: deps.vue ? 'vue' : 'svelte',
            command: 'npm',
            args: ['run', script],
            readyMatchers: GENERIC_URL_MATCHERS,
          };
        }
      }

      // Plain React (Create React App, etc.)
      if (deps.react) {
        const script = scripts.start ? 'start' : scripts.dev ? 'dev' : null;
        if (script) {
          return {
            name: 'react',
            command: 'npm',
            args: ['run', script],
            readyMatchers: GENERIC_URL_MATCHERS,
          };
        }
      }

      // Generic fallback for any project with a dev/start script.
      if (scripts.dev) {
        return {
          name: 'generic-dev',
          command: 'npm',
          args: ['run', 'dev'],
          readyMatchers: GENERIC_URL_MATCHERS,
        };
      }
      if (scripts.start) {
        return {
          name: 'generic-start',
          command: 'npm',
          args: ['run', 'start'],
          readyMatchers: GENERIC_URL_MATCHERS,
        };
      }
    }

    // No package.json (or no usable script) — fall back to python's static
    // file server if there's an HTML file at the project root.
    if (hasHtmlAtRoot(projectPath)) {
      return {
        name: 'static-html',
        command: 'python3',
        args: ['-m', 'http.server', '0'],
        readyMatchers: [
          // "Serving HTTP on :: port 12345 (http://[::]:12345/) ..."
          { regex: /Serving HTTP on .*?port\s+(\d+)/, portOnly: true },
        ],
      };
    }

    return null;
  }
}

// --- Helpers ---

// Universal "Local: http://localhost:NNNN" matcher used by Vite/Storybook/
// Angular/Vue/Svelte/CRA. Fallback to bare URL detection.
const GENERIC_URL_MATCHERS: { regex: RegExp; portOnly?: boolean }[] = [
  { regex: /Local:\s*(https?:\/\/\S+)/i },
  { regex: /(https?:\/\/localhost:\d+\b\S*)/ },
];

function matchReady(
  text: string,
  matchers: { regex: RegExp; portOnly?: boolean }[],
): string | null {
  for (const m of matchers) {
    const match = text.match(m.regex);
    if (match?.[1]) {
      const captured = stripAnsi(match[1]).replace(/[)\].,]+$/, '');
      if (m.portOnly) {
        return `http://localhost:${captured}`;
      }
      return captured;
    }
  }
  return null;
}

function stripAnsi(s: string): string {
  // Some dev servers still write ANSI even with FORCE_COLOR=0 (Storybook
  // notoriously). Strip CSI escape sequences from the captured URL.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences which include \x1b.
  return s.replace(/\[[0-9;]*[A-Za-z]/g, '');
}

function readPackageJson(projectPath: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
} | null {
  const p = path.join(projectPath, 'package.json');
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasHtmlAtRoot(projectPath: string): boolean {
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    return entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith('.html'));
  } catch {
    return false;
  }
}
