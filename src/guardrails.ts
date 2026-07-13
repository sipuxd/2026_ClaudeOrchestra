import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type GuardrailSeverity = 'block' | 'warn';

export type GuardrailFindingKind =
  | 'path_traversal'
  | 'protected_path'
  | 'dependency_change'
  | 'runtime_config_change'
  | 'secret_pattern'
  | 'forbidden_command'
  | 'mcp_tool_error'
  | 'stream_error';

export interface GuardrailFinding {
  kind: GuardrailFindingKind;
  severity: GuardrailSeverity;
  message: string;
  evidence: string;
  path?: string;
  command?: string;
}

export interface GuardrailReport {
  ok: boolean;
  phase: string;
  checkedAt: string;
  findings: GuardrailFinding[];
}

export interface GuardrailRuntimeConfig {
  enabled: boolean;
  abortCodexOnForbiddenStreamEvent: boolean;
}

export const DEFAULT_GUARDRAILS: GuardrailRuntimeConfig = {
  enabled: true,
  abortCodexOnForbiddenStreamEvent: true,
};

export function normalizeGuardrails(
  config?: Partial<GuardrailRuntimeConfig>,
): GuardrailRuntimeConfig {
  return {
    ...DEFAULT_GUARDRAILS,
    ...config,
  };
}

export class GuardrailViolationError extends Error {
  readonly report: GuardrailReport;

  constructor(message: string, report: GuardrailReport) {
    super(message);
    this.name = 'GuardrailViolationError';
    this.report = report;
  }
}

const PROTECTED_PATH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|\/)\.env(?:$|[./-])/i, reason: 'environment files may contain secrets' },
  {
    pattern: /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i,
    reason: 'private key material is protected',
  },
  { pattern: /\.(pem|p12|pfx|key)$/i, reason: 'key/certificate files are protected' },
  { pattern: /(^|\/)\.git(\/|$)/i, reason: 'git internals are protected' },
  {
    pattern: /(^|\/)\.claude-orchestra\/teams(\/|$)/i,
    reason: 'orchestrator team state is engine-owned',
  },
];

const DEPENDENCY_PATH_PATTERNS = [
  /(^|\/)package\.json$/i,
  /(^|\/)package-lock\.json$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)bun\.lockb?$/i,
];

const RUNTIME_CONFIG_PATH_PATTERNS = [
  /(^|\/)orchestra\.config\.json$/i,
  /(^|\/)\.mcp\.json$/i,
  /(^|\/)\.claude\/settings\.json$/i,
  /(^|\/)agents\/[^/]+\.agent\.md$/i,
  /(^|\/)(AGENTS|CLAUDE)\.md$/i,
];

const SECRET_LINE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
    label: 'private key block',
  },
  {
    pattern:
      /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=:@-]{20,}/i,
    label: 'credential-looking assignment',
  },
  {
    pattern: /\b(?:sk-ant|sk-proj|sk)-[A-Za-z0-9_-]{20,}/i,
    label: 'API key-looking token',
  },
  {
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}/i,
    label: 'GitHub token-looking value',
  },
];

const FORBIDDEN_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bsudo\b/, reason: 'sudo is outside the agent safety envelope' },
  {
    // Recursive-force rm targeting anything that can reach outside the project
    // (absolute `/`, home `~`, parent `..`, or env-var `$`). Two lookaheads
    // require BOTH a recursive flag (`-r`/`-R`/`-fr`/`--recursive`) and a force
    // flag (`-f`/`-Rf`/`--force`) in any order/position/case, so `rm -Rf /`,
    // `rm --recursive --force /`, `rm -v -rf ~`, and `rm /path -rf` are all
    // caught. Local relative deletes (`rm -rf ./build`, `rm -rf node_modules`)
    // are intentionally still allowed.
    pattern:
      /\brm\b(?=[\s\S]{0,200}?(?:-\w*r|--recursive))(?=[\s\S]{0,200}?(?:-\w*f|--force))[\s\S]{0,200}?(?:^|\s)['"]?(?:\/|~|\.\.|\$)/i,
    reason: 'destructive recursive removal outside the project is blocked',
  },
  {
    pattern: /\b(?:curl|wget)\b[\s\S]{0,200}\|\s*(?:sh|bash|zsh|python|node)\b/,
    reason: 'piped remote script execution is blocked',
  },
  {
    // SSH private keys and cloud credential files, wherever they live. Bash is
    // not path-contained, so a read of these outside the project (e.g.
    // `cat ~/.ssh/id_rsa`) must be blocked by content, not location.
    pattern:
      /\bid_(?:rsa|dsa|ecdsa|ed25519)\b|(?:^|[\s='"/])\.ssh\/|\.aws\/credentials\b|\.config\/gcloud\b/i,
    reason: 'accessing SSH keys or cloud credential files is blocked',
  },
  {
    // curl/wget reading a local file into a request body via the `@file` syntax.
    // The `@` must sit at the START of a value (after whitespace, a quote, or
    // `=`), which is what curl's @file read requires — so `-d @secrets`,
    // `--data-binary @f`, and `-F field=@f` are caught, but a JSON body with an
    // email (`-d '{"email":"x@y.com"}'`) is NOT (its `@` follows a letter).
    pattern:
      /\b(?:curl|wget)\b[\s\S]{0,200}(?:--data(?:-ascii|-binary|-raw|-urlencode)?|--json|--form|-d|-F)\b[\s\S]{0,100}[\s'"=]@/i,
    reason: 'exfiltrating a local file over the network is blocked',
  },
  {
    // curl/wget uploading a local file via a path-taking flag (no `@`):
    // curl --upload-file/-T, wget --post-file/--body-file.
    pattern:
      /\bcurl\b[\s\S]{0,200}(?:--upload-file\b|\s-T\b)|\b(?:curl|wget)\b[\s\S]{0,200}(?:--post-file|--body-file)\b/i,
    reason: 'uploading a local file over the network is blocked',
  },
  {
    // Any common reader/copier/interpreter referencing a `.env`/`.env.*` file.
    // The boundary before `.env` accepts whitespace, `=`, `/`, or a quote so
    // `cat ./.env`, `cp .env /tmp/x`, `base64 .env`, `node -e "...'.env'..."`,
    // and `source .env` are all caught. Case-insensitive so `.ENV` on a
    // case-insensitive filesystem (macOS) is caught too.
    pattern:
      /\b(?:cat|less|more|head|tail|bat|nl|tac|xxd|od|strings|grep|rg|awk|sed|cut|sort|uniq|view|vi|vim|nano|open|code|printenv|cp|mv|dd|base64|gzip|gunzip|zip|tar|scp|rsync|node|python|python3|ruby|perl|source|tee)\b[\s\S]{0,160}(?:^|[\s=/'"])\.env(?:\.[A-Za-z0-9_.-]+)?(?:['"\s]|$)/i,
    reason: 'reading environment secret files is blocked',
  },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'destructive git reset is blocked' },
  { pattern: /\bchmod\s+-R\s+777\b/, reason: 'broad world-writable permissions are blocked' },
];

export function evaluatePathAccess(filePath: string, projectRoot?: string): GuardrailFinding[] {
  const normalized = normalizePathForPolicy(filePath);
  if (!normalized) return [];

  const findings: GuardrailFinding[] = [];

  if (hasTraversal(normalized)) {
    findings.push({
      kind: 'path_traversal',
      severity: 'block',
      message: 'Path traversal is blocked.',
      evidence: filePath,
      path: filePath,
    });
  }

  // Project containment: refuse any path that resolves outside the project root.
  // Absolute paths (e.g. /Users/you/.zshrc, /etc/passwd) and home references
  // (~/...) are outside by definition. This is the primary write/read boundary
  // now that agents run with permissionMode 'bypassPermissions', where the SDK
  // itself no longer prompts.
  if (projectRoot && isOutsideProject(filePath, projectRoot)) {
    findings.push({
      kind: 'path_traversal',
      severity: 'block',
      message: 'Path escapes the project directory.',
      evidence: filePath,
      path: filePath,
    });
  }

  const protectedMatch = PROTECTED_PATH_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  if (protectedMatch) {
    findings.push({
      kind: 'protected_path',
      severity: 'block',
      message: `Protected path blocked: ${protectedMatch.reason}.`,
      evidence: filePath,
      path: filePath,
    });
  }

  return findings;
}

export function evaluateChangedPath(filePath: string, projectRoot?: string): GuardrailFinding[] {
  const normalized = normalizePathForPolicy(filePath);
  const findings = evaluatePathAccess(filePath, projectRoot);
  if (!normalized) return findings;

  if (DEPENDENCY_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    findings.push({
      kind: 'dependency_change',
      severity: 'warn',
      message: 'Dependency manifest or lockfile changed.',
      evidence: filePath,
      path: filePath,
    });
  }

  if (RUNTIME_CONFIG_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    findings.push({
      kind: 'runtime_config_change',
      severity: 'warn',
      message: 'Runtime or agent configuration changed.',
      evidence: filePath,
      path: filePath,
    });
  }

  return findings;
}

export function evaluateCommand(command: string): GuardrailFinding[] {
  if (!command.trim()) return [];

  const findings: GuardrailFinding[] = [];
  for (const { pattern, reason } of FORBIDDEN_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      findings.push({
        kind: 'forbidden_command',
        severity: 'block',
        message: reason,
        evidence: command,
        command,
      });
    }
  }
  return findings;
}

export function evaluateDiffForSecrets(diff: string): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const content = line.slice(1);
    for (const { pattern, label } of SECRET_LINE_PATTERNS) {
      if (pattern.test(content)) {
        findings.push({
          kind: 'secret_pattern',
          severity: 'block',
          message: `Secret-like content detected in diff: ${label}.`,
          evidence: redact(content),
        });
      }
    }
  }
  return findings;
}

export function evaluateCodexStreamItem(item: unknown, projectRoot?: string): GuardrailFinding[] {
  if (!item || typeof item !== 'object') return [];
  const typed = item as Record<string, unknown>;

  if (typed.type === 'command_execution') {
    return evaluateCommand(String(typed.command ?? ''));
  }

  if (typed.type === 'file_change' && Array.isArray(typed.changes)) {
    return typed.changes.flatMap((change) => {
      if (!change || typeof change !== 'object') return [];
      return evaluateChangedPath(
        String((change as Record<string, unknown>).path ?? ''),
        projectRoot,
      );
    });
  }

  if (typed.type === 'mcp_tool_call' && typed.status === 'failed') {
    const server = String(typed.server ?? 'unknown');
    const tool = String(typed.tool ?? 'unknown');
    return [
      {
        kind: 'mcp_tool_error',
        severity: 'warn',
        message: 'MCP tool call failed during Codex turn.',
        evidence: `${server}:${tool}`,
      },
    ];
  }

  if (typed.type === 'error') {
    return [
      {
        kind: 'stream_error',
        severity: 'warn',
        message: 'Codex stream item reported a non-fatal error.',
        evidence: String(typed.message ?? 'unknown error'),
      },
    ];
  }

  return [];
}

export function auditProjectChanges(projectPath: string, phase: string): GuardrailReport {
  const findings: GuardrailFinding[] = [];
  if (!isGitRepository(projectPath)) {
    return makeReport(phase, findings);
  }

  const untrackedPaths = gitLines(projectPath, ['ls-files', '--others', '--exclude-standard']);
  const changedPaths = unique([
    ...gitLines(projectPath, ['diff', '--name-only', 'HEAD']),
    ...untrackedPaths,
  ]);

  for (const changedPath of changedPaths) {
    findings.push(...evaluateChangedPath(changedPath, projectPath));
  }

  const diff = gitOutput(projectPath, ['diff', '--unified=0', 'HEAD']);
  findings.push(...evaluateDiffForSecrets(diff));

  for (const changedPath of untrackedPaths) {
    findings.push(...scanUntrackedFileForSecrets(projectPath, changedPath));
  }

  return makeReport(phase, dedupeFindings(findings));
}

export function formatGuardrailReport(report: GuardrailReport): string {
  if (report.findings.length === 0) {
    return `Guardrail audit passed for ${report.phase}.`;
  }
  return report.findings
    .map((finding) => {
      const scope = finding.path ? ` (${finding.path})` : '';
      return `${finding.severity.toUpperCase()} ${finding.kind}${scope}: ${finding.message}\nEvidence: ${finding.evidence}`;
    })
    .join('\n\n');
}

export function hasBlockingFindings(report: GuardrailReport): boolean {
  return report.findings.some((finding) => finding.severity === 'block');
}

function makeReport(phase: string, findings: GuardrailFinding[]): GuardrailReport {
  return {
    ok: !findings.some((finding) => finding.severity === 'block'),
    phase,
    checkedAt: new Date().toISOString(),
    findings,
  };
}

function normalizePathForPolicy(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function hasTraversal(filePath: string): boolean {
  return filePath.split('/').some((part) => part === '..');
}

/**
 * Canonicalize a path through symlinks. When the path (or its leaf) does not
 * exist yet — e.g. a Write to a new file — realpath the deepest existing
 * ancestor and re-append the missing tail, so a new file inside a symlinked
 * project still resolves under the canonical root.
 */
function canonicalize(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(canonicalize(parent), path.basename(p));
  }
}

/**
 * True when `filePath` resolves outside `projectRoot`. A leading `~` is a home
 * reference the shell would expand outside the project, so it is treated as
 * outside without needing to expand it. Both sides are canonicalized through
 * symlinks so a project referenced via a symlinked path (e.g. macOS `/tmp` ->
 * `/private/tmp`) doesn't classify its own in-project files as outside.
 */
function isOutsideProject(filePath: string, projectRoot: string): boolean {
  if (/^~($|\/)/.test(filePath.trim())) return true;
  const rootResolved = path.resolve(projectRoot);
  const root = canonicalize(rootResolved);
  const resolved = canonicalize(path.resolve(rootResolved, filePath));
  return resolved !== root && !resolved.startsWith(root + path.sep);
}

function isGitRepository(projectPath: string): boolean {
  try {
    const output = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    });
    return output.trim() === 'true';
  } catch {
    return false;
  }
}

function gitOutput(projectPath: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    });
  } catch {
    return '';
  }
}

function gitLines(projectPath: string, args: string[]): string[] {
  return gitOutput(projectPath, args)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function scanUntrackedFileForSecrets(projectPath: string, changedPath: string): GuardrailFinding[] {
  const absolute = path.resolve(projectPath, changedPath);
  if (!absolute.startsWith(path.resolve(projectPath) + path.sep)) return [];
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > 1_000_000) return [];

  let content = '';
  try {
    content = fs.readFileSync(absolute, 'utf-8');
  } catch {
    return [];
  }

  const findings: GuardrailFinding[] = [];
  for (const line of content.split('\n')) {
    for (const { pattern, label } of SECRET_LINE_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          kind: 'secret_pattern',
          severity: 'block',
          message: `Secret-like content detected in changed file: ${label}.`,
          evidence: redact(line),
          path: changedPath,
        });
      }
    }
  }
  return findings;
}

function redact(value: string): string {
  return value.length > 24 ? `${value.slice(0, 12)}...[redacted]` : '[redacted]';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeFindings(findings: GuardrailFinding[]): GuardrailFinding[] {
  const seen = new Set<string>();
  const result: GuardrailFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.kind}:${finding.severity}:${finding.path ?? ''}:${finding.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  return result;
}
