import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMUsage } from '../../core/types/llm.js';
import type { MultiAgentConflict, MultiAgentPlan, MultiAgentStateFile, MultiAgentTaskResult, TaskClaim } from './types.js';

const ZERO_USAGE: LLMUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export class TaskClaimStore {
  readonly rootDir: string;
  readonly claimsDir: string;
  readonly statePath: string;
  private stateWriteQueue: Promise<void> = Promise.resolve();

  constructor(cwd: string, private readonly runId: string) {
    this.rootDir = join(cwd, '.roxycode', 'multi-agent', runId);
    this.claimsDir = join(this.rootDir, 'claims');
    this.statePath = join(this.rootDir, 'state.json');
  }

  async init(plan: MultiAgentPlan): Promise<void> {
    await mkdir(this.claimsDir, { recursive: true });
    await this.writeState({
      runId: this.runId,
      updatedAt: new Date().toISOString(),
      plan,
      results: [],
      conflicts: [],
      usage: { ...ZERO_USAGE },
    });
  }

  async claim(taskId: string, agentId: string, cwd: string): Promise<TaskClaim | null> {
    await mkdir(this.claimsDir, { recursive: true });
    const claim: TaskClaim = {
      runId: this.runId,
      taskId,
      agentId,
      cwd,
      claimedAt: new Date().toISOString(),
    };
    const path = this.claimPath(taskId);
    let handle;
    try {
      handle = await open(path, 'wx');
      await handle.writeFile(`${JSON.stringify(claim, null, 2)}\n`, 'utf8');
      return claim;
    } catch (error) {
      if (isAlreadyExists(error)) return null;
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async readClaim(taskId: string): Promise<TaskClaim | null> {
    try {
      return JSON.parse(await readFile(this.claimPath(taskId), 'utf8')) as TaskClaim;
    } catch {
      return null;
    }
  }

  async release(taskId: string): Promise<void> {
    await rm(this.claimPath(taskId), { force: true });
  }

  async updateState(mutator: (state: MultiAgentStateFile) => MultiAgentStateFile): Promise<void> {
    const nextWrite = this.stateWriteQueue.then(async () => {
      const current = await this.readState();
      await this.writeState(mutator(current));
    });
    this.stateWriteQueue = nextWrite.catch(() => undefined);
    await nextWrite;
  }

  async appendResult(result: MultiAgentTaskResult): Promise<void> {
    await this.updateState(state => ({
      ...state,
      updatedAt: new Date().toISOString(),
      results: upsertBy(state.results, result, item => item.taskId),
      usage: addUsage(state.usage, result.usage),
    }));
  }

  async appendConflict(conflict: MultiAgentConflict): Promise<void> {
    await this.updateState(state => ({
      ...state,
      updatedAt: new Date().toISOString(),
      conflicts: [...state.conflicts, conflict],
    }));
  }

  async writeMergeReport(mergeReport: string): Promise<void> {
    await this.updateState(state => ({
      ...state,
      updatedAt: new Date().toISOString(),
      mergeReport,
    }));
  }

  async readState(): Promise<MultiAgentStateFile> {
    const raw = await readFile(this.statePath, 'utf8');
    return JSON.parse(raw) as MultiAgentStateFile;
  }

  private async writeState(state: MultiAgentStateFile): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const temp = `${this.statePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temp, this.statePath);
  }

  private claimPath(taskId: string): string {
    return join(this.claimsDir, `${safeFileName(taskId)}.claim.json`);
  }
}

function upsertBy<T>(items: T[], item: T, key: (value: T) => string): T[] {
  const next = items.filter(existing => key(existing) !== key(item));
  next.push(item);
  return next;
}

function addUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: (a.cost ?? 0) + (b.cost ?? 0) || undefined,
  };
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST';
}
