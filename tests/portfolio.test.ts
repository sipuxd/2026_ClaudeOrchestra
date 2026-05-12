import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Portfolio, type Project } from '../src/portfolio.js';

describe('Portfolio', () => {
  let tmpDir: string;
  let portfolioPath: string;
  let portfolio: Portfolio;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-test-'));
    portfolioPath = path.join(tmpDir, 'projects.json');
    portfolio = new Portfolio(portfolioPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('returns empty array when file does not exist', () => {
      expect(portfolio.load()).toEqual([]);
    });

    it('returns empty array when file is corrupt JSON', () => {
      fs.writeFileSync(portfolioPath, '{not json');
      expect(portfolio.load()).toEqual([]);
    });

    it('returns projects array when file exists', () => {
      const project: Project = {
        projectPath: '/some/path',
        displayName: 'path',
        addedAt: '2026-05-10T00:00:00Z',
      };
      fs.writeFileSync(portfolioPath, JSON.stringify({ projects: [project] }));
      expect(portfolio.load()).toEqual([project]);
    });
  });

  describe('add', () => {
    it('persists a new project', () => {
      const project: Project = {
        projectPath: '/a/b',
        displayName: 'b',
        addedAt: '2026-05-10T00:00:00Z',
      };
      portfolio.add(project);

      expect(portfolio.load()).toEqual([project]);

      // Reload from disk via a fresh instance.
      const fresh = new Portfolio(portfolioPath);
      expect(fresh.load()).toEqual([project]);
    });

    it('is idempotent — adding the same projectPath twice keeps one entry', () => {
      portfolio.add({ projectPath: '/a/b', displayName: 'b', addedAt: 't1' });
      portfolio.add({ projectPath: '/a/b', displayName: 'different', addedAt: 't2' });

      const projects = portfolio.load();
      expect(projects.length).toBe(1);
      expect(projects[0].displayName).toBe('b'); // First add wins.
    });

    it('handles multiple distinct projects', () => {
      portfolio.add({ projectPath: '/a', displayName: 'a', addedAt: 't1' });
      portfolio.add({ projectPath: '/b', displayName: 'b', addedAt: 't2' });
      portfolio.add({ projectPath: '/c', displayName: 'c', addedAt: 't3' });

      const paths = portfolio.load().map((p) => p.projectPath);
      expect(paths).toEqual(['/a', '/b', '/c']);
    });
  });

  describe('remove', () => {
    it('removes a project by path', () => {
      portfolio.add({ projectPath: '/a', displayName: 'a', addedAt: 't1' });
      portfolio.add({ projectPath: '/b', displayName: 'b', addedAt: 't2' });

      portfolio.remove('/a');

      const paths = portfolio.load().map((p) => p.projectPath);
      expect(paths).toEqual(['/b']);
    });

    it('is a no-op when the path is not in the portfolio', () => {
      portfolio.add({ projectPath: '/a', displayName: 'a', addedAt: 't1' });

      portfolio.remove('/nonexistent');

      expect(portfolio.load().length).toBe(1);
    });

    it('persists after remove', () => {
      portfolio.add({ projectPath: '/a', displayName: 'a', addedAt: 't1' });
      portfolio.remove('/a');

      const fresh = new Portfolio(portfolioPath);
      expect(fresh.load()).toEqual([]);
    });
  });

  describe('has + get', () => {
    it('has returns true for added project', () => {
      portfolio.add({ projectPath: '/a', displayName: 'a', addedAt: 't1' });
      expect(portfolio.has('/a')).toBe(true);
      expect(portfolio.has('/nope')).toBe(false);
    });

    it('get returns the project or undefined', () => {
      portfolio.add({ projectPath: '/a', displayName: 'A', addedAt: 't1' });
      expect(portfolio.get('/a')?.displayName).toBe('A');
      expect(portfolio.get('/nope')).toBeUndefined();
    });

    it('resolves relative paths so callers can pass either form', () => {
      const abs = path.resolve('./somewhere');
      portfolio.add({ projectPath: abs, displayName: 'rel', addedAt: 't1' });
      expect(portfolio.has(abs)).toBe(true);
      expect(portfolio.has('./somewhere')).toBe(true);
    });
  });

  describe('atomic writes', () => {
    it('leaves no temp files after add', () => {
      portfolio.add({ projectPath: '/a', displayName: 'a', addedAt: 't1' });

      const files = fs.readdirSync(tmpDir);
      const tmpFiles = files.filter((f) => f.startsWith('.tmp-portfolio-'));
      expect(tmpFiles).toEqual([]);
    });
  });
});
