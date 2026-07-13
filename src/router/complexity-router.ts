// Heuristic task complexity classifier.
// Routes tasks to simple or standard pipelines based on
// description length and keyword analysis. No LLM call needed.

import type { TaskComplexity } from '../state/team-state.js';

/** Keywords that indicate a task needs the full pipeline. */
const COMPLEX_KEYWORDS = [
  'test',
  'tests',
  'testing',
  'validate',
  'validation',
  'multiple files',
  'several files',
  'refactor',
  'restructure',
  'redesign',
  'integrate',
  'integration',
  'implement',
  'implementation',
  'module',
  'modules',
  'api',
  'endpoint',
  'endpoints',
  'database',
  'migration',
  'authentication',
  'authorization',
  'deploy',
  'deployment',
  'configure',
  'configuration',
  'setup',
  'install',
  'architecture',
  'security',
  'permissions',
  'performance',
  'optimize',
];

/**
 * Destructive / high-risk intent. A task matching this is routed to the full
 * pipeline regardless of length — defense-in-depth so a short destructive task
 * (e.g. "drop the users table") is never treated as trivial. Matched on WHOLE
 * words (not substrings) so ordinary tasks like "preset the layout" or "update
 * the backdrop" aren't misclassified. This is a denylist and cannot be
 * exhaustive, which is why Security-1 also scans every task.
 */
// Narrowed to genuinely destructive/high-risk terms. Common benign action verbs
// (remove, reset, revert, rollback, overwrite, format) were dropped — they routed
// trivial tasks like "remove the debug banner" or "format the README" to the
// blocking requirements modal and stalled unattended runs. Security-1 still scans
// every task, so this denylist is defense-in-depth, not the only gate.
const DESTRUCTIVE_PATTERN =
  /\b(?:delete|drop|truncate|wipe|erase|destroy|purge|prune|rm|uninstall|downgrade|force[- ]?push|sudo|chmod|chown|credentials?|secrets?|passwords?|tokens?|production|prod)\b|\bprivate key\b|\.env\b/i;

/** Word count threshold — descriptions longer than this are standard. */
const MAX_SIMPLE_WORDS = 20;

/**
 * True when the task text carries destructive/high-risk intent. Used both by the
 * router (to force `standard`) and by the pipeline (to refuse a Security-1 SIMPLE
 * downgrade), so a trivial-looking destructive task can never skip the gates.
 */
export function hasDestructiveIntent(description: string): boolean {
  return DESTRUCTIVE_PATTERN.test(description);
}

/**
 * Classify a task description as simple or standard.
 *
 * Simple tasks: short descriptions with no complexity markers.
 * Examples: "create hello.txt", "add a comment to main.ts",
 *           "rename foo.js to bar.js"
 *
 * Standard tasks: longer descriptions or those containing
 * keywords that indicate multi-step work.
 * Examples: "implement user authentication with tests",
 *           "refactor the database module"
 */
export function classifyComplexity(description: string): TaskComplexity {
  const lower = description.toLowerCase();
  const words = description.trim().split(/\s+/).length;

  // Destructive/high-risk intent → always standard, regardless of length.
  if (DESTRUCTIVE_PATTERN.test(description)) return 'standard';

  // Long descriptions → standard
  if (words > MAX_SIMPLE_WORDS) return 'standard';

  // Check for complexity keywords
  const hitCount = COMPLEX_KEYWORDS.filter((k) => lower.includes(k)).length;
  if (hitCount > 0) return 'standard';

  return 'simple';
}
