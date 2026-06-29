import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { FileLock, MultiAgentConflict } from './types.js';

export interface FileLockAcquireResult {
  locks: FileLock[];
  conflicts: MultiAgentConflict[];
}

export class FileLockManager {
  readonly locksDir: string;

  constructor(private readonly cwd: string, private readonly runId: string, rootDir: string) {
    this.locksDir = join(rootDir, 'locks');
  }

  async acquireMany(taskId: string, agentId: string, paths: string[], reason?: string): Promise<FileLockAcquireResult> {
    await mkdir(this.locksDir, { recursive: true });
    const normalizedPaths = unique(paths.map(path => this.normalizeScope(path)).filter(Boolean)).sort();
    if (normalizedPaths.length === 0) return { locks: [], conflicts: [] };

    const acquired: FileLock[] = [];
    const conflicts: MultiAgentConflict[] = [];
    for (const path of normalizedPaths) {
      const lock: FileLock = {
        runId: this.runId,
        taskId,
        agentId,
        path,
        createdAt: new Date().toISOString(),
        reason,
      };
      const lockPath = this.lockPath(path);
      let handle;
      try {
        handle = await open(lockPath, 'wx');
        lock.lockPath = lockPath;
        await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
        acquired.push(lock);
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        const holder = await this.readLockByLockPath(lockPath);
        conflicts.push({
          taskId,
          agentId,
          path,
          holder: holder ?? undefined,
          message: holder
            ? `File scope "${path}" is already locked by ${holder.agentId} for task ${holder.taskId}.`
            : `File scope "${path}" is already locked.`,
          resolution: 'serialized',
        });
        await this.releaseMany(acquired);
        return { locks: [], conflicts };
      } finally {
        await handle?.close();
      }
    }

    return { locks: acquired, conflicts };
  }

  async releaseMany(locks: FileLock[]): Promise<void> {
    await Promise.all(locks.map(lock => rm(lock.lockPath ?? this.lockPath(lock.path), { force: true })));
  }

  async readLock(path: string): Promise<FileLock | null> {
    return this.readLockByLockPath(this.lockPath(this.normalizeScope(path)));
  }

  normalizeScope(path: string): string {
    const trimmed = path.trim();
    if (!trimmed || trimmed === '.') return '.';
    if (hasGlob(trimmed)) return trimmed.replace(/\\/g, '/');
    const absolute = isAbsolute(trimmed) ? resolve(trimmed) : resolve(this.cwd, trimmed);
    const rel = relative(this.cwd, absolute).replace(/\\/g, '/');
    return rel || '.';
  }

  private async readLockByLockPath(lockPath: string): Promise<FileLock | null> {
    try {
      return JSON.parse(await readFile(lockPath, 'utf8')) as FileLock;
    } catch {
      return null;
    }
  }

  private lockPath(path: string): string {
    const digest = createHash('sha256').update(path).digest('hex').slice(0, 24);
    return join(this.locksDir, `${digest}.lock.json`);
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function hasGlob(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST';
}
