import { readFile, stat } from 'node:fs/promises';
import type { Tool } from '../types.js';
import { buildTool } from '../builder/ToolBuilder.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { okBody, optionalNumberArg, resolveToolPath, stringArg } from '../utils/args.js';
import { throwIfAborted } from '../utils/abort.js';
import { ensureFileReadState } from '../security/FileReadState.js';

export const readFileTool: Tool = buildTool({
  definition: {
    name: 'read_file',
    description: '读取文本文件内容，支持 offset/limit 分段读取。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要读取的文件路径，相对当前项目根目录。' },
        offset: { type: 'number', description: '起始行号，1 表示第一行。', default: 1 },
        limit: { type: 'number', description: '最多读取多少行。', default: 200 },
      },
      required: ['path'],
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
    return [resolveToolPath(ctx, stringArg(args, 'path'))];
  },
  async *stream(args, ctx) {
    const started = Date.now();
    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    const offset = Math.max(1, optionalNumberArg(args, 'offset') ?? 1);
    const limit = Math.max(1, optionalNumberArg(args, 'limit') ?? 200);
    throwIfAborted(ctx);
    const fileStat = await stat(path);
    yield { type: 'progress', progress: { type: 'file_read', stage: 'start', path, bytes: fileStat.size, offset, limit } };
    const content = await readFile(path, 'utf-8');
    throwIfAborted(ctx);
    const lines = content.split(/\r?\n/);
    const selected = lines.slice(offset - 1, offset - 1 + limit);
    const isPartialView = offset !== 1 || selected.length < lines.length;
    yield {
      type: 'progress',
      progress: {
        type: 'file_read',
        stage: 'complete',
        path,
        bytes: fileStat.size,
        totalLines: lines.length,
        offset,
        limit,
        selectedLines: selected.length,
        partial: isPartialView,
      },
    };
    ensureFileReadState(ctx).record({
      path,
      content,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      isPartialView,
      offset,
      limit,
      totalLines: lines.length,
    });

    const numbered = selected.map((line, index) => `${String(offset + index).padStart(5, ' ')} | ${line}`).join('\n');
    const endLine = selected.length > 0 ? offset + selected.length - 1 : offset - 1;
    const body = okBody('读取文件完成', [
      `path: ${path}`,
      `lines: ${offset}-${endLine} / ${lines.length}`,
      `partial: ${isPartialView}`,
      `content:\n${numbered}`,
    ]);
    return {
      success: true,
      output: formatToolResult('read_file', true, body, ctx, { path, offset, limit, totalLines: lines.length, isPartialView }),
      duration: Date.now() - started,
      metadata: { path, offset, limit, totalLines: lines.length, isPartialView },
    };
  },
  getAuditSummary(args, result) {
    return { path: args.path, operation: 'read', partial: result?.metadata?.isPartialView === true };
  },
});
