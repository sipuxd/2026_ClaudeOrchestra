import type { AgentProvider } from './agent-runtime/types.js';
import { GuardrailViolationError, type GuardrailReport } from './guardrails.js';

export type RuntimeErrorCategory =
  | 'guardrail'
  | 'provider'
  | 'validation'
  | 'permission'
  | 'git'
  | 'unknown';

export interface NormalizedRuntimeErrorData {
  provider: AgentProvider | 'orchestrator';
  phase: string;
  category: RuntimeErrorCategory;
  retryable: boolean;
  message: string;
  evidence?: unknown;
}

export class NormalizedRuntimeError extends Error {
  readonly data: NormalizedRuntimeErrorData;
  readonly cause?: unknown;

  constructor(data: NormalizedRuntimeErrorData, cause?: unknown) {
    super(data.message);
    this.name = 'NormalizedRuntimeError';
    this.data = data;
    this.cause = cause;
  }
}

export function normalizeRuntimeError(
  err: unknown,
  context: { provider: AgentProvider | 'orchestrator'; phase: string },
): NormalizedRuntimeError {
  if (err instanceof NormalizedRuntimeError) return err;

  if (err instanceof GuardrailViolationError) {
    return new NormalizedRuntimeError({
      provider: context.provider,
      phase: context.phase,
      category: 'guardrail',
      retryable: false,
      message: err.message,
      evidence: summarizeGuardrailReport(err.report),
    }, err);
  }

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const retryable =
    lower.includes('timeout') ||
    lower.includes('temporar') ||
    lower.includes('rate limit') ||
    lower.includes('stream failed') ||
    lower.includes('turn failed');

  const category: RuntimeErrorCategory =
    lower.includes('permission') || lower.includes('denied')
      ? 'permission'
      : lower.includes('validation') || lower.includes('malformed')
        ? 'validation'
        : lower.includes('git ')
          ? 'git'
          : context.provider === 'orchestrator'
            ? 'unknown'
            : 'provider';

  return new NormalizedRuntimeError({
    provider: context.provider,
    phase: context.phase,
    category,
    retryable,
    message,
  }, err);
}

function summarizeGuardrailReport(report: GuardrailReport): unknown {
  return {
    phase: report.phase,
    checkedAt: report.checkedAt,
    findings: report.findings.map(finding => ({
      kind: finding.kind,
      severity: finding.severity,
      message: finding.message,
      evidence: finding.evidence,
      path: finding.path,
      command: finding.command,
    })),
  };
}
