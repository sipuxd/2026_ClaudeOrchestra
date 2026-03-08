// Wrapper around a single Claude Code agent.
// Supports two modes:
//   - Test mode (spawnArgs set): uses child_process.spawn() with mock processes
//   - SDK mode (production): uses @anthropic-ai/claude-agent-sdk query()

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { query, type SDKMessage, type SDKUserMessage, type Query } from '@anthropic-ai/claude-agent-sdk';
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
  /** Tools the agent is allowed to use (SDK mode) */
  allowedTools?: string[];
  /** Max agentic turns before stopping (SDK mode) */
  maxTurns?: number;
}

// --- Agent process state ---

export enum ProcessState {
  Starting = 'starting',
  Running = 'running',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Crashed = 'crashed',
}

// --- PromptChannel: bridges sync send() to async iterable for SDK ---

class PromptChannel {
  private queue: SDKUserMessage[] = [];
  private waiter: ((value: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(prompt: string): void {
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: prompt },
      parent_tool_use_id: null,
      session_id: '',
    };
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: msg, done: false });
    } else {
      this.queue.push(msg);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined as any, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
    };
  }
}

// --- Extract text from SDK assistant message content blocks ---

function extractText(msg: SDKMessage): string | null {
  if (msg.type === 'assistant') {
    const blocks = msg.message?.content;
    if (!Array.isArray(blocks)) return null;
    const texts: string[] = [];
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text);
      }
    }
    return texts.length > 0 ? texts.join('') : null;
  }
  if (msg.type === 'result' && 'result' in msg && typeof msg.result === 'string') {
    return msg.result;
  }
  return null;
}

export class AgentProcess extends EventEmitter<AgentProcessEvents> {
  readonly role: Role;
  readonly instance: RoleInstance;
  readonly teamId: string;

  // child_process mode
  private process: ChildProcess | null = null;

  // SDK mode
  private sdkQuery: Query | null = null;
  private promptChannel: PromptChannel | null = null;
  private abortController: AbortController | null = null;
  private sdkStreamActive = false;

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

  spawn(): void {
    if (this.process || this.sdkQuery) {
      throw new Error(`Agent ${this.instance} already spawned`);
    }

    if (this.spawnOptions.spawnArgs) {
      this.spawnChildProcess();
    } else {
      this.spawnSdk();
    }
  }

  // --- Path A: child_process spawn (test mode) ---

  private spawnChildProcess(): void {
    const bin = this.spawnOptions.claudeBin ?? 'claude';
    const args = this.spawnOptions.spawnArgs!;

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

    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this._lastOutputAt = new Date();
      this.handleStdout(text);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.stderrBuffer += text;
      this.emit('stderr', text);
    });

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

    this.process.on('error', (err) => {
      this._state = ProcessState.Crashed;
      this.process = null;
      this.emit('stderr', err.message);
      this.emit('exit', 1, null);
    });

    this.emit('ready');
  }

  // --- Path B: SDK spawn (production mode) ---

  private spawnSdk(): void {
    // Ensure cwd exists
    if (!existsSync(this.spawnOptions.cwd)) {
      try {
        mkdirSync(this.spawnOptions.cwd, { recursive: true });
      } catch (err: any) {
        this._state = ProcessState.Crashed;
        const msg = `Failed to create cwd directory ${this.spawnOptions.cwd}: ${err?.message}`;
        this.emit('stderr', msg);
        this.emit('exit', 1, null);
        return;
      }
    }

    let systemPrompt: string;
    try {
      systemPrompt = readFileSync(this.spawnOptions.systemPromptPath, 'utf-8');
    } catch (err: any) {
      this._state = ProcessState.Crashed;
      const msg = `Failed to read system prompt at ${this.spawnOptions.systemPromptPath}: ${err?.message}`;
      this.emit('stderr', msg);
      this.emit('exit', 1, null);
      return;
    }

    this.abortController = new AbortController();
    this.promptChannel = new PromptChannel();

    const env: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_ORCHESTRA_ROLE: this.spawnOptions.role,
      CLAUDE_ORCHESTRA_INSTANCE: this.spawnOptions.instance,
      CLAUDE_ORCHESTRA_TEAM_ID: this.spawnOptions.teamId,
      CLAUDECODE: undefined,
    };

    try {
      this.sdkQuery = query({
        prompt: this.promptChannel as AsyncIterable<SDKUserMessage>,
        options: {
          model: this.spawnOptions.model,
          systemPrompt,
          cwd: this.spawnOptions.cwd,
          env,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          allowedTools: this.spawnOptions.allowedTools ?? [
            'Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob',
          ],
          maxTurns: this.spawnOptions.maxTurns,
          abortController: this.abortController,
          persistSession: false,
          // Capture SDK stderr for error visibility
          stderr: (data: string) => {
            this.emit('stderr', `[SDK] ${data}`);
          },
        },
      });
    } catch (err: any) {
      this._state = ProcessState.Crashed;
      const msg = `SDK query() failed to initialize: ${err?.message ?? err}`;
      this.emit('stderr', msg);
      this.emit('exit', 1, null);
      return;
    }

    this._state = ProcessState.Running;
    this.sdkStreamActive = true;

    // Consume the SDK stream in the background
    this.consumeSdkStream();

    this.emit('ready');
  }

  private async consumeSdkStream(): Promise<void> {
    try {
      for await (const msg of this.sdkQuery!) {
        if (!this.sdkStreamActive) break;

        const text = extractText(msg);
        if (text) {
          this._lastOutputAt = new Date();
          this.handleStdout(text);
        }

        // On result message, the turn is complete
        if (msg.type === 'result') {
          // Flush remaining buffer as output
          if (this.stdoutBuffer.trim()) {
            this.emit('output', this.stdoutBuffer.trim());
            this.stdoutBuffer = '';
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || this._state === ProcessState.Stopping) {
        // Expected abort during shutdown
      } else {
        this._state = ProcessState.Crashed;
        // Surface full error details for debugging
        const errorDetail = err?.stack ?? err?.message ?? String(err) ?? 'SDK stream error';
        this.emit('stderr', `SDK stream crashed: ${errorDetail}`);
        this.emit('exit', 1, null);
        return;
      }
    }

    this.sdkStreamActive = false;
    this.sdkQuery = null;

    if (this._state === ProcessState.Stopping || this._state === ProcessState.Stopped) {
      this._state = ProcessState.Stopped;
    } else if (this._state === ProcessState.Running) {
      // Stream ended normally (all prompts consumed)
      this._state = ProcessState.Stopped;
    }
    this._exitCode = 0;
    this.emit('exit', 0, null);
  }

  // --- Communication ---

  send(prompt: string): void {
    if (this.promptChannel) {
      // SDK mode
      if (!this.sdkStreamActive) {
        throw new Error(`Agent ${this.instance} SDK stream not active`);
      }
      this.promptChannel.push(prompt);
      return;
    }

    // child_process mode
    if (!this.process?.stdin?.writable) {
      throw new Error(`Agent ${this.instance} stdin not writable`);
    }
    this.process.stdin.write(prompt + '\n');
  }

  // --- Health ---

  checkAlive(): boolean {
    // SDK mode
    if (this.sdkQuery) {
      return this.sdkStreamActive && this._state === ProcessState.Running;
    }

    // child_process mode
    if (!this._pid || this._state !== ProcessState.Running) return false;
    try {
      process.kill(this._pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  silenceDurationMs(): number {
    if (!this._lastOutputAt) return Infinity;
    return Date.now() - this._lastOutputAt.getTime();
  }

  // --- Shutdown ---

  async terminate(options?: { shutdownPrompt?: string; gracePeriodMs?: number }): Promise<void> {
    if (this._state === ProcessState.Stopped || this._state === ProcessState.Crashed) {
      return;
    }

    this._state = ProcessState.Stopping;

    // SDK mode
    if (this.promptChannel) {
      if (options?.shutdownPrompt && this.sdkStreamActive) {
        this.promptChannel.push(options.shutdownPrompt);
      }
      this.promptChannel.close();

      const gracePeriod = options?.gracePeriodMs ?? 3000;
      const exited = await this.waitForExit(gracePeriod);
      if (!exited && this.abortController) {
        this.abortController.abort();
        await this.waitForExit(2000);
      }
      return;
    }

    // child_process mode
    if (!this.process) return;

    if (options?.shutdownPrompt && this.process.stdin?.writable) {
      try {
        this.process.stdin.write(options.shutdownPrompt + '\n');
      } catch {
        // stdin may already be closed
      }
    }

    try {
      this.process.stdin?.end();
    } catch {
      // stdin may already be closed
    }

    const gracePeriod = options?.gracePeriodMs ?? 3000;
    const exited = await this.waitForExit(gracePeriod);
    if (exited) return;

    this.killProcess('SIGTERM');
    const exitedAfterTerm = await this.waitForExit(2000);
    if (exitedAfterTerm) return;

    this.killProcess('SIGKILL');
    await this.waitForExit(1000);
  }

  kill(): void {
    if (this.abortController) {
      // SDK mode
      this._state = ProcessState.Stopping;
      this.promptChannel?.close();
      this.abortController.abort();
      return;
    }
    // child_process mode
    this.killProcess('SIGKILL');
  }

  // --- Private ---

  private handleStdout(text: string): void {
    this.stdoutBuffer += text;

    while (true) {
      const startIdx = this.stdoutBuffer.indexOf(MESSAGE_START);
      const endIdx = this.stdoutBuffer.indexOf(MESSAGE_END);

      if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) break;

      if (startIdx > 0) {
        const before = this.stdoutBuffer.substring(0, startIdx).trim();
        if (before) this.emit('output', before);
      }

      const msgStart = startIdx + MESSAGE_START.length;
      const msgJson = this.stdoutBuffer.substring(msgStart, endIdx).trim();
      if (msgJson) {
        this.emit('message', msgJson);
      }

      this.stdoutBuffer = this.stdoutBuffer.substring(endIdx + MESSAGE_END.length);
    }

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
