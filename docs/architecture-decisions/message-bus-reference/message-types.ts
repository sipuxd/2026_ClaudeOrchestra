// Full message schema as TypeScript interfaces,
// matching the JSON contract in docs/message-contract.md exactly

import { Phase, Priority, MessageStatus } from '../types/index.js';
import { Role, RoleInstance } from '../roles/role-types.js';
import { MessageFlag } from './flag-enums.js';

// --- Core message interface ---

export interface AgentMessage {
  /** Unique identifier. Format: msg-<uuidv4> */
  messageId: `msg-${string}`;

  /** Groups related messages. Format: thread-<uuidv4> */
  threadId: `thread-${string}`;

  /** ISO-8601 timestamp */
  timestamp: string;

  /** Role of the sending agent */
  roleSource: Role;

  /** Specific instance of the sender */
  roleSourceInstance: RoleInstance;

  /** Role of the intended recipient */
  roleTarget: Role;

  /** Specific instance, or null for role-level multicast */
  roleTargetInstance: RoleInstance | null;

  /** Scoped per role pair — drives routing */
  flag: MessageFlag;

  /** Determines surfacing order */
  priority: Priority;

  /** Workflow phase this message belongs to */
  phase: Phase;

  /** Message payload. Max 8,000 characters. */
  content: string;

  /** Links to related message IDs or task IDs */
  references: string[];

  /** If true, system tracks whether a response was received */
  requiresResponse: boolean;

  /** Lifecycle: pending → acknowledged → resolved */
  status: MessageStatus;
}

// --- Type-safe message constructors ---

export interface CreateMessageParams {
  threadId?: `thread-${string}`;
  roleSource: Role;
  roleSourceInstance: RoleInstance;
  roleTarget: Role;
  roleTargetInstance: RoleInstance | null;
  flag: MessageFlag;
  priority: Priority;
  phase: Phase;
  content: string;
  references?: string[];
  requiresResponse: boolean;
}

// --- Message file naming ---

/**
 * Generates the filename for a message file.
 * Format: {timestamp}-{messageId}.json
 */
export function messageFileName(message: AgentMessage): string {
  // Zero-pad the ISO timestamp for consistent sort order
  const ts = message.timestamp.replace(/[:.]/g, '-');
  return `${ts}-${message.messageId}.json`;
}

// --- Validation helpers ---

// Relaxed patterns: agents are LLMs and may generate descriptive IDs
// instead of strict UUIDs. Accept any non-empty string with the correct prefix.
const MSG_ID_PATTERN = /^msg-.+$/;
const THREAD_ID_PATTERN = /^thread-.+$/;

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validates an AgentMessage object against the contract rules.
 * Returns an array of validation errors (empty if valid).
 */
export function validateMessage(msg: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof msg !== 'object' || msg === null) {
    return [{ field: 'root', message: 'Message must be a non-null object' }];
  }

  const m = msg as Record<string, unknown>;

  // messageId
  if (typeof m.messageId !== 'string' || !MSG_ID_PATTERN.test(m.messageId)) {
    errors.push({
      field: 'messageId',
      message: 'Must match format msg-<uuidv4>',
    });
  }

  // threadId
  if (
    typeof m.threadId !== 'string' ||
    !THREAD_ID_PATTERN.test(m.threadId)
  ) {
    errors.push({
      field: 'threadId',
      message: 'Must match format thread-<uuidv4>',
    });
  }

  // timestamp
  if (typeof m.timestamp !== 'string' || isNaN(Date.parse(m.timestamp))) {
    errors.push({
      field: 'timestamp',
      message: 'Must be a valid ISO-8601 timestamp',
    });
  }

  // roleSource
  if (!Object.values(Role).includes(m.roleSource as Role)) {
    errors.push({
      field: 'roleSource',
      message: `Must be one of: ${Object.values(Role).join(', ')}`,
    });
  }

  // roleSourceInstance
  if (typeof m.roleSourceInstance !== 'string') {
    errors.push({
      field: 'roleSourceInstance',
      message: 'Must be a string',
    });
  }

  // roleTarget
  if (!Object.values(Role).includes(m.roleTarget as Role)) {
    errors.push({
      field: 'roleTarget',
      message: `Must be one of: ${Object.values(Role).join(', ')}`,
    });
  }

  // roleTargetInstance — can be null
  if (m.roleTargetInstance !== null && typeof m.roleTargetInstance !== 'string') {
    errors.push({
      field: 'roleTargetInstance',
      message: 'Must be a string or null',
    });
  }

  // flag
  if (typeof m.flag !== 'string') {
    errors.push({ field: 'flag', message: 'Must be a string' });
  }

  // priority
  if (!Object.values(Priority).includes(m.priority as Priority)) {
    errors.push({
      field: 'priority',
      message: `Must be one of: ${Object.values(Priority).join(', ')}`,
    });
  }

  // phase
  if (!Object.values(Phase).includes(m.phase as Phase)) {
    errors.push({
      field: 'phase',
      message: `Must be one of: ${Object.values(Phase).join(', ')}`,
    });
  }

  // content
  if (typeof m.content !== 'string') {
    errors.push({ field: 'content', message: 'Must be a string' });
  } else if (m.content.length > 8_000) {
    errors.push({
      field: 'content',
      message: `Exceeds max length of 8,000 characters (got ${m.content.length})`,
    });
  }

  // references
  if (!Array.isArray(m.references)) {
    errors.push({ field: 'references', message: 'Must be an array' });
  } else if (m.references.length > 20) {
    errors.push({
      field: 'references',
      message: `Exceeds max of 20 entries (got ${m.references.length})`,
    });
  }

  // requiresResponse
  if (typeof m.requiresResponse !== 'boolean') {
    errors.push({
      field: 'requiresResponse',
      message: 'Must be a boolean',
    });
  }

  // status
  if (!Object.values(MessageStatus).includes(m.status as MessageStatus)) {
    errors.push({
      field: 'status',
      message: `Must be one of: ${Object.values(MessageStatus).join(', ')}`,
    });
  }

  return errors;
}
