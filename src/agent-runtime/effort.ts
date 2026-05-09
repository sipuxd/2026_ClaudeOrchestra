import type {
  AgentProvider,
  ClaudeEffortLevel,
  CodexReasoningEffort,
  EffortLevel,
} from './types.js';

/**
 * Claude Agent SDK and Codex SDK use different names for their top effort.
 * Keep that translation at the provider boundary so orchestration stays generic.
 */
export function toClaudeEffort(effort: EffortLevel): ClaudeEffortLevel {
  if (effort === 'xhigh') return 'max';
  if (effort === 'minimal') return 'low';
  return effort;
}

export function toCodexReasoningEffort(effort: EffortLevel): CodexReasoningEffort {
  if (effort === 'max') return 'xhigh';
  return effort;
}

export function toProviderEffort(
  provider: AgentProvider,
  effort: EffortLevel,
): ClaudeEffortLevel | CodexReasoningEffort {
  return provider === 'claude' ? toClaudeEffort(effort) : toCodexReasoningEffort(effort);
}
