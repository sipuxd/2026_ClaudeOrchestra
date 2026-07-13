// SDK governance hooks for agent query() sessions.
// Ports the logic from .claude/hooks/block-traversal.js and tsc.js
// into callback hooks that fire at runtime on spawned agents.

import { execSync } from 'node:child_process';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  PostToolUseHookInput,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import {
  evaluateCommand,
  evaluatePathAccess,
  formatGuardrailReport,
  type GuardrailReport,
  type GuardrailRuntimeConfig,
  hasBlockingFindings,
} from './guardrails.js';

/**
 * Core PreToolUse policy check. When `projectRoot` is supplied, file paths are
 * also required to stay inside that root (see evaluatePathAccess containment).
 */
function evaluateToolUse(input: HookInput, projectRoot?: string): HookJSONOutput {
  const pi = input as PreToolUseHookInput;
  const toolInput = pi.tool_input as Record<string, unknown> | undefined;
  const filePath = (toolInput?.file_path ??
    toolInput?.path ??
    toolInput?.notebook_path ??
    '') as string;
  const command = (toolInput?.command ?? '') as string;
  const findings = [
    ...evaluatePathAccess(filePath, projectRoot),
    ...(pi.tool_name === 'Bash' ? evaluateCommand(command) : []),
  ];
  const report: GuardrailReport = {
    ok: !findings.some((finding) => finding.severity === 'block'),
    phase: 'claude-pre-tool-use',
    checkedAt: new Date().toISOString(),
    findings,
  };

  if (hasBlockingFindings(report)) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: formatGuardrailReport(report),
      },
    };
  }
  return {};
}

/**
 * Builds a PreToolUse hook bound to `cwd` (the project root), so file paths that
 * resolve outside the project are blocked in addition to the shared policy. This
 * is the only PreToolUse hook constructor — an unbound variant that skipped
 * project containment was removed so a future call site can't silently wire the
 * weaker check.
 */
export function makeBlockTraversal(cwd: string) {
  return async function blockTraversalScoped(
    input: HookInput,
    _toolUseID: string | undefined,
    _options: { signal: AbortSignal },
  ): Promise<HookJSONOutput> {
    return evaluateToolUse(input, cwd);
  };
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
  guardrails?: GuardrailRuntimeConfig,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  if (guardrails?.enabled === false) return {};

  return {
    PreToolUse: [
      {
        // Grep and Glob take a `path` and can read/enumerate outside the project
        // (their `path` param is extracted in evaluateToolUse), so they must be
        // contained too — omitting them let any agent read off-project files
        // (e.g. ~/.ssh, ~/.aws) that the Read tool is blocked from.
        matcher: 'Read|Edit|Write|Bash|NotebookEdit|Grep|Glob',
        hooks: [makeBlockTraversal(cwd)],
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
