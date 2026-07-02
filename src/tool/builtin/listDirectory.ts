import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { emitToolProgress } from '../progress/ToolProgress.js';
import { okBody, optionalNumberArg, optionalStringArg, resolveToolPath } from '../utils/args.js';
import { throwIfAborted } from '../utils/abort.js';

export const listDirectoryTool: Tool = {
  definition: {
    name: 'list_directory',
    description: '列出目录内容。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径。', default: '.' },
        max_entries: { type: 'number', description: '最多返回条目数。', default: 200 },
      },
    },
  },
  isReadOnly: true,
  riskLevel: 'low',
  concurrency: 'safe',
  concurrencySafe: true,
  destructive: false,
  interruptBehavior: 'cancel',
  isDestructive() {
    return false;
  },
  getAffectedPaths(args, ctx) {
    return [resolveToolPath(ctx, optionalStringArg(args, 'path') ?? '.')];
  },
  async execute(args, ctx) {
    const started = Date.now();
    const path = resolveToolPath(ctx, optionalStringArg(args, 'path') ?? '.');
    const maxEntries = Math.max(1, optionalNumberArg(args, 'max_entries') ?? 200);
    throwIfAborted(ctx);
    emitToolProgress(ctx, { type: 'status', toolName: 'list_directory', phase: 'execute', message: ctx.language === 'en-US' ? `Listing ${path}` : `正在列出 ${path}` });
    const entries = await readdir(path, { withFileTypes: true });
    throwIfAborted(ctx);
    const selected = entries.slice(0, maxEntries);
    const lines = await Promise.all(selected.map(async entry => {
      throwIfAborted(ctx);
      const full = join(path, entry.name);
      const info = await stat(full).catch(() => null);
      const kind = entry.isDirectory() ? 'dir ' : entry.isFile() ? 'file' : 'node';
      const size = info?.isFile() ? `${info.size}b` : '';
      return `${kind.padEnd(4)} ${entry.name}${size ? ` ${size}` : ''}`;
    }));
    emitToolProgress(ctx, { type: 'status', toolName: 'list_directory', phase: 'complete', message: ctx.language === 'en-US' ? `Listed ${selected.length}/${entries.length} entries` : `已列出 ${selected.length}/${entries.length} 个条目` });
    const body = okBody('列出目录完成', [`path: ${path}`, `entries: ${selected.length}/${entries.length}`, lines.join('\n') || '(empty)']);
    return {
      success: true,
      output: formatToolResult('list_directory', true, body, ctx, { path, entries: selected.length, total: entries.length }),
      duration: Date.now() - started,
      metadata: { path, entries: selected.length, total: entries.length, truncated: entries.length > selected.length },
    };
  },
  getAuditSummary(args) {
    return { path: args.path ?? '.', operation: 'list' };
  },
};
