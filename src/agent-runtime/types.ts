export type AgentProvider = 'claude' | 'codex';
export type AgentAuthMode = 'subscription';
export type ClaudeEffortLevel = 'low' | 'medium' | 'high' | 'max';
/** Codex SDK/config accepts minimal, but the VS Code Codex dropdown may only show Low, Medium, High, and Extra High. */
export type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type EffortLevel = ClaudeEffortLevel | CodexReasoningEffort;

export interface AgentRuntimeConfig {
  /** Agent backend. "claude" uses Claude Agent SDK; "codex" uses Codex SDK/CLI. */
  provider: AgentProvider;
  /** Billing/auth mode. Subscription means Claude.ai or ChatGPT OAuth, not API keys. */
  auth: AgentAuthMode;
  /** Optional model override for every role. Use "default" to let the provider choose. */
  model?: string;
}

export interface AgentInputImage {
  media_type: string;
  data: string;
}

export interface AgentSessionOptions {
  runtime: AgentRuntimeConfig;
  model?: string;
  cwd: string;
  effort: EffortLevel;
  disallowedTools?: string[];
  maxTurns?: number;
  onProgress?: (accumulated: string) => void;
}

export interface AgentSession {
  readonly name: string;
  readonly closed: boolean;
  readonly lastActivityLog: string;
  send(message: string, images?: AgentInputImage[]): Promise<string>;
  close(): void;
  waitForCompletion(): Promise<void>;
}
