import type { ToolCall, ToolResult } from '../../core/types/message.js';
import type { Tool, ToolExecutionContext, ToolExecutor, ToolInvocation, ToolProgressEvent } from '../../tool/index.js';

export type StreamingToolExecutorEvent =
  | { type: 'tool_execution_start'; toolCall: ToolCall }
  | { type: 'tool_progress'; toolCall: ToolCall; progress: ToolProgressEvent }
  | { type: 'tool_result'; toolCall: ToolCall; result: ToolResult };

export interface StreamingToolExecutorOptions {
  toolExecutor: ToolExecutor;
  tools: Tool[];
  context: ToolExecutionContext;
  maxConcurrency?: number;
}

type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded';

type TrackedTool = {
  toolCall: ToolCall;
  status: ToolStatus;
  concurrencySafe: boolean;
  interruptBehavior: 'cancel' | 'block';
  promise?: Promise<void>;
  result?: ToolResult;
};

/**
 * RoxyCode's conservative streaming tool scheduler.
 * It allows safe read/deferred tools to overlap, keeps write/high-risk tools exclusive,
 * yields structured progress events, and always yields tool_result events in the
 * original tool_call order.
 */
export class StreamingToolExecutor {
  private readonly toolMetadata = new Map<string, Tool>();
  private readonly queue: TrackedTool[] = [];
  private readonly maxConcurrency: number;
  private readonly pendingProgress: Array<{ toolCall: ToolCall; progress: ToolProgressEvent }> = [];
  private readonly progressWaiters: Array<() => void> = [];
  private discarded = false;

  constructor(private readonly options: StreamingToolExecutorOptions) {
    for (const tool of options.tools) this.toolMetadata.set(tool.definition.name, tool);
    this.maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? 3));
  }

  addTool(toolCall: ToolCall): void {
    const tool = this.toolMetadata.get(toolCall.name);
    const tracked: TrackedTool = {
      toolCall,
      status: 'queued',
      concurrencySafe: tool ? isConcurrencySafe(tool, toolCall.arguments, this.options.context) : true,
      interruptBehavior: tool?.interruptBehavior ?? (tool?.isReadOnly ? 'cancel' : 'block'),
    };
    this.queue.push(tracked);
  }

  discard(): void {
    this.discarded = true;
    this.wakeProgressWaiters();
  }

  async *run(): AsyncGenerator<StreamingToolExecutorEvent> {
    while (this.hasPendingWork()) {
      const started = this.startRunnableTools();
      for (const tool of started) yield { type: 'tool_execution_start', toolCall: tool.toolCall };

      yield* this.drainProgressEvents();
      for (const event of this.drainCompletedInOrder()) yield event;
      if (!this.hasPendingWork()) break;

      const executing = this.queue.filter(tool => tool.status === 'executing' && tool.promise).map(tool => tool.promise!);
      if (executing.length === 0) {
        this.completeUnfinishedWithSyntheticResult('no_executor_progress');
        continue;
      }
      const waiters = executing.map(promise => promise.catch(() => undefined));
      waiters.push(this.waitForProgress());
      if (!this.discarded && !this.options.context.signal?.aborted) waiters.push(this.waitForAbort());
      await Promise.race(waiters);
      if (this.discarded || this.options.context.signal?.aborted) {
        this.completeUnfinishedWithSyntheticResult(this.discarded ? 'discarded' : 'aborted');
      }
    }

    yield* this.drainProgressEvents();
    for (const event of this.drainCompletedInOrder()) yield event;
  }

  private startRunnableTools(): TrackedTool[] {
    if (this.discarded || this.options.context.signal?.aborted) {
      this.completeUnfinishedWithSyntheticResult(this.discarded ? 'discarded' : 'aborted');
      return [];
    }

    const started: TrackedTool[] = [];
    for (const tool of this.queue) {
      if (tool.status !== 'queued') continue;
      if (!this.canStart(tool)) {
        if (!tool.concurrencySafe) break;
        continue;
      }
      this.startTool(tool);
      started.push(tool);
    }
    return started;
  }

  private canStart(candidate: TrackedTool): boolean {
    const executing = this.queue.filter(tool => tool.status === 'executing');
    if (executing.length >= this.maxConcurrency) return false;
    if (executing.length === 0) return true;
    return candidate.concurrencySafe && executing.every(tool => tool.concurrencySafe);
  }

  private startTool(tool: TrackedTool): void {
    tool.status = 'executing';
    tool.promise = this.execute(tool).then(result => {
      if (tool.status === 'yielded' || tool.result?.metadata?.synthetic === true) return;
      tool.result = result;
      tool.status = 'completed';
      this.wakeProgressWaiters();
    }).catch(error => {
      if (tool.status === 'yielded' || tool.result?.metadata?.synthetic === true) return;
      tool.result = syntheticToolResult(tool.toolCall.name, this.options.context, 'execution_error', error instanceof Error ? error.message : String(error));
      tool.status = 'completed';
      this.wakeProgressWaiters();
    });
  }

  private async execute(tool: TrackedTool): Promise<ToolResult> {
    if (this.discarded) return syntheticToolResult(tool.toolCall.name, this.options.context, 'discarded');
    if (this.options.context.signal?.aborted) return syntheticToolResult(tool.toolCall.name, this.options.context, 'aborted');
    const invocation: ToolInvocation = {
      id: tool.toolCall.id,
      name: tool.toolCall.name,
      arguments: tool.toolCall.arguments,
    };
    const context = tool.interruptBehavior === 'block'
      ? { ...this.options.context, signal: undefined }
      : this.options.context;
    const previousProgress = context.onProgress;
    const scopedContext: ToolExecutionContext = {
      ...context,
      onProgress: event => {
        previousProgress?.(event);
        this.enqueueProgress(tool.toolCall, event);
      },
    };
    return this.options.toolExecutor.execute(invocation, scopedContext);
  }

  private *drainProgressEvents(): Generator<StreamingToolExecutorEvent> {
    while (this.pendingProgress.length > 0) {
      const event = this.pendingProgress.shift()!;
      yield { type: 'tool_progress', toolCall: event.toolCall, progress: event.progress };
    }
  }

  private *drainCompletedInOrder(): Generator<StreamingToolExecutorEvent> {
    for (const tool of this.queue) {
      if (tool.status === 'yielded') continue;
      if (tool.status !== 'completed' || !tool.result) break;
      tool.status = 'yielded';
      yield { type: 'tool_result', toolCall: tool.toolCall, result: tool.result };
    }
  }

  private enqueueProgress(toolCall: ToolCall, progress: ToolProgressEvent): void {
    this.pendingProgress.push({ toolCall, progress });
    this.wakeProgressWaiters();
  }

  private waitForProgress(): Promise<void> {
    if (this.pendingProgress.length > 0) return Promise.resolve();
    return new Promise(resolve => this.progressWaiters.push(resolve));
  }

  private wakeProgressWaiters(): void {
    const waiters = this.progressWaiters.splice(0);
    for (const wake of waiters) wake();
  }

  private completeUnfinishedWithSyntheticResult(reason: SyntheticReason): void {
    for (const tool of this.queue) {
      if (tool.status !== 'queued' && tool.status !== 'executing') continue;
      if (reason === 'aborted' && tool.status === 'executing' && tool.interruptBehavior === 'block') continue;
      if (tool.result) continue;
      tool.result = syntheticToolResult(tool.toolCall.name, this.options.context, reason);
      tool.status = 'completed';
    }
    this.wakeProgressWaiters();
  }

  private waitForAbort(): Promise<void> {
    const signal = this.options.context.signal;
    if (!signal) return new Promise(() => undefined);
    if (signal.aborted) return Promise.resolve();
    return new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
  }

  private hasPendingWork(): boolean {
    return this.queue.some(tool => tool.status !== 'yielded');
  }
}

type SyntheticReason = 'aborted' | 'discarded' | 'execution_error' | 'no_executor_progress';

function isConcurrencySafe(tool: Tool, args: Record<string, unknown>, ctx: ToolExecutionContext): boolean {
  if (tool.isConcurrencySafe) {
    try {
      return tool.isConcurrencySafe(args, ctx);
    } catch {
      return false;
    }
  }
  if (typeof tool.concurrencySafe === 'boolean') return tool.concurrencySafe;
  if (tool.concurrency) return tool.concurrency === 'safe';
  if (tool.shouldDefer) return true;
  return tool.isReadOnly && tool.riskLevel === 'low';
}

function syntheticToolResult(toolName: string, ctx: ToolExecutionContext, reason: SyntheticReason, detail?: string): ToolResult {
  const started = Date.now();
  const isZh = ctx.language !== 'en-US';
  const reasonText = syntheticReasonText(reason, isZh);
  const detailText = detail ? `\n${isZh ? '\u7ec6\u8282' : 'Detail'}: ${detail}` : '';
  const body = `<tool_result name="${toolName}" status="error">\n${reasonText}${detailText}\nmetadata: ${JSON.stringify({ tool: toolName, synthetic: true, reason })}\n</tool_result>`;
  return {
    success: false,
    output: body,
    error: `${reasonText}${detail ? `: ${detail}` : ''}`,
    duration: Date.now() - started,
    metadata: { tool: toolName, synthetic: true, reason, detail },
  };
}

function syntheticReasonText(reason: SyntheticReason, isZh: boolean): string {
  if (!isZh) {
    switch (reason) {
      case 'aborted': return 'Tool execution was aborted before it could run.';
      case 'discarded': return 'Tool execution was discarded because the streaming attempt was reset.';
      case 'execution_error': return 'Tool execution failed inside the streaming executor.';
      case 'no_executor_progress': return 'Tool execution could not make progress in the scheduler.';
    }
  }
  switch (reason) {
    case 'aborted': return '\u5de5\u5177\u6267\u884c\u5728\u8fd0\u884c\u524d\u88ab\u4e2d\u6b62\u3002';
    case 'discarded': return '\u7531\u4e8e\u6d41\u5f0f\u6267\u884c\u5c1d\u8bd5\u88ab\u91cd\u7f6e\uff0c\u5de5\u5177\u6267\u884c\u7ed3\u679c\u5df2\u4e22\u5f03\u3002';
    case 'execution_error': return '\u5de5\u5177\u5728\u6d41\u5f0f\u6267\u884c\u8c03\u5ea6\u5668\u5185\u90e8\u5931\u8d25\u3002';
    case 'no_executor_progress': return '\u5de5\u5177\u8c03\u5ea6\u5668\u65e0\u6cd5\u7ee7\u7eed\u63a8\u8fdb\u6267\u884c\u3002';
  }
}
