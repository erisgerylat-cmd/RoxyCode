import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
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

export interface WorktreeListItem extends WorktreeLease {
  headSha: string;
  status: WorktreeStatus;
  current?: boolean;
  metadataFound: boolean;
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

export interface WorktreeCleanupOptions {
  slug?: string;
  discardChanges?: boolean;
}

export interface WorktreeCleanupItem {
  slug: string;
  path: string;
  branch: string;
  removed: boolean;
  reason?: string;
  status?: WorktreeStatus;
  warnings: string[];
}

export interface WorktreeMergeResult {
  slug: string;
  path: string;
  branch: string;
  merged: boolean;
  conflict: boolean;
  conflicts: string[];
  reason?: string;
  commit?: string;
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
    await ensureLocalGitExclude(gitRoot);
    await mkdir(root, { recursive: true });
    const path = join(root, options.slug);
    const branch = `roxy-worktree-${options.slug}`;

    await git(['worktree', 'add', '-b', branch, path, baseRef], gitRoot);
    const lease = {
      slug: options.slug,
      gitRoot,
      path,
      branch,
      baseRef,
      baseSha,
      createdAt: new Date().toISOString(),
    };
    await this.writeLease(lease);
    return lease;
  }

  async list(): Promise<WorktreeListItem[]> {
    const gitRoot = await this.findGitRoot();
    const root = worktreeRoot(gitRoot);
    const records = parseWorktreeList((await git(['worktree', 'list', '--porcelain'], gitRoot)).stdout);
    const leases = await this.readLeases(gitRoot);
    const items: WorktreeListItem[] = [];

    for (const record of records) {
      if (!record.path || !isInside(root, record.path)) continue;
      const slug = basename(record.path);
      const lease = leases.get(slug);
      const baseSha = lease?.baseSha ?? record.headSha ?? '';
      const status = await this.statusFromPath(record.path, baseSha).catch(() => ({ dirty: true, changedFiles: ['<status unavailable>'], commitsAhead: 0 }));
      items.push({
        slug,
        gitRoot,
        path: record.path,
        branch: stripBranchRef(record.branch) || lease?.branch || '',
        baseRef: lease?.baseRef ?? 'HEAD',
        baseSha,
        headSha: record.headSha ?? '',
        createdAt: lease?.createdAt ?? '',
        status,
        current: record.current,
        metadataFound: Boolean(lease),
      });
    }
    return items.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async status(lease: WorktreeLease): Promise<WorktreeStatus> {
    await assertExistingDirectory(lease.path);
    return this.statusFromPath(lease.path, lease.baseSha);
  }

  async cleanup(options: WorktreeCleanupOptions = {}): Promise<WorktreeCleanupItem[]> {
    const items = await this.list();
    const selected = options.slug ? items.filter(item => item.slug === options.slug) : items;
    if (options.slug && selected.length === 0) throw new Error(`Worktree not found: ${options.slug}`);

    const results: WorktreeCleanupItem[] = [];
    for (const item of selected) {
      const removed = await this.remove(item, { discardChanges: options.discardChanges });
      results.push({
        slug: item.slug,
        path: item.path,
        branch: item.branch,
        removed: removed.removed,
        reason: removed.reason,
        status: removed.status,
        warnings: removed.warnings,
      });
    }
    return results;
  }

  async merge(slug: string): Promise<WorktreeMergeResult> {
    validateWorktreeSlug(slug);
    const gitRoot = await this.findGitRoot();
    const item = (await this.list()).find(candidate => candidate.slug === slug);
    if (!item) throw new Error(`Worktree not found: ${slug}`);
    const warnings: string[] = [];

    const sourceStatus = await this.status(item);
    if (sourceStatus.dirty) {
      return {
        slug,
        path: item.path,
        branch: item.branch,
        merged: false,
        conflict: false,
        conflicts: sourceStatus.changedFiles,
        reason: 'Worktree has uncommitted changes. Commit or discard them before merge.',
        warnings,
      };
    }

    const mainStatus = await this.statusFromPath(gitRoot, item.baseSha);
    if (mainStatus.dirty) {
      return {
        slug,
        path: item.path,
        branch: item.branch,
        merged: false,
        conflict: false,
        conflicts: mainStatus.changedFiles,
        reason: 'Main workspace is dirty. Commit or stash changes before merging a worktree.',
        warnings,
      };
    }

    const check = await this.checkMerge(gitRoot, slug, item.branch);
    warnings.push(...check.warnings);
    if (!check.ok) {
      return {
        slug,
        path: item.path,
        branch: item.branch,
        merged: false,
        conflict: true,
        conflicts: check.conflicts,
        reason: check.reason,
        warnings,
      };
    }

    try {
      await git(['merge', '--no-ff', item.branch, '-m', `Merge RoxyCode worktree ${slug}`], gitRoot);
      const commit = (await git(['rev-parse', 'HEAD'], gitRoot)).stdout.trim();
      return { slug, path: item.path, branch: item.branch, merged: true, conflict: false, conflicts: [], commit, warnings };
    } catch (error) {
      await git(['merge', '--abort'], gitRoot).catch(() => undefined);
      return {
        slug,
        path: item.path,
        branch: item.branch,
        merged: false,
        conflict: true,
        conflicts: (await this.statusFromPath(gitRoot, item.baseSha).catch(() => ({ dirty: false, changedFiles: [], commitsAhead: 0 }))).changedFiles,
        reason: `git merge failed: ${error instanceof Error ? error.message : String(error)}`,
        warnings,
      };
    }
  }

  private async statusFromPath(path: string, baseSha: string): Promise<WorktreeStatus> {
    await assertExistingDirectory(path);
    const status = (await git(['status', '--porcelain'], path)).stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const aheadRaw = baseSha ? (await git(['rev-list', '--count', `${baseSha}..HEAD`], path)).stdout.trim() : '0';
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

    await this.deleteLease(lease).catch(error => {
      warnings.push(`Could not delete lease metadata: ${error instanceof Error ? error.message : String(error)}`);
    });

    return { removed: true, status: currentStatus, warnings };
  }

  async findGitRoot(): Promise<string> {
    const result = await git(['rev-parse', '--show-toplevel'], this.cwd);
    const root = result.stdout.trim();
    if (!root) throw new Error('Not inside a git repository.');
    return resolve(root);
  }

  private async writeLease(lease: WorktreeLease): Promise<void> {
    const dir = leaseDir(lease.gitRoot);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${lease.slug}.json`), `${JSON.stringify(lease, null, 2)}\n`, 'utf8');
  }

  private async readLeases(gitRoot: string): Promise<Map<string, WorktreeLease>> {
    const dir = leaseDir(gitRoot);
    const leases = new Map<string, WorktreeLease>();
    if (!existsSync(dir)) return leases;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return leases;
    }
    for (const entry of entries.filter(file => file.endsWith('.json'))) {
      try {
        const lease = JSON.parse(await readFile(join(dir, entry), 'utf8')) as WorktreeLease;
        leases.set(lease.slug, lease);
      } catch {
        continue;
      }
    }
    return leases;
  }

  private async deleteLease(lease: WorktreeLease): Promise<void> {
    await unlink(join(leaseDir(lease.gitRoot), `${lease.slug}.json`)).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }

  private async checkMerge(gitRoot: string, slug: string, branch: string): Promise<{ ok: boolean; conflicts: string[]; reason?: string; warnings: string[] }> {
    if (!branch) return { ok: false, conflicts: [], reason: 'Worktree branch is unknown.', warnings: [] };
    const checkPath = join(worktreeRoot(gitRoot), `.merge-check-${slug}-${Date.now().toString(36)}`);
    const warnings: string[] = [];
    try {
      await git(['worktree', 'add', '--detach', checkPath, 'HEAD'], gitRoot);
      try {
        await git(['merge', '--no-commit', '--no-ff', branch], checkPath);
        return { ok: true, conflicts: [], warnings };
      } catch (error) {
        const conflicts = (await git(['status', '--porcelain'], checkPath).catch(() => ({ stdout: '', stderr: '' }))).stdout
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean);
        await git(['merge', '--abort'], checkPath).catch(() => undefined);
        return {
          ok: false,
          conflicts,
          reason: `Merge conflict detected before applying to main workspace: ${error instanceof Error ? error.message : String(error)}`,
          warnings,
        };
      }
    } finally {
      await git(['worktree', 'remove', '--force', checkPath], gitRoot).catch(error => {
        warnings.push(`Could not remove merge-check worktree: ${error instanceof Error ? error.message : String(error)}`);
      });
      await rm(checkPath, { recursive: true, force: true }).catch(() => undefined);
    }
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

interface WorktreePorcelainRecord {
  path: string;
  headSha?: string;
  branch?: string;
  current?: boolean;
}

function parseWorktreeList(raw: string): WorktreePorcelainRecord[] {
  const records: WorktreePorcelainRecord[] = [];
  let current: Partial<WorktreePorcelainRecord> = {};
  const flush = () => {
    if (current.path) records.push(current as WorktreePorcelainRecord);
    current = {};
  };
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const [key, ...rest] = line.split(' ');
    const value = rest.join(' ');
    if (key === 'worktree') current.path = resolve(value);
    else if (key === 'HEAD') current.headSha = value;
    else if (key === 'branch') current.branch = value;
    else if (key === 'bare') current.current = false;
  }
  flush();
  return records;
}

function stripBranchRef(value: string | undefined): string {
  return value?.replace(/^refs\/heads\//, '') ?? '';
}

function worktreeRoot(gitRoot: string): string {
  return join(gitRoot, '.roxycode', 'worktrees');
}

function leaseDir(gitRoot: string): string {
  return join(gitRoot, '.git', 'roxycode', 'worktree-leases');
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

async function ensureLocalGitExclude(gitRoot: string): Promise<void> {
  const excludePath = join(gitRoot, '.git', 'info', 'exclude');
  const patterns = ['.roxycode/worktrees/'];
  try {
    await mkdir(dirname(excludePath), { recursive: true });
    const existing = await readFile(excludePath, 'utf8').catch(() => '');
    const missing = patterns.filter(pattern => !existing.split(/\r?\n/).includes(pattern));
    if (missing.length === 0) return;
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    await writeFile(excludePath, `${existing}${prefix}${missing.join('\n')}\n`, 'utf8');
  } catch {
    // Local exclude is best-effort; safety checks still refuse dirty main workspaces.
  }
}
