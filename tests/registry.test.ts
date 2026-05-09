import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Registry, type RegistryEntry } from '../src/registry.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    teamId: overrides.teamId ?? 'test-team',
    teamName: overrides.teamName ?? 'test-team',
    projectPath: overrides.projectPath ?? '/tmp/project',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    lastActiveAt: overrides.lastActiveAt ?? '2026-01-01T00:00:00.000Z',
  };
}

describe('Registry', () => {
  describe('load', () => {
    it('returns empty array when file does not exist', () => {
      const registry = new Registry(path.join(tmpDir, 'registry.json'));
      expect(registry.load()).toEqual([]);
    });

    it('returns empty array for corrupted JSON', () => {
      const regPath = path.join(tmpDir, 'registry.json');
      fs.writeFileSync(regPath, 'not valid json', 'utf-8');

      const registry = new Registry(regPath);
      expect(registry.load()).toEqual([]);
    });

    it('returns teams from valid file', () => {
      const regPath = path.join(tmpDir, 'registry.json');
      const data = { teams: [makeEntry()] };
      fs.writeFileSync(regPath, JSON.stringify(data), 'utf-8');

      const registry = new Registry(regPath);
      const entries = registry.load();
      expect(entries).toHaveLength(1);
      expect(entries[0].teamId).toBe('test-team');
    });
  });

  describe('add', () => {
    it('creates registry file if it does not exist', () => {
      const regPath = path.join(tmpDir, 'registry.json');
      const registry = new Registry(regPath);

      registry.add(makeEntry());

      expect(fs.existsSync(regPath)).toBe(true);
      const entries = registry.load();
      expect(entries).toHaveLength(1);
      expect(entries[0].teamId).toBe('test-team');
    });

    it('adds multiple entries', () => {
      const registry = new Registry(path.join(tmpDir, 'registry.json'));

      registry.add(makeEntry({ teamId: 'team-a', teamName: 'team-a' }));
      registry.add(makeEntry({ teamId: 'team-b', teamName: 'team-b' }));

      const entries = registry.load();
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.teamId).sort()).toEqual(['team-a', 'team-b']);
    });

    it('updates existing entry instead of duplicating', () => {
      const registry = new Registry(path.join(tmpDir, 'registry.json'));

      registry.add(makeEntry({ teamId: 'dup', projectPath: '/path/a' }));
      registry.add(makeEntry({ teamId: 'dup', projectPath: '/path/b' }));

      const entries = registry.load();
      expect(entries).toHaveLength(1);
      expect(entries[0].projectPath).toBe('/path/b');
    });

    it('persists data to disk as JSON', () => {
      const regPath = path.join(tmpDir, 'registry.json');
      const registry = new Registry(regPath);

      registry.add(makeEntry({ teamId: 'persist-test' }));

      const raw = fs.readFileSync(regPath, 'utf-8');
      const data = JSON.parse(raw);
      expect(data.teams).toHaveLength(1);
      expect(data.teams[0].teamId).toBe('persist-test');
    });
  });

  describe('remove', () => {
    it('removes an entry by teamId', () => {
      const registry = new Registry(path.join(tmpDir, 'registry.json'));

      registry.add(makeEntry({ teamId: 'keep' }));
      registry.add(makeEntry({ teamId: 'remove-me' }));

      registry.remove('remove-me');

      const entries = registry.load();
      expect(entries).toHaveLength(1);
      expect(entries[0].teamId).toBe('keep');
    });

    it('does not crash when removing nonexistent entry', () => {
      const registry = new Registry(path.join(tmpDir, 'registry.json'));
      registry.add(makeEntry());

      expect(() => registry.remove('nonexistent')).not.toThrow();
      expect(registry.load()).toHaveLength(1);
    });

    it('handles remove from empty registry', () => {
      const registry = new Registry(path.join(tmpDir, 'registry.json'));
      expect(() => registry.remove('anything')).not.toThrow();
    });
  });

  describe('updateLastActive', () => {
    it('updates the lastActiveAt timestamp', () => {
      const registry = new Registry(path.join(tmpDir, 'registry.json'));
      const entry = makeEntry({ lastActiveAt: '2026-01-01T00:00:00.000Z' });
      registry.add(entry);

      registry.updateLastActive('test-team');

      const entries = registry.load();
      expect(entries[0].lastActiveAt).not.toBe('2026-01-01T00:00:00.000Z');
      // Should be a recent ISO timestamp
      expect(entries[0].lastActiveAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('does nothing for nonexistent team', () => {
      const registry = new Registry(path.join(tmpDir, 'registry.json'));
      registry.add(makeEntry());

      expect(() => registry.updateLastActive('nonexistent')).not.toThrow();
      // Original entry unchanged
      const entries = registry.load();
      expect(entries).toHaveLength(1);
    });
  });

  describe('get', () => {
    it('returns entry by teamId', () => {
      const registry = new Registry(path.join(tmpDir, 'registry.json'));
      registry.add(makeEntry({ teamId: 'find-me', projectPath: '/projects/mine' }));

      const entry = registry.get('find-me');
      expect(entry).toBeDefined();
      expect(entry!.projectPath).toBe('/projects/mine');
    });

    it('returns undefined for unknown teamId', () => {
      const registry = new Registry(path.join(tmpDir, 'registry.json'));
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('atomic writes', () => {
    it('does not leave temp files after write', () => {
      const registry = new Registry(path.join(tmpDir, 'registry.json'));
      registry.add(makeEntry());

      const files = fs.readdirSync(tmpDir);
      const tmpFiles = files.filter((f) => f.startsWith('.tmp-registry-'));
      expect(tmpFiles).toHaveLength(0);
    });

    it('creates parent directories if needed', () => {
      const nested = path.join(tmpDir, 'deep', 'nested', 'registry.json');
      const registry = new Registry(nested);

      registry.add(makeEntry());

      expect(fs.existsSync(nested)).toBe(true);
    });
  });
});
