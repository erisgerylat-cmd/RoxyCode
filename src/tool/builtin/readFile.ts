import { readFile, stat } from 'node:fs/promises';
import type { Tool } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { emitToolProgress } from '../progress/ToolProgress.js';
import { okBody, optionalNumberArg, resolveToolPath, stringArg } from '../utils/args.js';
import { throwIfAborted } from '../utils/abort.js';
import { ensureFileReadState } from '../security/FileReadState.js';

export const readFileTool: Tool = {
  definition: {
    name: 'read_file',
    description: '\u8bfb\u53d6\u6587\u672c\u6587\u4ef6\u5185\u5bb9\uff0c\u652f\u6301 offset/limit \u5206\u6bb5\u8bfb\u53d6\u3002',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '\u8981\u8bfb\u53d6\u7684\u6587\u4ef6\u8def\u5f84\uff0c\u76f8\u5bf9\u5f53\u524d\u9879\u76ee\u6839\u76ee\u5f55\u3002' },
        offset: { type: 'number', description: '\u8d77\u59cb\u884c\u53f7\uff0c1 \u8868\u793a\u7b2c\u4e00\u884c\u3002', default: 1 },
        limit: { type: 'number', description: '\u6700\u591a\u8bfb\u53d6\u591a\u5c11\u884c\u3002', default: 200 },
      },
      required: ['path'],
    },
  },
  isReadOnly: true,
  riskLevel: 'low',
  concurrency: 'safe',
  interruptBehavior: 'cancel',
  isDestructive() {
    return false;
  },
  getAffectedPaths(args, ctx) {
    return [resolveToolPath(ctx, stringArg(args, 'path'))];
  },
  async execute(args, ctx) {
    const started = Date.now();
    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    const offset = Math.max(1, optionalNumberArg(args, 'offset') ?? 1);
    const limit = Math.max(1, optionalNumberArg(args, 'limit') ?? 200);
    throwIfAborted(ctx);
    const fileStat = await stat(path);
    emitToolProgress(ctx, { type: 'file_read', stage: 'start', path, bytes: fileStat.size, offset, limit });
    const content = await readFile(path, 'utf-8');
    throwIfAborted(ctx);
    const lines = content.split(/\r?\n/);
    const selected = lines.slice(offset - 1, offset - 1 + limit);
    const isPartialView = offset !== 1 || selected.length < lines.length;
    emitToolProgress(ctx, {
      type: 'file_read',
      stage: 'complete',
      path,
      bytes: fileStat.size,
      totalLines: lines.length,
      offset,
      limit,
      selectedLines: selected.length,
      partial: isPartialView,
    });
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
    const body = okBody('\u8bfb\u53d6\u6587\u4ef6\u5b8c\u6210', [
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
};
