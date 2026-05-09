// Role definitions, instance types, and JTBD type definitions

// --- Roles ---

export enum Role {
  Worker = 'Worker',
  Security = 'Security',
  Reviewer = 'Reviewer',
}

// --- Role Instances ---

export type WorkerInstance = 'Worker-1' | 'Worker-2';
export type SecurityInstance = 'Security-1';
export type ReviewerInstance = 'Reviewer-1';

export type RoleInstance = WorkerInstance | SecurityInstance | ReviewerInstance;

// All valid instance identifiers
export const VALID_INSTANCES: readonly RoleInstance[] = [
  'Worker-1',
  'Worker-2',
  'Security-1',
  'Reviewer-1',
] as const;

// Map role to its valid instances
export const ROLE_INSTANCES: Record<Role, readonly RoleInstance[]> = {
  [Role.Worker]: ['Worker-1', 'Worker-2'],
  [Role.Security]: ['Security-1'],
  [Role.Reviewer]: ['Reviewer-1'],
} as const;

// --- JTBD (Jobs To Be Done) ---

export interface JobDefinition {
  role: Role;
  mission: string;
  phaseJobs: Record<string, string>;
  constraints: string[];
}
