import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const VALID_SLUG_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const MAX_SLUG_LENGTH = 80;

export interface WorktreeCreateOptions {
  slug: string;
  baseRef?: string;
}

export interface WorktreeLease {
  slug: string;
  gitRoot: string;
  path: string;
  branch: string;
  baseRef: string;
  baseSha: string;
  createdAt: string;
}

export interface WorktreeStatus {
  dirty: boolean;
  changedFiles: string[];
  commitsAhead: number;
}

export interface WorktreeRemoveOptions {
  discardChanges?: boolean;
}

export interface WorktreeRemoveResult {
  removed: boolean;
  reason?: string;
  status?: WorktreeStatus;
  warnings: string[];
}

export class WorktreeManager {
  constructor(private readonly cwd: string) {}

  async create(options: WorktreeCreateOptions): Promise<WorktreeLease> {
    validateWorktreeSlug(options.slug);
    const gitRoot = await this.findGitRoot();
    const baseRef = options.baseRef ?? 'HEAD';
    const baseSha = (await git(['rev-parse', baseRef], gitRoot)).stdout.trim();
    if (!baseSha) throw new Error(`Could not resolve base ref: ${baseRef}`);

    const root = join(gitRoot, '.roxycode', 'worktrees');
    await mkdir(root, { recursive: true });
    const path = join(root, options.slug);
    const branch = `roxy-worktree-${options.slug}`;

    await git(['worktree', 'add', '-b', branch, path, baseRef], gitRoot);
    return {
      slug: options.slug,
      gitRoot,
      path,
      branch,
      baseRef,
      baseSha,
      createdAt: new Date().toISOString(),
    };
  }

  async status(lease: WorktreeLease): Promise<WorktreeStatus> {
    await assertExistingDirectory(lease.path);
    const status = (await git(['status', '--porcelain'], lease.path)).stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const aheadRaw = (await git(['rev-list', '--count', `${lease.baseSha}..HEAD`], lease.path)).stdout.trim();
    const commitsAhead = Number.parseInt(aheadRaw, 10);
    return {
      dirty: status.length > 0,
      changedFiles: status,
      commitsAhead: Number.isFinite(commitsAhead) ? commitsAhead : 0,
    };
  }

  async remove(lease: WorktreeLease, options: WorktreeRemoveOptions = {}): Promise<WorktreeRemoveResult> {
    const warnings: string[] = [];
    let currentStatus: WorktreeStatus | undefined;

    try {
      currentStatus = await this.status(lease);
    } catch (error) {
      if (!options.discardChanges) {
        return {
          removed: false,
          reason: `Could not inspect worktree safely: ${error instanceof Error ? error.message : String(error)}`,
          warnings,
        };
      }
      warnings.push(`Discarding worktree without clean status: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!options.discardChanges && currentStatus && (currentStatus.dirty || currentStatus.commitsAhead > 0)) {
      return {
        removed: false,
        reason: 'Worktree has uncommitted changes or new commits.',
        status: currentStatus,
        warnings,
      };
    }

    try {
      await git(['worktree', 'remove', '--force', lease.path], lease.gitRoot);
    } catch (error) {
      return {
        removed: false,
        reason: `git worktree remove failed: ${error instanceof Error ? error.message : String(error)}`,
        status: currentStatus,
        warnings,
      };
    }

    try {
      await git(['branch', '-D', lease.branch], lease.gitRoot);
    } catch (error) {
      warnings.push(`Could not delete branch ${lease.branch}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { removed: true, status: currentStatus, warnings };
  }

  async findGitRoot(): Promise<string> {
    const result = await git(['rev-parse', '--show-toplevel'], this.cwd);
    const root = result.stdout.trim();
    if (!root) throw new Error('Not inside a git repository.');
    return resolve(root);
  }
}

export function validateWorktreeSlug(slug: string): void {
  if (!slug || slug.length > MAX_SLUG_LENGTH) {
    throw new Error(`Invalid worktree slug: must be 1-${MAX_SLUG_LENGTH} characters.`);
  }
  for (const segment of slug.split('/')) {
    if (!segment || segment === '.' || segment === '..' || !VALID_SLUG_SEGMENT.test(segment)) {
      throw new Error('Invalid worktree slug: use letters, digits, dots, underscores, and dashes only.');
    }
  }
}

async function assertExistingDirectory(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isDirectory()) throw new Error(`Worktree path is not a directory: ${path}`);
}

async function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' },
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string; code?: number | string };
    const stderr = String(err.stderr ?? '').trim();
    const stdout = String(err.stdout ?? '').trim();
    const detail = stderr || stdout || err.message;
    throw new Error(`git ${args.join(' ')} failed${err.code !== undefined ? ` (${err.code})` : ''}: ${detail}`);
  }
}
