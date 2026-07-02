import type { Tool, ToolConcurrency, ToolExecutionContext, ToolInterruptBehavior, ToolStream, ToolStreamEvent } from '../types.js';
import type { ToolResult } from '../../core/types/message.js';
import { emitToolProgress } from '../progress/ToolProgress.js';

export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;

export interface ToolBuilderOptions {
  aliases?: string[];
  searchHint?: string;
  maxResultSizeChars?: number;
  strict?: boolean;
  shouldDefer?: boolean;
  concurrency?: ToolConcurrency;
  interruptBehavior?: ToolInterruptBehavior;
  concurrencySafe?: boolean;
  destructive?: boolean;
}

export function buildTool(tool: Tool): Tool {
  return withToolDefaults(tool);
}

export function withToolDefaults(tool: Tool, options: ToolBuilderOptions = {}): Tool {
  const concurrencySafe = options.concurrencySafe ?? tool.concurrencySafe ?? inferConcurrencySafe(tool);
  const destructive = options.destructive ?? tool.destructive ?? inferDestructive(tool);
  const execute = tool.execute ?? (tool.stream ? createStreamExecutor(tool) : undefined);
  if (!execute) {
    throw new Error(`Tool must define execute() or stream(): ${tool.definition.name}`);
  }

  return {
    ...tool,
    aliases: options.aliases ?? tool.aliases ?? [],
    searchHint: options.searchHint ?? tool.searchHint,
    maxResultSizeChars: options.maxResultSizeChars ?? tool.maxResultSizeChars ?? DEFAULT_MAX_RESULT_SIZE_CHARS,
    strict: options.strict ?? tool.strict,
    shouldDefer: options.shouldDefer ?? tool.shouldDefer,
    concurrencySafe,
    destructive,
    concurrency: options.concurrency ?? tool.concurrency ?? (concurrencySafe ? 'safe' : 'exclusive'),
    interruptBehavior: options.interruptBehavior ?? tool.interruptBehavior ?? inferInterruptBehavior(tool, concurrencySafe),
    execute,
  };
}

export function normalizeToolName(value: string): string {
  return value.trim();
}

function createStreamExecutor(tool: Tool): NonNullable<Tool['execute']> {
  return async (args, ctx) => consumeToolStream(tool.stream!(args, ctx), ctx, tool.definition.name);
}

async function consumeToolStream(stream: ToolStream, ctx: ToolExecutionContext, toolName: string): Promise<ToolResult> {
  const iterator = stream[Symbol.asyncIterator]();
  let result: ToolResult | undefined;

  while (true) {
    const next = await iterator.next();
    if (next.done) {
      if (isToolResult(next.value)) result = next.value;
      break;
    }

    const event = next.value as ToolStreamEvent;
    if (event.type === 'progress') {
      emitToolProgress(ctx, event.progress);
    } else if (event.type === 'result') {
      result = event.result;
    }
  }

  if (!result) throw new Error(`Tool stream completed without a result: ${toolName}`);
  return result;
}

function inferConcurrencySafe(tool: Tool): boolean {
  if (typeof tool.concurrencySafe === 'boolean') return tool.concurrencySafe;
  if (tool.concurrency) return tool.concurrency === 'safe';
  if (tool.shouldDefer) return true;
  return tool.isReadOnly && tool.riskLevel === 'low';
}

function inferDestructive(tool: Tool): boolean {
  if (typeof tool.destructive === 'boolean') return tool.destructive;
  if (tool.isReadOnly) return false;
  return tool.riskLevel === 'high';
}

function inferInterruptBehavior(tool: Tool, concurrencySafe: boolean): ToolInterruptBehavior {
  return tool.isReadOnly || tool.shouldDefer || concurrencySafe ? 'cancel' : 'block';
}

function isToolResult(value: unknown): value is ToolResult {
  return typeof value === 'object'
    && value !== null
    && typeof (value as ToolResult).success === 'boolean'
    && typeof (value as ToolResult).output === 'string';
}
