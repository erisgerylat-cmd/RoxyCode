import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { okBody, optionalNumberArg, optionalStringArg, resolveToolPath, stringArg } from '../utils/args.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.tmp-home']);

export const grepSearchTool: Tool = {
  definition: {
    name: 'grep_search',
    description: '在项目文件中搜索文本或正则。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '搜索文本或 JavaScript 正则表达式。' },
        path: { type: 'string', description: '搜索目录或文件。', default: '.' },
        max_results: { type: 'number', description: '最多返回结果数。', default: 100 },
      },
      required: ['pattern'],
    },
  },
  isReadOnly: true,
  riskLevel: 'low',
  getAffectedPaths(args, ctx) {
    return [resolveToolPath(ctx, optionalStringArg(args, 'path') ?? '.')];
  },
  async execute(args, ctx) {
    const started = Date.now();
    const pattern = stringArg(args, 'pattern');
    const root = resolveToolPath(ctx, optionalStringArg(args, 'path') ?? '.');
    const maxResults = Math.max(1, optionalNumberArg(args, 'max_results') ?? 100);
    const regex = new RegExp(pattern, 'i');
    const results: string[] = [];
    await searchPath(root, regex, results, maxResults);
    const body = okBody('搜索完成', [`pattern: ${pattern}`, `path: ${root}`, `matches: ${results.length}`, results.join('\n') || 'No matches']);
    return {
      success: true,
      output: formatToolResult('grep_search', true, body, ctx, { pattern, path: root, matches: results.length }),
      duration: Date.now() - started,
      metadata: { pattern, path: root, matches: results.length, truncated: results.length >= maxResults },
    };
  },
  getAuditSummary(args) {
    return { path: args.path ?? '.', pattern: args.pattern, operation: 'grep' };
  },
};

async function searchPath(path: string, regex: RegExp, results: string[], maxResults: number): Promise<void> {
  if (results.length >= maxResults || !existsSync(path)) return;
  const info = await stat(path);
  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      await searchPath(join(path, entry.name), regex, results, maxResults);
    }
    return;
  }
  if (!info.isFile() || info.size > 1024 * 1024) return;
  const content = await readFile(path, 'utf-8').catch(() => null);
  if (content === null) return;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (results.length >= maxResults) return;
    if (regex.test(lines[i])) results.push(`${path}:${i + 1}: ${lines[i]}`);
  }
}
