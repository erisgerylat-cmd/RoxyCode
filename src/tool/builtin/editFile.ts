import { writeFile } from 'node:fs/promises';
import type { Tool } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { okBody, optionalBooleanArg, resolveToolPath, stringArg } from '../utils/args.js';
import { throwIfAborted } from '../utils/abort.js';
import { createDiffPreview } from '../utils/diff.js';
import { recordFullFileState, validateReadBeforeMutation } from '../security/FileMutationGuard.js';

export const editFileTool: Tool = {
  definition: {
    name: 'edit_file',
    description: '\u7528 old_string/new_string \u4fee\u6539\u6587\u4ef6\u5185\u5bb9\u3002',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '\u8981\u7f16\u8f91\u7684\u6587\u4ef6\u8def\u5f84\u3002' },
        old_string: { type: 'string', description: '\u8981\u66ff\u6362\u7684\u539f\u59cb\u6587\u672c\u3002' },
        new_string: { type: 'string', description: '\u66ff\u6362\u540e\u7684\u6587\u672c\u3002' },
        replace_all: { type: 'boolean', description: '\u662f\u5426\u66ff\u6362\u6240\u6709\u5339\u914d\u3002', default: false },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  isReadOnly: false,
  riskLevel: 'high',
  concurrency: 'exclusive',
  interruptBehavior: 'block',
  getAffectedPaths(args, ctx) {
    return [resolveToolPath(ctx, stringArg(args, 'path'))];
  },
  async preflight(args, ctx) {
    const oldString = stringArg(args, 'old_string');
    const newString = stringArg(args, 'new_string');
    if (oldString === newString) {
      return ctx.language === 'en-US'
        ? 'old_string and new_string are identical; there is no edit to apply.'
        : 'old_string \u548c new_string \u5b8c\u5168\u76f8\u540c\uff0c\u6ca1\u6709\u53ef\u6267\u884c\u7684\u4fee\u6539\u3002';
    }

    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    throwIfAborted(ctx);
    const validation = await validateReadBeforeMutation(path, ctx);
    throwIfAborted(ctx);
    if (validation.error) return validation.error;
    if (!validation.snapshot.exists) {
      return ctx.language === 'en-US' ? `File does not exist: ${path}` : `\u6587\u4ef6\u4e0d\u5b58\u5728: ${path}`;
    }

    const content = validation.snapshot.content;
    if (!content.includes(oldString)) {
      return ctx.language === 'en-US' ? 'old_string was not found in the file.' : '\u6587\u4ef6\u4e2d\u672a\u627e\u5230 old_string\u3002';
    }
    const matches = content.split(oldString).length - 1;
    if (matches > 1 && !optionalBooleanArg(args, 'replace_all')) {
      return ctx.language === 'en-US'
        ? `Found ${matches} matches, but replace_all=false. Provide a more specific old_string or enable replace_all.`
        : `\u627e\u5230 ${matches} \u5904\u5339\u914d\uff0c\u4f46 replace_all=false\u3002\u8bf7\u63d0\u4f9b\u66f4\u7cbe\u786e\u7684 old_string \u6216\u542f\u7528 replace_all\u3002`;
    }
    return null;
  },
  getPermissionPrompt(args, ctx) {
    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    const oldString = stringArg(args, 'old_string');
    const newString = stringArg(args, 'new_string');
    const replaceAll = optionalBooleanArg(args, 'replace_all') ?? false;
    const readRecord = ctx.fileReadState?.get(path);
    const previewSource = readRecord?.content ?? oldString;
    const previewTarget = replaceAll ? previewSource.split(oldString).join(newString) : previewSource.replace(oldString, newString);
    const diff = createDiffPreview(previewSource, previewTarget, 24);
    return {
      title: ctx.language === 'en-US' ? 'Confirm file edit' : '\u786e\u8ba4\u7f16\u8f91\u6587\u4ef6',
      message: ctx.language === 'en-US' ? 'This will modify file contents.' : '\u8be5\u64cd\u4f5c\u4f1a\u4fee\u6539\u6587\u4ef6\u5185\u5bb9\u3002',
      details: [
        `path: ${path}`,
        `replace_all: ${replaceAll}`,
        `old length: ${oldString.length}`,
        `new length: ${newString.length}`,
        `change: +${diff.addedLines} -${diff.removedLines}`,
        `diff:\n${diff.preview}`,
      ],
      riskLevel: 'high',
    };
  },
  async execute(args, ctx) {
    const started = Date.now();
    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    const oldString = stringArg(args, 'old_string');
    const newString = stringArg(args, 'new_string');
    const replaceAll = optionalBooleanArg(args, 'replace_all') ?? false;
    throwIfAborted(ctx);
    const validation = await validateReadBeforeMutation(path, ctx);
    if (validation.error) throw new Error(validation.error);
    const content = validation.snapshot.content;
    const updated = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
    const diff = createDiffPreview(content, updated);
    throwIfAborted(ctx);
    await writeFile(path, updated, 'utf-8');
    throwIfAborted(ctx);
    await recordFullFileState(path, updated, ctx);
    const body = okBody('\u7f16\u8f91\u6587\u4ef6\u5b8c\u6210', [
      `path: ${path}`,
      `replace_all: ${replaceAll}`,
      `changed_chars: ${updated.length - content.length}`,
      `change: +${diff.addedLines} -${diff.removedLines}`,
      `diff:\n${diff.preview}`,
    ]);
    return {
      success: true,
      output: formatToolResult('edit_file', true, body, ctx, { path, replaceAll, diff }),
      duration: Date.now() - started,
      metadata: { path, replaceAll, beforeChars: content.length, afterChars: updated.length, diff },
    };
  },
  getAuditSummary(args, result) {
    return { path: args.path, operation: 'edit', replaceAll: args.replace_all === true, diff: result?.metadata?.diff };
  },
};
