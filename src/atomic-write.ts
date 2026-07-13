// Shared atomic JSON writer: write to a temp file in the target's directory,
// fsync it to durable storage, then rename over the target so readers never
// observe a partial/truncated file. Used by Registry, Portfolio, and
// StatePersistence, which each previously hand-rolled a temp-file+rename dance
// that skipped the fsync (a crash between write() and the page-cache flush
// could leave a truncated file that rename then made "official").

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Atomically write `data` as pretty-printed (2-space) JSON to `targetPath`.
 * Creates the parent directory if missing. The 2-space format is the wire
 * format every consumer (Registry/Portfolio/StatePersistence loaders) expects,
 * so it must be preserved exactly.
 */
export function writeJsonFileAtomic(targetPath: string, data: unknown): void {
  const resolved = path.resolve(targetPath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });

  const json = JSON.stringify(data, null, 2);
  const tmpPath = path.join(dir, `.tmp-${randomUUID()}.json`);

  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, json, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    fs.renameSync(tmpPath, resolved);
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      /* best-effort temp cleanup */
    }
    throw err;
  }
}
