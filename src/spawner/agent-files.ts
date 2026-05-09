// Single source of truth: which prompt file each RoleInstance loads,
// and which Role each instance belongs to. Filenames intentionally match
// the literal so a grep on either side surfaces every reference
// (e.g. 'Worker-1' ↔ worker-1.agent.md).

import { Role, type RoleInstance } from '../roles/role-types.js';

export const INSTANCE_AGENT_FILES: Record<RoleInstance, string> = {
  'Worker-1': 'worker-1.agent.md',
  'Worker-2': 'worker-2.agent.md',
  'Security-1': 'security.agent.md',
  'Reviewer-1': 'reviewer.agent.md',
  'Coordinator-1': 'coordinator.agent.md',
};

export const INSTANCE_TO_ROLE: Record<RoleInstance, Role> = {
  'Worker-1': Role.Worker,
  'Worker-2': Role.Worker,
  'Security-1': Role.Security,
  'Reviewer-1': Role.Reviewer,
  'Coordinator-1': Role.Coordinator,
};

export const ALL_INSTANCES: readonly RoleInstance[] = Object.keys(
  INSTANCE_AGENT_FILES
) as RoleInstance[];
