import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  evaluateCodexStreamItem,
  formatGuardrailReport,
  type GuardrailReport,
  GuardrailViolationError,
  hasBlockingFindings,
} from '../guardrails.js';
import { buildCodexSubscriptionEnv, normalizeProviderModel } from './auth.js';
import { toCodexReasoningEffort } from './effort.js';
import type { AgentInputImage, AgentSession, AgentSessionOptions } from './types.js';

type CodexInput =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }>;

export class CodexAgentSession implements AgentSession {
  readonly name: string;
  private readonly systemPrompt: string;
  private readonly opts: AgentSessionOptions;
  private codexClient: any = null;
  private codexThread: any = null;
  private abortController: AbortController | null = null;
  private systemPromptSent = false;
  private accumulated = '';
  private activityLog = '';
  private _closed = false;
  private turnCount = 0;
  private readonly monitoredStreamKeys = new Set<string>();

  constructor(name: string, systemPrompt: string, opts: AgentSessionOptions) {
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.opts = opts;
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
    if (this.opts.maxTurns !== undefined && this.turnCount >= this.opts.maxTurns) {
      throw new Error(`Codex maxTurns exceeded for "${this.name}" (${this.opts.maxTurns})`);
    }

    await this.ensureThread();

    this.turnCount++;
    this.accumulated = '';
    this.activityLog = '';
    this.abortController = new AbortController();
    const input = this.prepareInput(message, images);

    try {
      const { events } = await this.codexThread.runStreamed(input, {
        signal: this.abortController.signal,
      });

      for await (const event of events) {
        if (
          event.type === 'item.started' ||
          event.type === 'item.completed' ||
          event.type === 'item.updated'
        ) {
          this.enforceStreamGuardrails(event.item);
        }

        if (event.type === 'item.completed' || event.type === 'item.updated') {
          if (event.item?.type === 'agent_message') {
            this.accumulated = event.item.text ?? this.accumulated;
            this.opts.onProgress?.(this.accumulated);
            continue;
          }

          const progress = formatCodexProgressItem(event.item);
          if (progress) {
            this.activityLog += (this.activityLog ? '\n' : '') + progress;
            this.opts.onProgress?.(this.activityLog);
          }
        } else if (event.type === 'turn.failed') {
          throw new Error(event.error?.message ?? 'Codex turn failed');
        } else if (event.type === 'error') {
          throw new Error(event.message ?? 'Codex stream failed');
        }
      }

      return this.accumulated;
    } finally {
      this.abortController = null;
    }
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async waitForCompletion(): Promise<void> {
    return;
  }

  private async ensureThread(): Promise<void> {
    if (this.codexThread) return;

    const { Codex } = await import('@openai/codex-sdk');
    const model = normalizeProviderModel(this.opts.model ?? this.opts.runtime.model);
    const isReadOnlyRole =
      this.opts.disallowedTools?.some(
        (tool) => tool === 'Write' || tool === 'Edit' || tool === 'Bash',
      ) ?? false;

    this.codexClient = new Codex({
      env: buildCodexSubscriptionEnv(),
      config: {
        forced_login_method: 'chatgpt',
      },
    });
    this.codexThread = this.codexClient.startThread({
      model,
      workingDirectory: this.opts.cwd,
      skipGitRepoCheck: true,
      sandboxMode: isReadOnlyRole ? 'read-only' : 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      modelReasoningEffort: toCodexReasoningEffort(this.opts.effort),
    });
  }

  private prepareInput(message: string, images?: AgentInputImage[]): CodexInput {
    const prompt = this.systemPromptSent ? message : `${this.systemPrompt}\n\n---\n\n${message}`;
    this.systemPromptSent = true;

    if (!images || images.length === 0) return prompt;

    const imageDir = path.join(this.opts.cwd, '.claude-orchestra', 'codex-images');
    fs.mkdirSync(imageDir, { recursive: true });

    const input: Exclude<CodexInput, string> = [{ type: 'text', text: prompt }];
    images.forEach((image, index) => {
      const ext = mediaTypeExtension(image.media_type);
      const imagePath = path.join(imageDir, `${Date.now()}-${index}.${ext}`);
      fs.writeFileSync(imagePath, Buffer.from(image.data, 'base64'));
      input.push({ type: 'local_image', path: imagePath });
    });
    return input;
  }

  private enforceStreamGuardrails(item: unknown): void {
    if (this.opts.guardrails?.enabled === false) return;
    if (!item || typeof item !== 'object') return;

    const typed = item as Record<string, unknown>;
    const id = String(typed.id ?? '');
    const status = String(typed.status ?? '');
    const key = `${id}:${String(typed.type ?? '')}:${status}`;
    if (id && this.monitoredStreamKeys.has(key)) return;
    if (id) this.monitoredStreamKeys.add(key);

    const findings = evaluateCodexStreamItem(item);
    if (findings.length === 0) return;

    const report: GuardrailReport = {
      ok: !findings.some((finding) => finding.severity === 'block'),
      phase: `codex-stream:${this.name}`,
      checkedAt: new Date().toISOString(),
      findings,
    };

    const detail = `Guardrail post-detection:\n${formatGuardrailReport(report)}`;
    this.activityLog += (this.activityLog ? '\n' : '') + detail;
    this.opts.onProgress?.(this.activityLog);

    if (
      hasBlockingFindings(report) &&
      this.opts.guardrails?.abortCodexOnForbiddenStreamEvent !== false
    ) {
      this.abortController?.abort();
      throw new GuardrailViolationError(
        'Codex stream guardrail blocked the turn after detecting a forbidden event.',
        report,
      );
    }
  }
}

function mediaTypeExtension(mediaType: string): string {
  if (mediaType === 'image/jpeg') return 'jpg';
  if (mediaType === 'image/webp') return 'webp';
  if (mediaType === 'image/gif') return 'gif';
  return 'png';
}

function formatCodexProgressItem(item: any): string | null {
  if (!item || typeof item !== 'object') return null;
  if (item.type === 'command_execution')
    return `Bash: ${String(item.command ?? '').substring(0, 120)}`;
  if (item.type === 'file_change') {
    const changes = Array.isArray(item.changes)
      ? item.changes
          .map((change: any) => `${change.kind ?? 'update'} ${change.path ?? ''}`)
          .join(', ')
      : 'files changed';
    return `Edit: ${changes}`;
  }
  if (item.type === 'mcp_tool_call')
    return `MCP: ${item.server ?? 'server'}:${item.tool ?? 'tool'}`;
  if (item.type === 'web_search') return `WebSearch: ${item.query ?? ''}`;
  if (item.type === 'reasoning')
    return item.text ? `Reasoning: ${String(item.text).substring(0, 200)}` : null;
  if (item.type === 'error') return `Error: ${item.message ?? 'unknown'}`;
  return null;
}
