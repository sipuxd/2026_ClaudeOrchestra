import type { AgentProvider, AgentRuntimeConfig } from './types.js';

export const DEFAULT_AGENT_RUNTIME: AgentRuntimeConfig = {
  provider: 'claude',
  auth: 'subscription',
};

export function normalizeAgentRuntime(runtime?: Partial<AgentRuntimeConfig>): AgentRuntimeConfig {
  return {
    ...DEFAULT_AGENT_RUNTIME,
    ...runtime,
    provider: runtime?.provider ?? DEFAULT_AGENT_RUNTIME.provider,
    auth: runtime?.auth ?? DEFAULT_AGENT_RUNTIME.auth,
  };
}

export function normalizeProviderModel(model?: string): string | undefined {
  if (!model) return undefined;
  return model === 'default' ? undefined : model;
}

function envWithout(keys: string[]): Record<string, string> {
  const blocked = new Set(keys);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (blocked.has(key)) continue;
    env[key] = value;
  }
  return env;
}

function requireUnsetForSubscription(provider: AgentProvider, keys: string[]): void {
  const setKeys = keys.filter((key) => process.env[key]);
  if (setKeys.length === 0) return;

  const label = provider === 'claude' ? 'Claude' : 'Codex';
  throw new Error(
    `${label} subscription auth requested, but ${setKeys.join(', ')} ` +
      `${setKeys.length === 1 ? 'is' : 'are'} set. Unset ${setKeys.join(', ')} ` +
      'to avoid API-key or provider-based billing.',
  );
}

export function validateAgentRuntime(runtime: AgentRuntimeConfig): void {
  if (runtime.auth !== 'subscription') {
    throw new Error(`Unsupported agent auth mode: ${runtime.auth}`);
  }

  if (runtime.provider === 'claude') {
    requireUnsetForSubscription('claude', [
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_API_KEY',
    ]);
    return;
  }

  if (runtime.provider === 'codex') {
    requireUnsetForSubscription('codex', ['CODEX_API_KEY', 'OPENAI_API_KEY', 'OPENAI_AUTH_TOKEN']);
    return;
  }

  throw new Error(`Unsupported agent provider: ${runtime.provider}`);
}

export function buildClaudeSubscriptionEnv(): Record<string, string | undefined> {
  return {
    ...envWithout([
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_API_KEY',
    ]),
    CLAUDECODE: undefined,
  };
}

export function buildCodexSubscriptionEnv(): Record<string, string> {
  return envWithout(['CODEX_API_KEY', 'OPENAI_API_KEY', 'OPENAI_AUTH_TOKEN']);
}
