// Git operations for target project repos.
//
// Three tiers:
//   1. Automatic (engine-controlled): commit() only — safety checkpoints
//      at phase boundaries on the team's branch. No user approval needed.
//
//   2. User-initiated: createPullRequest() — pushes team branch and creates
//      a GitHub PR via `gh`. Called from dashboard button.
//
//   3. Polling: checkPrState() — checks if a PR has been merged on GitHub.
//      Called by the engine's PR polling loop.
//
//   Legacy: pushAndMerge() — @deprecated, kept for backward compatibility.

import { execFileSync } from 'node:child_process';

export interface GitResult {
  success: boolean;
  output: string;
}

function git(projectPath: string, args: string[]): GitResult {
  try {
    const output = execFileSync('git', args, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: output.trim() };
  } catch (err: any) {
    const output = (err.stdout ?? '') + (err.stderr ?? '');
    return { success: false, output: output.trim() };
  }
}

export class GitOps {
  // --- Automatic (engine-controlled) ---

  /**
   * Check if the project has uncommitted changes (staged or unstaged).
   */
  static hasChanges(projectPath: string): boolean {
    const result = git(projectPath, ['status', '--porcelain']);
    return result.success && result.output.length > 0;
  }

  /**
   * Get the current branch name.
   */
  static currentBranch(projectPath: string): string {
    const result = git(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return result.success ? result.output : 'unknown';
  }

  /**
   * Get the diff of the current branch against a base branch.
   * Uses three-dot form to show only changes on the current branch.
   */
  static diff(projectPath: string, base: string = 'main'): GitResult {
    return git(projectPath, ['diff', `${base}...HEAD`]);
  }

  /**
   * Auto-commit all changes on the current branch.
   * Called by the engine at phase boundaries — safety checkpoints.
   * Only commits if there are changes.
   */
  static commit(projectPath: string, message: string): GitResult {
    if (!GitOps.hasChanges(projectPath)) {
      return { success: true, output: 'No changes to commit' };
    }

    // Stage all changes
    const addResult = git(projectPath, ['add', '-A']);
    if (!addResult.success) {
      return addResult;
    }

    // Commit
    return git(projectPath, ['commit', '-m', message]);
  }

  // --- User-initiated (dashboard/CLI) ---

  /**
   * Push current branch to remote.
   */
  static push(projectPath: string, branch: string): GitResult {
    return git(projectPath, ['push', 'origin', branch]);
  }

  /**
   * Checkout a branch.
   */
  static checkout(projectPath: string, branch: string): GitResult {
    return git(projectPath, ['checkout', branch]);
  }

  /**
   * Merge source branch into the current branch.
   */
  static merge(projectPath: string, source: string): GitResult {
    return git(projectPath, ['merge', source]);
  }

  // --- Branch & PR operations ---

  /**
   * Slugify a team name into a valid git branch name.
   * "Auth API Endpoints" → "team/auth-api-endpoints"
   */
  static slugifyBranchName(teamName: string): string {
    const slug = teamName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
    return `team/${slug || 'unnamed'}`;
  }

  /**
   * Whether `projectPath` is inside a git working tree. Distinguishes a genuine
   * "no version control here" directory from a git repo whose team-branch setup
   * failed — the two need opposite handling in the orchestrator (skip vs. fail).
   */
  static isGitRepo(projectPath: string): boolean {
    const result = git(projectPath, ['rev-parse', '--is-inside-work-tree']);
    return result.success && result.output.trim() === 'true';
  }

  /**
   * Create a new branch off main for a team.
   * Checks out main, pulls latest (best-effort), creates branch.
   * Returns the final branch name (may have suffix if collision).
   */
  static createTeamBranch(
    projectPath: string,
    branchName: string,
  ): GitResult & { branchName: string } {
    // Start from main
    const checkoutMain = git(projectPath, ['checkout', 'main']);
    if (!checkoutMain.success) {
      return { ...checkoutMain, branchName };
    }

    // Pull latest (best-effort — may fail if no remote)
    git(projectPath, ['pull', 'origin', 'main']);

    // Try the branch name, append suffix on collision
    let finalName = branchName;
    for (let i = 0; i < 10; i++) {
      const candidate = i === 0 ? branchName : `${branchName}-${i + 1}`;
      const exists = git(projectPath, ['rev-parse', '--verify', candidate]);
      if (!exists.success) {
        finalName = candidate;
        break;
      }
      if (i === 9) {
        finalName = `${branchName}-${Date.now()}`;
      }
    }

    const create = git(projectPath, ['checkout', '-b', finalName]);
    if (!create.success) {
      // Return to main on failure
      git(projectPath, ['checkout', 'main']);
      return { ...create, branchName: finalName };
    }

    // Best-effort push to set up tracking
    git(projectPath, ['push', '-u', 'origin', finalName]);

    return { success: true, output: `Created branch ${finalName}`, branchName: finalName };
  }

  /**
   * Check if `gh` CLI is available.
   */
  private static ghAvailable: boolean | null = null;
  static isGhAvailable(): boolean {
    if (GitOps.ghAvailable === null) {
      try {
        execFileSync('gh', ['--version'], { stdio: 'pipe', timeout: 5_000 });
        GitOps.ghAvailable = true;
      } catch {
        GitOps.ghAvailable = false;
      }
    }
    return GitOps.ghAvailable;
  }

  /**
   * Push a team branch and create a GitHub PR.
   * Returns the PR number and URL on success.
   */
  static createPullRequest(
    projectPath: string,
    branchName: string,
    title: string,
    body: string,
  ): GitResult & { prNumber?: number; prUrl?: string } {
    if (!GitOps.isGhAvailable()) {
      return {
        success: false,
        output:
          'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/ to create PRs.',
      };
    }

    // Push branch to remote
    const push = git(projectPath, ['push', '-u', 'origin', branchName]);
    if (!push.success) {
      return { ...push };
    }

    // Create PR via gh
    try {
      const output = execFileSync(
        'gh',
        ['pr', 'create', '--base', 'main', '--head', branchName, '--title', title, '--body', body],
        { cwd: projectPath, encoding: 'utf-8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      // gh pr create outputs the PR URL
      const prUrl = output.trim();
      const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
      const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : undefined;
      return { success: true, output: prUrl, prNumber, prUrl };
    } catch (err: any) {
      const output = (err.stdout ?? '') + (err.stderr ?? '');
      return { success: false, output: output.trim() };
    }
  }

  /**
   * Check the state of a GitHub PR.
   * Returns { state, merged } from `gh pr view`.
   */
  static checkPrState(
    projectPath: string,
    prNumber: number,
  ): { state: string; merged: boolean } | null {
    if (!GitOps.isGhAvailable()) return null;
    try {
      const output = execFileSync(
        'gh',
        ['pr', 'view', String(prNumber), '--json', 'state,merged'],
        { cwd: projectPath, encoding: 'utf-8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const data = JSON.parse(output.trim());
      return { state: data.state ?? 'UNKNOWN', merged: data.merged ?? false };
    } catch {
      return null;
    }
  }

  /**
   * Delete a local branch (safe delete — must be fully merged).
   */
  static deleteLocalBranch(projectPath: string, branchName: string): GitResult {
    return git(projectPath, ['branch', '-d', branchName]);
  }

  // --- Legacy ---

  /**
   * @deprecated Use createPullRequest() instead. Kept for backward compatibility.
   *
   * Full push-and-merge workflow. User-initiated only.
   *
   * 1. git push origin dev
   * 2. git checkout main && git pull origin main
   * 3. git merge dev
   * 4. git push origin main
   * 5. git checkout dev
   *
   * Returns combined output from all steps. Stops on first failure.
   */
  static pushAndMerge(projectPath: string): GitResult {
    const devBranch = GitOps.currentBranch(projectPath);
    const outputs: string[] = [];

    // Step 1: Push dev
    const pushDev = git(projectPath, ['push', 'origin', devBranch]);
    outputs.push(`[push ${devBranch}] ${pushDev.output}`);
    if (!pushDev.success) {
      return { success: false, output: outputs.join('\n') };
    }

    // Step 2: Checkout main, pull latest, and merge dev
    const checkoutMain = git(projectPath, ['checkout', 'main']);
    outputs.push(`[checkout main] ${checkoutMain.output}`);
    if (!checkoutMain.success) {
      return { success: false, output: outputs.join('\n') };
    }

    const pullMain = git(projectPath, ['pull', 'origin', 'main']);
    outputs.push(`[pull main] ${pullMain.output}`);
    if (!pullMain.success) {
      git(projectPath, ['checkout', devBranch]);
      return { success: false, output: outputs.join('\n') };
    }

    const mergeDev = git(projectPath, ['merge', devBranch]);
    outputs.push(`[merge ${devBranch}] ${mergeDev.output}`);
    if (!mergeDev.success) {
      // Abort merge and return to dev on failure
      git(projectPath, ['merge', '--abort']);
      git(projectPath, ['checkout', devBranch]);
      return { success: false, output: outputs.join('\n') };
    }

    // Step 3: Push main
    const pushMain = git(projectPath, ['push', 'origin', 'main']);
    outputs.push(`[push main] ${pushMain.output}`);
    if (!pushMain.success) {
      // Return to dev even if push fails
      git(projectPath, ['checkout', devBranch]);
      return { success: false, output: outputs.join('\n') };
    }

    // Step 4: Return to dev
    const checkoutDev = git(projectPath, ['checkout', devBranch]);
    outputs.push(`[checkout ${devBranch}] ${checkoutDev.output}`);

    return { success: checkoutDev.success, output: outputs.join('\n') };
  }
}
