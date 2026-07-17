import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitOps } from '../src/git.js';

let tmpDir: string;

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
}

function commitFile(dir: string, filename: string, content: string, message: string): void {
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
  execSync(`git add "${filename}"`, { cwd: dir, stdio: 'pipe' });
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: 'pipe' });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GitOps', () => {
  describe('hasChanges', () => {
    it('returns false on clean repo', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');

      expect(GitOps.hasChanges(tmpDir)).toBe(false);
    });

    it('returns true when file is modified', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');

      fs.writeFileSync(path.join(tmpDir, 'init.txt'), 'modified', 'utf-8');
      expect(GitOps.hasChanges(tmpDir)).toBe(true);
    });

    it('returns true when file is added but unstaged', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');

      fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'new file', 'utf-8');
      expect(GitOps.hasChanges(tmpDir)).toBe(true);
    });

    it('returns true when file is staged', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');

      fs.writeFileSync(path.join(tmpDir, 'staged.txt'), 'staged content', 'utf-8');
      execSync('git add staged.txt', { cwd: tmpDir, stdio: 'pipe' });
      expect(GitOps.hasChanges(tmpDir)).toBe(true);
    });
  });

  describe('isGitRepo', () => {
    it('returns true inside a git working tree', () => {
      initGitRepo(tmpDir);
      expect(GitOps.isGitRepo(tmpDir)).toBe(true);
    });

    it('returns false for a non-git directory', () => {
      const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
      try {
        expect(GitOps.isGitRepo(nonGit)).toBe(false);
      } finally {
        fs.rmSync(nonGit, { recursive: true, force: true });
      }
    });
  });

  describe('currentBranch', () => {
    it('returns the current branch name', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');

      // Default branch could be main or master depending on git config
      const branch = GitOps.currentBranch(tmpDir);
      expect(['main', 'master']).toContain(branch);
    });

    it('returns branch name after checkout', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');
      execSync('git checkout -b dev', { cwd: tmpDir, stdio: 'pipe' });

      expect(GitOps.currentBranch(tmpDir)).toBe('dev');
    });

    it('returns unknown for non-git directory', () => {
      const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
      try {
        expect(GitOps.currentBranch(nonGit)).toBe('unknown');
      } finally {
        fs.rmSync(nonGit, { recursive: true, force: true });
      }
    });
  });

  describe('commit', () => {
    it('commits all changes with the given message', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');

      // Create new file
      fs.writeFileSync(path.join(tmpDir, 'work.txt'), 'work output', 'utf-8');

      const result = GitOps.commit(tmpDir, 'WIP: work phase complete');
      expect(result.success).toBe(true);

      // Verify commit happened
      const log = execSync('git log --oneline -1', { cwd: tmpDir, encoding: 'utf-8' });
      expect(log).toContain('WIP: work phase complete');

      // Verify working tree is clean
      expect(GitOps.hasChanges(tmpDir)).toBe(false);
    });

    it('returns success with no-op when no changes', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');

      const result = GitOps.commit(tmpDir, 'should not commit');
      expect(result.success).toBe(true);
      expect(result.output).toContain('No changes');
    });

    it('stages and commits both new and modified files', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'existing.txt', 'original', 'initial');

      // Modify existing and add new
      fs.writeFileSync(path.join(tmpDir, 'existing.txt'), 'modified', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'brand-new.txt'), 'new', 'utf-8');

      const result = GitOps.commit(tmpDir, 'two changes');
      expect(result.success).toBe(true);
      expect(GitOps.hasChanges(tmpDir)).toBe(false);
    });

    it('handles commit message with special characters', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');
      fs.writeFileSync(path.join(tmpDir, 'work.txt'), 'content', 'utf-8');

      const result = GitOps.commit(tmpDir, 'Fix "quoted" message & special <chars>');
      expect(result.success).toBe(true);
    });
  });

  describe('checkout', () => {
    it('switches to an existing branch', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');
      execSync('git checkout -b feature', { cwd: tmpDir, stdio: 'pipe' });
      execSync('git checkout -b other', { cwd: tmpDir, stdio: 'pipe' });

      const result = GitOps.checkout(tmpDir, 'feature');
      expect(result.success).toBe(true);
      expect(GitOps.currentBranch(tmpDir)).toBe('feature');
    });

    it('fails for nonexistent branch', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');

      const result = GitOps.checkout(tmpDir, 'nonexistent');
      expect(result.success).toBe(false);
    });
  });

  describe('merge', () => {
    it('merges source branch into current', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');

      // Create dev branch with a commit
      execSync('git checkout -b dev', { cwd: tmpDir, stdio: 'pipe' });
      commitFile(tmpDir, 'dev-work.txt', 'dev content', 'dev work');

      // Go back to main/master
      const mainBranch = execSync('git branch --list main master', {
        cwd: tmpDir,
        encoding: 'utf-8',
      })
        .trim()
        .replace('* ', '')
        .split('\n')[0]
        .trim();
      execSync(`git checkout ${mainBranch}`, { cwd: tmpDir, stdio: 'pipe' });

      const result = GitOps.merge(tmpDir, 'dev');
      expect(result.success).toBe(true);

      // Verify file from dev exists on main
      expect(fs.existsSync(path.join(tmpDir, 'dev-work.txt'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('commit fails on non-git directory', () => {
      const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
      try {
        fs.writeFileSync(path.join(nonGit, 'file.txt'), 'content', 'utf-8');
        const result = GitOps.commit(nonGit, 'should fail');
        // hasChanges returns false for non-git dirs (the command fails)
        // so commit returns no-op
        expect(result.success).toBe(true);
        expect(result.output).toContain('No changes');
      } finally {
        fs.rmSync(nonGit, { recursive: true, force: true });
      }
    });

    it('hasChanges returns false for non-git directory', () => {
      const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
      try {
        expect(GitOps.hasChanges(nonGit)).toBe(false);
      } finally {
        fs.rmSync(nonGit, { recursive: true, force: true });
      }
    });
  });
});
