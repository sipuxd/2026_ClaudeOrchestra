// Flag enums per role pair, matching the message contract exactly

import { Role } from '../roles/role-types.js';

// --- Supervisor → Worker ---

export enum SupervisorToWorkerFlag {
  TaskAssignment = 'task-assignment',
  DirectionChange = 'direction-change',
  Pause = 'pause',
  Resume = 'resume',
  CheckIn = 'check-in',
  RevisionRequest = 'revision-request',
}

// --- Worker → Supervisor ---

export enum WorkerToSupervisorFlag {
  TaskAccepted = 'task-accepted',
  ProgressUpdate = 'progress-update',
  TaskComplete = 'task-complete',
  Blocked = 'blocked',
  NeedsGuidance = 'needs-guidance',
  ScopeConcern = 'scope-concern',
  AnomalyDetected = 'anomaly-detected',
}

// --- Supervisor → Security ---

export enum SupervisorToSecurityFlag {
  ScanRequest = 'scan-request',
  SweepRequest = 'sweep-request',
  EscalationQuery = 'escalation-query',
}

// --- Security → Supervisor ---

export enum SecurityToSupervisorFlag {
  ClearanceReport = 'clearance-report',
  HandoffClearance = 'handoff-clearance',
  SecurityAlert = 'security-alert',
  EscalationResponse = 'escalation-response',
}

// --- Worker → Security ---

export enum WorkerToSecurityFlag {
  ClearanceRequest = 'clearance-request',
}

// --- Security → Worker ---

export enum SecurityToWorkerFlag {
  ClearanceGranted = 'clearance-granted',
  ClearanceDenied = 'clearance-denied',
}

// --- Supervisor → Reviewer ---

export enum SupervisorToReviewerFlag {
  ReviewRequest = 'review-request',
}

// --- Reviewer → Supervisor ---

export enum ReviewerToSupervisorFlag {
  ReviewApproved = 'review-approved',
  ReviewRevise = 'review-revise',
  ReviewRejected = 'review-rejected',
}

// --- Worker → Worker ---

export enum WorkerToWorkerFlag {
  SyncRequest = 'sync-request',
  SyncResponse = 'sync-response',
  HeadsUp = 'heads-up',
}

// --- Union of all flags ---

export type MessageFlag =
  | SupervisorToWorkerFlag
  | WorkerToSupervisorFlag
  | SupervisorToSecurityFlag
  | SecurityToSupervisorFlag
  | WorkerToSecurityFlag
  | SecurityToWorkerFlag
  | SupervisorToReviewerFlag
  | ReviewerToSupervisorFlag
  | WorkerToWorkerFlag;

// --- Route key for validation ---

type RouteKey = `${Role}->${Role}`;

function routeKey(source: Role, target: Role): RouteKey {
  return `${source}->${target}`;
}

// --- Flag validation matrix ---

const FLAG_VALIDATION_MATRIX: Record<string, ReadonlySet<string>> = {
  [routeKey(Role.Supervisor, Role.Worker)]: new Set(
    Object.values(SupervisorToWorkerFlag)
  ),
  [routeKey(Role.Worker, Role.Supervisor)]: new Set(
    Object.values(WorkerToSupervisorFlag)
  ),
  [routeKey(Role.Supervisor, Role.Security)]: new Set(
    Object.values(SupervisorToSecurityFlag)
  ),
  [routeKey(Role.Security, Role.Supervisor)]: new Set(
    Object.values(SecurityToSupervisorFlag)
  ),
  [routeKey(Role.Worker, Role.Security)]: new Set(
    Object.values(WorkerToSecurityFlag)
  ),
  [routeKey(Role.Security, Role.Worker)]: new Set(
    Object.values(SecurityToWorkerFlag)
  ),
  [routeKey(Role.Supervisor, Role.Reviewer)]: new Set(
    Object.values(SupervisorToReviewerFlag)
  ),
  [routeKey(Role.Reviewer, Role.Supervisor)]: new Set(
    Object.values(ReviewerToSupervisorFlag)
  ),
  [routeKey(Role.Worker, Role.Worker)]: new Set(
    Object.values(WorkerToWorkerFlag)
  ),
};

/**
 * Validates that a flag is legal for the given source→target role pair.
 * Returns true if valid, false if the combination is not in the matrix.
 */
export function isValidFlag(
  sourceRole: Role,
  targetRole: Role,
  flag: string
): boolean {
  // Self-sends are never valid (except Worker→Worker)
  if (sourceRole === targetRole && sourceRole !== Role.Worker) {
    return false;
  }

  const key = routeKey(sourceRole, targetRole);
  const validFlags = FLAG_VALIDATION_MATRIX[key];
  if (!validFlags) {
    return false;
  }

  return validFlags.has(flag);
}

/**
 * Returns all legal flags for a given source→target role pair.
 * Returns an empty array if no route exists.
 */
export function getLegalFlags(
  sourceRole: Role,
  targetRole: Role
): readonly string[] {
  const key = routeKey(sourceRole, targetRole);
  const validFlags = FLAG_VALIDATION_MATRIX[key];
  return validFlags ? Array.from(validFlags) : [];
}
