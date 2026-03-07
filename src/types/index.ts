// Shared enums and base types for ClaudeOrchestra

// --- Workflow Phases ---

export enum Phase {
  PreWork = 'pre-work',
  Work = 'work',
  Handoff = 'handoff',
  Review = 'review',
}

// --- Message Priority ---

export enum Priority {
  Low = 'low',
  Normal = 'normal',
  High = 'high',
  Critical = 'critical',
}

// --- Message Status Lifecycle ---

export enum MessageStatus {
  Pending = 'pending',
  Acknowledged = 'acknowledged',
  Resolved = 'resolved',
}

// --- Agent States ---

export enum AgentState {
  Spawning = 'spawning',
  Active = 'active',
  Idle = 'idle',
  Blocked = 'blocked',
  Waiting = 'waiting',
  Done = 'done',
  Errored = 'errored',
}

// --- Size Limits ---

export const MAX_CONTENT_LENGTH = 8_000;
export const MAX_REFERENCES = 20;
export const MAX_MESSAGE_SIZE_BYTES = 16_384; // 16 KB
