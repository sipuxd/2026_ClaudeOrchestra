import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildGovernanceHooks } from '../hooks.js';
import { buildClaudeSubscriptionEnv } from './auth.js';
import { toClaudeEffort } from './effort.js';
import type { AgentInputImage, AgentSession, AgentSessionOptions } from './types.js';

class PromptChannel {
  private queue: SDKUserMessage[] = [];
  private waiter: ((value: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(prompt: string, images?: AgentInputImage[]): void {
    let content: string | Array<{ type: string; [key: string]: any }>;
    if (images && images.length > 0) {
      content = [
        { type: 'text', text: prompt },
        ...images.map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.media_type, data: img.data },
        })),
      ];
    } else {
      content = prompt;
    }

    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
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

export class ClaudeAgentSession implements AgentSession {
  readonly name: string;
  private readonly channel: PromptChannel;
  private readonly queryGen: Query;
  private pendingResolve: ((text: string) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private accumulated = '';
  private activityLog = '';
  private onProgress?: (accumulated: string) => void;
  private consuming: Promise<void>;
  private _closed = false;

  constructor(name: string, systemPrompt: string, opts: AgentSessionOptions) {
    this.name = name;
    this.channel = new PromptChannel();
    this.onProgress = opts.onProgress;

    this.queryGen = query({
      prompt: this.channel as AsyncIterable<SDKUserMessage>,
      options: {
        model: opts.model,
        systemPrompt,
        cwd: opts.cwd,
        effort: toClaudeEffort(opts.effort),
        maxTurns: opts.maxTurns,
        disallowedTools: opts.disallowedTools,
        allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        env: buildClaudeSubscriptionEnv(),
        hooks: buildGovernanceHooks(opts.cwd, opts.guardrails),
      } as any,
    });

    this.consuming = this.consume();
  }

  get closed(): boolean {
    return this._closed;
  }

  get lastActivityLog(): string {
    return this.activityLog;
  }

  async send(message: string, images?: AgentInputImage[]): Promise<string> {
    if (this._closed) {
      throw new Error(`AgentSession "${this.name}" is closed`);
    }

    return new Promise<string>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.accumulated = '';
      this.activityLog = '';
      this.channel.push(message, images);
    });
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.channel.close();
    try {
      this.queryGen.close();
    } catch {
      // Best effort
    }
  }

  async waitForCompletion(): Promise<void> {
    await this.consuming;
  }

  private async consume(): Promise<void> {
    try {
      for await (const msg of this.queryGen) {
        if ((msg as any).type === 'assistant' && this.onProgress) {
          const content = (msg as any).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use') {
                const tool = block.name || 'unknown';
                const input = block.input || {};
                let detail = '';
                if (input.file_path) detail = input.file_path;
                else if (input.command) detail = input.command.substring(0, 120);
                else if (input.pattern) detail = input.pattern;
                const line = detail ? `${tool}: ${detail}` : tool;
                this.activityLog += (this.activityLog ? '\n' : '') + line;
                this.onProgress(this.activityLog);
              }
              if (block.type === 'thinking' && block.thinking) {
                const preview = block.thinking.substring(0, 200);
                this.activityLog += (this.activityLog ? '\n' : '') + 'Thinking: ' + preview;
                this.onProgress(this.activityLog);
              }
            }
          }
        }

        const text = extractAssistantText(msg);
        if (text) {
          this.accumulated += text;
          this.onProgress?.(this.accumulated);
        }

        if ((msg as any).type === 'result' && this.pendingResolve) {
          // The SDK's `result` message repeats the final assistant text that was
          // already streamed via `assistant` messages and accumulated above.
          // Use its `result` field ONLY as a fallback when nothing streamed, so
          // the response text is never duplicated.
          if (!this.accumulated) {
            const resultText = (msg as any).result;
            if (typeof resultText === 'string') this.accumulated = resultText;
          }
          const result = this.accumulated;
          this.accumulated = '';
          const resolve = this.pendingResolve;
          this.pendingResolve = null;
          this.pendingReject = null;
          resolve(result);
        }
      }
    } catch (err: any) {
      if (this.pendingReject) {
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this._closed = true;
    }
  }
}

// Extracts the streamed text from an `assistant` message only. The final
// `result` message is intentionally NOT handled here — its `result` field
// duplicates the assistant text and is used as a fallback in consume().
function extractAssistantText(msg: any): string | null {
  const content = msg?.message?.content ?? msg?.content;
  if (msg?.type === 'assistant' && Array.isArray(content)) {
    const textParts = content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text);
    return textParts.length > 0 ? textParts.join('\n') : null;
  }
  return null;
}
