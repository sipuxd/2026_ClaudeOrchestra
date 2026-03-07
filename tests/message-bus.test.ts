import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Phase, Priority, MessageStatus } from '../src/types/index.js';
import { Role, type RoleInstance } from '../src/roles/role-types.js';
import {
  SupervisorToWorkerFlag,
  WorkerToSupervisorFlag,
  SupervisorToSecurityFlag,
  SecurityToSupervisorFlag,
  WorkerToWorkerFlag,
  SupervisorToReviewerFlag,
  ReviewerToSupervisorFlag,
} from '../src/router/flag-enums.js';
import { type AgentMessage } from '../src/router/message-types.js';
import { MessageBus, MessageBusError } from '../src/router/message-bus.js';

// --- Test helpers ---

let testDir: string;
let bus: MessageBus;

function tmpDir(): string {
  return path.join('/private/tmp/claude-501', `test-bus-${randomUUID()}`);
}

beforeEach(() => {
  testDir = tmpDir();
  bus = new MessageBus({ teamDir: testDir });
  bus.init();
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function createTestMessage(
  overrides: Partial<Parameters<MessageBus['createMessage']>[0]> = {}
): AgentMessage {
  return bus.createMessage({
    roleSource: Role.Supervisor,
    roleSourceInstance: 'Supervisor-1',
    roleTarget: Role.Worker,
    roleTargetInstance: 'Worker-1',
    flag: SupervisorToWorkerFlag.TaskAssignment,
    priority: Priority.Normal,
    phase: Phase.PreWork,
    content: 'Test message',
    requiresResponse: true,
    ...overrides,
  });
}

// =============================================
// send + receive
// =============================================

describe('send and receive', () => {
  it('sends a message and receives it from the target inbox', () => {
    const msg = createTestMessage();
    bus.send(msg);

    const received = bus.receive('Worker-1');
    expect(received).toHaveLength(1);
    expect(received[0].messageId).toBe(msg.messageId);
    expect(received[0].content).toBe('Test message');
    expect(received[0].status).toBe(MessageStatus.Pending);
  });

  it('returns messages sorted by timestamp ascending', () => {
    const msg1 = createTestMessage({ content: 'First' });
    msg1.timestamp = '2026-03-07T10:00:00.000Z';

    const msg2 = createTestMessage({ content: 'Second' });
    msg2.timestamp = '2026-03-07T10:00:01.000Z';

    const msg3 = createTestMessage({ content: 'Third' });
    msg3.timestamp = '2026-03-07T10:00:02.000Z';

    // Send out of order
    bus.send(msg3);
    bus.send(msg1);
    bus.send(msg2);

    const received = bus.receive('Worker-1');
    expect(received).toHaveLength(3);
    expect(received[0].content).toBe('First');
    expect(received[1].content).toBe('Second');
    expect(received[2].content).toBe('Third');
  });

  it('receive returns empty array for inbox with no messages', () => {
    const received = bus.receive('Worker-2');
    expect(received).toEqual([]);
  });

  it('multicasts when roleTargetInstance is null', () => {
    const msg = createTestMessage({ roleTargetInstance: null });
    bus.send(msg);

    const worker1 = bus.receive('Worker-1');
    const worker2 = bus.receive('Worker-2');
    expect(worker1).toHaveLength(1);
    expect(worker2).toHaveLength(1);
    expect(worker1[0].messageId).toBe(msg.messageId);
    expect(worker2[0].messageId).toBe(msg.messageId);
  });

  it('does not deliver to other roles on multicast', () => {
    const msg = createTestMessage({ roleTargetInstance: null });
    bus.send(msg);

    const supervisor = bus.receive('Supervisor-1');
    expect(supervisor).toHaveLength(0);
  });
});

// =============================================
// Validation
// =============================================

describe('send validation', () => {
  it('rejects messages with invalid flag for the route', () => {
    const msg = createTestMessage();
    // Worker→Supervisor flag on a Supervisor→Worker message
    (msg as any).flag = 'task-accepted';

    expect(() => bus.send(msg)).toThrow(MessageBusError);
    expect(() => bus.send(msg)).toThrow('Invalid flag');
  });

  it('rejects messages with invalid schema', () => {
    const msg = createTestMessage();
    (msg as any).messageId = 'bad-id';

    expect(() => bus.send(msg)).toThrow(MessageBusError);
  });

  it('rejects messages exceeding 16KB total size', () => {
    const msg = createTestMessage({ content: 'x'.repeat(7999) });
    // Force a huge references array to push over 16KB
    msg.references = Array.from({ length: 20 }, () => 'x'.repeat(500));

    expect(() => bus.send(msg)).toThrow('max size');
  });
});

// =============================================
// Deduplication
// =============================================

describe('deduplication', () => {
  it('silently skips duplicate messageIds', () => {
    const msg = createTestMessage();
    bus.send(msg);
    bus.send(msg); // Duplicate

    const received = bus.receive('Worker-1');
    expect(received).toHaveLength(1);
  });

  it('rebuilds dedup set on init from existing messages', () => {
    const msg = createTestMessage();
    bus.send(msg);

    // Create new bus instance pointing at same directory
    const bus2 = new MessageBus({ teamDir: testDir });
    bus2.init(); // Should rebuild dedup set

    bus2.send(msg); // Should be silently skipped

    const received = bus2.receive('Worker-1');
    expect(received).toHaveLength(1);
  });
});

// =============================================
// acknowledge
// =============================================

describe('acknowledge', () => {
  it('moves message from inbox to archive and updates status', () => {
    const msg = createTestMessage();
    bus.send(msg);

    bus.acknowledge(msg.messageId, 'Worker-1');

    // Inbox should be empty
    const inbox = bus.receive('Worker-1');
    expect(inbox).toHaveLength(0);

    // Archive should have the message with updated status
    const archiveDir = path.join(testDir, 'messages', 'archive');
    const archiveFiles = fs.readdirSync(archiveDir)
      .filter((f) => f.endsWith('.json'));
    expect(archiveFiles).toHaveLength(1);

    const archived = JSON.parse(
      fs.readFileSync(path.join(archiveDir, archiveFiles[0]), 'utf-8')
    );
    expect(archived.messageId).toBe(msg.messageId);
    expect(archived.status).toBe(MessageStatus.Acknowledged);
  });

  it('does nothing if messageId not found', () => {
    bus.acknowledge('msg-00000000-0000-0000-0000-000000000099', 'Worker-1');
    // No error thrown
  });
});

// =============================================
// Threading
// =============================================

describe('getThread', () => {
  it('retrieves all messages in a thread across inboxes', () => {
    const threadId = `thread-${randomUUID()}` as const;

    const msg1 = createTestMessage({ threadId });
    msg1.timestamp = '2026-03-07T10:00:00.000Z';

    const msg2 = bus.createMessage({
      threadId,
      roleSource: Role.Worker,
      roleSourceInstance: 'Worker-1',
      roleTarget: Role.Supervisor,
      roleTargetInstance: 'Supervisor-1',
      flag: WorkerToSupervisorFlag.TaskAccepted,
      priority: Priority.Low,
      phase: Phase.PreWork,
      content: 'Accepted',
      requiresResponse: false,
    });
    msg2.timestamp = '2026-03-07T10:00:01.000Z';

    bus.send(msg1);
    bus.send(msg2);

    const thread = bus.getThread(threadId);
    expect(thread).toHaveLength(2);
    expect(thread[0].messageId).toBe(msg1.messageId);
    expect(thread[1].messageId).toBe(msg2.messageId);
  });

  it('includes archived messages in thread', () => {
    const threadId = `thread-${randomUUID()}` as const;
    const msg = createTestMessage({ threadId });
    bus.send(msg);
    bus.acknowledge(msg.messageId, 'Worker-1');

    const thread = bus.getThread(threadId);
    expect(thread).toHaveLength(1);
    expect(thread[0].messageId).toBe(msg.messageId);
  });

  it('deduplicates multicast messages in thread results', () => {
    const threadId = `thread-${randomUUID()}` as const;
    const msg = createTestMessage({
      threadId,
      roleTargetInstance: null,
    });
    bus.send(msg);

    const thread = bus.getThread(threadId);
    expect(thread).toHaveLength(1);
  });

  it('returns empty for unknown threadId', () => {
    const thread = bus.getThread(`thread-${randomUUID()}`);
    expect(thread).toEqual([]);
  });
});

// =============================================
// getPending
// =============================================

describe('getPending', () => {
  it('finds messages with requiresResponse=true and status!=resolved', () => {
    const msg1 = createTestMessage({ requiresResponse: true });
    const msg2 = createTestMessage({ requiresResponse: false });
    bus.send(msg1);
    bus.send(msg2);

    const pending = bus.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].messageId).toBe(msg1.messageId);
  });

  it('includes acknowledged-but-unresolved messages', () => {
    const msg = createTestMessage({ requiresResponse: true });
    bus.send(msg);
    bus.acknowledge(msg.messageId, 'Worker-1');

    const pending = bus.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe(MessageStatus.Acknowledged);
  });

  it('excludes resolved messages', () => {
    const msg = createTestMessage({ requiresResponse: true });
    bus.send(msg);
    bus.resolve(msg.messageId);

    const pending = bus.getPending();
    expect(pending).toHaveLength(0);
  });
});

// =============================================
// resolve
// =============================================

describe('resolve', () => {
  it('marks a message as resolved in inbox', () => {
    const msg = createTestMessage({ requiresResponse: true });
    bus.send(msg);
    bus.resolve(msg.messageId);

    const received = bus.receive('Worker-1');
    expect(received[0].status).toBe(MessageStatus.Resolved);
  });

  it('marks a message as resolved in archive', () => {
    const msg = createTestMessage({ requiresResponse: true });
    bus.send(msg);
    bus.acknowledge(msg.messageId, 'Worker-1');
    bus.resolve(msg.messageId);

    const pending = bus.getPending();
    expect(pending).toHaveLength(0);
  });
});

// =============================================
// Atomic writes / temp file cleanup
// =============================================

describe('atomic writes and temp file cleanup', () => {
  it('cleans orphaned temp files on init', () => {
    const inboxPath = path.join(testDir, 'messages', 'inbox', 'Worker-1');
    // Simulate orphaned temp file
    fs.writeFileSync(path.join(inboxPath, '.tmp-orphan.json'), '{}');

    // Re-init should clean it
    bus.init();

    const files = fs.readdirSync(inboxPath);
    expect(files.filter((f) => f.startsWith('.tmp-'))).toHaveLength(0);
  });

  it('receive ignores temp files', () => {
    const inboxPath = path.join(testDir, 'messages', 'inbox', 'Worker-1');
    fs.writeFileSync(
      path.join(inboxPath, '.tmp-inprogress.json'),
      JSON.stringify(createTestMessage())
    );

    const received = bus.receive('Worker-1');
    expect(received).toHaveLength(0);
  });
});

// =============================================
// Concurrent write simulation
// =============================================

describe('concurrent writes', () => {
  it('handles multiple agents writing to same inbox simultaneously', () => {
    const messages: AgentMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(
        bus.createMessage({
          roleSource: Role.Supervisor,
          roleSourceInstance: 'Supervisor-1',
          roleTarget: Role.Worker,
          roleTargetInstance: 'Worker-1',
          flag: SupervisorToWorkerFlag.CheckIn,
          priority: Priority.Normal,
          phase: Phase.Work,
          content: `Message ${i}`,
          requiresResponse: true,
        })
      );
    }

    // Send all messages (simulating concurrent writes)
    for (const msg of messages) {
      bus.send(msg);
    }

    const received = bus.receive('Worker-1');
    expect(received).toHaveLength(10);
  });

  it('handles writes to different inboxes simultaneously', () => {
    const toWorker1 = createTestMessage({
      roleTargetInstance: 'Worker-1',
      content: 'To Worker 1',
    });
    const toWorker2 = createTestMessage({
      roleTargetInstance: 'Worker-2',
      content: 'To Worker 2',
    });

    bus.send(toWorker1);
    bus.send(toWorker2);

    expect(bus.receive('Worker-1')).toHaveLength(1);
    expect(bus.receive('Worker-2')).toHaveLength(1);
  });
});

// =============================================
// Full lifecycle
// =============================================

describe('full message lifecycle', () => {
  it('pending → acknowledged → resolved', () => {
    const msg = createTestMessage({ requiresResponse: true });

    // Send (pending)
    bus.send(msg);
    let received = bus.receive('Worker-1');
    expect(received[0].status).toBe(MessageStatus.Pending);

    // Acknowledge
    bus.acknowledge(msg.messageId, 'Worker-1');
    let pending = bus.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe(MessageStatus.Acknowledged);

    // Resolve
    bus.resolve(msg.messageId);
    pending = bus.getPending();
    expect(pending).toHaveLength(0);
  });
});

// =============================================
// createMessage helper
// =============================================

describe('createMessage', () => {
  it('generates valid messageId and threadId', () => {
    const msg = createTestMessage();
    expect(msg.messageId).toMatch(/^msg-/);
    expect(msg.threadId).toMatch(/^thread-/);
  });

  it('uses provided threadId if given', () => {
    const threadId = `thread-${randomUUID()}` as const;
    const msg = createTestMessage({ threadId });
    expect(msg.threadId).toBe(threadId);
  });

  it('sets status to pending', () => {
    const msg = createTestMessage();
    expect(msg.status).toBe(MessageStatus.Pending);
  });

  it('generates ISO timestamp', () => {
    const msg = createTestMessage();
    expect(new Date(msg.timestamp).toISOString()).toBe(msg.timestamp);
  });
});
