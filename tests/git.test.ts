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

  describe('pushAndMerge', () => {
    it('fails gracefully without a remote', () => {
      initGitRepo(tmpDir);
      commitFile(tmpDir, 'init.txt', 'initial', 'initial commit');
      execSync('git checkout -b dev', { cwd: tmpDir, stdio: 'pipe' });

      // pushAndMerge requires a remote — should fail on push step
      const result = GitOps.pushAndMerge(tmpDir);
      expect(result.success).toBe(false);
      expect(result.output).toBeTruthy();
    });

    it('completes full workflow with local remote', () => {
      // Create a bare repo to act as remote
      const bareDir = path.join(tmpDir, 'remote.git');
      fs.mkdirSync(bareDir);
      execSync('git init --bare', { cwd: bareDir, stdio: 'pipe' });

      // Create working repo with remote
      const workDir = path.join(tmpDir, 'work');
      fs.mkdirSync(workDir);
      initGitRepo(workDir);

      // Determine default branch name and set it
      commitFile(workDir, 'init.txt', 'initial', 'initial commit');
      const defaultBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: workDir,
        encoding: 'utf-8',
      }).trim();

      execSync(`git remote add origin "${bareDir}"`, { cwd: workDir, stdio: 'pipe' });
      execSync(`git push -u origin ${defaultBranch}`, { cwd: workDir, stdio: 'pipe' });

      // Create a 'main' branch if default isn't main
      if (defaultBranch !== 'main') {
        execSync('git checkout -b main', { cwd: workDir, stdio: 'pipe' });
        execSync('git push -u origin main', { cwd: workDir, stdio: 'pipe' });
      }

      // Create dev branch
      execSync('git checkout -b dev', { cwd: workDir, stdio: 'pipe' });
      commitFile(workDir, 'work.txt', 'work output', 'WIP: work done');
      execSync('git push -u origin dev', { cwd: workDir, stdio: 'pipe' });

      // Run pushAndMerge
      const result = GitOps.pushAndMerge(workDir);
      expect(result.success).toBe(true);
      expect(result.output).toContain('[push dev]');
      expect(result.output).toContain('[checkout main]');
      expect(result.output).toContain('[merge dev]');
      expect(result.output).toContain('[push main]');
      expect(result.output).toContain('[checkout dev]');

      // Should be back on dev
      expect(GitOps.currentBranch(workDir)).toBe('dev');

      // Verify main has the work
      execSync('git checkout main', { cwd: workDir, stdio: 'pipe' });
      expect(fs.existsSync(path.join(workDir, 'work.txt'))).toBe(true);
      execSync('git checkout dev', { cwd: workDir, stdio: 'pipe' });
    });

    it('returns to dev branch on merge failure', () => {
      // Create bare remote
      const bareDir = path.join(tmpDir, 'remote.git');
      fs.mkdirSync(bareDir);
      execSync('git init --bare', { cwd: bareDir, stdio: 'pipe' });

      // Create working repo with 'main' branch
      const workDir = path.join(tmpDir, 'work');
      fs.mkdirSync(workDir);
      initGitRepo(workDir);
      execSync('git checkout -b main', { cwd: workDir, stdio: 'pipe' });
      commitFile(workDir, 'conflict.txt', 'main content', 'initial on main');

      execSync(`git remote add origin "${bareDir}"`, { cwd: workDir, stdio: 'pipe' });
      execSync('git push -u origin main', { cwd: workDir, stdio: 'pipe' });

      // Create dev with conflicting change
      execSync('git checkout -b dev', { cwd: workDir, stdio: 'pipe' });
      commitFile(workDir, 'conflict.txt', 'dev content', 'dev change');
      execSync('git push -u origin dev', { cwd: workDir, stdio: 'pipe' });

      // Create conflicting commit on main
      execSync('git checkout main', { cwd: workDir, stdio: 'pipe' });
      commitFile(workDir, 'conflict.txt', 'main diverged', 'main diverge');
      execSync('git push origin main', { cwd: workDir, stdio: 'pipe' });

      // Go back to dev for pushAndMerge
      execSync('git checkout dev', { cwd: workDir, stdio: 'pipe' });

      const result = GitOps.pushAndMerge(workDir);
      expect(result.success).toBe(false);

      // Should be back on dev despite merge failure
      expect(GitOps.currentBranch(workDir)).toBe('dev');
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
