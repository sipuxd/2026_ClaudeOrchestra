// Heuristic task complexity classifier.
// Routes tasks to simple or standard pipelines based on
// description length and keyword analysis. No LLM call needed.

import type { TaskComplexity } from '../state/team-state.js';

/** Keywords that indicate a task needs the full pipeline. */
const COMPLEX_KEYWORDS = [
  'test', 'tests', 'testing',
  'validate', 'validation',
  'multiple files', 'several files',
  'refactor', 'restructure', 'redesign',
  'integrate', 'integration',
  'implement', 'implementation',
  'module', 'modules',
  'api', 'endpoint', 'endpoints',
  'database', 'migration',
  'authentication', 'authorization',
  'deploy', 'deployment',
  'configure', 'configuration',
  'setup', 'install',
  'architecture',
  'security', 'permissions',
  'performance', 'optimize',
];

/** Word count threshold — descriptions longer than this are standard. */
const MAX_SIMPLE_WORDS = 20;

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

  // Long descriptions → standard
  if (words > MAX_SIMPLE_WORDS) return 'standard';

  // Check for complexity keywords
  const hitCount = COMPLEX_KEYWORDS.filter(k => lower.includes(k)).length;
  if (hitCount > 0) return 'standard';

  return 'simple';
}
