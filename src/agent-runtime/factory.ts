import { ClaudeAgentSession } from './claude-session.js';
import { CodexAgentSession } from './codex-session.js';
import type { AgentSession, AgentSessionOptions } from './types.js';

export function createAgentSession(
  name: string,
  systemPrompt: string,
  opts: AgentSessionOptions,
): AgentSession {
  if (opts.runtime.provider === 'claude') {
    return new ClaudeAgentSession(name, systemPrompt, opts);
  }
  if (opts.runtime.provider === 'codex') {
    return new CodexAgentSession(name, systemPrompt, opts);
  }
  throw new Error(`Unsupported agent provider: ${opts.runtime.provider}`);
}
