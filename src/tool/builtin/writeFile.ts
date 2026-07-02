import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { emitToolProgress } from '../progress/ToolProgress.js';
import { okBody, resolveToolPath, stringArg } from '../utils/args.js';
import { throwIfAborted } from '../utils/abort.js';
import { createDiffPreview } from '../utils/diff.js';
import { recordFullFileState, validateReadBeforeMutation } from '../security/FileMutationGuard.js';

export const writeFileTool: Tool = {
  definition: {
    name: 'write_file',
    description: '\u521b\u5efa\u6216\u8986\u76d6\u6587\u672c\u6587\u4ef6\u3002',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '\u8981\u5199\u5165\u7684\u6587\u4ef6\u8def\u5f84\u3002' },
        content: { type: 'string', description: '\u5b8c\u6574\u6587\u4ef6\u5185\u5bb9\u3002' },
      },
      required: ['path', 'content'],
    },
  },
  isReadOnly: false,
  riskLevel: 'high',
  concurrency: 'exclusive',
  concurrencySafe: false,
  destructive: true,
  interruptBehavior: 'block',
  isDestructive() {
    return true;
  },
  getAffectedPaths(args, ctx) {
    return [resolveToolPath(ctx, stringArg(args, 'path'))];
  },
  async preflight(args, ctx) {
    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    throwIfAborted(ctx);
    const validation = await validateReadBeforeMutation(path, ctx);
    throwIfAborted(ctx);
    return validation.error;
  },
  getPermissionPrompt(args, ctx) {
    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    const content = stringArg(args, 'content');
    const readRecord = ctx.fileReadState?.get(path);
    const oldContent = readRecord && !readRecord.isPartialView ? readRecord.content : '';
    const diff = createDiffPreview(oldContent, content, 24);
    return {
      title: ctx.language === 'en-US' ? 'Confirm file write' : '\u786e\u8ba4\u5199\u5165\u6587\u4ef6',
      message: ctx.language === 'en-US' ? 'This will create or overwrite a file.' : '\u8be5\u64cd\u4f5c\u4f1a\u521b\u5efa\u6216\u8986\u76d6\u6587\u4ef6\u3002',
      details: [
        `path: ${path}`,
        `operation: ${readRecord ? 'update' : 'create'}`,
        `content length: ${content.length}`,
        `change: +${diff.addedLines} -${diff.removedLines}`,
        `diff:\n${diff.preview}`,
      ],
      riskLevel: 'high',
    };
  },
  async execute(args, ctx) {
    const started = Date.now();
    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    const content = stringArg(args, 'content');
    throwIfAborted(ctx);
    const validation = await validateReadBeforeMutation(path, ctx);
    if (validation.error) throw new Error(validation.error);
    const oldContent = validation.snapshot.exists ? validation.snapshot.content : '';
    const diff = createDiffPreview(oldContent, content);
    emitToolProgress(ctx, { type: 'status', toolName: 'write_file', phase: 'execute', message: ctx.language === 'en-US' ? `Writing ${path}` : `正在写入 ${path}` });
    await mkdir(dirname(path), { recursive: true });
    throwIfAborted(ctx);
    await writeFile(path, content, 'utf-8');
    throwIfAborted(ctx);
    await recordFullFileState(path, content, ctx);
    emitToolProgress(ctx, { type: 'status', toolName: 'write_file', phase: 'complete', message: ctx.language === 'en-US' ? `Wrote ${path}` : `已写入 ${path}` });
    const bytes = Buffer.byteLength(content, 'utf8');
    const operation = validation.snapshot.exists ? 'update' : 'create';
    const body = okBody('\u5199\u5165\u6587\u4ef6\u5b8c\u6210', [
      `path: ${path}`,
      `operation: ${operation}`,
      `bytes: ${bytes}`,
      `change: +${diff.addedLines} -${diff.removedLines}`,
      `diff:\n${diff.preview}`,
    ]);
    return {
      success: true,
      output: formatToolResult('write_file', true, body, ctx, { path, bytes, operation, diff }),
      duration: Date.now() - started,
      metadata: { path, bytes, operation, diff },
    };
  },
  getAuditSummary(args, result) {
    return {
      path: args.path,
      operation: result?.metadata?.operation ?? 'write',
      chars: typeof args.content === 'string' ? args.content.length : 0,
      diff: result?.metadata?.diff,
    };
  },
};

