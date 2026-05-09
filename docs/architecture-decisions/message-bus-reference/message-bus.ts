// Filesystem-based message bus for inter-agent communication.
// Messages are written as individual JSON files to agent inbox directories.
// Uses temp-file + rename for atomic writes. Deduplicates by messageId.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Phase, Priority, MessageStatus, MAX_CONTENT_LENGTH, MAX_REFERENCES, MAX_MESSAGE_SIZE_BYTES } from '../types/index.js';
import { Role, RoleInstance, ROLE_INSTANCES } from '../roles/role-types.js';
import { isValidFlag, type MessageFlag } from './flag-enums.js';
import { type AgentMessage, type CreateMessageParams, validateMessage, messageFileName } from './message-types.js';

export interface MessageBusOptions {
  /** Root data directory (e.g., data/teams/{team-id}) */
  teamDir: string;
}

export class MessageBus {
  private readonly inboxDir: string;
  private readonly archiveDir: string;
  private readonly processedIds: Set<string> = new Set();

  constructor(private readonly options: MessageBusOptions) {
    this.inboxDir = path.join(options.teamDir, 'messages', 'inbox');
    this.archiveDir = path.join(options.teamDir, 'messages', 'archive');
  }

  /**
   * Initialize the bus: create directories, rebuild dedup set,
   * clean up orphaned temp files from previous sessions.
   */
  init(): void {
    // Create inbox directories for all role instances
    for (const instances of Object.values(ROLE_INSTANCES)) {
      for (const instance of instances) {
        fs.mkdirSync(path.join(this.inboxDir, instance), { recursive: true });
      }
    }
    fs.mkdirSync(this.archiveDir, { recursive: true });

    // Rebuild dedup set from existing messages
    this.rebuildDedupSet();

    // Clean orphaned temp files
    this.cleanTempFiles();
  }

  /**
   * Create a new AgentMessage from params, generating messageId and timestamp.
   */
  createMessage(params: CreateMessageParams): AgentMessage {
    return {
      messageId: `msg-${randomUUID()}`,
      threadId: params.threadId ?? `thread-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      roleSource: params.roleSource,
      roleSourceInstance: params.roleSourceInstance,
      roleTarget: params.roleTarget,
      roleTargetInstance: params.roleTargetInstance,
      flag: params.flag,
      priority: params.priority,
      phase: params.phase,
      content: params.content,
      references: params.references ?? [],
      requiresResponse: params.requiresResponse,
      status: MessageStatus.Pending,
    };
  }

  /**
   * Write a message to the target agent's inbox directory.
   * Validates the message against the contract and flag matrix.
   * Uses temp-file + rename for atomic writes.
   */
  send(message: AgentMessage): void {
    // Validate message schema
    const errors = validateMessage(message);
    if (errors.length > 0) {
      throw new MessageBusError(
        `Invalid message: ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`,
        'VALIDATION_ERROR'
      );
    }

    // Validate flag against role pair
    if (!isValidFlag(message.roleSource, message.roleTarget, message.flag)) {
      throw new MessageBusError(
        `Invalid flag "${message.flag}" for route ${message.roleSource} → ${message.roleTarget}`,
        'INVALID_FLAG_ROUTE'
      );
    }

    // Check total message size
    const json = JSON.stringify(message);
    if (Buffer.byteLength(json, 'utf-8') > MAX_MESSAGE_SIZE_BYTES) {
      throw new MessageBusError(
        `Message exceeds max size of ${MAX_MESSAGE_SIZE_BYTES} bytes`,
        'SIZE_LIMIT_EXCEEDED'
      );
    }

    // Deduplication check
    if (this.processedIds.has(message.messageId)) {
      return; // Silently skip duplicates
    }

    // Determine target inboxes (multicast if roleTargetInstance is null)
    const targetInstances = message.roleTargetInstance
      ? [message.roleTargetInstance]
      : ROLE_INSTANCES[message.roleTarget];

    const fileName = messageFileName(message);

    for (const instance of targetInstances) {
      const inboxPath = path.join(this.inboxDir, instance);
      const finalPath = path.join(inboxPath, fileName);
      const tmpPath = path.join(inboxPath, `.tmp-${randomUUID()}.json`);

      // Atomic write: temp file → rename
      fs.writeFileSync(tmpPath, json, 'utf-8');
      fs.renameSync(tmpPath, finalPath);
    }

    this.processedIds.add(message.messageId);
  }

  /**
   * Read and return all pending messages from an agent's inbox,
   * sorted by timestamp ascending (oldest first).
   */
  receive(roleInstance: RoleInstance): AgentMessage[] {
    const inboxPath = path.join(this.inboxDir, roleInstance);
    if (!fs.existsSync(inboxPath)) {
      return [];
    }

    const files = fs.readdirSync(inboxPath)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.tmp-'))
      .sort(); // Filename format ensures chronological sort

    const messages: AgentMessage[] = [];
    for (const file of files) {
      const filePath = path.join(inboxPath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const msg = JSON.parse(content) as AgentMessage;
        messages.push(msg);
      } catch {
        // Skip malformed files — they'll be handled by the engine's
        // malformed output protocol
      }
    }

    return messages;
  }

  /**
   * Move a message from its inbox to the archive directory.
   * Updates the message status to 'acknowledged'.
   */
  acknowledge(messageId: string, roleInstance: RoleInstance): void {
    const inboxPath = path.join(this.inboxDir, roleInstance);
    if (!fs.existsSync(inboxPath)) {
      return;
    }

    const files = fs.readdirSync(inboxPath)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.tmp-'));

    for (const file of files) {
      const filePath = path.join(inboxPath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const msg = JSON.parse(content) as AgentMessage;
        if (msg.messageId === messageId) {
          // Update status
          msg.status = MessageStatus.Acknowledged;
          const archivePath = path.join(this.archiveDir, file);
          // Atomic write to archive, then remove from inbox
          const tmpPath = path.join(this.archiveDir, `.tmp-${randomUUID()}.json`);
          fs.writeFileSync(tmpPath, JSON.stringify(msg), 'utf-8');
          fs.renameSync(tmpPath, archivePath);
          fs.unlinkSync(filePath);
          return;
        }
      } catch {
        // Skip malformed files
      }
    }
  }

  /**
   * Retrieve all messages in a thread across all inboxes and archives.
   * Returns messages sorted by timestamp ascending.
   */
  getThread(threadId: string): AgentMessage[] {
    const messages: AgentMessage[] = [];

    // Scan all inboxes
    for (const instances of Object.values(ROLE_INSTANCES)) {
      for (const instance of instances) {
        const inboxPath = path.join(this.inboxDir, instance);
        messages.push(...this.scanDirForThread(inboxPath, threadId));
      }
    }

    // Scan archive
    messages.push(...this.scanDirForThread(this.archiveDir, threadId));

    // Deduplicate (multicast messages appear in multiple inboxes)
    const seen = new Set<string>();
    const deduped = messages.filter((m) => {
      if (seen.has(m.messageId)) return false;
      seen.add(m.messageId);
      return true;
    });

    // Sort by timestamp, then messageId for deterministic ordering
    return deduped.sort((a, b) => {
      const cmp = a.timestamp.localeCompare(b.timestamp);
      return cmp !== 0 ? cmp : a.messageId.localeCompare(b.messageId);
    });
  }

  /**
   * Find all messages where requiresResponse is true and status is not resolved.
   * Used for stuck detection and timeout monitoring.
   */
  getPending(): AgentMessage[] {
    const messages: AgentMessage[] = [];

    // Scan all inboxes
    for (const instances of Object.values(ROLE_INSTANCES)) {
      for (const instance of instances) {
        const inboxPath = path.join(this.inboxDir, instance);
        messages.push(...this.scanDirForPending(inboxPath));
      }
    }

    // Also scan archive for acknowledged-but-unresolved messages
    messages.push(...this.scanDirForPending(this.archiveDir));

    // Deduplicate
    const seen = new Set<string>();
    return messages.filter((m) => {
      if (seen.has(m.messageId)) return false;
      seen.add(m.messageId);
      return true;
    });
  }

  /**
   * Mark a message as resolved (no further action needed).
   * Searches both inboxes and archive.
   */
  resolve(messageId: string): void {
    // Check archive first (most likely location for resolved messages)
    if (this.updateStatusInDir(this.archiveDir, messageId, MessageStatus.Resolved)) {
      return;
    }

    // Check all inboxes
    for (const instances of Object.values(ROLE_INSTANCES)) {
      for (const instance of instances) {
        const inboxPath = path.join(this.inboxDir, instance);
        if (this.updateStatusInDir(inboxPath, messageId, MessageStatus.Resolved)) {
          return;
        }
      }
    }
  }

  // --- Private helpers ---

  private rebuildDedupSet(): void {
    // Scan all inboxes
    for (const instances of Object.values(ROLE_INSTANCES)) {
      for (const instance of instances) {
        const inboxPath = path.join(this.inboxDir, instance);
        this.extractIdsFromDir(inboxPath);
      }
    }
    // Scan archive
    this.extractIdsFromDir(this.archiveDir);
  }

  private extractIdsFromDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.tmp-'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const msg = JSON.parse(content) as AgentMessage;
        this.processedIds.add(msg.messageId);
      } catch {
        // Skip malformed files
      }
    }
  }

  private cleanTempFiles(): void {
    const dirsToClean = [this.archiveDir];
    for (const instances of Object.values(ROLE_INSTANCES)) {
      for (const instance of instances) {
        dirsToClean.push(path.join(this.inboxDir, instance));
      }
    }

    for (const dir of dirsToClean) {
      if (!fs.existsSync(dir)) continue;
      const tmpFiles = fs.readdirSync(dir).filter((f) => f.startsWith('.tmp-'));
      for (const file of tmpFiles) {
        try {
          fs.unlinkSync(path.join(dir, file));
        } catch {
          // Best effort cleanup
        }
      }
    }
  }

  private scanDirForThread(dir: string, threadId: string): AgentMessage[] {
    if (!fs.existsSync(dir)) return [];
    const results: AgentMessage[] = [];
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.tmp-'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const msg = JSON.parse(content) as AgentMessage;
        if (msg.threadId === threadId) {
          results.push(msg);
        }
      } catch {
        // Skip
      }
    }
    return results;
  }

  private scanDirForPending(dir: string): AgentMessage[] {
    if (!fs.existsSync(dir)) return [];
    const results: AgentMessage[] = [];
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.tmp-'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const msg = JSON.parse(content) as AgentMessage;
        if (msg.requiresResponse && msg.status !== MessageStatus.Resolved) {
          results.push(msg);
        }
      } catch {
        // Skip
      }
    }
    return results;
  }

  private updateStatusInDir(
    dir: string,
    messageId: string,
    status: MessageStatus
  ): boolean {
    if (!fs.existsSync(dir)) return false;
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.tmp-'));
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const msg = JSON.parse(content) as AgentMessage;
        if (msg.messageId === messageId) {
          msg.status = status;
          const tmpPath = path.join(dir, `.tmp-${randomUUID()}.json`);
          fs.writeFileSync(tmpPath, JSON.stringify(msg), 'utf-8');
          fs.renameSync(tmpPath, filePath);
          return true;
        }
      } catch {
        // Skip
      }
    }
    return false;
  }
}

// --- Error type ---

export type MessageBusErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_FLAG_ROUTE'
  | 'SIZE_LIMIT_EXCEEDED';

export class MessageBusError extends Error {
  constructor(
    message: string,
    public readonly code: MessageBusErrorCode
  ) {
    super(message);
    this.name = 'MessageBusError';
  }
}
