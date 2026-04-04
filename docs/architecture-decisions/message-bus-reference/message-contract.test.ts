import { describe, it, expect } from 'vitest';
import { Phase, Priority, MessageStatus } from '../src/types/index.js';
import { Role } from '../src/roles/role-types.js';
import {
  SupervisorToWorkerFlag,
  WorkerToSupervisorFlag,
  SupervisorToSecurityFlag,
  SecurityToSupervisorFlag,
  WorkerToSecurityFlag,
  SecurityToWorkerFlag,
  SupervisorToReviewerFlag,
  ReviewerToSupervisorFlag,
  WorkerToWorkerFlag,
  isValidFlag,
  getLegalFlags,
} from '../src/router/flag-enums.js';
import {
  type AgentMessage,
  validateMessage,
  messageFileName,
} from '../src/router/message-types.js';

// --- Helper to build a valid message ---

function validMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    messageId: 'msg-00000000-0000-0000-0000-000000000001',
    threadId: 'thread-00000000-0000-0000-0000-000000000001',
    timestamp: '2026-03-07T15:30:00.123Z',
    roleSource: Role.Supervisor,
    roleSourceInstance: 'Supervisor-1',
    roleTarget: Role.Worker,
    roleTargetInstance: 'Worker-1',
    flag: SupervisorToWorkerFlag.TaskAssignment,
    priority: Priority.Normal,
    phase: Phase.PreWork,
    content: 'Implement the auth module',
    references: [],
    requiresResponse: true,
    status: MessageStatus.Pending,
    ...overrides,
  };
}

// =============================================
// Message Validation
// =============================================

describe('validateMessage', () => {
  it('accepts a valid message with no errors', () => {
    const errors = validateMessage(validMessage());
    expect(errors).toEqual([]);
  });

  it('rejects null', () => {
    const errors = validateMessage(null);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('root');
  });

  it('rejects invalid messageId format', () => {
    const errors = validateMessage(validMessage({ messageId: 'bad-id' as any }));
    expect(errors.some((e) => e.field === 'messageId')).toBe(true);
  });

  it('rejects invalid threadId format', () => {
    const errors = validateMessage(
      validMessage({ threadId: 'bad-thread' as any })
    );
    expect(errors.some((e) => e.field === 'threadId')).toBe(true);
  });

  it('rejects invalid timestamp', () => {
    const errors = validateMessage(
      validMessage({ timestamp: 'not-a-date' })
    );
    expect(errors.some((e) => e.field === 'timestamp')).toBe(true);
  });

  it('rejects invalid roleSource', () => {
    const errors = validateMessage(
      validMessage({ roleSource: 'Hacker' as any })
    );
    expect(errors.some((e) => e.field === 'roleSource')).toBe(true);
  });

  it('rejects invalid roleTarget', () => {
    const errors = validateMessage(
      validMessage({ roleTarget: 'Ghost' as any })
    );
    expect(errors.some((e) => e.field === 'roleTarget')).toBe(true);
  });

  it('allows null roleTargetInstance', () => {
    const errors = validateMessage(
      validMessage({ roleTargetInstance: null })
    );
    expect(errors).toEqual([]);
  });

  it('rejects content exceeding 8,000 characters', () => {
    const errors = validateMessage(
      validMessage({ content: 'x'.repeat(8_001) })
    );
    expect(errors.some((e) => e.field === 'content')).toBe(true);
  });

  it('accepts content at exactly 8,000 characters', () => {
    const errors = validateMessage(
      validMessage({ content: 'x'.repeat(8_000) })
    );
    expect(errors).toEqual([]);
  });

  it('rejects references exceeding 20 entries', () => {
    const refs = Array.from({ length: 21 }, (_, i) => `msg-${i}`);
    const errors = validateMessage(validMessage({ references: refs }));
    expect(errors.some((e) => e.field === 'references')).toBe(true);
  });

  it('rejects invalid priority', () => {
    const errors = validateMessage(
      validMessage({ priority: 'urgent' as any })
    );
    expect(errors.some((e) => e.field === 'priority')).toBe(true);
  });

  it('rejects invalid phase', () => {
    const errors = validateMessage(
      validMessage({ phase: 'planning' as any })
    );
    expect(errors.some((e) => e.field === 'phase')).toBe(true);
  });

  it('rejects invalid status', () => {
    const errors = validateMessage(
      validMessage({ status: 'read' as any })
    );
    expect(errors.some((e) => e.field === 'status')).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const errors = validateMessage({
      messageId: 'bad',
      threadId: 'bad',
      timestamp: 'bad',
      roleSource: 'bad',
      roleTarget: 'bad',
      flag: 123,
      priority: 'bad',
      phase: 'bad',
      content: 123,
      references: 'bad',
      requiresResponse: 'yes',
      status: 'bad',
    });
    expect(errors.length).toBeGreaterThanOrEqual(10);
  });
});

// =============================================
// Flag Validation Matrix
// =============================================

describe('isValidFlag', () => {
  // --- Valid routes ---

  it('accepts Supervisor → Worker: task-assignment', () => {
    expect(
      isValidFlag(Role.Supervisor, Role.Worker, SupervisorToWorkerFlag.TaskAssignment)
    ).toBe(true);
  });

  it('accepts all Supervisor → Worker flags', () => {
    for (const flag of Object.values(SupervisorToWorkerFlag)) {
      expect(isValidFlag(Role.Supervisor, Role.Worker, flag)).toBe(true);
    }
  });

  it('accepts all Worker → Supervisor flags', () => {
    for (const flag of Object.values(WorkerToSupervisorFlag)) {
      expect(isValidFlag(Role.Worker, Role.Supervisor, flag)).toBe(true);
    }
  });

  it('accepts all Supervisor → Security flags', () => {
    for (const flag of Object.values(SupervisorToSecurityFlag)) {
      expect(isValidFlag(Role.Supervisor, Role.Security, flag)).toBe(true);
    }
  });

  it('accepts all Security → Supervisor flags', () => {
    for (const flag of Object.values(SecurityToSupervisorFlag)) {
      expect(isValidFlag(Role.Security, Role.Supervisor, flag)).toBe(true);
    }
  });

  it('accepts Worker → Security: clearance-request', () => {
    expect(
      isValidFlag(Role.Worker, Role.Security, WorkerToSecurityFlag.ClearanceRequest)
    ).toBe(true);
  });

  it('accepts all Security → Worker flags', () => {
    for (const flag of Object.values(SecurityToWorkerFlag)) {
      expect(isValidFlag(Role.Security, Role.Worker, flag)).toBe(true);
    }
  });

  it('accepts Supervisor → Reviewer: review-request', () => {
    expect(
      isValidFlag(Role.Supervisor, Role.Reviewer, SupervisorToReviewerFlag.ReviewRequest)
    ).toBe(true);
  });

  it('accepts all Reviewer → Supervisor flags', () => {
    for (const flag of Object.values(ReviewerToSupervisorFlag)) {
      expect(isValidFlag(Role.Reviewer, Role.Supervisor, flag)).toBe(true);
    }
  });

  it('accepts all Worker → Worker flags', () => {
    for (const flag of Object.values(WorkerToWorkerFlag)) {
      expect(isValidFlag(Role.Worker, Role.Worker, flag)).toBe(true);
    }
  });

  // --- Invalid routes ---

  it('rejects Worker → Reviewer (no direct path)', () => {
    expect(
      isValidFlag(Role.Worker, Role.Reviewer, 'review-request')
    ).toBe(false);
  });

  it('rejects Reviewer → Worker (no direct path)', () => {
    expect(
      isValidFlag(Role.Reviewer, Role.Worker, 'task-assignment')
    ).toBe(false);
  });

  it('rejects Reviewer → Security (no direct path)', () => {
    expect(
      isValidFlag(Role.Reviewer, Role.Security, 'scan-request')
    ).toBe(false);
  });

  it('rejects Security → Reviewer (no direct path)', () => {
    expect(
      isValidFlag(Role.Security, Role.Reviewer, 'clearance-report')
    ).toBe(false);
  });

  it('rejects Supervisor → Supervisor (self-send)', () => {
    expect(
      isValidFlag(Role.Supervisor, Role.Supervisor, 'task-assignment')
    ).toBe(false);
  });

  it('rejects Security → Security (self-send)', () => {
    expect(
      isValidFlag(Role.Security, Role.Security, 'security-alert')
    ).toBe(false);
  });

  it('rejects Reviewer → Reviewer (self-send)', () => {
    expect(
      isValidFlag(Role.Reviewer, Role.Reviewer, 'review-approved')
    ).toBe(false);
  });

  it('rejects wrong flag for valid route (Worker sending clearance-report)', () => {
    expect(
      isValidFlag(Role.Worker, Role.Supervisor, 'clearance-report')
    ).toBe(false);
  });

  it('rejects wrong flag for valid route (Security sending task-complete)', () => {
    expect(
      isValidFlag(Role.Security, Role.Supervisor, 'task-complete')
    ).toBe(false);
  });
});

describe('getLegalFlags', () => {
  it('returns 6 flags for Supervisor → Worker', () => {
    const flags = getLegalFlags(Role.Supervisor, Role.Worker);
    expect(flags).toHaveLength(6);
    expect(flags).toContain('task-assignment');
    expect(flags).toContain('revision-request');
  });

  it('returns 7 flags for Worker → Supervisor', () => {
    const flags = getLegalFlags(Role.Worker, Role.Supervisor);
    expect(flags).toHaveLength(7);
  });

  it('returns 3 flags for Worker → Worker', () => {
    const flags = getLegalFlags(Role.Worker, Role.Worker);
    expect(flags).toHaveLength(3);
  });

  it('returns empty for invalid route', () => {
    const flags = getLegalFlags(Role.Worker, Role.Reviewer);
    expect(flags).toEqual([]);
  });
});

// =============================================
// Message Filename
// =============================================

describe('messageFileName', () => {
  it('generates correct filename format', () => {
    const msg = validMessage();
    const name = messageFileName(msg);
    expect(name).toContain('msg-00000000-0000-0000-0000-000000000001.json');
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// =============================================
// Type-level compile checks
// =============================================

describe('type system compile-time checks', () => {
  it('enforces messageId prefix', () => {
    // This compiles:
    const _valid: AgentMessage['messageId'] =
      'msg-00000000-0000-0000-0000-000000000001';
    expect(_valid).toBeDefined();
  });

  it('enforces threadId prefix', () => {
    const _valid: AgentMessage['threadId'] =
      'thread-00000000-0000-0000-0000-000000000001';
    expect(_valid).toBeDefined();
  });

  it('enforces Role enum for roleSource', () => {
    const _valid: AgentMessage['roleSource'] = Role.Supervisor;
    expect(_valid).toBe('Supervisor');
  });

  it('enforces Priority enum', () => {
    const _valid: AgentMessage['priority'] = Priority.Critical;
    expect(_valid).toBe('critical');
  });

  it('enforces Phase enum', () => {
    const _valid: AgentMessage['phase'] = Phase.Review;
    expect(_valid).toBe('review');
  });

  it('enforces MessageStatus enum', () => {
    const _valid: AgentMessage['status'] = MessageStatus.Resolved;
    expect(_valid).toBe('resolved');
  });
});
