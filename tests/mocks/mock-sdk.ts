// Mock SDK for testing SubagentOrchestrator.
// Provides a controllable fake query() function that simulates
// the Claude Agent SDK's async generator behavior.

import type { HookCallback, HookInput } from '@anthropic-ai/claude-agent-sdk';

// --- Mock SDK Message types ---

export interface MockSDKMessage {
  type: 'assistant' | 'result' | 'system';
  content?: Array<{ type: string; text: string }>;
  result?: string;
}

// --- Mock Query ---

export interface MockQueryControls {
  /** Emit a message to the stream consumer */
  emit(msg: MockSDKMessage): void;
  /** Simulate subagent start (triggers SubagentStart hook) */
  simulateSubagentStart(agentType: string, agentId?: string): Promise<void>;
  /** Simulate subagent stop (triggers SubagentStop hook) */
  simulateSubagentStop(agentType: string, agentId?: string): Promise<void>;
  /** Complete the stream (resolve the generator) */
  complete(): void;
  /** Fail the stream with an error */
  fail(error: Error): void;
  /** Access recorded options from query() call */
  readonly options: Record<string, unknown>;
}

/** Create a mock query function and its controls. */
export function createMockQuery(): {
  mockQueryFn: typeof import('@anthropic-ai/claude-agent-sdk').query;
  controls: MockQueryControls;
} {
  let resolveNext: ((value: IteratorResult<any, void>) => void) | null = null;
  let rejectNext: ((reason: any) => void) | null = null;
  const pendingMessages: any[] = [];
  let completed = false;
  let error: Error | null = null;
  let recordedOptions: Record<string, unknown> = {};
  let hooks: Record<string, Array<{ hooks: HookCallback[] }>> = {};

  // Create the async generator
  async function* mockGenerator(): AsyncGenerator<any, void> {
    while (true) {
      if (error) throw error;
      if (pendingMessages.length > 0) {
        yield pendingMessages.shift();
        continue;
      }
      if (completed) return;

      // Wait for next message
      const result = await new Promise<IteratorResult<any, void>>((resolve, reject) => {
        resolveNext = resolve;
        rejectNext = reject;
      });
      resolveNext = null;
      rejectNext = null;

      if (result.done) return;
      yield result.value;
    }
  }

  const controls: MockQueryControls = {
    emit(msg: MockSDKMessage): void {
      if (resolveNext) {
        resolveNext({ value: msg, done: false });
      } else {
        pendingMessages.push(msg);
      }
    },

    async simulateSubagentStart(agentType: string, agentId?: string): Promise<void> {
      const hookMatchers = hooks.SubagentStart;
      if (!hookMatchers) return;

      const input: Partial<HookInput> = {
        hook_event_name: 'SubagentStart',
        session_id: 'mock-session',
        agent_type: agentType,
        agent_id: agentId ?? `${agentType}-${Date.now()}`,
      };

      for (const matcher of hookMatchers) {
        for (const hook of matcher.hooks) {
          await hook(input as HookInput, undefined, {
            signal: new AbortController().signal,
          });
        }
      }
    },

    async simulateSubagentStop(agentType: string, agentId?: string): Promise<void> {
      const hookMatchers = hooks.SubagentStop;
      if (!hookMatchers) return;

      const input: Partial<HookInput> = {
        hook_event_name: 'SubagentStop',
        session_id: 'mock-session',
        stop_hook_active: false,
        agent_type: agentType,
        agent_id: agentId ?? `${agentType}-${Date.now()}`,
        agent_transcript_path: '/tmp/mock-transcript.jsonl',
      };

      for (const matcher of hookMatchers) {
        for (const hook of matcher.hooks) {
          await hook(input as HookInput, undefined, {
            signal: new AbortController().signal,
          });
        }
      }
    },

    complete(): void {
      completed = true;
      if (resolveNext) {
        resolveNext({ value: undefined, done: true });
      }
    },

    fail(err: Error): void {
      error = err;
      if (rejectNext) {
        rejectNext(err);
      }
    },

    get options(): Record<string, unknown> {
      return recordedOptions;
    },
  };

  // Mock query function
  const mockQueryFn = (params: { prompt: string | any; options?: any }) => {
    recordedOptions = params.options ?? {};

    // Capture hooks for simulation
    if (recordedOptions.hooks) {
      hooks = recordedOptions.hooks as Record<string, Array<{ hooks: HookCallback[] }>>;
    }

    // Return the async generator with Query-like methods
    const generator = mockGenerator();
    const queryObj = Object.assign(generator, {
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      setMaxThinkingTokens: async () => {},
      initializationResult: async () => ({}),
      supportedCommands: async () => [],
      supportedModels: async () => [],
      supportedAgents: async () => [],
      mcpServerStatus: async () => [],
      accountInfo: async () => ({}),
      rewindFiles: async () => ({ canRewind: false }),
      reconnectMcpServer: async () => {},
      toggleMcpServer: async () => {},
      setMcpServers: async () => ({ added: [], removed: [], errors: [] }),
      streamInput: async () => {},
      stopTask: async () => {},
      close: () => {
        completed = true;
        if (resolveNext) {
          resolveNext({ value: undefined, done: true });
        }
      },
    });

    return queryObj;
  };

  return {
    mockQueryFn: mockQueryFn as any,
    controls,
  };
}
