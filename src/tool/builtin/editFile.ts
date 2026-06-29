import { readFile, writeFile } from 'node:fs/promises';
import type { Tool } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { okBody, optionalBooleanArg, resolveToolPath, stringArg } from '../utils/args.js';

export const editFileTool: Tool = {
  definition: {
    name: 'edit_file',
    description: '用 old_string/new_string 修改文件内容。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要编辑的文件路径。' },
        old_string: { type: 'string', description: '要替换的原始文本。' },
        new_string: { type: 'string', description: '替换后的文本。' },
        replace_all: { type: 'boolean', description: '是否替换所有匹配。', default: false },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  isReadOnly: false,
  riskLevel: 'high',
  getAffectedPaths(args, ctx) {
    return [resolveToolPath(ctx, stringArg(args, 'path'))];
  },
  async preflight(args, ctx) {
    const oldString = stringArg(args, 'old_string');
    const newString = stringArg(args, 'new_string');
    if (oldString === newString) return 'old_string 与 new_string 完全相同，没有可执行的修改。';
    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    const content = await readFile(path, 'utf-8').catch(() => null);
    if (content === null) return `文件不存在: ${path}`;
    if (!content.includes(oldString)) return '文件中未找到 old_string。';
    const matches = content.split(oldString).length - 1;
    if (matches > 1 && !optionalBooleanArg(args, 'replace_all')) {
      return `找到 ${matches} 处匹配，但 replace_all=false。请提供更精确的 old_string 或启用 replace_all。`;
    }
    return null;
  },
  getPermissionPrompt(args, ctx) {
    return {
      title: ctx.language === 'en-US' ? 'Confirm file edit' : '确认编辑文件',
      message: ctx.language === 'en-US' ? 'This will modify file contents.' : '该操作会修改文件内容。',
      details: [`path: ${resolveToolPath(ctx, stringArg(args, 'path'))}`, `old length: ${stringArg(args, 'old_string').length}`, `new length: ${stringArg(args, 'new_string').length}`],
      riskLevel: 'high',
    };
  },
  async execute(args, ctx) {
    const started = Date.now();
    const path = resolveToolPath(ctx, stringArg(args, 'path'));
    const oldString = stringArg(args, 'old_string');
    const newString = stringArg(args, 'new_string');
    const replaceAll = optionalBooleanArg(args, 'replace_all') ?? false;
    const content = await readFile(path, 'utf-8');
    const updated = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
    await writeFile(path, updated, 'utf-8');
    const body = okBody('编辑文件完成', [`path: ${path}`, `replace_all: ${replaceAll}`, `changed_chars: ${updated.length - content.length}`]);
    return {
      success: true,
      output: formatToolResult('edit_file', true, body, ctx, { path, replaceAll }),
      duration: Date.now() - started,
      metadata: { path, replaceAll, beforeChars: content.length, afterChars: updated.length },
    };
  },
  getAuditSummary(args) {
    return { path: args.path, operation: 'edit', replaceAll: args.replace_all === true };
  },
};
