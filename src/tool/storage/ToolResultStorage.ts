import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ToolResult } from '../../core/types/message.js';
import type { Tool, ToolExecutionContext } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';

export interface PersistedToolResult {
  path: string;
  originalChars: number;
  previewChars: number;
  hasMore: boolean;
}

const PREVIEW_CHARS = 2_000;

export async function processToolResultSize(
  tool: Tool,
  result: ToolResult,
  ctx: ToolExecutionContext,
  invocationId: string,
): Promise<ToolResult> {
  if (!result.success) return result;
  const limit = tool.maxResultSizeChars ?? 50_000;
  if (!Number.isFinite(limit) || result.output.length <= limit) return result;

  const persisted = await persistToolResult(result.output, ctx, invocationId);
  const isZh = ctx.language !== 'en-US';
  const body = [
    isZh ? '\u5de5\u5177\u7ed3\u679c\u8fc7\u5927\uff0c\u5df2\u5199\u5165\u672c\u5730\u6587\u4ef6\u3002' : 'Tool result was too large and has been persisted to disk.',
    `path: ${persisted.path}`,
    `original_chars: ${persisted.originalChars}`,
    `preview_chars: ${persisted.previewChars}`,
    'preview:',
    createPreview(result.output),
  ].join('\n');
  const metadata = {
    ...result.metadata,
    persistedToolResult: persisted,
  };

  return {
    ...result,
    output: formatToolResult(tool.definition.name, result.success, body, ctx, metadata),
    metadata,
  };
}

async function persistToolResult(content: string, ctx: ToolExecutionContext, invocationId: string): Promise<PersistedToolResult> {
  const safeId = sanitizeId(invocationId);
  const digest = createHash('sha1').update(content).digest('hex').slice(0, 10);
  const path = join(ctx.cwd, '.roxycode', 'tool-results', ctx.sessionId, `${safeId}-${digest}.txt`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
  return {
    path,
    originalChars: content.length,
    previewChars: Math.min(PREVIEW_CHARS, content.length),
    hasMore: content.length > PREVIEW_CHARS,
  };
}

function createPreview(content: string): string {
  if (content.length <= PREVIEW_CHARS) return content;
  const head = content.slice(0, PREVIEW_CHARS);
  const cut = head.lastIndexOf('\n');
  return `${head.slice(0, cut > PREVIEW_CHARS / 2 ? cut : PREVIEW_CHARS)}\n... [persisted output truncated]`;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'tool-result';
}
