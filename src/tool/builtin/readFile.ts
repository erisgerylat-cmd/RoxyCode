import { readFile } from 'node:fs/promises';
import type { Tool } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { okBody, optionalNumberArg, resolveToolPath, stringArg, truncate } from '../utils/args.js';

export const readFileTool: Tool = {
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
  getAffectedPaths(args, ctx) {
    return [resolveToolPath(ctx, stringArg(args, 'path'))];
  },
  async execute(args, ctx) {
    const started = Date.now();
    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    const offset = Math.max(1, optionalNumberArg(args, 'offset') ?? 1);
    const limit = Math.max(1, optionalNumberArg(args, 'limit') ?? 200);
    const content = await readFile(path, 'utf-8');
    const lines = content.split(/\r?\n/);
    const selected = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = selected.map((line, index) => `${String(offset + index).padStart(5, ' ')} | ${line}`).join('\n');
    const body = okBody('读取文件完成', [
      `path: ${path}`,
      `lines: ${offset}-${offset + selected.length - 1} / ${lines.length}`,
      `content:\n${numbered}`,
    ]);
    return {
      success: true,
      output: formatToolResult('read_file', true, body, ctx, { path, offset, limit, totalLines: lines.length }),
      duration: Date.now() - started,
      metadata: { path, offset, limit, totalLines: lines.length },
    };
  },
  getAuditSummary(args) {
    return { path: args.path, operation: 'read' };
  },
};
