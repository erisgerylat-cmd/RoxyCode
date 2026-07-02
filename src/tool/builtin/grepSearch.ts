import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool, ToolExecutionContext, ToolProgressEvent } from '../types.js';
import { buildTool } from '../builder/ToolBuilder.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { okBody, optionalNumberArg, optionalStringArg, resolveToolPath, stringArg } from '../utils/args.js';
import { throwIfAborted } from '../utils/abort.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.tmp-home']);

export const grepSearchTool: Tool = buildTool({
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
  async *stream(args, ctx) {
    const started = Date.now();
    const pattern = stringArg(args, 'pattern');
    const root = resolveToolPath(ctx, optionalStringArg(args, 'path') ?? '.');
    const maxResults = Math.max(1, optionalNumberArg(args, 'max_results') ?? 100);
    const regex = new RegExp(pattern, 'i');
    const results: string[] = [];
    throwIfAborted(ctx);
    yield { type: 'progress', progress: { type: 'search_start', pattern, path: root, maxResults } };
    for await (const progress of searchPath(root, regex, results, maxResults, ctx)) {
      yield { type: 'progress', progress };
    }
    throwIfAborted(ctx);
    yield { type: 'progress', progress: { type: 'search_complete', pattern, path: root, matches: results.length, truncated: results.length >= maxResults } };
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
});

async function* searchPath(path: string, regex: RegExp, results: string[], maxResults: number, ctx: ToolExecutionContext): AsyncGenerator<ToolProgressEvent> {
  throwIfAborted(ctx);
  if (results.length >= maxResults || !existsSync(path)) return;
  const info = await stat(path);
  throwIfAborted(ctx);

  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      throwIfAborted(ctx);
      if (results.length >= maxResults) return;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      yield* searchPath(join(path, entry.name), regex, results, maxResults, ctx);
    }
    return;
  }

  if (!info.isFile() || info.size > 1024 * 1024) return;
  throwIfAborted(ctx);
  const content = await readFile(path, 'utf-8').catch(() => null);
  throwIfAborted(ctx);
  if (content === null) return;

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    throwIfAborted(ctx);
    if (results.length >= maxResults) return;
    if (regex.test(lines[i])) {
      const matchCount = results.length + 1;
      results.push(`${path}:${i + 1}: ${lines[i]}`);
      yield { type: 'search_match', path, line: i + 1, text: clip(lines[i], 240), matchCount };
    }
  }
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}
