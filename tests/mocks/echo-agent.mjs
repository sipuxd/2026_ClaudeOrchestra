#!/usr/bin/env node
// Mock agent that reads stdin and echoes it back with optional
// ORCHESTRA-MESSAGE delimiters. Used for testing the spawner.
//
// Behavior modes (via MOCK_BEHAVIOR env var):
//   "echo"     — echo stdin lines back to stdout (default)
//   "message"  — wrap echoed output in ORCHESTRA-MESSAGE delimiters
//   "crash"    — exit with code 1 after first input
//   "silent"   — read stdin but produce no output
//   "immediate-exit" — exit immediately with code 0

import * as readline from 'node:readline';

const behavior = process.env.MOCK_BEHAVIOR ?? 'echo';

if (behavior === 'immediate-exit') {
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  switch (behavior) {
    case 'echo':
      process.stdout.write(`ECHO: ${line}\n`);
      break;
    case 'message':
      process.stdout.write(`---ORCHESTRA-MESSAGE-START---\n${line}\n---ORCHESTRA-MESSAGE-END---\n`);
      break;
    case 'crash':
      process.exit(1);
    case 'silent':
      // Do nothing
      break;
  }
});

rl.on('close', () => {
  process.exit(0);
});
