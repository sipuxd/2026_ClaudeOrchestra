import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeJsonFileAtomic } from '../src/atomic-write.js';

describe('writeJsonFileAtomic', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes valid, round-trippable JSON', () => {
    const target = path.join(tmpDir, 'data.json');
    const obj = { a: 1, b: ['x', 'y'], nested: { ok: true } };
    writeJsonFileAtomic(target, obj);
    expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual(obj);
  });

  it('uses 2-space pretty-print format (preserves the wire format)', () => {
    const target = path.join(tmpDir, 'data.json');
    const obj = { a: 1, b: 2 };
    writeJsonFileAtomic(target, obj);
    expect(fs.readFileSync(target, 'utf-8')).toBe(JSON.stringify(obj, null, 2));
  });

  it('creates the parent directory if missing', () => {
    const target = path.join(tmpDir, 'deep', 'nested', 'data.json');
    writeJsonFileAtomic(target, { ok: true });
    expect(fs.existsSync(target)).toBe(true);
  });

  it('replaces an existing file completely (no truncation artifacts)', () => {
    const target = path.join(tmpDir, 'data.json');
    // Pre-write a LARGER object, then overwrite with a smaller one.
    writeJsonFileAtomic(target, { big: 'x'.repeat(5000), extra: [1, 2, 3, 4, 5] });
    const smaller = { small: 1 };
    writeJsonFileAtomic(target, smaller);
    expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual(smaller);
    expect(fs.readFileSync(target, 'utf-8')).toBe(JSON.stringify(smaller, null, 2));
  });

  it('leaves no temp files behind', () => {
    const target = path.join(tmpDir, 'data.json');
    writeJsonFileAtomic(target, { ok: true });
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.startsWith('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});
