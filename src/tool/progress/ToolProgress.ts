import type { ToolExecutionContext, ToolProgressEvent } from '../types.js';

export function emitToolProgress(ctx: ToolExecutionContext, event: ToolProgressEvent): void {
  try {
    ctx.onProgress?.(event);
  } catch {
    // Progress is observational and must not change tool execution semantics.
  }
}

export function describeToolProgress(event: ToolProgressEvent, language: 'zh-CN' | 'en-US' = 'zh-CN'): string {
  const zh = language !== 'en-US';
  switch (event.type) {
    case 'status':
      return event.message;
    case 'file_read':
      return event.stage === 'start'
        ? zh ? `正在读取 ${shortPath(event.path)}` : `Reading ${shortPath(event.path)}`
        : zh ? `已读取 ${shortPath(event.path)} (${event.totalLines ?? 0} 行)` : `Read ${shortPath(event.path)} (${event.totalLines ?? 0} lines)`;
    case 'search_start':
      return zh ? `正在搜索 ${event.pattern}` : `Searching ${event.pattern}`;
    case 'search_match':
      return zh ? `搜索匹配 ${event.matchCount}: ${shortPath(event.path)}:${event.line}` : `Match ${event.matchCount}: ${shortPath(event.path)}:${event.line}`;
    case 'search_complete':
      return zh ? `搜索完成：${event.matches} 个匹配` : `Search complete, ${event.matches} matches`;
    case 'command_start':
      return zh ? `正在执行命令: ${clip(event.command, 80)}` : `Running command: ${clip(event.command, 80)}`;
    case 'output_chunk':
      return zh ? `命令输出 ${event.stream}: ${formatCount(event.text.length)} chars` : `${event.stream}: ${formatCount(event.text.length)} chars`;
    case 'command_complete':
      return zh ? `命令结束，退出码 ${event.exitCode ?? 'null'}` : `Command finished, exit ${event.exitCode ?? 'null'}`;
    case 'mcp_call':
      return event.phase === 'start'
        ? zh ? `正在调用 MCP ${event.server}/${event.tool}` : `Calling MCP ${event.server}/${event.tool}`
        : zh ? `MCP 调用完成 ${event.server}/${event.tool}` : `MCP completed ${event.server}/${event.tool}`;
  }
}

function shortPath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length <= 2 ? normalized : `${parts.at(-2)}/${parts.at(-1)}`;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}
