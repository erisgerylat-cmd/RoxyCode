import type { Tool, ToolConcurrency, ToolInterruptBehavior } from '../types.js';

export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;

export interface ToolBuilderOptions {
  aliases?: string[];
  searchHint?: string;
  maxResultSizeChars?: number;
  strict?: boolean;
  shouldDefer?: boolean;
  concurrency?: ToolConcurrency;
  interruptBehavior?: ToolInterruptBehavior;
}

export function buildTool(tool: Tool): Tool {
  return withToolDefaults(tool);
}

export function withToolDefaults(tool: Tool, options: ToolBuilderOptions = {}): Tool {
  return {
    ...tool,
    aliases: options.aliases ?? tool.aliases ?? [],
    searchHint: options.searchHint ?? tool.searchHint,
    maxResultSizeChars: options.maxResultSizeChars ?? tool.maxResultSizeChars ?? DEFAULT_MAX_RESULT_SIZE_CHARS,
    strict: options.strict ?? tool.strict,
    shouldDefer: options.shouldDefer ?? tool.shouldDefer,
    concurrency: options.concurrency ?? tool.concurrency ?? inferConcurrency(tool),
    interruptBehavior: options.interruptBehavior ?? tool.interruptBehavior ?? inferInterruptBehavior(tool),
  };
}

export function normalizeToolName(value: string): string {
  return value.trim();
}

function inferConcurrency(tool: Tool): ToolConcurrency {
  if (tool.shouldDefer) return 'safe';
  return tool.isReadOnly && tool.riskLevel === 'low' ? 'safe' : 'exclusive';
}

function inferInterruptBehavior(tool: Tool): ToolInterruptBehavior {
  return tool.isReadOnly || tool.shouldDefer ? 'cancel' : 'block';
}