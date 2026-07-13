// PipelineOrchestrator — Deterministic code-driven orchestration.
//
// Eliminates the Supervisor LLM entirely. Code drives the pipeline:
//   Security scan → Worker-1 implements → Worker-2 verifies → Security sweep → Review
//
// Worker-2 acts as an engineering manager: it checks Worker-1's output
// against the original task requirements and reports gaps. A gap is a
// specific requirement the user asked for that isn't implemented.
// Worker-1 fixes gaps, Worker-2 re-checks (max 2 loops). Worker-2 never
// modifies code — requirements verification only.
//
// Each agent gets its own provider-backed session. The pipeline talks to a
// small AgentSession interface; provider adapters own SDK-specific behavior.

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentRuntimeConfig, AgentSession, EffortLevel } from './agent-runtime/index.js';
import {
  createAgentSession,
  isEffortLevel,
  normalizeAgentRuntime,
  normalizeProviderModel,
  validateAgentRuntime,
} from './agent-runtime/index.js';
import { GitOps } from './git.js';
import {
  auditProjectChanges,
  formatGuardrailReport,
  type GuardrailReport,
  type GuardrailRuntimeConfig,
  GuardrailViolationError,
  hasBlockingFindings,
  normalizeGuardrails,
} from './guardrails.js';
import { Portfolio, type Project } from './portfolio.js';
import { Registry } from './registry.js';
import { Role, type RoleInstance } from './roles/role-types.js';
import { classifyComplexity, hasDestructiveIntent } from './router/complexity-router.js';
import { normalizeRuntimeError } from './runtime-errors.js';
import { ALL_INSTANCES, INSTANCE_AGENT_FILES, INSTANCE_TO_ROLE } from './spawner/agent-files.js';
import { parseFrontmatter } from './spawner/frontmatter-parser.js';
import { StatePersistence } from './state/persistence.js';
import {
  type ChatMessage,
  DEFAULT_LOOP_LIMITS,
  type LoopLimits,
  TeamPhase,
  TeamState,
  type TeamStateData,
} from './state/team-state.js';
import { AgentState } from './types/index.js';

export type {
  AgentAuthMode,
  AgentProvider,
  AgentRuntimeConfig,
  EffortLevel,
} from './agent-runtime/index.js';

// --- Orchestrator events (shared interface for all event consumers) ---

export interface OrchestratorEvents {
  'team-created': [teamId: string];
  'task-assigned': [teamId: string, description: string];
  'task-classified': [teamId: string, complexity: string, agentCount: number];
  'phase-transition': [teamId: string, from: TeamPhase, to: TeamPhase, trigger: string];
  'task-complete': [teamId: string, phase: TeamPhase, durationMs: number];
  'agent-output': [teamId: string, instance: RoleInstance, data: string];
  'agent-progress': [teamId: string, instance: RoleInstance, text: string];
  'malformed-output': [teamId: string, instance: RoleInstance, raw: string];
  error: [teamId: string, error: Error];
  feedback: [teamId: string, feedback: FeedbackPayload];
  'feedback-response': [teamId: string, feedbackId: string, value: string];
  'agent-task': [teamId: string, instance: RoleInstance, subtask: string];
  'security-review': [teamId: string, data: { status: string; result?: string }];
  'pr-created': [teamId: string, prNumber: number, prUrl: string];
  'team-archived': [teamId: string, prUrl: string];
  'team-deleted': [teamId: string];
  // Emitted on every user/coordinator message and on synthetic system notes
  // (e.g. "Pipeline started for: ..."). Dashboard appends to the team's chat
  // panel. Includes the verdict for coordinator messages so the UI can style
  // TRIGGER_PIPELINE differently from RESPONDING/ASKING.
  'chat-message': [teamId: string, message: ChatMessage];
  // Emitted when cancelChat aborts an in-flight coordinator turn. Dashboard
  // clears the team's chatPending state and shows a toast. No chat-message
  // is emitted for the cancelled turn.
  'chat-cancelled': [teamId: string];
  shutdown: [];
}

export interface FeedbackPayload {
  id: string;
  type: 'info' | 'warning' | 'question' | 'decision' | 'error';
  title: string;
  message: string;
  actions?: Array<{ label: string; value: string }>;
  blocking?: boolean;
  timestamp: string;
  sourceAgent?: string;
  highlightTerms?: string[];
  detail?: string;
  metadata?: Record<string, unknown>;
  /**
   * Editable body for a blocking prompt (e.g. the requirements checklist). When
   * present, the dashboard lets the user revise this text before responding; the
   * edited text is returned to the resolver as `text`.
   */
  editableContent?: string;
}
// Agent config defaults are read from YAML frontmatter in agent .md files.
// These fallbacks are used when frontmatter is missing a field.
const FALLBACK_MODEL = 'claude-opus-4-6';
const FALLBACK_EFFORT: EffortLevel = 'medium';
const FALLBACK_MAX_TURNS = 20;

/**
 * Frontmatter maxTurns is user-authored text. Accept only a positive integer;
 * anything else (non-numeric, NaN, zero, negative, fractional) falls back to
 * the safe default rather than reaching the SDK as an invalid turn budget.
 */
function parseFrontmatterMaxTurns(raw: string | undefined): number {
  if (raw === undefined) return FALLBACK_MAX_TURNS;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : FALLBACK_MAX_TURNS;
}

// Tools that write to disk/state, and the network/exfiltration tools a read-only
// role must also be denied. In the Claude Agent SDK `allowedTools` only
// auto-approves; `disallowedTools` is the only hard removal ("removed from the
// model's context and cannot be used"). So a role is only truly read-only if
// every one of these is disallowed — not just Write/Edit/Bash.
const WRITE_TOOLS = ['Write', 'Edit', 'Bash'];
export const READ_ONLY_DISALLOWED_TOOLS = [
  ...WRITE_TOOLS,
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Task',
];

// Network tools have no path containment (the guardrail hook can't scope a fetch
// to the project), so they are an exfiltration channel even for the write-capable
// Worker-1, which reads the whole project. Deny them to EVERY instance.
const NETWORK_EXFIL_TOOLS = ['WebFetch', 'WebSearch'];

// The final security reviewer is read-only for the repo. It works from the diff
// supplied in its prompt (plus Grep for file content), so it does not need Bash —
// keeping Bash let a "Do NOT modify the repo" session run `git checkout -- .`,
// `sed -i`, etc. (the guardrail denylist doesn't block those). Deny the full
// read-only set; Grep/Glob remain for content search.
export const SECURITY_REVIEW_DISALLOWED_TOOLS = [...READ_ONLY_DISALLOWED_TOOLS];

// Instances that must ALWAYS be read-only, driven by role identity rather than
// inferred from a tool list — so a config/frontmatter override can never grant
// one of them write access. Worker-1 is the only write-capable instance.
const READ_ONLY_INSTANCES: readonly RoleInstance[] = [
  'Security-1',
  'Worker-2',
  'Reviewer-1',
  'Coordinator-1',
];

/**
 * Validates a team name before it becomes a filesystem directory name, registry
 * key, and map key. Rejects anything that could escape the
 * `.claude-orchestra/teams` tree (path separators, `..`) or corrupt on-disk
 * state (control characters, empty, over-long). Throws a user-facing message.
 */
export function validateTeamName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Team name must not be empty.');
  if (trimmed.length > 100) throw new Error('Team name must be 100 characters or fewer.');
  if (trimmed.includes('..')) throw new Error('Team name must not contain "..".');
  if (/[/\\]/.test(trimmed)) throw new Error('Team name must not contain "/" or "\\".');
  if (trimmed === '.') throw new Error('Team name must not be ".".');
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) < 0x20) {
      throw new Error('Team name must not contain control characters.');
    }
  }
  // The trimmed value is what becomes the on-disk directory and registry key.
  return trimmed;
}

// --- Verdict types ---

export type SecurityVerdict = 'APPROVED' | 'FLAGGED' | 'BLOCKED';
export type ReviewVerdict = 'APPROVED' | 'REVISION_NEEDED' | 'REJECTED';
export type VerifyVerdict = 'COMPLETE' | 'GAPS_FOUND';
export type ChatVerdict = 'RESPONDING' | 'ASKING' | 'TRIGGER_PIPELINE';
export type TaskClassification = 'SIMPLE' | 'STANDARD' | 'COMPLEX';

export interface ParsedVerdict<V extends string> {
  verdict: V;
  details: string;
}

export interface AmbiguousVerdict {
  verdict: 'AMBIGUOUS';
  raw: string;
}

export type VerdictResult<V extends string> = ParsedVerdict<V> | AmbiguousVerdict;

function isAmbiguous<V extends string>(result: VerdictResult<V>): result is AmbiguousVerdict {
  return result.verdict === 'AMBIGUOUS';
}

export class MalformedVerdictError extends Error {
  constructor(
    readonly instance: RoleInstance,
    readonly expected: readonly string[],
    readonly raw: string,
  ) {
    super(
      `Agent ${instance} emitted an unparseable verdict twice. ` +
        `Expected response to begin with one of: ${expected.join(', ')}. ` +
        `Raw output (last attempt, truncated to 200 chars): ${raw.slice(0, 200)}`,
    );
    this.name = 'MalformedVerdictError';
  }
}

export function parseClassification(scanText: string): TaskClassification {
  const match = scanText.match(/^CLASSIFICATION:\s*(SIMPLE|STANDARD|COMPLEX)/im);
  if (match) return match[1].toUpperCase() as TaskClassification;
  return 'STANDARD';
}

// One prefix-matching verdict parser factory. Every pipeline gate parses the
// agent's response the same way: optional structural cleanup, then a STRICT
// prefix match against the allowed tokens, AMBIGUOUS on no match — never guess.
// Guessing on a security gate produces silent failure-open when the prompt
// drifts. The four gates differ only along the three switches below, so they
// derive from this one factory instead of drifting as four hand-rolled copies.
//
//   stripThinking — remove <thinking>…</thinking> blocks before matching. This
//     is structural cleanup, not fuzzy matching: providers not trained on the
//     convention may emit literal blocks that would otherwise anchor the prefix
//     check on the wrong content.
//   stripBold — remove a leading run of '*' (markdown bold) before matching.
//   caseInsensitive — upcase before comparing. `details` always preserves the
//     original (post-cleanup) casing. The security scan stays case-SENSITIVE
//     (its agent is mandated to emit caps); the other gates accept any case.
interface PrefixVerdictOptions {
  stripThinking?: boolean;
  stripBold?: boolean;
  caseInsensitive?: boolean;
}

export function makePrefixVerdictParser<V extends string>(
  tokens: readonly V[],
  options: PrefixVerdictOptions = {},
): (text: string) => VerdictResult<V> {
  return (text: string): VerdictResult<V> => {
    let cleaned = text;
    if (options.stripThinking) {
      cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    }
    let trimmed = cleaned.trimStart();
    if (options.stripBold) {
      trimmed = trimmed.replace(/^\*+\s*/, '');
    }
    const haystack = options.caseInsensitive ? trimmed.toUpperCase() : trimmed;
    for (const token of tokens) {
      const needle = options.caseInsensitive ? token.toUpperCase() : token;
      if (haystack.startsWith(needle)) return { verdict: token, details: trimmed };
    }
    return { verdict: 'AMBIGUOUS', raw: trimmed };
  };
}

// Security scan/sweep gate: APPROVED | FLAGGED | BLOCKED (case-sensitive prefix).
export const parseSecurityVerdict = makePrefixVerdictParser<SecurityVerdict>([
  'APPROVED',
  'FLAGGED',
  'BLOCKED',
]);

// Review gate: APPROVED | REVISION_NEEDED | REJECTED (thinking-stripped, any case).
export const parseReviewVerdict = makePrefixVerdictParser<ReviewVerdict>(
  ['APPROVED', 'REVISION_NEEDED', 'REJECTED'],
  { stripThinking: true, caseInsensitive: true },
);

// Worker-2 verify gate: GAPS_FOUND | COMPLETE (any case).
export const parseVerifyVerdict = makePrefixVerdictParser<VerifyVerdict>(
  ['GAPS_FOUND', 'COMPLETE'],
  {
    caseInsensitive: true,
  },
);

// Final security-review gate: PASSED | CONCERNS. Strips <thinking> and a leading
// bold run, then strict-prefix matches — never guesses on a substring (which
// failed open when the mandated "No security concerns" phrasing itself contains
// the word CONCERNS). Routed through sendWithVerdict so a malformed response
// retries once then throws, like every other gate.
export type SecurityReviewVerdict = 'PASSED' | 'CONCERNS';

export const parseSecurityReviewVerdict = makePrefixVerdictParser<SecurityReviewVerdict>(
  ['PASSED', 'CONCERNS'],
  { stripThinking: true, stripBold: true, caseInsensitive: true },
);

// Coordinator-1 verdict: RESPONDING | ASKING | TRIGGER_PIPELINE.
// `details` contains everything AFTER the verdict word on the first line, plus
// any subsequent lines, trimmed. Body is what the orchestrator routes to chat
// (for RESPONDING / ASKING) or to assignTask (for TRIGGER_PIPELINE).
export function parseChatVerdict(text: string): VerdictResult<ChatVerdict> {
  const stripped = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  const trimmed = stripped.trimStart();
  const match = trimmed.match(/^(TRIGGER_PIPELINE|RESPONDING|ASKING)\b\s*[:\-—]?\s*([\s\S]*)$/i);
  if (!match) return { verdict: 'AMBIGUOUS', raw: trimmed };
  const verdict = match[1].toUpperCase() as ChatVerdict;
  const body = match[2].trim();
  return { verdict, details: body };
}

const MAX_VERIFY_PASSES = 2;
const VERDICT_RETRY_LIMIT = 1;

// Generic corrective re-prompt used by sendWithVerdict when the parser
// returns AMBIGUOUS. Same shape for all three pipeline-phase verdicts.
function formatVerdictRetryPrompt(expected: readonly string[], raw: string): string {
  const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
  return (
    `Your previous response did not begin with one of: ${expected.join(', ')}.\n\n` +
    `Re-emit your verdict on the FIRST line of your next response. ` +
    `Use the exact verdict token followed by an em-dash and a brief reason. ` +
    `Do not preface it with prose, headings, or thinking blocks.\n\n` +
    `For reference, your previous response started with: "${preview}"`
  );
}

interface SendWithVerdictHooks {
  // Called for every raw response the agent emits (including the malformed
  // first attempt and the retry). Pipeline callers wire this to agent-output
  // emission so the dashboard transcript shows everything the agent produced.
  onResponse: (raw: string) => void;
  // Called only on AMBIGUOUS responses — separate diagnostic signal that
  // dashboard/logger/metrics can subscribe to for prompt-drift detection.
  onMalformed: (raw: string) => void;
}

// Wraps session.send + parse with strict verdict-prefix checking. On the
// first AMBIGUOUS response, emits a malformed-output signal and re-prompts
// the agent ONCE with a corrective format hint. A second AMBIGUOUS response
// throws MalformedVerdictError, which the orchestrator's outer try/catch
// routes to failPipeline → TeamPhase.Errored. No fuzzy fallback — the prefix
// is the contract.
export async function sendWithVerdict<V extends string>(
  session: AgentSession,
  prompt: string,
  parser: (text: string) => VerdictResult<V>,
  expected: readonly V[],
  hooks: SendWithVerdictHooks,
  instance: RoleInstance,
  images?: Array<{ media_type: string; data: string }>,
): Promise<ParsedVerdict<V>> {
  const first = await session.send(prompt, images);
  hooks.onResponse(first);
  const firstParse = parser(first);
  if (!isAmbiguous(firstParse)) return firstParse;

  hooks.onMalformed(first);

  // biome-ignore lint/correctness/noUnreachable: loop body always returns or throws on the first iteration; the loop form is kept so VERDICT_RETRY_LIMIT can be raised later without restructuring.
  for (let attempt = 0; attempt < VERDICT_RETRY_LIMIT; attempt++) {
    const retryPrompt = formatVerdictRetryPrompt(expected, first);
    const retry = await session.send(retryPrompt);
    hooks.onResponse(retry);
    const retryParse = parser(retry);
    if (!isAmbiguous(retryParse)) return retryParse;
    hooks.onMalformed(retry);
    throw new MalformedVerdictError(instance, expected, retry);
  }

  // Unreachable: VERDICT_RETRY_LIMIT >= 1 guarantees the loop body runs at
  // least once and either returns or throws. The throw below exists only to
  // satisfy the type system.
  throw new MalformedVerdictError(instance, expected, first);
}

// --- Requirements post-processor ---

/**
 * Two-step strip applied to the raw output of the requirements-extraction agent.
 * Step 1 removes any <thinking>...</thinking> blocks the model may have emitted
 * literally (covers providers not trained on the convention). Step 2 strips
 * anything before the first numbered-list line, so preamble prose like
 * "Here are the requirements:" never reaches the user-approval modal.
 *
 * Order matters: step 1 must run before step 2 because a leaked <thinking>
 * block containing its own numbered list would otherwise anchor step 2's
 * lookahead and survive into the output.
 */
export function postProcessRequirements(raw: string): string {
  const trimmed = raw.trim();
  const noThinking = trimmed.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  const stripped = noThinking.replace(/^[\s\S]*?(?=^\d+\.)/m, '');
  return stripped.trim();
}

// --- Pipeline Orchestrator Config ---

export interface PipelineOrchestraConfig {
  registryPath: string;
  /** Path to projects.json (the portfolio registry — projects as first-class entities). */
  portfolioPath: string;
  logDirectory: string;
  /** Directory containing role prompt files (reuses subagent prompts) */
  rolesDir: string;
  maxConcurrentTeams: number;
  /** Global all-or-nothing agent runtime. Applies to every team. */
  agentRuntime?: Partial<AgentRuntimeConfig>;
  /** Model overrides per role (full model IDs like 'claude-opus-4-6') */
  models?: Partial<Record<Role, string>>;
  /** Per-role effort levels. Pipeline advantage: each agent gets its own provider session. */
  efforts?: Partial<Record<Role, EffortLevel>>;
  /** Disallowed tools overrides per role */
  disallowedTools?: Partial<Record<Role, string[]>>;
  /** Max turns overrides per role */
  maxTurns?: Partial<Record<Role, number>>;
  /** Loop limits for phase transitions */
  limits?: Partial<LoopLimits>;
  /** Skip requirements extraction (useful for testing) */
  skipRequirements?: boolean;
  /** Provider-neutral guardrail policy and Codex stream detection controls */
  guardrails?: Partial<GuardrailRuntimeConfig>;
}

const DEFAULT_PIPELINE_CONFIG = {
  registryPath: './registry.json',
  portfolioPath: './projects.json',
  logDirectory: './logs',
  rolesDir: './agents',
  maxConcurrentTeams: 5,
};

// --- Per-team runtime context ---

interface PipelineTeamContext {
  state: TeamState;
  /** Active agent sessions (null if no task running) */
  sessions: AgentSession[];
  /** Whether a pipeline is currently running */
  pipelineRunning: boolean;
  /** Pending blocking feedback requests awaiting user response */
  pendingFeedback: Map<
    string,
    { resolve: (result: { value: string; text?: string }) => void; feedback: FeedbackPayload }
  >;
  /** Active final security review session (if running) */
  securityReviewSession?: AgentSession;
  /** Whether Security-1 classified the task as COMPLEX */
  isComplex?: boolean;
  /** Long-running Coordinator-1 session for the team's chat panel.
   *  Created at team creation, kept alive across pipeline runs, closed on
   *  terminateTeam. Lazy-spawned when sendChatMessage is called for a
   *  recovered team that pre-dates the chat feature. */
  coordinatorSession?: AgentSession;
  /** Serializes sendChatMessage calls so concurrent dashboard messages don't
   *  interleave on the same coordinator session. */
  chatLock?: Promise<void>;
  /** Abort controller for the in-flight coordinator turn, if any. cancelChat
   *  aborts it; the chat turn handler races send() against this signal and
   *  treats the abort as a clean cancellation (no system chat-message). */
  coordinatorAbortController?: AbortController;
  /** Whether the current live coordinatorSession has already received the
   *  first-turn TEAM/PROJECT/history bootstrap. The session is a single
   *  long-lived streaming query() that retains conversation context across
   *  send() calls, so only the first send replays history; later sends carry
   *  just the new user message. Reset to false whenever the session is
   *  (re)spawned. */
  coordinatorBootstrapped?: boolean;
}

// --- PipelineOrchestrator ---

export class PipelineOrchestrator extends EventEmitter<OrchestratorEvents> {
  private readonly config: PipelineOrchestraConfig & typeof DEFAULT_PIPELINE_CONFIG;
  private readonly agentRuntime: AgentRuntimeConfig;
  private readonly persistence: StatePersistence;
  private readonly registry: Registry;
  private readonly portfolio: Portfolio;
  private readonly models: Record<RoleInstance, string>;
  private readonly efforts: Record<RoleInstance, EffortLevel>;
  private readonly disallowedTools: Record<RoleInstance, string[]>;
  private readonly maxTurnsPerInstance: Record<RoleInstance, number>;
  private readonly guardrails: GuardrailRuntimeConfig;
  private readonly teams: Map<string, PipelineTeamContext> = new Map();
  private shuttingDown = false;
  private prPollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<PipelineOrchestraConfig> = {}) {
    super();

    // Filter out undefined values so they don't overwrite defaults
    const cleanConfig = Object.fromEntries(
      Object.entries(config).filter(([, v]) => v !== undefined),
    );
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...cleanConfig } as PipelineOrchestraConfig &
      typeof DEFAULT_PIPELINE_CONFIG;
    // If portfolioPath wasn't explicitly provided but registryPath was, place
    // projects.json next to registry.json. This keeps tests that isolate
    // registryPath into a tmpDir from polluting the engine repo's real
    // ./projects.json via auto-register-on-createTeam.
    if (cleanConfig.portfolioPath === undefined && cleanConfig.registryPath !== undefined) {
      this.config.portfolioPath = path.join(
        path.dirname(this.config.registryPath),
        'projects.json',
      );
    }
    this.agentRuntime = normalizeAgentRuntime(config.agentRuntime);
    validateAgentRuntime(this.agentRuntime);
    this.guardrails = normalizeGuardrails(config.guardrails);

    this.persistence = new StatePersistence();
    this.registry = new Registry(this.config.registryPath);
    this.portfolio = new Portfolio(this.config.portfolioPath);

    // Build per-instance defaults from each instance's frontmatter, then
    // apply role-level config overrides on top. Config stays role-keyed for
    // backward compat; per-instance differentiation lives in frontmatter
    // (e.g. worker-2.agent.md sets disallowedTools at the SDK boundary).
    const fmDefaults = this.loadFrontmatterDefaults(this.config.rolesDir);
    this.models = {} as Record<RoleInstance, string>;
    this.efforts = {} as Record<RoleInstance, EffortLevel>;
    this.disallowedTools = {} as Record<RoleInstance, string[]>;
    this.maxTurnsPerInstance = {} as Record<RoleInstance, number>;
    for (const instance of ALL_INSTANCES) {
      const role = INSTANCE_TO_ROLE[instance];
      this.models[instance] = config.models?.[role] ?? fmDefaults.models[instance];
      this.efforts[instance] = config.efforts?.[role] ?? fmDefaults.efforts[instance];
      const baseDisallowed = config.disallowedTools?.[role] ?? fmDefaults.disallowedTools[instance];
      // Read-only enforcement is driven purely by role IDENTITY, not by
      // inferring intent from a tool list. Worker-1 (the only write-capable
      // instance) keeps exactly its configured/frontmatter denials — so a config
      // that denies only Bash to the shared Worker role never strips its
      // Write/Edit and leaves it unable to implement anything.
      const roleDisallowed = READ_ONLY_INSTANCES.includes(instance)
        ? [...baseDisallowed, ...READ_ONLY_DISALLOWED_TOOLS]
        : baseDisallowed;
      // Network/exfiltration tools are denied to every instance, including the
      // write-capable Worker-1 (which reads the whole project and could otherwise
      // POST secrets out via WebFetch — a channel the guardrail hook can't scope).
      this.disallowedTools[instance] = Array.from(
        new Set([...roleDisallowed, ...NETWORK_EXFIL_TOOLS]),
      );
      this.maxTurnsPerInstance[instance] = config.maxTurns?.[role] ?? fmDefaults.maxTurns[instance];
    }
  }

  getAgentRuntime(): AgentRuntimeConfig {
    return { ...this.agentRuntime };
  }

  // --- Team Lifecycle ---

  createTeam(name: string, projectPath: string): TeamState {
    if (this.shuttingDown) {
      throw new Error('Orchestrator is shutting down');
    }

    const teamId = validateTeamName(name);
    if (this.teams.has(teamId)) {
      throw new Error(`Team "${teamId}" already exists`);
    }

    const resolvedProjectPath = path.resolve(projectPath);

    // Limit is now per-project, not global. A user with multiple projects
    // can run up to maxConcurrentTeams teams in EACH project independently.
    let teamsInThisProject = 0;
    for (const ctx of this.teams.values()) {
      if (ctx.state.snapshot.projectPath === resolvedProjectPath) {
        teamsInThisProject++;
      }
    }
    if (teamsInThisProject >= this.config.maxConcurrentTeams) {
      throw new Error(
        `Maximum concurrent teams (${this.config.maxConcurrentTeams}) reached for this project. Terminate an existing team in this project first, or use a different project.`,
      );
    }

    // Project directory must already exist — engine attaches to existing repos
    if (!fs.existsSync(resolvedProjectPath)) {
      throw new Error(`Project path does not exist: ${resolvedProjectPath}`);
    }

    // Create .claude-orchestra/teams/{teamId}/ in the target project
    const orchDir = path.join(resolvedProjectPath, '.claude-orchestra');
    const teamDir = path.join(orchDir, 'teams', teamId);
    fs.mkdirSync(teamDir, { recursive: true });

    // Add .claude-orchestra/ to the project's .gitignore if not present
    this.ensureGitignore(resolvedProjectPath);

    // Create a dedicated branch for this team off main
    const branchName = this.ensureTeamBranch(resolvedProjectPath, name);

    const limits: LoopLimits = {
      ...DEFAULT_LOOP_LIMITS,
      ...this.config.limits,
    };

    const state = TeamState.create(teamId, name, resolvedProjectPath, limits);
    state.setBranchName(branchName);

    // Register team directory with persistence and persist initial state
    this.persistence.registerTeamDir(teamId, teamDir);
    this.persistence.ensureTeamDir(teamId);
    this.persistence.persistNow(state);

    // Add registry entry
    this.registry.add({
      teamId,
      teamName: name,
      projectPath: resolvedProjectPath,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });

    // Auto-register the project in the portfolio if not already there.
    // Preserves the "just give me a path and go" UX while populating projects.json
    // for the first-class project model.
    if (!this.portfolio.has(resolvedProjectPath)) {
      this.portfolio.add({
        projectPath: resolvedProjectPath,
        displayName: path.basename(resolvedProjectPath),
        addedAt: new Date().toISOString(),
      });
    }

    const ctx: PipelineTeamContext = {
      state,
      sessions: [],
      pipelineRunning: false,
      pendingFeedback: new Map(),
    };

    this.teams.set(teamId, ctx);

    // Coordinator-1 is lazy-spawned on the first sendChatMessage so we don't
    // pay the SDK cold-start cost for teams that never use the chat panel,
    // and so the existing pipeline test fixtures don't see an extra session
    // appear before assignTask runs.

    this.emit('team-created', teamId);

    return state;
  }

  // --- Chat (Coordinator-1) ---

  /**
   * Send a user message to a team's Coordinator-1. Appends to chat.jsonl,
   * sends the coordinator the first-turn bootstrap (full history) or just the
   * new message on later warm-session turns, parses its verdict, and
   * dispatches:
   *   - RESPONDING / ASKING → coordinator's reply goes back to chat
   *   - TRIGGER_PIPELINE → kicks off assignTask with the body as task
   *
   * Serialized per team via ctx.chatLock so two concurrent dashboard messages
   * don't interleave on the same coordinator session.
   */
  async sendChatMessage(teamId: string, userMessage: string): Promise<void> {
    if (this.shuttingDown) {
      throw new Error('Orchestrator is shutting down');
    }
    const ctx = this.teams.get(teamId);
    if (!ctx) throw new Error(`Team "${teamId}" not found`);
    const text = userMessage.trim();
    if (!text) throw new Error('Empty chat message');

    const previous = ctx.chatLock ?? Promise.resolve();
    const next = previous.then(() => this.handleChatTurn(teamId, ctx, text));
    ctx.chatLock = next.catch(() => undefined);
    return next;
  }

  /**
   * Abort an in-flight coordinator turn for this team, if any. Returns true
   * if a turn was actually aborted; false otherwise (no turn in flight).
   * Mirrors the chat-side "stop generating" pattern. Does NOT touch the
   * deterministic pipeline — if TRIGGER_PIPELINE has already been issued,
   * the pipeline runs to completion regardless of this call.
   */
  cancelChat(teamId: string): boolean {
    const ctx = this.teams.get(teamId);
    if (!ctx) throw new Error(`Team "${teamId}" not found`);
    if (!ctx.coordinatorAbortController) return false;
    ctx.coordinatorAbortController.abort();
    return true;
  }

  private async handleChatTurn(
    teamId: string,
    ctx: PipelineTeamContext,
    userMessage: string,
  ): Promise<void> {
    // 1. Persist + emit the user's message immediately so the UI feels live.
    const userMsg: ChatMessage = {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    ctx.state.appendChatMessage(userMsg);
    this.persistence.appendChatMessage(teamId, userMsg);
    this.emit('chat-message', teamId, userMsg);

    // 2. Lazy-spawn the coordinator session if missing (e.g. recovered team
    //    that pre-dates the chat feature, or the createTeam-time spawn failed).
    if (!ctx.coordinatorSession || ctx.coordinatorSession.closed) {
      try {
        ctx.coordinatorSession = this.createSession(
          'Coordinator-1',
          ctx.state.snapshot.projectPath,
          (text) => this.emit('agent-progress', teamId, 'Coordinator-1', text),
        );
        // Fresh session holds no context yet — the next turn must bootstrap it.
        ctx.coordinatorBootstrapped = false;
      } catch (err: any) {
        const errMsg: ChatMessage = {
          role: 'system',
          content: `Could not start Coordinator-1: ${err.message}`,
          timestamp: new Date().toISOString(),
        };
        ctx.state.appendChatMessage(errMsg);
        this.persistence.appendChatMessage(teamId, errMsg);
        this.emit('chat-message', teamId, errMsg);
        return;
      }
    }

    // 3. Build the prompt. Coordinator-1 is a single long-lived streaming
    //    session that retains conversation context across send() calls, so
    //    replay the TEAM/PROJECT/history bootstrap ONLY on the first turn of a
    //    session; on later turns send just the new user message. A cancelled
    //    turn closes the session and the lazy-spawn block resets the flag, so a
    //    respawned session gets a fresh bootstrap. Set the flag eagerly (before
    //    send) so a malformed-twice failure — which leaves the session alive —
    //    does not re-replay history the session already consumed.
    let prompt: string;
    if (!ctx.coordinatorBootstrapped) {
      prompt = this.buildCoordinatorPrompt(ctx);
      ctx.coordinatorBootstrapped = true;
    } else {
      prompt = userMessage;
    }

    // 4. Send + parse verdict with the same fail-loud pattern as other gates.
    //    Race the send against an AbortController so cancelChat can interrupt
    //    a coordinator turn mid-response. The abort path is treated as a
    //    clean cancellation — no system chat-message is recorded.
    const abortController = new AbortController();
    ctx.coordinatorAbortController = abortController;
    const abortPromise = new Promise<never>((_, reject) => {
      abortController.signal.addEventListener('abort', () => {
        reject(new Error('__chat_cancelled__'));
      });
    });

    let parsed: ParsedVerdict<ChatVerdict>;
    try {
      parsed = await Promise.race([
        sendWithVerdict(
          ctx.coordinatorSession,
          prompt,
          parseChatVerdict,
          ['RESPONDING', 'ASKING', 'TRIGGER_PIPELINE'] as const,
          {
            onResponse: (raw) => this.emit('agent-output', teamId, 'Coordinator-1', raw),
            onMalformed: (raw) => this.emit('malformed-output', teamId, 'Coordinator-1', raw),
          },
          'Coordinator-1',
        ),
        abortPromise,
      ]);
    } catch (err: any) {
      if (err?.message === '__chat_cancelled__') {
        // User clicked the × button while we were awaiting the coordinator.
        // Close the session so any lingering work stops; next chat message
        // lazy-respawns it.
        try {
          ctx.coordinatorSession.close();
        } catch {
          /* best effort */
        }
        this.emit('chat-cancelled', teamId);
        return;
      }
      const errMsg: ChatMessage = {
        role: 'system',
        content: `Coordinator-1 emitted unparseable output twice. ${err.message}`,
        timestamp: new Date().toISOString(),
      };
      ctx.state.appendChatMessage(errMsg);
      this.persistence.appendChatMessage(teamId, errMsg);
      this.emit('chat-message', teamId, errMsg);
      return;
    } finally {
      if (ctx.coordinatorAbortController === abortController) {
        ctx.coordinatorAbortController = undefined;
      }
    }

    // 5. Persist + emit the coordinator's response.
    const reply: ChatMessage = {
      role: 'coordinator',
      content: parsed.details,
      timestamp: new Date().toISOString(),
      verdict: parsed.verdict,
    };
    ctx.state.appendChatMessage(reply);
    this.persistence.appendChatMessage(teamId, reply);
    this.emit('chat-message', teamId, reply);

    // 6. If TRIGGER_PIPELINE, dispatch the body as a new task. Don't await
    //    the pipeline — the chat turn ends here. Pipeline progress streams
    //    back via the existing agent-output/phase-transition events.
    if (parsed.verdict === 'TRIGGER_PIPELINE') {
      const task = parsed.details;
      if (!task) {
        const warn: ChatMessage = {
          role: 'system',
          content: 'Coordinator emitted TRIGGER_PIPELINE with an empty body. Ignoring.',
          timestamp: new Date().toISOString(),
        };
        ctx.state.appendChatMessage(warn);
        this.persistence.appendChatMessage(teamId, warn);
        this.emit('chat-message', teamId, warn);
        return;
      }
      try {
        this.assignTask(teamId, task);
      } catch (err: any) {
        const errMsg: ChatMessage = {
          role: 'system',
          content: `Could not start pipeline: ${err.message}`,
          timestamp: new Date().toISOString(),
        };
        ctx.state.appendChatMessage(errMsg);
        this.persistence.appendChatMessage(teamId, errMsg);
        this.emit('chat-message', teamId, errMsg);
      }
    }
  }

  private buildCoordinatorPrompt(ctx: PipelineTeamContext): string {
    const { teamName, projectPath, currentPhase, currentTask } = ctx.state.snapshot;
    const history = ctx.state.getChatHistory();

    const lines: string[] = [
      `TEAM: ${teamName}`,
      `PROJECT: ${projectPath}`,
      `CURRENT PHASE: ${currentPhase}`,
    ];
    if (currentTask?.description) {
      lines.push(`MOST RECENT TASK: ${currentTask.description}`);
    }
    lines.push('', 'CONVERSATION HISTORY:');

    for (const msg of history) {
      if (msg.role === 'user') {
        lines.push(`[user] ${msg.content}`);
      } else if (msg.role === 'coordinator') {
        const v = msg.verdict ?? 'RESPONDING';
        lines.push(`[coordinator ${v}] ${msg.content}`);
      } else {
        lines.push(`[system] ${msg.content}`);
      }
    }

    lines.push(
      '',
      'Respond to the LAST user message above. Begin your response with one of:',
      '  RESPONDING — your reply goes to chat as-is',
      '  ASKING — your reply is a clarifying question',
      '  TRIGGER_PIPELINE — body becomes the task description for a new pipeline run',
    );
    return lines.join('\n');
  }

  // --- Recovery ---

  recover(): string[] {
    const recovered: string[] = [];
    const entries = this.registry.load();

    for (const entry of entries) {
      if (this.teams.has(entry.teamId)) continue;

      // Handle missing project path gracefully (project deleted or moved)
      if (!fs.existsSync(entry.projectPath)) {
        continue;
      }

      const teamDir = path.join(entry.projectPath, '.claude-orchestra', 'teams', entry.teamId);
      const data = this.persistence.loadFromDir(teamDir);
      if (!data) continue;

      // Previously skipped Done/Cancelled/Errored teams on recovery, which
      // made them invisible in the dashboard after a restart. Now we keep
      // them visible so the user can review them, create PRs, or remove
      // them via the Delete button. Terminal-state teams hold no live
      // sessions, so recovering them is essentially free.

      // Register team directory with persistence
      this.persistence.registerTeamDir(entry.teamId, teamDir);

      const limits: LoopLimits = { ...DEFAULT_LOOP_LIMITS, ...this.config.limits };
      const state = TeamState.fromData(data, limits);

      const ctx: PipelineTeamContext = {
        state,
        sessions: [],
        pipelineRunning: false,
        pendingFeedback: new Map(),
      };

      this.teams.set(entry.teamId, ctx);
      recovered.push(entry.teamId);

      // A team recovered mid-PrOpen still has an open PR on GitHub; resume
      // polling so a merge/close that happens while the engine was down is
      // still detected and the team archived/returned to Done. startPrPolling
      // is idempotent, so one call per recovered PrOpen team is safe.
      if (state.snapshot.currentPhase === TeamPhase.PrOpen) {
        this.startPrPolling();
      }
    }

    return recovered;
  }

  // --- Task Assignment ---

  assignTask(
    teamId: string,
    taskDescription: string,
    images?: Array<{ media_type: string; data: string }>,
  ): void {
    if (this.shuttingDown) {
      throw new Error('Orchestrator is shutting down');
    }

    const ctx = this.teams.get(teamId);
    if (!ctx) throw new Error(`Team "${teamId}" not found`);
    if (ctx.pipelineRunning) throw new Error(`Team "${teamId}" already has an active pipeline`);

    // Clean up previous sessions if re-assigning after completion
    if (ctx.sessions.length > 0) {
      this.closeSessions(ctx);
    }

    // Clean up any running security review
    if (ctx.securityReviewSession && !ctx.securityReviewSession.closed) {
      ctx.securityReviewSession.close();
      ctx.securityReviewSession = undefined;
    }

    // Reset from terminal state for re-launch. resetForReassignment force-sets
    // PreWork for ANY terminal phase — a plain transitionPhase(PreWork) throws
    // for Cancelled/Merged (dead-ends in VALID_PHASE_TRANSITIONS), which left
    // cancelled and merged teams permanently un-reassignable.
    ctx.state.resetForReassignment();

    // Clear any previous task and reset agents for re-launch
    if (ctx.state.snapshot.currentTask) {
      ctx.state.clearTask();
    }
    ctx.state.resetAgents();

    // Record the task and classify complexity
    ctx.state.assignTask(taskDescription);
    const complexity = classifyComplexity(taskDescription);
    ctx.state.setTaskComplexity(complexity);

    // Every task now runs the scan-first pipeline: Security-1 always scans and
    // is the sole authority that may downgrade a genuinely trivial task to a
    // Worker-1-only run. So all four agents are activated up front (Security-1
    // marks the unused ones Done if it downgrades). The heuristic router no
    // longer decides whether the security scan runs.
    const agentCount = 4;
    this.emit('task-classified', teamId, complexity, agentCount);
    this.emit('task-assigned', teamId, taskDescription);

    // Register agents in state
    ctx.state.transitionAgent('Worker-1' as any, AgentState.Active);
    ctx.state.transitionAgent('Worker-2' as any, AgentState.Active);
    ctx.state.transitionAgent('Security-1' as any, AgentState.Active);
    ctx.state.transitionAgent('Reviewer-1' as any, AgentState.Active);

    this.persistence.persistNow(ctx.state);

    // Extract requirements and get approval before starting pipeline
    ctx.pipelineRunning = true;
    this.runWithRequirements(teamId, ctx, taskDescription, complexity, images);
  }

  private async runWithRequirements(
    teamId: string,
    ctx: PipelineTeamContext,
    task: string,
    complexity: 'simple' | 'standard' | 'complex',
    images?: Array<{ media_type: string; data: string }>,
  ): Promise<void> {
    // 'simple' no longer bypasses the security scan. Keep the fast path (no
    // requirements extraction), but run the scan-first standard pipeline;
    // Security-1 downgrades to a Worker-1-only run when the task is genuinely
    // trivial (see runStandardPipeline's SIMPLE reclassification path).
    if (complexity === 'simple') {
      this.runStandardPipeline(teamId, ctx, task, images);
      return;
    }

    if (this.config.skipRequirements) {
      // Skip extraction — go straight to pipeline
      this.runStandardPipeline(teamId, ctx, task, images);
      return;
    }

    try {
      // Extract requirements from the task prompt
      this.emit('agent-output', teamId, 'Worker-1' as any, '[Pipeline] Extracting requirements...');
      const requirements = await this.extractRequirements(
        ctx.state.snapshot.projectPath,
        task,
        images,
      );

      if (requirements) {
        // Short-circuit: extraction emitted only a clarification-flagging line —
        // task is too vague to proceed. Bail before user-approval and Worker-2 to
        // avoid the "user clicks Approve, Worker-2 finds no implementation, pipeline
        // loops to revision limit" footgun.
        // Pattern is intentionally narrow: anchored to start, single numbered item,
        // "Clarify" first word — won't false-fire on a real multi-item list that
        // happens to use "Clarify" in a later item.
        const clarificationOnly =
          /^1\.\s+Clarify\b[^\n]*$/m.test(requirements) && !/^2\./m.test(requirements);
        if (clarificationOnly) {
          this.notifyUser(
            teamId,
            'warning',
            'Task too vague',
            'Requirements extraction could not derive a verifiable requirement from the task description. ' +
              'Please reassign the task with more specific outcome criteria.',
          );
          ctx.pipelineRunning = false;
          // Stay in PreWork awaiting a new task.
          return;
        }

        // Show requirements for user approval. The requirements body is passed as
        // editableContent so the user can revise it in the dashboard before
        // approving; the edited text (if any) comes back as response.text.
        const response = await this.askUser(
          teamId,
          'Requirements Checklist',
          'Review the extracted requirements before agents start. You can edit them before approving.',
          [
            { label: 'Approve', value: 'approve' },
            { label: 'Skip', value: 'skip' },
          ],
          requirements,
        );

        // The team may have been terminated while this blocking prompt was open
        // (settlePendingFeedback resolves it with 'cancelled'); if so, stop —
        // do not spin the pipeline back up on a torn-down team.
        if (!this.teams.has(teamId)) return;

        if (response.value === 'approve') {
          // Fall back to the extracted requirements when the edited text is
          // empty/whitespace — `??` alone would keep an empty string and
          // silently drop the requirements (a non-UI client can post text: '').
          const editedText = response.text?.trim();
          const finalRequirements = editedText || requirements.trim();
          if (finalRequirements) {
            ctx.state.setTaskRequirements(finalRequirements);
            this.persistence.persistNow(ctx.state);
          }
        }
        // If 'skip', proceed without requirements
      }
    } catch (err: any) {
      // Extraction failed — proceed without requirements
      this.notifyUser(
        teamId,
        'warning',
        'Requirements extraction skipped',
        'Could not extract requirements: ' + (err.message || 'Unknown error'),
      );
    }

    // Start the pipeline
    this.runStandardPipeline(teamId, ctx, task, images);
  }

  // --- Query ---

  getTeamStatus(teamId: string): Readonly<TeamStateData> | undefined {
    return this.teams.get(teamId)?.state.snapshot;
  }

  getAllTeams(): Array<Readonly<TeamStateData>> {
    const result: Array<Readonly<TeamStateData>> = [];
    for (const ctx of this.teams.values()) {
      result.push(ctx.state.snapshot);
    }
    return result;
  }

  // --- Start / Stop (no-ops for API compatibility) ---

  start(): void {
    // No-op — pipeline orchestration is fully event-driven
  }

  stop(): void {
    // No-op
  }

  // --- Shutdown ---

  async terminateTeam(teamId: string): Promise<void> {
    const ctx = this.teams.get(teamId);
    if (!ctx) return;

    // Close all active sessions
    this.closeSessions(ctx);
    // Release any blocking prompt the pipeline is suspended on so its promise
    // settles instead of hanging with the team gone.
    this.settlePendingFeedback(ctx);

    // Also close the long-running coordinator chat session if alive.
    if (ctx.coordinatorSession && !ctx.coordinatorSession.closed) {
      try {
        ctx.coordinatorSession.close();
      } catch {
        /* best effort */
      }
      ctx.coordinatorSession = undefined;
    }

    if (!ctx.state.isTerminal) {
      const fromPhase = ctx.state.currentPhase;
      try {
        ctx.state.transitionPhase(TeamPhase.Cancelled);
        this.emit('phase-transition', teamId, fromPhase, TeamPhase.Cancelled, 'manual termination');
      } catch {
        // Transition may not be valid — best effort
      }
    }

    this.persistence.persistNow(ctx.state);

    // Remove from registry
    this.registry.remove(teamId);

    this.teams.delete(teamId);

    // Notify clients (dashboard) so they can drop the team from their local
    // state — without this, the team lingers in the UI as "cancelled" forever
    // even though the server has already removed it.
    this.emit('team-deleted', teamId);
  }

  /**
   * Bulk-delete all terminal-phase teams (Done, Merged, Cancelled, Errored) for
   * a given project. Reuses terminateTeam so each removal emits the same
   * 'team-deleted' SSE event the dashboard already handles per-team.
   * Returns the number of teams cleared.
   */
  async clearDoneTeams(projectPath: string): Promise<number> {
    const resolvedPath = path.resolve(projectPath);
    const toDelete: string[] = [];
    for (const [teamId, ctx] of this.teams) {
      if (ctx.state.snapshot.projectPath === resolvedPath && ctx.state.isTerminal) {
        toDelete.push(teamId);
      }
    }
    for (const teamId of toDelete) {
      await this.terminateTeam(teamId);
    }
    return toDelete.length;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.stopPrPolling();

    for (const [, ctx] of this.teams) {
      this.closeSessions(ctx);
      this.settlePendingFeedback(ctx);
      if (ctx.coordinatorSession && !ctx.coordinatorSession.closed) {
        try {
          ctx.coordinatorSession.close();
        } catch {
          /* best effort */
        }
        ctx.coordinatorSession = undefined;
      }
      if (!ctx.state.isTerminal) {
        try {
          ctx.state.transitionPhase(TeamPhase.Cancelled);
        } catch {
          // Best effort
        }
      }
      this.persistence.persistNow(ctx.state);
    }

    this.teams.clear();
    this.persistence.dispose();
    this.emit('shutdown');
  }

  forceKillAll(): void {
    for (const ctx of this.teams.values()) {
      this.closeSessions(ctx);
      try {
        this.persistence.persistNow(ctx.state);
      } catch {
        // Best effort
      }
    }
    this.teams.clear();
    this.persistence.dispose();
  }

  // --- Registry Access (for dashboard) ---

  getRegistryEntries(): import('./registry.js').RegistryEntry[] {
    return this.registry.load();
  }

  // --- Portfolio Management (projects as first-class entities) ---

  /**
   * List every project in the portfolio. Projects exist independently of teams —
   * a project may have zero teams and still appear here.
   */
  getPortfolio(): Project[] {
    return this.portfolio.load();
  }

  /**
   * Add a project to the portfolio. Validates that the path exists on disk.
   * Idempotent — adding the same path twice is a no-op.
   * Returns the project record.
   */
  addProjectToPortfolio(input: { projectPath: string; displayName?: string }): Project {
    const resolved = path.resolve(input.projectPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Project path does not exist: ${resolved}`);
    }
    const existing = this.portfolio.get(resolved);
    if (existing) return existing;
    const project: Project = {
      projectPath: resolved,
      displayName: input.displayName ?? path.basename(resolved),
      addedAt: new Date().toISOString(),
    };
    this.portfolio.add(project);
    return project;
  }

  /**
   * Remove a project from the portfolio. Blocked if any teams in the orchestrator's
   * working set still reference this project — the user must delete or terminate
   * those teams first. Returns nothing on success.
   */
  removeProjectFromPortfolio(projectPath: string): void {
    const resolved = path.resolve(projectPath);
    if (!this.portfolio.has(resolved)) {
      throw new Error(`Project not in portfolio: ${resolved}`);
    }
    let teamCount = 0;
    for (const ctx of this.teams.values()) {
      if (ctx.state.snapshot.projectPath === resolved) {
        teamCount++;
      }
    }
    if (teamCount > 0) {
      throw new Error(
        `Project has ${teamCount} team${teamCount !== 1 ? 's' : ''}. Delete or terminate them before removing the project from the portfolio.`,
      );
    }
    this.portfolio.remove(resolved);
  }

  // --- Git Operations (user-initiated) ---

  /**
   * Push the team's branch and create a GitHub PR. User-initiated.
   * Transitions team from Done → PrOpen on success.
   */
  createPr(teamId: string): import('./git.js').GitResult & { prNumber?: number; prUrl?: string } {
    const ctx = this.teams.get(teamId);
    if (!ctx) {
      return { success: false, output: `Team "${teamId}" not found` };
    }

    const { snapshot } = ctx.state;
    if (snapshot.currentPhase !== TeamPhase.Done) {
      return {
        success: false,
        output: `Team is in "${snapshot.currentPhase}" phase, must be "done" to create PR`,
      };
    }

    const branchName = snapshot.branchName;
    if (!branchName) {
      return { success: false, output: 'No branch name set for this team' };
    }

    const taskDesc = snapshot.currentTask?.description ?? 'No description';
    const title = taskDesc.length > 72 ? taskDesc.substring(0, 69) + '...' : taskDesc;
    const body = `## Team: ${snapshot.teamName}\n\n**Task:** ${taskDesc}\n\n---\n_Created by ClaudeOrchestra_`;

    const result = GitOps.createPullRequest(snapshot.projectPath, branchName, title, body);

    if (result.success && result.prNumber && result.prUrl) {
      ctx.state.setPrInfo(result.prNumber, result.prUrl);
      const fromPhase = ctx.state.currentPhase;
      ctx.state.transitionPhase(TeamPhase.PrOpen);
      this.persistence.persistNow(ctx.state);
      this.emit('phase-transition', teamId, fromPhase, TeamPhase.PrOpen, 'pr-created');
      this.emit('pr-created', teamId, result.prNumber, result.prUrl);
      this.startPrPolling();
    }

    return result;
  }

  /**
   * Archive a team after its PR has been merged.
   * Cleans up branch, registry, and in-memory state.
   */
  async archiveTeam(teamId: string): Promise<void> {
    const ctx = this.teams.get(teamId);
    if (!ctx) return;

    const { snapshot } = ctx.state;
    const prUrl = snapshot.prUrl ?? '';

    // Close any lingering sessions
    this.closeSessions(ctx);

    // Transition to Merged
    if (snapshot.currentPhase === TeamPhase.PrOpen) {
      const fromPhase = ctx.state.currentPhase;
      ctx.state.transitionPhase(TeamPhase.Merged);
      this.emit('phase-transition', teamId, fromPhase, TeamPhase.Merged, 'pr-merged');
    }

    this.persistence.persistNow(ctx.state);

    // Clean up local branch
    if (snapshot.branchName) {
      GitOps.checkout(snapshot.projectPath, 'main');
      GitOps.deleteLocalBranch(snapshot.projectPath, snapshot.branchName);
    }

    // Remove from registry and memory
    this.registry.remove(teamId);
    this.teams.delete(teamId);

    this.emit('team-archived', teamId, prUrl);
  }

  // --- PR Polling ---

  /**
   * Start polling GitHub for merged PRs. Called when a team enters PrOpen.
   * Polls every 60s. Safe to call multiple times (idempotent).
   */
  private startPrPolling(): void {
    if (this.prPollInterval) return;

    this.prPollInterval = setInterval(() => {
      this.pollPrStates();
    }, 60_000);
  }

  private stopPrPolling(): void {
    if (this.prPollInterval) {
      clearInterval(this.prPollInterval);
      this.prPollInterval = null;
    }
  }

  private pollPrStates(): void {
    for (const [teamId, ctx] of this.teams) {
      const { snapshot } = ctx.state;
      if (snapshot.currentPhase !== TeamPhase.PrOpen) continue;
      if (!snapshot.prNumber) continue;

      const prState = GitOps.checkPrState(snapshot.projectPath, snapshot.prNumber);
      if (!prState) continue; // gh not available or error — skip

      if (prState.merged) {
        // PR was merged — archive the team
        this.archiveTeam(teamId).catch(() => {});
      } else if (prState.state === 'CLOSED') {
        // PR closed without merge — return to Done so user can re-create
        const fromPhase = ctx.state.currentPhase;
        ctx.state.clearPrInfo();
        ctx.state.transitionPhase(TeamPhase.Done);
        this.persistence.persistNow(ctx.state);
        this.emit('phase-transition', teamId, fromPhase, TeamPhase.Done, 'pr-closed-without-merge');
        this.emit('feedback', teamId, {
          id: `pr-closed-${Date.now()}`,
          type: 'warning',
          title: 'PR Closed',
          message: `PR #${snapshot.prNumber} was closed without merging. You can create a new PR.`,
          blocking: false,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Stop polling if no teams are in PrOpen
    const anyPrOpen = [...this.teams.values()].some(
      (ctx) => ctx.state.snapshot.currentPhase === TeamPhase.PrOpen,
    );
    if (!anyPrOpen) {
      this.stopPrPolling();
    }
  }

  // --- Final Security Review (user-initiated) ---

  /**
   * Spawn a fresh agent to perform a comprehensive security review
   * of all changes on the current branch vs main. Results stream
   * to the Security-1 panel and a security-review event is emitted.
   */
  async runSecurityReview(teamId: string): Promise<void> {
    const ctx = this.teams.get(teamId);
    if (!ctx) throw new Error(`Team "${teamId}" not found`);
    if (ctx.pipelineRunning)
      throw new Error('Cannot run security review while pipeline is running');

    // Close any previous security review session
    if (ctx.securityReviewSession && !ctx.securityReviewSession.closed) {
      ctx.securityReviewSession.close();
    }

    const cwd = ctx.state.snapshot.projectPath;

    // Get the full branch diff
    const diffResult = GitOps.diff(cwd);
    if (!diffResult.success) {
      this.emit('security-review', teamId, {
        status: 'concerns',
        result: `Failed to get diff: ${diffResult.output}`,
      });
      return;
    }
    if (!diffResult.output.trim()) {
      this.emit('security-review', teamId, {
        status: 'passed',
        result: 'No changes to review — branch is identical to main.',
      });
      return;
    }

    this.emit('security-review', teamId, { status: 'running' });
    this.emit(
      'agent-output',
      teamId,
      'Security-1' as any,
      '[Security Review] Starting comprehensive review...',
    );

    try {
      const systemPrompt = this.loadRolePrompt('security-review.agent.md');
      const session = createAgentSession('SecurityReview', systemPrompt, {
        runtime: this.agentRuntime,
        model: this.getModelForRole(Role.Security),
        cwd,
        effort: 'high',
        maxTurns: 15,
        // The security reviewer must not modify the repo ("Do NOT implement
        // fixes"), so it is fully read-only (no Bash) — it works from the diff in
        // its prompt plus Grep for file content. The frontmatter restriction is
        // not applied to ad-hoc sessions, so pass the denylist explicitly.
        disallowedTools: SECURITY_REVIEW_DISALLOWED_TOOLS,
        guardrails: this.guardrails,
        onProgress: (text: string) => {
          this.emit('agent-progress', teamId, 'Security-1' as any, text);
        },
      });
      ctx.securityReviewSession = session;

      // Truncate large diffs to avoid exceeding context
      const MAX_DIFF_CHARS = 80_000;
      let diffText = diffResult.output;
      if (diffText.length > MAX_DIFF_CHARS) {
        diffText =
          diffText.substring(0, MAX_DIFF_CHARS) +
          '\n\n[DIFF TRUNCATED — review the changes shown above; use Grep to read the ' +
          'full content of any changed file you need more context on]';
      }

      // Fail-loud verdict: strict PASSED/CONCERNS prefix, retry once then throw
      // (caught below) — never infer 'passed' from a substring or an empty reply.
      const verdict = await sendWithVerdict(
        session,
        'Review the following git diff for security concerns. Analyze every change. ' +
          'Begin your response with **PASSED** (no issues) or **CONCERNS** (issues found).\n\n' +
          diffText,
        parseSecurityReviewVerdict,
        ['PASSED', 'CONCERNS'] as const,
        {
          onResponse: (raw) => this.emit('agent-output', teamId, 'Security-1' as any, raw),
          onMalformed: (raw) => this.emit('malformed-output', teamId, 'Security-1' as any, raw),
        },
        'Security-1',
      );

      const status = verdict.verdict === 'CONCERNS' ? 'concerns' : 'passed';
      this.emit('security-review', teamId, { status, result: verdict.details });

      session.close();
      ctx.securityReviewSession = undefined;
    } catch (err: any) {
      this.emit('security-review', teamId, { status: 'idle' });
      this.emit('feedback', teamId, {
        id: randomUUID(),
        type: 'error',
        title: 'Security review failed',
        message: err.message || 'Unknown error',
        blocking: false,
        timestamp: new Date().toISOString(),
      });
      ctx.securityReviewSession = undefined;
    }
  }

  // --- Private: .gitignore Management ---

  private ensureGitignore(projectPath: string): void {
    const gitignorePath = path.join(projectPath, '.gitignore');
    const entry = '.claude-orchestra/';

    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
      // Check if already present
      if (content.split('\n').some((line) => line.trim() === entry)) {
        return;
      }
    }

    // Append the entry
    const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(gitignorePath, content + separator + entry + '\n', 'utf-8');
  }

  // --- Private: Team Branch Setup ---

  /**
   * Create a dedicated branch for this team off main.
   * Returns the branch name (may include suffix if name was taken).
   */
  private ensureTeamBranch(projectPath: string, teamName: string): string {
    const branchName = GitOps.slugifyBranchName(teamName);
    const result = GitOps.createTeamBranch(projectPath, branchName);
    if (result.success) {
      return result.branchName;
    }
    // Branch creation failed — two very different situations:
    if (!GitOps.isGitRepo(projectPath)) {
      // Target dir is intentionally not under version control. The engine's
      // phase-boundary auto-commit runs `git status`/`git commit`, which no-op
      // here (hasChanges() is false when git fails), so nothing can land on a
      // default branch. Run the team WITHOUT a branch and warn.
      console.warn(
        `[orchestra] ${projectPath} is not a git repository — team will run without git auto-commit.`,
      );
      return '';
    }
    // It IS a git repo but the team branch could not be created/switched to
    // (e.g. no "main" branch, detached HEAD, dirty tree). Continuing would
    // leave HEAD on the current branch — typically the default branch — where
    // phase-boundary auto-commits would silently land. Fail loud instead.
    throw new Error(
      `Failed to create team branch "${branchName}" in ${projectPath}: ${result.output}. ` +
        `Refusing to start the team — auto-commits would otherwise land on the default branch. ` +
        `Ensure the repository has a "main" branch and a clean working tree, then try again.`,
    );
  }

  // --- Private: Session Management ---

  private closeSessions(ctx: PipelineTeamContext): void {
    for (const session of ctx.sessions) {
      if (!session.closed) {
        session.close();
      }
    }
    ctx.sessions = [];
    ctx.pipelineRunning = false;
  }

  /**
   * Resolve every pending blocking-feedback promise (e.g. an awaited
   * requirements checklist) with 'cancelled' and clear the map, so a pipeline
   * suspended in askUser doesn't hang forever — and leak its closure — when the
   * team is terminated or the engine shuts down.
   */
  private settlePendingFeedback(ctx: PipelineTeamContext): void {
    for (const [, pending] of ctx.pendingFeedback) {
      try {
        pending.resolve({ value: 'cancelled' });
      } catch {
        /* best effort */
      }
    }
    ctx.pendingFeedback.clear();
  }

  private createSession(
    name: RoleInstance,
    cwd: string,
    onProgress?: (accumulated: string) => void,
  ): AgentSession {
    const systemPrompt = this.loadRolePrompt(INSTANCE_AGENT_FILES[name]);

    return createAgentSession(name, systemPrompt, {
      runtime: this.agentRuntime,
      model: this.getModelForInstance(name),
      cwd,
      effort: this.efforts[name],
      disallowedTools:
        this.disallowedTools[name].length > 0 ? this.disallowedTools[name] : undefined,
      maxTurns: this.maxTurnsPerInstance[name],
      guardrails: this.guardrails,
      onProgress,
    });
  }

  // --- Private: Standard Pipeline ---

  private async runStandardPipeline(
    teamId: string,
    ctx: PipelineTeamContext,
    task: string,
    images?: Array<{ media_type: string; data: string }>,
  ): Promise<void> {
    const startTime = Date.now();
    const cwd = ctx.state.snapshot.projectPath;
    const requirements = ctx.state.snapshot.currentTask?.requirements;
    const requirementsBlock = requirements ? `\nAPPROVED REQUIREMENTS:\n${requirements}\n` : '';

    try {
      // Create all 4 agent sessions in parallel (cold starts happen simultaneously)
      const security = this.createSession('Security-1', cwd, (text) =>
        this.emit('agent-progress', teamId, 'Security-1' as any, text),
      );
      const worker1 = this.createSession('Worker-1', cwd, (text) =>
        this.emit('agent-progress', teamId, 'Worker-1' as any, text),
      );
      const worker2 = this.createSession('Worker-2', cwd, (text) =>
        this.emit('agent-progress', teamId, 'Worker-2' as any, text),
      );
      const reviewer = this.createSession('Reviewer-1', cwd, (text) =>
        this.emit('agent-progress', teamId, 'Reviewer-1' as any, text),
      );
      ctx.sessions = [security, worker1, worker2, reviewer];

      // Outer loop: handles REJECTED verdicts (restart from scan)
      let scanResult = '';
      // Carries the reviewer's actual findings from a REVISION_NEEDED/REJECTED
      // verdict into the next Worker-1 instruction, so the implementer revises
      // against concrete feedback instead of a generic "address any feedback"
      // note. Declared in the outer scope so it survives both the inner
      // `continue` (revision) and `continue outerLoop` (rejection) paths.
      let reviewerFeedback = '';
      outerLoop: while (true) {
        // --- Step 1: Security Scan ---
        {
          const fromPhase = ctx.state.currentPhase;
          this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.PreWork, 'security scan');
          this.persistence.persist(ctx.state);

          this.emit(
            'agent-output',
            teamId,
            'Security-1' as any,
            `[Pipeline] Security scan starting...`,
          );

          scanResult = await security.send(
            `PRE-WORK SCAN REQUEST\n\n` +
              `Task: ${task}\n` +
              requirementsBlock +
              `Project path: ${cwd}\n\n` +
              `Scan all files in the task scope and produce a clearance report.`,
          );

          this.emit('agent-output', teamId, 'Security-1' as any, scanResult);

          // Check if Security-1 classified this task as simpler than the heuristic thought
          const classification = parseClassification(scanResult);
          if (classification === 'SIMPLE') {
            // A SIMPLE downgrade skips Worker-2 verification and Reviewer-1 review,
            // so it must never apply to a task the router flagged as destructive or
            // one whose own scan raised concerns — otherwise a trivial-looking task
            // could bypass the gates entirely. Refuse the downgrade in those cases
            // and fall through to the full pipeline.
            const scanVerdict = parseSecurityVerdict(scanResult).verdict;
            const scanConcerns =
              /\bOFF-LIMITS\b/i.test(scanResult) ||
              scanVerdict === 'BLOCKED' ||
              scanVerdict === 'FLAGGED';
            const destructive = hasDestructiveIntent(task);

            if (destructive || scanConcerns) {
              this.emit(
                'agent-output',
                teamId,
                'Security-1' as any,
                `[Pipeline] SIMPLE downgrade refused (${
                  destructive ? 'router flagged destructive intent' : 'scan raised concerns'
                }) — running the full pipeline.`,
              );
              // Fall through to the standard worker/sweep/review loop below.
            } else {
              // Trivial task: skip Worker-2 verification and Reviewer-1 review, but
              // KEEP Security-1 for a mandatory post-work sweep. The security gate
              // is never skipped, even on the simple path.
              worker2.close();
              reviewer.close();
              ctx.sessions = [worker1, security];

              ctx.state.setTaskComplexity('simple');
              ctx.state.transitionAgent('Worker-2' as any, AgentState.Done);
              ctx.state.transitionAgent('Reviewer-1' as any, AgentState.Done);
              this.emit('task-classified', teamId, 'simple', 2);
              this.persistence.persist(ctx.state);

              this.emit(
                'agent-output',
                teamId,
                'Security-1' as any,
                `[Pipeline] Security classified task as SIMPLE — Worker-1 + security sweep only.`,
              );

              // --- Work: Worker-1 implements (stay in Work phase so the sweep can
              // run without a Handoff→Done transition, which the machine forbids) ---
              const fromPhase2 = ctx.state.currentPhase;
              this.tryTransitionPhase(
                ctx.state,
                teamId,
                fromPhase2,
                TeamPhase.Work,
                'simple pipeline (reclassified)',
              );
              this.persistence.persist(ctx.state);

              ctx.state.setAgentJob('Worker-1' as any, 'Implementing task (simple)');
              this.emit('agent-task', teamId, 'Worker-1' as any, 'Implementing task (simple)');
              let simpleResult = await worker1.send(
                `TASK: ${task}\n\n` +
                  requirementsBlock +
                  `SECURITY CLEARANCE:\n${scanResult}\n\n` +
                  `Implement the assigned work within the cleared scope.`,
                images,
              );
              this.emit(
                'agent-output',
                teamId,
                'Worker-1' as any,
                simpleResult.trim() || worker1.lastActivityLog || '(no text output)',
              );
              this.runGuardrailAudit(teamId, ctx, 'simple-work-reclassified');
              GitOps.commit(cwd, 'WIP: work phase complete (simple)');

              // --- Mandatory post-work security sweep ---
              this.emit(
                'agent-output',
                teamId,
                'Security-1' as any,
                `[Pipeline] Security sweep starting...`,
              );
              const sweepVerdict = await sendWithVerdict(
                security,
                `POST-WORK SWEEP REQUEST\n\n` +
                  `Task: ${task}\n` +
                  requirementsBlock +
                  `\nWorker-1 summary:\n${simpleResult.substring(0, 2000)}\n\n` +
                  `Sweep all changes made by Worker-1. Check for introduced vulnerabilities, ` +
                  `leaked secrets, and scope violations. Begin your response with APPROVED, FLAGGED, or BLOCKED.`,
                parseSecurityVerdict,
                ['APPROVED', 'FLAGGED', 'BLOCKED'] as const,
                {
                  onResponse: (raw) => this.emit('agent-output', teamId, 'Security-1' as any, raw),
                  onMalformed: (raw) =>
                    this.emit('malformed-output', teamId, 'Security-1' as any, raw),
                },
                'Security-1',
              );

              if (sweepVerdict.verdict === 'BLOCKED') {
                this.notifyUser(
                  teamId,
                  'warning',
                  'Security Blocked',
                  'Security sweep found issues on the simple task — Worker-1 is fixing them.',
                  'Security-1',
                  ['blocked', 'issue', 'vulnerability', 'hardcoded', 'secret', 'injection'],
                );
                simpleResult = await worker1.send(
                  `SECURITY BLOCKED — FIX REQUIRED\n\n${sweepVerdict.details.substring(0, 3000)}\n\n` +
                    `Fix the security issues above. Do not add unrelated changes.`,
                );
                this.emit(
                  'agent-output',
                  teamId,
                  'Worker-1' as any,
                  simpleResult.trim() || worker1.lastActivityLog || '(no text output)',
                );
                this.runGuardrailAudit(teamId, ctx, 'simple-work-security-fix');

                const reSweep = await sendWithVerdict(
                  security,
                  `POST-WORK SWEEP RE-CHECK\n\nTask: ${task}\n\n` +
                    `Worker-1 remediation:\n${simpleResult.substring(0, 2000)}\n\n` +
                    `Re-check the previously BLOCKED issues. Begin your response with APPROVED, FLAGGED, or BLOCKED.`,
                  parseSecurityVerdict,
                  ['APPROVED', 'FLAGGED', 'BLOCKED'] as const,
                  {
                    onResponse: (raw) =>
                      this.emit('agent-output', teamId, 'Security-1' as any, raw),
                    onMalformed: (raw) =>
                      this.emit('malformed-output', teamId, 'Security-1' as any, raw),
                  },
                  'Security-1',
                );
                if (reSweep.verdict === 'BLOCKED') {
                  this.notifyUser(
                    teamId,
                    'warning',
                    'Security Still Blocked',
                    'Security sweep still reports issues after one fix pass — review before merge.',
                    'Security-1',
                  );
                }
              }

              this.runGuardrailAudit(teamId, ctx, 'security-sweep');
              GitOps.commit(cwd, 'WIP: security sweep passed (simple)');

              security.close();
              this.markAgentDone(ctx, 'Security-1' as any);
              this.markAgentDone(ctx, 'Worker-1' as any);
              this.completePipeline(teamId, ctx, startTime);
              return;
            }
          }

          if (classification === 'COMPLEX') {
            ctx.isComplex = true;
          }
        }

        // Inner loop: handles REVISION_NEEDED and BLOCKED verdicts
        let workerResults: { w1: string; w2: string } = { w1: '', w2: '' };
        while (true) {
          // --- Step 2: Worker-1 implements, Worker-2 verifies ---
          {
            const fromPhase = ctx.state.currentPhase;
            this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Work, 'workers start');
            this.persistence.persist(ctx.state);

            const revisionCount = ctx.state.counters.revisions;
            const workerInstruction =
              `TASK: ${task}\n\n` +
              requirementsBlock +
              `SECURITY CLEARANCE:\n${scanResult}\n\n` +
              (revisionCount > 0
                ? `REVISION ATTEMPT ${revisionCount + 1}:\nPrevious work needs revision. ` +
                  `Address the reviewer's feedback below and fix the issues.\n\n` +
                  (reviewerFeedback
                    ? `REVIEWER FEEDBACK:\n${reviewerFeedback.substring(0, 3000)}\n\n`
                    : '')
                : '') +
              `Implement the assigned work within the cleared scope.`;

            // --- Worker-1: Implement ---
            this.emit('agent-task', teamId, 'Worker-1' as any, 'Implementing full task');
            this.emit(
              'agent-output',
              teamId,
              'Worker-1' as any,
              `[Pipeline] Worker-1 implementing...`,
            );

            const w1Result = await worker1.send(`You are Worker-1. ${workerInstruction}`, images);
            // Use activity log as fallback display when text result is empty (most work is tool_use)
            const w1Display = w1Result.trim() || worker1.lastActivityLog || '(no text output)';
            this.emit('agent-output', teamId, 'Worker-1' as any, w1Display);

            // --- Worker-2: Verify completeness (loop up to MAX_VERIFY_PASSES) ---
            let w2Result = '';
            let verifyPass = 0;
            let currentW1Result = w1Result;

            while (verifyPass < MAX_VERIFY_PASSES) {
              verifyPass++;
              const verifyLabel =
                verifyPass === 1
                  ? 'Verifying completeness'
                  : `Re-verifying completeness (pass ${verifyPass})`;

              this.emit('agent-task', teamId, 'Worker-2' as any, verifyLabel);
              this.emit(
                'agent-output',
                teamId,
                'Worker-2' as any,
                `[Pipeline] Worker-2 ${verifyLabel.toLowerCase()}...`,
              );

              const verifyVerdict = await sendWithVerdict(
                worker2,
                `REQUIREMENTS VERIFICATION\n\n` +
                  `You are Worker-2, acting as an engineering manager. Your ONLY job is to verify ` +
                  `that Worker-1 built what the user asked for. Do NOT modify any code.\n\n` +
                  `DEFINITION OF A GAP: A specific requirement from the approved requirements list ` +
                  `that is NOT implemented in the code. Do NOT flag code quality, style, ` +
                  `performance, or things not in the requirements.\n\n` +
                  `ORIGINAL TASK: ${task}\n\n` +
                  (requirements ? `APPROVED REQUIREMENTS:\n${requirements}\n\n` : '') +
                  `WORKER-1 OUTPUT:\n${currentW1Result.substring(0, 3000)}\n\n` +
                  `INSTRUCTIONS:\n` +
                  `1. Begin your response on the FIRST line with one of:\n` +
                  `   COMPLETE — if every approved requirement is implemented\n` +
                  `   GAPS_FOUND — if any requirement is missing\n` +
                  `2. Below the verdict, output a checklist in this format:\n\n` +
                  `REQUIREMENTS CHECKLIST:\n` +
                  `- [x] Requirement description — implemented\n` +
                  `- [ ] Requirement description — NOT implemented (explain what is missing)\n\n` +
                  `Only flag gaps for requirements in the approved list. Nothing else.`,
                parseVerifyVerdict,
                ['COMPLETE', 'GAPS_FOUND'] as const,
                {
                  onResponse: (raw) => this.emit('agent-output', teamId, 'Worker-2' as any, raw),
                  onMalformed: (raw) =>
                    this.emit('malformed-output', teamId, 'Worker-2' as any, raw),
                },
                'Worker-2',
              );
              w2Result = verifyVerdict.details;

              if (verifyVerdict.verdict === 'COMPLETE') {
                this.emit('agent-task', teamId, 'Worker-2' as any, 'Verified complete');
                break;
              }

              // GAPS_FOUND — extract only unmet requirements for the detail modal
              const unmetLines = w2Result
                .split('\n')
                .filter((line) => /- \[ \]/.test(line))
                .join('\n');
              const gapDetail = unmetLines || w2Result.substring(0, 4000);

              this.notifyUser(
                teamId,
                'info',
                'Requirements Gap',
                `Worker-2 found unmet requirements (pass ${verifyPass}) — Worker-1 is fixing them.`,
                undefined,
                undefined,
                gapDetail,
              );

              this.emit(
                'agent-task',
                teamId,
                'Worker-1' as any,
                `Fixing gaps (attempt ${verifyPass})`,
              );
              this.emit(
                'agent-output',
                teamId,
                'Worker-1' as any,
                `[Pipeline] Worker-1 fixing gaps (attempt ${verifyPass})...`,
              );

              currentW1Result = await worker1.send(
                `REQUIREMENTS GAPS — FIX REQUIRED (attempt ${verifyPass})\n\n` +
                  `Worker-2 checked your implementation against the original task requirements ` +
                  `and found unmet requirements (marked [ ] in the checklist below):\n\n` +
                  `${w2Result.substring(0, 3000)}\n\n` +
                  `Implement ONLY the unchecked [ ] requirements. Do not re-implement what already works.`,
              );
              const fixDisplay =
                currentW1Result.trim() || worker1.lastActivityLog || '(no text output)';
              this.emit('agent-output', teamId, 'Worker-1' as any, fixDisplay);
            }

            workerResults = { w1: currentW1Result, w2: w2Result };
          }

          this.runGuardrailAudit(teamId, ctx, 'work-phase');

          // Auto-commit after work phase (safety checkpoint)
          GitOps.commit(cwd, 'WIP: work phase complete');

          // --- Step 3: Security Sweep ---
          {
            const fromPhase = ctx.state.currentPhase;
            this.tryTransitionPhase(
              ctx.state,
              teamId,
              fromPhase,
              TeamPhase.Handoff,
              'security sweep',
            );
            this.persistence.persist(ctx.state);

            this.emit(
              'agent-output',
              teamId,
              'Security-1' as any,
              `[Pipeline] Security sweep starting...`,
            );

            const sweepVerdict = await sendWithVerdict(
              security,
              `POST-WORK SWEEP REQUEST\n\n` +
                `Task: ${task}\n` +
                requirementsBlock +
                `\n` +
                `Worker-1 summary:\n${workerResults.w1.substring(0, 2000)}\n\n` +
                `Worker-2 summary:\n${workerResults.w2.substring(0, 2000)}\n\n` +
                `Sweep all changes made by Workers. Check for introduced vulnerabilities, ` +
                `leaked secrets, and scope violations. Begin your response with APPROVED, FLAGGED, or BLOCKED.`,
              parseSecurityVerdict,
              ['APPROVED', 'FLAGGED', 'BLOCKED'] as const,
              {
                onResponse: (raw) => this.emit('agent-output', teamId, 'Security-1' as any, raw),
                onMalformed: (raw) =>
                  this.emit('malformed-output', teamId, 'Security-1' as any, raw),
              },
              'Security-1',
            );

            if (sweepVerdict.verdict === 'BLOCKED') {
              this.emit(
                'agent-output',
                teamId,
                'Security-1' as any,
                `[Pipeline] Security BLOCKED — retrying workers...`,
              );
              this.notifyUser(
                teamId,
                'warning',
                'Security Blocked',
                'Security sweep found issues — retrying workers with updated constraints.',
                'Security-1',
                ['blocked', 'issue', 'vulnerability', 'hardcoded', 'secret', 'injection'],
              );
              // Backward transition: Handoff → Work (auto-increments counters, checks limits)
              const fromPhase2 = ctx.state.currentPhase;
              ctx.state.transitionPhase(TeamPhase.Work);
              this.emit(
                'phase-transition',
                teamId,
                fromPhase2,
                TeamPhase.Work,
                'security blocked — retry',
              );
              this.persistence.persist(ctx.state);
              continue;
            }

            // APPROVED or FLAGGED — proceed to review
            // Auto-commit after security sweep passes (safety checkpoint)
            this.runGuardrailAudit(teamId, ctx, 'security-sweep');
            GitOps.commit(cwd, 'WIP: security sweep passed');
          }

          // --- Step 4: Review ---
          {
            const fromPhase = ctx.state.currentPhase;
            this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Review, 'review');
            this.persistence.persist(ctx.state);

            this.emit('agent-output', teamId, 'Reviewer-1' as any, `[Pipeline] Review starting...`);

            const reviewVerdict = await sendWithVerdict(
              reviewer,
              `REVIEW REQUEST\n\n` +
                `Task: ${task}\n` +
                requirementsBlock +
                `\n` +
                `Worker-1 summary:\n${workerResults.w1.substring(0, 2000)}\n\n` +
                `Worker-2 summary:\n${workerResults.w2.substring(0, 2000)}\n\n` +
                `Evaluate the quality and correctness of this work. ` +
                (ctx.isComplex
                  ? `This is a COMPLEX task — apply strict review criteria for backward compatibility, data integrity, and security. `
                  : '') +
                `Begin your response with APPROVED, REVISION_NEEDED, or REJECTED.`,
              parseReviewVerdict,
              ['APPROVED', 'REVISION_NEEDED', 'REJECTED'] as const,
              {
                onResponse: (raw) => this.emit('agent-output', teamId, 'Reviewer-1' as any, raw),
                onMalformed: (raw) =>
                  this.emit('malformed-output', teamId, 'Reviewer-1' as any, raw),
              },
              'Reviewer-1',
            );

            if (reviewVerdict.verdict === 'APPROVED') {
              // Success — break out of both loops
              break outerLoop;
            }

            if (reviewVerdict.verdict === 'REVISION_NEEDED') {
              // Carry the reviewer's concrete findings into the next Worker-1
              // instruction (see workerInstruction above), so the revision pass
              // targets the actual issues rather than revising blind.
              reviewerFeedback = reviewVerdict.details;
              this.emit(
                'agent-output',
                teamId,
                'Reviewer-1' as any,
                `[Pipeline] REVISION_NEEDED — retrying workers with feedback...`,
              );
              this.notifyUser(
                teamId,
                'info',
                'Revision Requested',
                'Reviewer requested changes — sending feedback to workers for another pass.',
              );
              // Backward transition: Review → Work (auto-increments revisions + total)
              const fromPhase2 = ctx.state.currentPhase;
              ctx.state.transitionPhase(TeamPhase.Work);
              this.emit('phase-transition', teamId, fromPhase2, TeamPhase.Work, 'revision needed');
              this.persistence.persist(ctx.state);
              continue;
            }

            if (reviewVerdict.verdict === 'REJECTED') {
              // A rejection restarts from the security scan, but the reviewer's
              // rationale still informs the next implementation attempt.
              reviewerFeedback = reviewVerdict.details;
              this.emit(
                'agent-output',
                teamId,
                'Reviewer-1' as any,
                `[Pipeline] REJECTED — restarting from security scan...`,
              );
              this.notifyUser(
                teamId,
                'warning',
                'Work Rejected',
                'Reviewer rejected the work — restarting pipeline from security scan.',
              );
              // Backward transition: Review → PreWork (auto-increments rejections + total)
              const fromPhase2 = ctx.state.currentPhase;
              ctx.state.transitionPhase(TeamPhase.PreWork);
              this.emit(
                'phase-transition',
                teamId,
                fromPhase2,
                TeamPhase.PreWork,
                'rejected — restart',
              );
              this.persistence.persist(ctx.state);
              continue outerLoop;
            }
          }

          // Default: break inner loop (shouldn't reach here)
          break;
        }
      }

      // All loops exited normally — pipeline succeeded
      // Final auto-commit with the task description
      GitOps.commit(cwd, task.substring(0, 72));

      // Keep sessions alive for Q&A after completion
      this.markAllNonErroredAgentsDone(ctx);
      this.completePipeline(teamId, ctx, startTime);
    } catch (err: any) {
      this.closeSessions(ctx);
      this.failPipeline(teamId, ctx, err, startTime);
    }
  }

  // --- Private: Guardrails ---

  private runGuardrailAudit(
    teamId: string,
    ctx: PipelineTeamContext,
    phase: string,
  ): GuardrailReport {
    if (!this.guardrails.enabled) {
      return {
        ok: true,
        phase,
        checkedAt: new Date().toISOString(),
        findings: [],
      };
    }

    const report = auditProjectChanges(ctx.state.snapshot.projectPath, phase);
    ctx.state.recordGuardrailReport({
      phase: report.phase,
      ok: report.ok,
      checkedAt: report.checkedAt,
      findingCount: report.findings.length,
      blockingCount: report.findings.filter((finding) => finding.severity === 'block').length,
      warningCount: report.findings.filter((finding) => finding.severity === 'warn').length,
    });
    this.persistence.persist(ctx.state);

    if (report.findings.length > 0) {
      this.notifyUser(
        teamId,
        'warning',
        report.ok ? 'Guardrail Audit Warning' : 'Guardrail Audit Blocked',
        report.ok
          ? 'Guardrail audit found risky changes; the pipeline is continuing with a warning.'
          : 'Guardrail audit found blocked changes; the pipeline is stopping before commit.',
        'Pipeline',
        ['guardrail', 'secret', 'protected', 'dependency', 'config'],
        formatGuardrailReport(report),
        { guardrailReport: report },
      );
    }

    if (hasBlockingFindings(report)) {
      throw new GuardrailViolationError(
        'Guardrail audit blocked the pipeline before committing changes.',
        report,
      );
    }

    return report;
  }

  // --- Feedback ---

  /** Non-blocking: fire-and-forget notification to the dashboard */
  private notifyUser(
    teamId: string,
    type: FeedbackPayload['type'],
    title: string,
    message: string,
    sourceAgent?: string,
    highlightTerms?: string[],
    detail?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.emit('feedback', teamId, {
      id: randomUUID(),
      type,
      title,
      message,
      blocking: false,
      timestamp: new Date().toISOString(),
      sourceAgent,
      highlightTerms,
      detail,
      metadata,
    });
  }

  /** Blocking: pause pipeline until user responds via dashboard */
  private askUser(
    teamId: string,
    title: string,
    message: string,
    actions: Array<{ label: string; value: string }>,
    editableContent?: string,
  ): Promise<{ value: string; text?: string }> {
    const ctx = this.teams.get(teamId);
    if (!ctx) return Promise.resolve({ value: '' });

    const id = randomUUID();
    const feedback: FeedbackPayload = {
      id,
      type: 'question',
      title,
      message,
      actions,
      blocking: true,
      timestamp: new Date().toISOString(),
      editableContent,
    };

    return new Promise((resolve) => {
      ctx.pendingFeedback.set(id, { resolve, feedback });
      this.emit('feedback', teamId, feedback);
    });
  }

  /**
   * All currently-pending blocking-feedback prompts across teams. Used by the
   * dashboard SSE init snapshot so a page reload re-shows an open prompt (e.g.
   * the requirements checklist) instead of orphaning the suspended pipeline.
   */
  getPendingFeedback(): Array<{ teamId: string; feedback: FeedbackPayload }> {
    const out: Array<{ teamId: string; feedback: FeedbackPayload }> = [];
    for (const [teamId, ctx] of this.teams) {
      for (const [, pending] of ctx.pendingFeedback) {
        out.push({ teamId, feedback: pending.feedback });
      }
    }
    return out;
  }

  /**
   * Called when the user responds from the dashboard — resolves the pending
   * promise. `text` carries an edited body when the prompt was editable (e.g. a
   * revised requirements checklist).
   */
  resolveFeedback(teamId: string, feedbackId: string, value: string, text?: string): void {
    const ctx = this.teams.get(teamId);
    const pending = ctx?.pendingFeedback?.get(feedbackId);
    if (pending) {
      pending.resolve({ value, text });
      ctx!.pendingFeedback.delete(feedbackId);
      this.emit('feedback-response', teamId, feedbackId, value);
    }
  }

  // --- User Q&A ---

  /** Send a user question to a warm agent session and emit the response as feedback */
  async sendMessage(
    teamId: string,
    message: string,
    images?: Array<{ media_type: string; data: string }>,
    targetInstance?: string,
  ): Promise<void> {
    const ctx = this.teams.get(teamId);
    if (!ctx) throw new Error(`Team "${teamId}" not found`);
    if (ctx.pipelineRunning) throw new Error('Cannot ask while pipeline is running');

    // Find the specific live session if targetInstance is given (UI's Steer
    // button labels itself with a specific instance, so the message should
    // land there — not on whatever happens to be first in ctx.sessions).
    // Falls back to the legacy "first non-closed session" behavior for API
    // callers that don't specify a target.
    let liveSession: AgentSession | undefined;
    if (targetInstance) {
      // Match a session by name. Some legacy sessions carry the bare role
      // ("Reviewer") while modern code uses the -1 suffix; accept both.
      liveSession = ctx.sessions.find(
        (s) =>
          !s.closed &&
          (s.name === targetInstance || (targetInstance === 'Reviewer-1' && s.name === 'Reviewer')),
      );
      if (!liveSession) {
        throw new Error(`No live session for ${targetInstance} — the agent may have been closed.`);
      }
    } else {
      liveSession = ctx.sessions.find((s) => !s.closed);
      if (!liveSession) throw new Error('No active agent sessions — start a new task first');
    }

    const instance = (
      liveSession.name === 'Reviewer'
        ? 'Reviewer-1'
        : liveSession.name === 'Worker-1'
          ? 'Worker-1'
          : liveSession.name.includes('-')
            ? liveSession.name
            : liveSession.name + '-1'
    ) as any;

    // Show user's question in feedback bar
    this.emit('feedback', teamId, {
      id: randomUUID(),
      type: 'question' as const,
      title: 'You asked',
      message,
      blocking: false,
      timestamp: new Date().toISOString(),
    });

    // Stream progress while agent is thinking
    this.emit('agent-output', teamId, instance, `[Q&A] Processing your question...`);

    const response = await liveSession.send(
      `USER QUESTION (not a new task — just answer this question about ` +
        `the work you just completed):\n\n${message}`,
      images,
    );

    this.emit('agent-output', teamId, instance, response);

    // Show response summary in feedback bar
    this.emit('feedback', teamId, {
      id: randomUUID(),
      type: 'info' as const,
      title: liveSession.name + ' responded',
      message: response.length > 500 ? response.substring(0, 497) + '...' : response,
      blocking: false,
      timestamp: new Date().toISOString(),
    });
  }

  // --- Private: Pipeline Completion ---

  private completePipeline(teamId: string, ctx: PipelineTeamContext, startTime: number): void {
    // Auto-commit any remaining changes before marking done
    const cwd = ctx.state.snapshot.projectPath;
    const task = ctx.state.snapshot.currentTask?.description ?? teamId;
    this.runGuardrailAudit(teamId, ctx, 'pipeline-complete');
    GitOps.commit(cwd, task.substring(0, 72));

    const fromPhase = ctx.state.currentPhase;
    this.tryTransitionPhase(ctx.state, teamId, fromPhase, TeamPhase.Done, 'pipeline completed');
    ctx.pipelineRunning = false;

    const durationMs = Date.now() - startTime;
    this.emit('task-complete', teamId, TeamPhase.Done, durationMs);
    this.notifyUser(
      teamId,
      'info',
      'Task Complete',
      `Pipeline finished in ${(durationMs / 1000).toFixed(1)}s — ready for push & merge.`,
    );
    this.persistence.persistNow(ctx.state);
  }

  private markAgentDone(ctx: PipelineTeamContext, instance: RoleInstance): void {
    const current = ctx.state.getAgent(instance)?.state;
    if (!current || current === AgentState.Done || current === AgentState.Errored) return;

    if (current === AgentState.Spawning) {
      ctx.state.transitionAgent(instance, AgentState.Active);
    }

    ctx.state.transitionAgent(instance, AgentState.Done);
  }

  private markAllNonErroredAgentsDone(ctx: PipelineTeamContext): void {
    for (const [instance, agent] of ctx.state.getAllAgents()) {
      if (agent.state !== AgentState.Errored) {
        this.markAgentDone(ctx, instance);
      }
    }
  }

  private failPipeline(
    teamId: string,
    ctx: PipelineTeamContext,
    err: any,
    startTime: number,
  ): void {
    if (this.shuttingDown) return;

    const error = normalizeRuntimeError(err, {
      provider: this.agentRuntime.provider,
      phase: ctx.state.currentPhase,
    });
    ctx.state.recordRuntimeError(error.data);
    this.emit('error', teamId, error);
    this.notifyUser(
      teamId,
      'warning',
      'Pipeline Failed',
      `Error: ${error.message}`,
      undefined,
      undefined,
      JSON.stringify(error.data, null, 2),
      { runtimeError: error.data },
    );

    const fromPhase = ctx.state.currentPhase;
    this.tryTransitionPhase(
      ctx.state,
      teamId,
      fromPhase,
      TeamPhase.Errored,
      `pipeline error: ${error.message}`,
    );
    ctx.pipelineRunning = false;

    const durationMs = Date.now() - startTime;
    this.emit('task-complete', teamId, TeamPhase.Errored, durationMs);
    this.persistence.persistNow(ctx.state);
  }

  // --- Private: Phase Transition Helper ---

  private tryTransitionPhase(
    state: TeamState,
    teamId: string,
    fromPhase: TeamPhase,
    toPhase: TeamPhase,
    trigger: string,
  ): void {
    try {
      state.transitionPhase(toPhase);
      this.emit('phase-transition', teamId, fromPhase, toPhase, trigger);
    } catch {
      // Invalid transition — pipeline may re-enter same phase
    }
  }

  // --- Private: Requirements Extraction ---

  private async extractRequirements(
    cwd: string,
    taskDescription: string,
    images?: Array<{ media_type: string; data: string }>,
  ): Promise<string> {
    const systemPrompt = this.loadRolePrompt('requirements.agent.md');

    const session = createAgentSession('Requirements', systemPrompt, {
      runtime: this.agentRuntime,
      model: this.getModelForRole(Role.Worker),
      cwd,
      effort: 'medium',
      maxTurns: 1,
      // Requirements extraction is read-only — it must not touch the repo.
      disallowedTools: READ_ONLY_DISALLOWED_TOOLS,
      guardrails: this.guardrails,
    });

    try {
      const result = await session.send(taskDescription, images);
      return postProcessRequirements(result);
    } finally {
      session.close();
    }
  }

  // --- Private: Role Prompt Loading ---

  private loadFrontmatterDefaults(rolesDir: string): {
    models: Record<RoleInstance, string>;
    efforts: Record<RoleInstance, EffortLevel>;
    disallowedTools: Record<RoleInstance, string[]>;
    maxTurns: Record<RoleInstance, number>;
  } {
    const models = {} as Record<RoleInstance, string>;
    const efforts = {} as Record<RoleInstance, EffortLevel>;
    const disallowedTools = {} as Record<RoleInstance, string[]>;
    const maxTurns = {} as Record<RoleInstance, number>;

    for (const instance of ALL_INSTANCES) {
      const filename = INSTANCE_AGENT_FILES[instance];
      const filePath = path.join(rolesDir, filename);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const { frontmatter } = parseFrontmatter(content);

        models[instance] = frontmatter.model ?? FALLBACK_MODEL;
        // Validate user-authored values: an unknown effort name or a
        // non-positive-integer maxTurns falls back to the safe default rather
        // than being cast/parsed blindly and handed to the SDK.
        efforts[instance] = isEffortLevel(frontmatter.effort)
          ? frontmatter.effort
          : FALLBACK_EFFORT;
        maxTurns[instance] = parseFrontmatterMaxTurns(frontmatter.maxTurns);
        disallowedTools[instance] = frontmatter.disallowedTools
          ? frontmatter.disallowedTools.split(',').map((t: string) => t.trim())
          : [];
      } catch {
        models[instance] = FALLBACK_MODEL;
        efforts[instance] = FALLBACK_EFFORT;
        maxTurns[instance] = FALLBACK_MAX_TURNS;
        disallowedTools[instance] = [];
      }
    }

    return { models, efforts, disallowedTools, maxTurns };
  }

  private loadRolePrompt(filename: string): string {
    const promptPath = path.join(this.config.rolesDir, filename);
    try {
      const rawContent = fs.readFileSync(promptPath, 'utf-8');
      return parseFrontmatter(rawContent).body;
    } catch (err: any) {
      throw new Error(`Failed to read role prompt at ${promptPath}: ${err?.message}`);
    }
  }

  private getModelForInstance(instance: RoleInstance): string | undefined {
    const runtimeModel = normalizeProviderModel(this.agentRuntime.model);
    if (runtimeModel) return runtimeModel;
    if (this.agentRuntime.provider === 'codex') return undefined;
    return this.models[instance];
  }

  // Used by agents that aren't part of the standard pipeline rotation
  // (final security review, requirements extraction). Picks the first
  // instance for the given role as a stable proxy for "the role's model."
  private getModelForRole(role: Role): string | undefined {
    const runtimeModel = normalizeProviderModel(this.agentRuntime.model);
    if (runtimeModel) return runtimeModel;
    if (this.agentRuntime.provider === 'codex') return undefined;
    const proxyInstance = ALL_INSTANCES.find((i) => INSTANCE_TO_ROLE[i] === role);
    return proxyInstance ? this.models[proxyInstance] : undefined;
  }
}
