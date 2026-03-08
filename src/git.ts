// Git operations for target project repos.
//
// Two tiers:
//   1. Automatic (engine-controlled): commit() only — safety checkpoints
//      at phase boundaries on the current branch (dev). No user approval needed.
//
//   2. User-initiated: pushAndMerge() — called from dashboard button or
//      CLI command. Pushes dev, merges to main, pushes main, returns to dev.
//      The engine NEVER runs this automatically.

import { execSync } from 'node:child_process';

export interface GitResult {
  success: boolean;
  output: string;
}

function git(projectPath: string, args: string): GitResult {
  try {
    const output = execSync(`git ${args}`, {
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
    const result = git(projectPath, 'status --porcelain');
    return result.success && result.output.length > 0;
  }

  /**
   * Get the current branch name.
   */
  static currentBranch(projectPath: string): string {
    const result = git(projectPath, 'rev-parse --abbrev-ref HEAD');
    return result.success ? result.output : 'unknown';
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
    const addResult = git(projectPath, 'add -A');
    if (!addResult.success) {
      return addResult;
    }

    // Commit
    return git(projectPath, `commit -m "${message.replace(/"/g, '\\"')}"`);
  }

  // --- User-initiated (dashboard/CLI) ---

  /**
   * Push current branch to remote.
   */
  static push(projectPath: string, branch: string): GitResult {
    return git(projectPath, `push origin ${branch}`);
  }

  /**
   * Checkout a branch.
   */
  static checkout(projectPath: string, branch: string): GitResult {
    return git(projectPath, `checkout ${branch}`);
  }

  /**
   * Merge source branch into the current branch.
   */
  static merge(projectPath: string, source: string): GitResult {
    return git(projectPath, `merge ${source}`);
  }

  /**
   * Full push-and-merge workflow. User-initiated only.
   *
   * 1. git push origin dev
   * 2. git checkout main && git merge dev
   * 3. git push origin main
   * 4. git checkout dev
   *
   * Returns combined output from all steps. Stops on first failure.
   */
  static pushAndMerge(projectPath: string): GitResult {
    const devBranch = GitOps.currentBranch(projectPath);
    const outputs: string[] = [];

    // Step 1: Push dev
    const pushDev = git(projectPath, `push origin ${devBranch}`);
    outputs.push(`[push ${devBranch}] ${pushDev.output}`);
    if (!pushDev.success) {
      return { success: false, output: outputs.join('\n') };
    }

    // Step 2: Checkout main and merge dev
    const checkoutMain = git(projectPath, 'checkout main');
    outputs.push(`[checkout main] ${checkoutMain.output}`);
    if (!checkoutMain.success) {
      return { success: false, output: outputs.join('\n') };
    }

    const mergeDev = git(projectPath, `merge ${devBranch}`);
    outputs.push(`[merge ${devBranch}] ${mergeDev.output}`);
    if (!mergeDev.success) {
      // Abort merge and return to dev on failure
      git(projectPath, 'merge --abort');
      git(projectPath, `checkout ${devBranch}`);
      return { success: false, output: outputs.join('\n') };
    }

    // Step 3: Push main
    const pushMain = git(projectPath, 'push origin main');
    outputs.push(`[push main] ${pushMain.output}`);
    if (!pushMain.success) {
      // Return to dev even if push fails
      git(projectPath, `checkout ${devBranch}`);
      return { success: false, output: outputs.join('\n') };
    }

    // Step 4: Return to dev
    const checkoutDev = git(projectPath, `checkout ${devBranch}`);
    outputs.push(`[checkout ${devBranch}] ${checkoutDev.output}`);

    return { success: checkoutDev.success, output: outputs.join('\n') };
  }
}
