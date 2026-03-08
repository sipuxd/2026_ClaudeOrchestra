#!/usr/bin/env node
// Minimal SDK test — runs query() with a simple prompt to verify SDK works.
// Usage: node scripts/sdk-test.mjs

import { query } from '@anthropic-ai/claude-agent-sdk';

console.log('Testing Claude Agent SDK...');
console.log('---');

try {
  const q = query({
    prompt: 'Say "Hello from SDK" and nothing else.',
    options: {
      model: 'claude-haiku-4-5',
      systemPrompt: 'You are a test agent. Follow instructions exactly.',
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      allowedTools: [],
      maxTurns: 1,
      persistSession: false,
      stderr: (data) => {
        console.error('[SDK stderr]', data);
      },
    },
  });

  console.log('query() returned successfully. Consuming stream...');

  for await (const msg of q) {
    if (msg.type === 'assistant') {
      const blocks = msg.message?.content;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block.type === 'text') {
            console.log('[Assistant]', block.text);
          }
        }
      }
    } else if (msg.type === 'result') {
      console.log('[Result]', msg.subtype, msg.is_error ? `errors: ${msg.errors}` : 'success');
    } else {
      console.log(`[${msg.type}]`, JSON.stringify(msg).substring(0, 200));
    }
  }

  console.log('---');
  console.log('SDK test PASSED - stream consumed successfully.');
} catch (err) {
  console.error('---');
  console.error('SDK test FAILED:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
}
