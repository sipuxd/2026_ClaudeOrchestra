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

/** Every effort name accepted across providers (Claude `max` + Codex `minimal`/`xhigh`). */
const EFFORT_LEVELS = new Set<string>(['minimal', 'low', 'medium', 'high', 'max', 'xhigh']);

/**
 * Type guard: true only for a recognized effort name. Used to reject bogus
 * user-authored frontmatter effort values (e.g. `effort: turbo`) before they
 * reach the SDK, which has no default case and would forward them verbatim.
 */
export function isEffortLevel(value: string | undefined): value is EffortLevel {
  return value !== undefined && EFFORT_LEVELS.has(value);
}
