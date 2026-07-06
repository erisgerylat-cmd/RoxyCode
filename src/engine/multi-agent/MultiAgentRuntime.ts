import type { LLMUsage } from '../../core/types/llm.js';
import { systemMessage, userMessage } from '../../core/types/message.js';
import { buildAgentSystemPrompt } from '../agent/prompts.js';
import { ConflictMerger } from './ConflictMerger.js';
import { Coordinator } from './Coordinator.js';
import { FileLockManager } from './FileLockManager.js';
import { TaskClaimStore } from './TaskClaimStore.js';
import { TaskGraph } from './TaskGraph.js';
import { WorktreeManager, type WorktreeLease } from '../../worktree/WorktreeManager.js';
import type {
  FileLock,
  MultiAgentConflict,
  MultiAgentEvent,
  MultiAgentRunInput,
  MultiAgentRunResult,
  MultiAgentRuntimeOptions,
  MultiAgentTask,
  MultiAgentTaskResult,
  MultiAgentWorktreeInfo,
  TaskClaim,
} from './types.js';

const ZERO_USAGE: LLMUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export class MultiAgentRuntime {
  private worktreeQueue: Promise<void> = Promise.resolve();
  private worktreeUnavailableReason: string | null = null;

  constructor(private readonly options: MultiAgentRuntimeOptions) {}

  async *run(input: MultiAgentRunInput): AsyncIterable<MultiAgentEvent, MultiAgentRunResult> {
    const runId = createRunId(this.options.sessionId);
    const coordinator = new Coordinator({ ...this.options, runtimeContext: input.runtimeContext ?? this.options.runtimeContext });
    const planResult = await coordinator.createPlan({
      userInput: input.userInput,
      runId,
      runtimeContext: input.runtimeContext ?? this.options.runtimeContext ?? null,
    });
    let plan = planResult.plan;
    yield { type: 'multi_agent_plan', plan, usage: planResult.usage };

    const graph = new TaskGraph(plan);
    const validation = graph.validate();
    if (!validation.ok) {
      plan = graph.markBlockedByValidation(plan, validation);
    }

    const store = new TaskClaimStore(this.options.cwd, runId);
    await store.init(plan);
    const locks = new FileLockManager(this.options.cwd, runId, store.rootDir);
    const results: MultiAgentTaskResult[] = [];
    const conflicts: MultiAgentConflict[] = validation.missingDependencies.map(item => ({
      taskId: item.taskId,
      message: this.options.language === 'en-US'
        ? `Task ${item.taskId} depends on missing task ${item.dependencyId}.`
        : `${zh('task')} ${item.taskId} ${zh('dependsOnMissing')} ${item.dependencyId}${zh('period')}`,
      resolution: 'blocked',
    }));
    let totalUsage = addUsage({ ...ZERO_USAGE }, planResult.usage);

    for (const conflict of conflicts) {
      await store.appendConflict(conflict);
      yield { type: 'multi_agent_conflict', conflict };
    }

    while (hasUnfinished(plan.tasks)) {
      const ready = new TaskGraph(plan).readyTasks(plan.tasks).slice(0, this.options.maxConcurrency);
      if (ready.length === 0) {
        const blocked = plan.tasks.filter(task => task.status === 'pending' || task.status === 'claimed' || task.status === 'running');
        for (const task of blocked) {
          const conflict: MultiAgentConflict = {
            taskId: task.id,
            message: this.options.language === 'en-US'
              ? `Task ${task.id} could not run because its dependencies did not finish.`
              : `${zh('task')} ${task.id} ${zh('cannotRunBecauseDeps')}`,
            resolution: 'blocked',
          };
          task.status = 'blocked';
          task.error = conflict.message;
          conflicts.push(conflict);
          await store.appendConflict(conflict);
          yield { type: 'multi_agent_conflict', conflict };
        }
        break;
      }

      const batch = ready.map(task => this.runTask(task, plan.tasks, store, locks, input)
        .then(async eventBundle => {
          for (const conflict of eventBundle.conflicts) await store.appendConflict(conflict);
          await store.appendResult(eventBundle.result);
          return eventBundle;
        }));

      for await (const eventBundle of settleAsCompleted(batch)) {
        if (eventBundle.claimed) yield { type: 'multi_agent_task_claimed', task: eventBundle.task, agentId: eventBundle.agentId };
        if (eventBundle.started) yield { type: 'multi_agent_task_start', task: eventBundle.task, agentId: eventBundle.agentId };
        for (const conflict of eventBundle.conflicts) {
          conflicts.push(conflict);
          yield { type: 'multi_agent_conflict', conflict };
        }
        const index = plan.tasks.findIndex(task => task.id === eventBundle.task.id);
        if (index >= 0) plan.tasks[index] = eventBundle.task;
        results.push(eventBundle.result);
        totalUsage = addUsage(totalUsage, eventBundle.result.usage);
        yield { type: 'multi_agent_task_done', task: eventBundle.task, result: eventBundle.result };
      }
    }

    const baseResult = {
      runId,
      stateDir: store.rootDir,
      plan,
      results,
      conflicts,
      usage: totalUsage,
    };
    const mergeReport = new ConflictMerger(this.options.language).merge(baseResult);
    await store.writeMergeReport(mergeReport);
    const result: MultiAgentRunResult = { ...baseResult, mergeReport };
    yield { type: 'multi_agent_merge', result, text: mergeReport };
    yield { type: 'multi_agent_done', result };
    return result;
  }

  private async runTask(
    task: MultiAgentTask,
    allTasks: MultiAgentTask[],
    store: TaskClaimStore,
    locks: FileLockManager,
    input: MultiAgentRunInput,
  ): Promise<TaskEventBundle> {
    const agentId = `${task.role}-${task.id}`;
    const claimedAt = new Date().toISOString();
    const claim = await store.claim(task.id, agentId, this.options.cwd);
    if (!claim) {
      const holder = await store.readClaim(task.id);
      const conflict: MultiAgentConflict = {
        taskId: task.id,
        agentId,
        holder: holder ?? undefined,
        message: this.options.language === 'en-US'
          ? `Task ${task.id} has already been claimed.`
          : `${zh('task')} ${task.id} ${zh('alreadyClaimed')}`,
        resolution: 'blocked',
      };
      const result = buildFailedResult(task, agentId, conflict.message, 'conflict', 0);
      return {
        task: { ...task, status: 'conflict', error: conflict.message },
        agentId,
        claimed: false,
        started: false,
        conflicts: [conflict],
        result,
      };
    }

    task.status = 'claimed';
    task.assignedAgent = agentId;
    task.claimedAt = claimedAt;

    let heldLocks: FileLock[] = [];
    let worktree: TaskWorktree | null = null;
    const started = Date.now();
    try {
      const lockResult = await locks.acquireMany(task.id, agentId, task.fileScopes, task.title);
      if (lockResult.conflicts.length > 0) {
        const conflict = lockResult.conflicts[0];
        const result = buildFailedResult(task, agentId, conflict.message, 'conflict', Date.now() - started);
        return {
          task: { ...task, status: 'conflict', error: conflict.message },
          agentId,
          claimed: true,
          started: false,
          conflicts: lockResult.conflicts,
          result,
        };
      }
      heldLocks = lockResult.locks;
      worktree = await this.createTaskWorktree(task, agentId);
      const taskCwd = worktree?.lease.path ?? this.options.cwd;
      const taskRuntimeContext = appendWorktreeContext(input.runtimeContext ?? this.options.runtimeContext ?? null, worktree?.info, this.options.language);

      task.status = 'running';
      task.startedAt = new Date().toISOString();
      const llmResult = await this.options.llmProvider.chat({
        messages: [
          systemMessage(buildAgentSystemPrompt({
            mode: 'ultimate',
            character: this.options.character,
            language: this.options.language,
            cwd: taskCwd,
            runtimeContext: taskRuntimeContext,
          })),
          userMessage(buildSubAgentPrompt(task, allTasks, input.userInput, this.options.language)),
        ],
        signal: this.options.signal,
      });

      const completedAt = new Date().toISOString();
      const result: MultiAgentTaskResult = {
        taskId: task.id,
        agentId,
        title: task.title,
        role: task.role,
        status: 'done',
        text: llmResult.text,
        usage: llmResult.usage,
        duration: Date.now() - started,
        fileScopes: task.fileScopes,
        worktree: worktree?.info,
      };
      return {
        task: { ...task, status: 'done', result: llmResult.text, completedAt },
        agentId,
        claimed: true,
        started: true,
        conflicts: [],
        result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result = buildFailedResult(task, agentId, message, 'failed', Date.now() - started);
      if (worktree?.info) result.worktree = worktree.info;
      return {
        task: { ...task, status: 'failed', error: message, completedAt: new Date().toISOString() },
        agentId,
        claimed: true,
        started: true,
        conflicts: [],
        result,
      };
    } finally {
      if (worktree) await this.cleanupTaskWorktree(worktree).catch(() => undefined);
      await locks.releaseMany(heldLocks).catch(() => undefined);
      await store.release(task.id).catch(() => undefined);
    }
  }

  private async createTaskWorktree(task: MultiAgentTask, agentId: string): Promise<TaskWorktree | null> {
    if (process.env.ROXY_MULTI_AGENT_WORKTREE === '0') return null;
    if (this.worktreeUnavailableReason) return null;

    const manager = new WorktreeManager(this.options.cwd);
    const slug = safeWorktreeSlug(`${agentId}-${Date.now().toString(36)}`);
    try {
      const lease = await this.withWorktreeQueue(() => manager.create({ slug }));
      const info: MultiAgentWorktreeInfo = {
        path: lease.path,
        branch: lease.branch,
        baseSha: lease.baseSha,
        cleanup: 'pending',
      };
      return { lease, info };
    } catch (error) {
      this.worktreeUnavailableReason = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  private async cleanupTaskWorktree(worktree: TaskWorktree): Promise<void> {
    const manager = new WorktreeManager(this.options.cwd);
    const result = await this.withWorktreeQueue(() => manager.remove(worktree.lease));
    worktree.info.cleanup = result.removed ? 'removed' : 'kept';
    worktree.info.cleanupReason = result.reason ?? (result.warnings.length > 0 ? result.warnings.join('; ') : undefined);
  }

  private async withWorktreeQueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.worktreeQueue.then(fn, fn);
    this.worktreeQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}

interface TaskWorktree {
  lease: WorktreeLease;
  info: MultiAgentWorktreeInfo;
}

interface TaskEventBundle {
  task: MultiAgentTask;
  agentId: string;
  claimed: boolean;
  started: boolean;
  conflicts: MultiAgentConflict[];
  result: MultiAgentTaskResult;
}

async function* settleAsCompleted<T>(promises: Array<Promise<T>>): AsyncIterable<T> {
  const pending = new Set(promises);
  while (pending.size > 0) {
    const tagged = Array.from(pending).map(promise => promise.then(value => ({ promise, value })));
    const { promise, value } = await Promise.race(tagged);
    pending.delete(promise);
    yield value;
  }
}

function buildSubAgentPrompt(task: MultiAgentTask, allTasks: MultiAgentTask[], userInput: string, language: 'zh-CN' | 'en-US'): string {
  const dependencies = task.dependsOn
    .map(id => allTasks.find(item => item.id === id))
    .filter((item): item is MultiAgentTask => Boolean(item));
  const dependencyText = dependencies
    .map(dep => `- ${dep.id} / ${dep.title}: ${dep.result ?? dep.error ?? dep.status}`)
    .join('\n');

  if (language === 'en-US') {
    return [
      `You are sub-agent ${task.id} (${task.role}) in RoxyCode Ultimate mode.`,
      'You must analyze only. Do not claim that you edited files, ran commands, or changed Git state.',
      'Focus on your assigned scope and return concise, actionable findings for the main agent.',
      `Task title: ${task.title}`,
      `Task description: ${task.description}`,
      `Likely file scopes: ${task.fileScopes.join(', ')}`,
      dependencies.length > 0 ? `Dependency results:\n${dependencyText}` : 'Dependency results: none',
      '',
      `Original user task:\n${userInput}`,
      '',
      `Your assignment:\n${task.prompt}`,
    ].join('\n');
  }

  return [
    `${zh('youAreSubAgent')} ${task.id} (${task.role})${zh('period')}`,
    zh('analyzeOnly'),
    zh('focusScope'),
    `${zh('taskTitle')}${task.title}`,
    `${zh('taskDescription')}${task.description}`,
    `${zh('fileScopes')}${task.fileScopes.join(', ')}`,
    dependencies.length > 0 ? `${zh('dependencyResults')}\n${dependencyText}` : zh('dependencyNone'),
    '',
    `${zh('originalTask')}\n${userInput}`,
    '',
    `${zh('assignment')}\n${task.prompt}`,
  ].join('\n');
}

function appendWorktreeContext(runtimeContext: string | null, worktree: MultiAgentWorktreeInfo | undefined, language: 'zh-CN' | 'en-US'): string | null {
  if (!worktree) return runtimeContext;
  const text = language === 'en-US'
    ? [
        'RoxyCode multi-agent worktree isolation:',
        `- path: ${worktree.path}`,
        `- branch: ${worktree.branch}`,
        '- This sub-agent is isolated from the main workspace. It should still analyze only unless the main agent explicitly executes tools later.',
      ].join('\n')
    : [
        'RoxyCode \u591a Agent Worktree \u9694\u79bb:',
        `- \u8def\u5f84: ${worktree.path}`,
        `- \u5206\u652f: ${worktree.branch}`,
        '- \u5b50 Agent \u5904\u4e8e\u72ec\u7acb\u5de5\u4f5c\u6811\u4e2d\uff0c\u4f46\u5f53\u524d\u4ecd\u53ea\u505a\u5206\u6790\uff1b\u771f\u5b9e\u5de5\u5177\u6267\u884c\u7531\u4e3b Agent \u5728\u6743\u9650\u4fdd\u62a4\u4e0b\u5b8c\u6210\u3002',
      ].join('\n');
  return [runtimeContext, text].filter(Boolean).join('\n\n') || null;
}

function buildFailedResult(
  task: MultiAgentTask,
  agentId: string,
  message: string,
  status: 'failed' | 'conflict',
  duration: number,
): MultiAgentTaskResult {
  return {
    taskId: task.id,
    agentId,
    title: task.title,
    role: task.role,
    status,
    text: message,
    usage: { ...ZERO_USAGE },
    duration,
    fileScopes: task.fileScopes,
    error: message,
  };
}

function hasUnfinished(tasks: MultiAgentTask[]): boolean {
  return tasks.some(task => task.status === 'pending' || task.status === 'claimed' || task.status === 'running');
}

function addUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: (a.cost ?? 0) + (b.cost ?? 0) || undefined,
  };
}

function createRunId(sessionId: string): string {
  return `${safeId(sessionId)}-${Date.now().toString(36)}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48) || 'session';
}

function safeWorktreeSlug(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
  return safe || `agent-${Date.now().toString(36)}`;
}

const ZH = {
  task: '\u4efb\u52a1',
  dependsOnMissing: '\u4f9d\u8d56\u4e0d\u5b58\u5728\u7684\u4efb\u52a1',
  period: '\u3002',
  cannotRunBecauseDeps: '\u65e0\u6cd5\u8fd0\u884c\uff0c\u56e0\u4e3a\u4f9d\u8d56\u4efb\u52a1\u6ca1\u6709\u5b8c\u6210\u3002',
  alreadyClaimed: '\u5df2\u88ab\u5176\u4ed6 Agent \u8ba4\u9886\u3002',
  youAreSubAgent: '\u4f60\u662f RoxyCode Ultimate \u6a21\u5f0f\u4e2d\u7684\u5b50 Agent\uff1a',
  analyzeOnly: '\u4f60\u53ea\u80fd\u5206\u6790\u548c\u7ed9\u5efa\u8bae\uff0c\u4e0d\u8981\u58f0\u79f0\u81ea\u5df1\u5df2\u7ecf\u4fee\u6539\u6587\u4ef6\u3001\u6267\u884c\u547d\u4ee4\u6216\u6539\u53d8 Git \u72b6\u6001\u3002',
  focusScope: '\u8bf7\u805a\u7126\u4f60\u7684\u4efb\u52a1\u8303\u56f4\uff0c\u7ed9\u4e3b Agent \u8f93\u51fa\u7b80\u6d01\u3001\u53ef\u6267\u884c\u7684\u53d1\u73b0\u3001\u98ce\u9669\u548c\u5efa\u8bae\u3002',
  taskTitle: '\u4efb\u52a1\u6807\u9898\uff1a',
  taskDescription: '\u4efb\u52a1\u63cf\u8ff0\uff1a',
  fileScopes: '\u53ef\u80fd\u6d89\u53ca\u6587\u4ef6\u8303\u56f4\uff1a',
  dependencyResults: '\u4f9d\u8d56\u4efb\u52a1\u7ed3\u679c\uff1a',
  dependencyNone: '\u4f9d\u8d56\u4efb\u52a1\u7ed3\u679c\uff1a\u65e0',
  originalTask: '\u7528\u6237\u539f\u59cb\u4efb\u52a1\uff1a',
  assignment: '\u4f60\u7684\u5206\u5de5\uff1a',
} as const;

type ZhKey = keyof typeof ZH;

function zh(key: ZhKey): string {
  return ZH[key];
}
