// SDK governance hooks for agent query() sessions.
// Ports the logic from .claude/hooks/block-traversal.js and tsc.js
// into callback hooks that fire at runtime on spawned agents.

import { execSync } from 'node:child_process';
import type {
  HookEvent,
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
  PreToolUseHookInput,
  PostToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * PreToolUse hook: blocks file paths containing ".." to prevent traversal.
 */
export async function blockTraversal(
  input: HookInput,
  _toolUseID: string | undefined,
  _options: { signal: AbortSignal },
): Promise<HookJSONOutput> {
  const pi = input as PreToolUseHookInput;
  const toolInput = pi.tool_input as Record<string, unknown> | undefined;
  const filePath = (toolInput?.file_path ?? toolInput?.path ?? '') as string;

  if (filePath.includes('..')) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Blocked: ".." is not allowed in file paths. Remove ".." from "${filePath}" and try again.`,
      },
    };
  }
  return {};
}

/**
 * Returns a PostToolUse hook that runs incremental tsc in the given cwd.
 */
export function makeTypeCheckHook(cwd: string) {
  return async function typeCheck(
    input: HookInput,
    _toolUseID: string | undefined,
    _options: { signal: AbortSignal },
  ): Promise<HookJSONOutput> {
    const pi = input as PostToolUseHookInput;
    const toolInput = pi.tool_input as Record<string, unknown> | undefined;
    const filePath = (toolInput?.file_path ?? '') as string;

    if (!/\.(ts|tsx)$/.test(filePath)) return {};

    try {
      execSync('npx tsc --noEmit --incremental --tsBuildInfoFile .claude/.tsbuildinfo', {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      });
    } catch (err: any) {
      const output = err.stderr?.toString() || err.stdout?.toString() || '';
      if (output) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: `TypeScript errors detected:\n${output}`,
          },
        };
      }
    }
    return {};
  };
}

/**
 * Builds the governance hooks object for SDK query() options.
 */
export function buildGovernanceHooks(
  cwd: string,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      {
        matcher: 'Read|Edit|Write',
        hooks: [blockTraversal],
        timeout: 5,
      },
    ],
    PostToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [makeTypeCheckHook(cwd)],
        timeout: 45,
      },
    ],
  };
}
