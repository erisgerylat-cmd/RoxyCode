import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { okBody, resolveToolPath, stringArg } from '../utils/args.js';

export const writeFileTool: Tool = {
  definition: {
    name: 'write_file',
    description: '创建或覆盖文本文件。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要写入的文件路径。' },
        content: { type: 'string', description: '完整文件内容。' },
      },
      required: ['path', 'content'],
    },
  },
  isReadOnly: false,
  riskLevel: 'high',
  getAffectedPaths(args, ctx) {
    return [resolveToolPath(ctx, stringArg(args, 'path'))];
  },
  getPermissionPrompt(args, ctx) {
    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    return {
      title: ctx.language === 'en-US' ? 'Confirm file write' : '确认写入文件',
      message: ctx.language === 'en-US' ? 'This will create or overwrite a file.' : '该操作会创建或覆盖文件。',
      details: [`path: ${path}`, `content length: ${stringArg(args, 'content').length}`],
      riskLevel: 'high',
    };
  },
  async execute(args, ctx) {
    const started = Date.now();
    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    const content = stringArg(args, 'content');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
    const body = okBody('写入文件完成', [`path: ${path}`, `bytes: ${Buffer.byteLength(content, 'utf8')}`]);
    return {
      success: true,
      output: formatToolResult('write_file', true, body, ctx, { path, bytes: Buffer.byteLength(content, 'utf8') }),
      duration: Date.now() - started,
      metadata: { path, bytes: Buffer.byteLength(content, 'utf8') },
    };
  },
  getAuditSummary(args) {
    return { path: args.path, operation: 'write', chars: typeof args.content === 'string' ? args.content.length : 0 };
  },
};
