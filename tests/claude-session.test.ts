import { describe, expect, it, vi } from 'vitest';

// Controllable mock of the Claude Agent SDK query(). Tests push raw SDK messages
// (assistant / result) and complete the stream to drive ClaudeAgentSession.
let pushMsg: ((m: unknown) => void) | null = null;
let finish: (() => void) | null = null;

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => {
    const pending: unknown[] = [];
    let resolveNext: ((v: IteratorResult<unknown>) => void) | null = null;
    let done = false;

    pushMsg = (m: unknown) => {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: m, done: false });
      } else {
        pending.push(m);
      }
    };
    finish = () => {
      done = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: undefined as unknown, done: true });
      }
    };

    async function* gen(): AsyncGenerator<unknown> {
      while (true) {
        if (pending.length > 0) {
          yield pending.shift();
          continue;
        }
        if (done) return;
        const r = await new Promise<IteratorResult<unknown>>((res) => {
          resolveNext = res;
        });
        if (r.done) return;
        yield r.value;
      }
    }

    return Object.assign(gen(), { close: () => finish?.() });
  }),
}));

import { ClaudeAgentSession } from '../src/agent-runtime/claude-session.js';

function makeSession() {
  return new ClaudeAgentSession('Test', 'system prompt', {
    runtime: { provider: 'claude', auth: 'subscription' },
    cwd: '/tmp',
    effort: 'medium',
  });
}

function assistant(text: string) {
  return { type: 'assistant', message: { content: [{ type: 'text', text }] } };
}
function result(text: string) {
  return { type: 'result', subtype: 'success', result: text };
}

describe('ClaudeAgentSession response assembly', () => {
  it('does not duplicate the response when the result repeats the assistant text', async () => {
    const s = makeSession();
    const p = s.send('hi');
    await new Promise((r) => setTimeout(r, 10));
    // The SDK streams the assistant text, then a result message whose `result`
    // field repeats that same final text — the doubling scenario.
    pushMsg?.(assistant('APPROVED — looks good'));
    pushMsg?.(result('APPROVED — looks good'));
    expect(await p).toBe('APPROVED — looks good');
    s.close();
  });

  it('joins multiple assistant blocks without repeating the final one', async () => {
    const s = makeSession();
    const p = s.send('hi');
    await new Promise((r) => setTimeout(r, 10));
    pushMsg?.(assistant('step one\n'));
    pushMsg?.(assistant('COMPLETE — done'));
    pushMsg?.(result('COMPLETE — done'));
    expect(await p).toBe('step one\nCOMPLETE — done');
    s.close();
  });

  it('falls back to the result text when no assistant text streamed', async () => {
    const s = makeSession();
    const p = s.send('hi');
    await new Promise((r) => setTimeout(r, 10));
    pushMsg?.(result('ONLY RESULT TEXT'));
    expect(await p).toBe('ONLY RESULT TEXT');
    s.close();
  });

  it('emits onProgress for a result-only turn (no assistant text streamed)', async () => {
    const progress: string[] = [];
    const s = new ClaudeAgentSession('Test', 'system prompt', {
      runtime: { provider: 'claude', auth: 'subscription' },
      cwd: '/tmp',
      effort: 'medium',
      onProgress: (acc) => progress.push(acc),
    });
    const p = s.send('hi');
    await new Promise((r) => setTimeout(r, 10));
    pushMsg?.(result('FINAL VIA RESULT'));
    await p;
    expect(progress).toContain('FINAL VIA RESULT');
    s.close();
  });

  it('settles an in-flight send() when the stream is closed (no hang)', async () => {
    const s = makeSession();
    const p = s.send('hi');
    await new Promise((r) => setTimeout(r, 10));
    // Close the query mid-turn (e.g. Stop) — the stream ends with no result.
    s.close();
    // Must resolve rather than hang forever.
    await expect(
      Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('hang')), 1000))]),
    ).resolves.toBeDefined();
  });
});
