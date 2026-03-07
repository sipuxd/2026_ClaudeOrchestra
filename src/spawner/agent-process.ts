// Wrapper around a single Claude Code CLI child process.
// Handles spawning, stdin/stdout communication, health monitoring,
// message delimiter parsing, and graceful shutdown.

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Role, type RoleInstance } from '../roles/role-types.js';

// --- Message delimiter protocol ---

const MESSAGE_START = '---ORCHESTRA-MESSAGE-START---';
const MESSAGE_END = '---ORCHESTRA-MESSAGE-END---';

// --- Agent process events ---

export interface AgentProcessEvents {
  message: [raw: string];
  output: [data: string];
  stderr: [data: string];
  exit: [code: number | null, signal: NodeJS.Signals | null];
  ready: [];
}

// --- Spawn options ---

export interface AgentSpawnOptions {
  /** Path to the claude CLI binary (default: 'claude') */
  claudeBin?: string;
  /** Override spawn args (for testing with mock processes) */
  spawnArgs?: string[];
  /** Model ID for this agent */
  model: string;
  /** Path to the CLAUDE.md system prompt file */
  systemPromptPath: string;
  /** Working directory (project path) */
  cwd: string;
  /** Role for this agent */
  role: Role;
  /** Instance identifier */
  instance: RoleInstance;
  /** Team ID */
  teamId: string;
}

// --- Agent process state ---

export enum ProcessState {
  Starting = 'starting',
  Running = 'running',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Crashed = 'crashed',
}

export class AgentProcess extends EventEmitter<AgentProcessEvents> {
  readonly role: Role;
  readonly instance: RoleInstance;
  readonly teamId: string;

  private process: ChildProcess | null = null;
  private _state: ProcessState = ProcessState.Starting;
  private _pid: number | null = null;
  private _exitCode: number | null = null;
  private _lastOutputAt: Date | null = null;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private spawnOptions: AgentSpawnOptions;

  constructor(options: AgentSpawnOptions) {
    super();
    this.role = options.role;
    this.instance = options.instance;
    this.teamId = options.teamId;
    this.spawnOptions = options;
  }

  // --- Accessors ---

  get state(): ProcessState { return this._state; }
  get pid(): number | null { return this._pid; }
  get exitCode(): number | null { return this._exitCode; }
  get lastOutputAt(): Date | null { return this._lastOutputAt; }
  get isAlive(): boolean { return this._state === ProcessState.Running; }

  // --- Spawn ---

  /**
   * Spawn the Claude Code CLI process.
   */
  spawn(): void {
    if (this.process) {
      throw new Error(`Agent ${this.instance} already spawned`);
    }

    const bin = this.spawnOptions.claudeBin ?? 'claude';

    let args: string[];
    if (this.spawnOptions.spawnArgs) {
      args = this.spawnOptions.spawnArgs;
    } else {
      const systemPrompt = readFileSync(this.spawnOptions.systemPromptPath, 'utf-8');
      args = [
        '-p',
        '--model', this.spawnOptions.model,
        '--system-prompt', systemPrompt,
        '--output-format', 'json',
      ];
    }

    const env = {
      ...process.env,
      CLAUDE_ORCHESTRA_ROLE: this.spawnOptions.role,
      CLAUDE_ORCHESTRA_INSTANCE: this.spawnOptions.instance,
      CLAUDE_ORCHESTRA_TEAM_ID: this.spawnOptions.teamId,
      CLAUDECODE: undefined,
    };

    this.process = spawn(bin, args, {
      cwd: this.spawnOptions.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._pid = this.process.pid ?? null;
    this._state = ProcessState.Running;

    // stdout handling
    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this._lastOutputAt = new Date();
      this.handleStdout(text);
    });

    // stderr handling
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.stderrBuffer += text;
      this.emit('stderr', text);
    });

    // Exit handling
    this.process.on('exit', (code, signal) => {
      if (this._state === ProcessState.Stopping) {
        this._state = ProcessState.Stopped;
      } else {
        this._state = ProcessState.Crashed;
      }
      this._exitCode = code;
      this.process = null;
      this.emit('exit', code, signal);
    });

    // Error handling (spawn failure)
    this.process.on('error', (err) => {
      this._state = ProcessState.Crashed;
      this.process = null;
      this.emit('stderr', err.message);
      this.emit('exit', 1, null);
    });

    this.emit('ready');
  }

  // --- Communication ---

  /**
   * Send a prompt to the agent via stdin.
   */
  send(prompt: string): void {
    if (!this.process?.stdin?.writable) {
      throw new Error(`Agent ${this.instance} stdin not writable`);
    }
    this.process.stdin.write(prompt + '\n');
  }

  // --- Health ---

  /**
   * Check if the process is still alive via kill signal 0.
   */
  checkAlive(): boolean {
    if (!this._pid || this._state !== ProcessState.Running) return false;
    try {
      process.kill(this._pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get seconds since last stdout output.
   */
  silenceDurationMs(): number {
    if (!this._lastOutputAt) return Infinity;
    return Date.now() - this._lastOutputAt.getTime();
  }

  // --- Shutdown ---

  /**
   * Graceful shutdown: optional shutdown prompt → SIGTERM → wait → SIGKILL.
   */
  async terminate(options?: { shutdownPrompt?: string; gracePeriodMs?: number }): Promise<void> {
    if (!this.process || this._state === ProcessState.Stopped || this._state === ProcessState.Crashed) {
      return;
    }

    this._state = ProcessState.Stopping;

    // Send shutdown prompt if provided and stdin is writable
    if (options?.shutdownPrompt && this.process.stdin?.writable) {
      try {
        this.process.stdin.write(options.shutdownPrompt + '\n');
      } catch {
        // stdin may already be closed
      }
    }

    // Close stdin to signal no more input
    try {
      this.process.stdin?.end();
    } catch {
      // stdin may already be closed
    }

    const gracePeriod = options?.gracePeriodMs ?? 3000;

    // Wait for graceful exit
    const exited = await this.waitForExit(gracePeriod);
    if (exited) return;

    // Send SIGTERM
    this.killProcess('SIGTERM');

    // Wait for SIGTERM
    const exitedAfterTerm = await this.waitForExit(2000);
    if (exitedAfterTerm) return;

    // Force kill
    this.killProcess('SIGKILL');
    await this.waitForExit(1000);
  }

  /**
   * Immediately kill the process.
   */
  kill(): void {
    this.killProcess('SIGKILL');
  }

  // --- Private ---

  private handleStdout(text: string): void {
    this.stdoutBuffer += text;

    // Extract orchestra messages from the buffer
    while (true) {
      const startIdx = this.stdoutBuffer.indexOf(MESSAGE_START);
      const endIdx = this.stdoutBuffer.indexOf(MESSAGE_END);

      if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) break;

      // Extract content before the message delimiter as regular output
      if (startIdx > 0) {
        const before = this.stdoutBuffer.substring(0, startIdx).trim();
        if (before) this.emit('output', before);
      }

      // Extract the message JSON
      const msgStart = startIdx + MESSAGE_START.length;
      const msgJson = this.stdoutBuffer.substring(msgStart, endIdx).trim();
      if (msgJson) {
        this.emit('message', msgJson);
      }

      // Advance buffer past the end delimiter
      this.stdoutBuffer = this.stdoutBuffer.substring(endIdx + MESSAGE_END.length);
    }

    // Emit any remaining content that doesn't contain partial delimiters
    if (this.stdoutBuffer.length > 0 && !this.stdoutBuffer.includes(MESSAGE_START.substring(0, 3))) {
      const remaining = this.stdoutBuffer.trim();
      if (remaining) this.emit('output', remaining);
      this.stdoutBuffer = '';
    }
  }

  private killProcess(signal: NodeJS.Signals): void {
    if (!this.process) return;
    try {
      this.process.kill(signal);
    } catch {
      // Process may already be dead
    }
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this._state === ProcessState.Stopped || this._state === ProcessState.Crashed) {
        resolve(true);
        return;
      }

      const timer = setTimeout(() => {
        resolve(false);
      }, timeoutMs);

      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };

      this.once('exit', onExit);
    });
  }
}
