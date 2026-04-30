import { describe, expect, it } from 'vitest';
import {
  toClaudeEffort,
  toCodexReasoningEffort,
  toProviderEffort,
} from '../src/agent-runtime/index.js';

describe('agent runtime effort mapping', () => {
  it('uses Codex SDK reasoning effort names', () => {
    expect(toCodexReasoningEffort('minimal')).toBe('minimal');
    expect(toCodexReasoningEffort('low')).toBe('low');
    expect(toCodexReasoningEffort('medium')).toBe('medium');
    expect(toCodexReasoningEffort('high')).toBe('high');
    expect(toCodexReasoningEffort('xhigh')).toBe('xhigh');
  });

  it('keeps max as a legacy alias for Codex extra high', () => {
    expect(toCodexReasoningEffort('max')).toBe('xhigh');
  });

  it('uses Claude Agent SDK effort names', () => {
    expect(toClaudeEffort('low')).toBe('low');
    expect(toClaudeEffort('medium')).toBe('medium');
    expect(toClaudeEffort('high')).toBe('high');
    expect(toClaudeEffort('max')).toBe('max');
  });

  it('maps Codex-only effort names to the closest Claude Agent SDK values', () => {
    expect(toClaudeEffort('minimal')).toBe('low');
    expect(toClaudeEffort('xhigh')).toBe('max');
  });

  it('selects the active provider mapping', () => {
    expect(toProviderEffort('codex', 'max')).toBe('xhigh');
    expect(toProviderEffort('claude', 'xhigh')).toBe('max');
  });
});
