import { basename } from 'node:path';
import type { ToolCall, ToolResult } from '../../core/types/message.js';

export type AgentPhase = 'analyze' | 'plan' | 'execute' | 'verify' | 'summarize';

export interface ToolResultPresentation {
  summary: string;
  recoverySuggestion?: string;
  modelResult: ToolResult;
}

const DEFAULT_MODEL_RESULT_MAX_CHARS = 24_000;
const MODEL_RESULT_PREVIEW_CHARS = 10_000;

export function describeAgentPhase(
  phase: AgentPhase,
  language: 'zh-CN' | 'en-US',
  characterName: string,
): string {
  const zh = language !== 'en-US';
  if (!zh) {
    switch (phase) {
      case 'analyze': return `${characterName} is reading the task and preparing context.`;
      case 'plan': return `${characterName} is drafting an execution plan.`;
      case 'execute': return `${characterName} is applying the plan with tools.`;
      case 'verify': return `${characterName} is checking the result.`;
      case 'summarize': return `${characterName} is preparing the final summary.`;
    }
  }
  switch (phase) {
    case 'analyze': return `${characterName} 正在分析需求，并准备项目上下文。`;
    case 'plan': return `${characterName} 正在整理执行计划。`;
    case 'execute': return `${characterName} 正在按计划调用工具执行。`;
    case 'verify': return `${characterName} 正在验证结果。`;
    case 'summarize': return `${characterName} 正在整理最终总结。`;
  }
}

export function describeToolIntent(toolCall: ToolCall, language: 'zh-CN' | 'en-US'): string {
  const zh = language !== 'en-US';
  const args = toolCall.arguments;
  const path = firstString(args, ['path', 'file', 'targetPath', 'file_path']);
  const command = firstString(args, ['command']);
  const pattern = firstString(args, ['pattern', 'query']);
  const operation = firstString(args, ['operation']);

  if (!zh) {
    switch (toolCall.name) {
      case 'read_file': return `Read the real file content: ${path ?? 'unknown file'}`;
      case 'list_directory': return `Inspect the directory structure: ${path ?? '.'}`;
      case 'grep_search': return `Search the project for: ${pattern ?? 'pattern'}`;
      case 'write_file': return `Write file changes: ${path ?? 'unknown file'}`;
      case 'edit_file': return `Edit file content: ${path ?? 'unknown file'}`;
      case 'execute_command': return `Run command for feedback: ${clip(command ?? '', 120) || 'command'}`;
      case 'git': return `Inspect Git state: ${operation ?? 'status'}`;
      case 'todo_write': return `Update the task checklist.`;
      default: return `Call ${toolCall.name}.`;
    }
  }

  switch (toolCall.name) {
    case 'read_file': return `读取真实文件内容：${path ?? '未知文件'}`;
    case 'list_directory': return `查看目录结构：${path ?? '.'}`;
    case 'grep_search': return `搜索项目定位相关代码：${pattern ?? '搜索条件'}`;
    case 'write_file': return `写入文件变更：${path ?? '未知文件'}`;
    case 'edit_file': return `编辑文件内容：${path ?? '未知文件'}`;
    case 'execute_command': return `运行命令获取环境反馈：${clip(command ?? '', 120) || '命令'}`;
    case 'git': return `查看 Git 状态：${operation ?? 'status'}`;
    case 'todo_write': return '更新当前任务清单。';
    default: return `调用工具 ${toolCall.name}。`;
  }
}

export function presentToolResult(
  toolCall: ToolCall,
  result: ToolResult,
  language: 'zh-CN' | 'en-US',
  maxModelResultChars = DEFAULT_MODEL_RESULT_MAX_CHARS,
): ToolResultPresentation {
  const summary = summarizeToolResult(toolCall, result, language);
  const recoverySuggestion = result.success ? undefined : recoveryHint(toolCall, result, language);
  const modelResult = result.output.length > maxModelResultChars
    ? compactToolResultForModel(toolCall, result, summary, recoverySuggestion, language)
    : result;
  return { summary, recoverySuggestion, modelResult };
}

export function summarizeToolResult(
  toolCall: ToolCall,
  result: ToolResult,
  language: 'zh-CN' | 'en-US',
): string {
  const zh = language !== 'en-US';
  const meta = result.metadata ?? {};
  const status = result.success ? (zh ? '成功' : 'success') : (zh ? '失败' : 'failed');
  const parts: string[] = [];

  switch (toolCall.name) {
    case 'read_file':
      parts.push(zh ? `读取 ${displayPath(meta.path ?? toolCall.arguments.path)}` : `read ${displayPath(meta.path ?? toolCall.arguments.path)}`);
      pushKnown(parts, meta, 'totalLines', zh ? '总行数' : 'lines');
      if (meta.isPartialView === true) parts.push(zh ? '部分读取' : 'partial');
      break;
    case 'list_directory':
      parts.push(zh ? `列出 ${displayPath(meta.path ?? toolCall.arguments.path ?? '.')}` : `listed ${displayPath(meta.path ?? toolCall.arguments.path ?? '.')}`);
      pushKnown(parts, meta, 'entries', zh ? '条目' : 'entries');
      pushKnown(parts, meta, 'total', zh ? '总数' : 'total');
      break;
    case 'grep_search':
      parts.push(zh ? `搜索 ${String(meta.pattern ?? toolCall.arguments.pattern ?? '')}` : `searched ${String(meta.pattern ?? toolCall.arguments.pattern ?? '')}`);
      pushKnown(parts, meta, 'matches', zh ? '匹配' : 'matches');
      if (meta.truncated === true) parts.push(zh ? '结果已截断' : 'truncated');
      break;
    case 'write_file':
    case 'edit_file':
      parts.push(zh ? `修改 ${displayPath(meta.path ?? toolCall.arguments.path)}` : `changed ${displayPath(meta.path ?? toolCall.arguments.path)}`);
      pushDiff(parts, meta, language);
      pushKnown(parts, meta, 'operation', zh ? '操作' : 'operation');
      break;
    case 'execute_command':
      parts.push(zh ? `命令 ${status}` : `command ${status}`);
      pushKnown(parts, meta, 'exitCode', zh ? '退出码' : 'exit');
      if (meta.timedOut === true) parts.push(zh ? '已超时' : 'timed out');
      break;
    case 'git':
      parts.push(`Git ${String(meta.operation ?? toolCall.arguments.operation ?? 'status')} ${status}`);
      pushKnown(parts, meta, 'exitCode', zh ? '退出码' : 'exit');
      break;
    case 'todo_write':
      parts.push(zh ? '任务清单已更新' : 'todo list updated');
      pushKnown(parts, meta, 'total', zh ? '总数' : 'total');
      pushKnown(parts, meta, 'inProgress', zh ? '进行中' : 'in progress');
      pushKnown(parts, meta, 'completed', zh ? '完成' : 'completed');
      break;
    default:
      parts.push(zh ? `${toolCall.name} ${status}` : `${toolCall.name} ${status}`);
      for (const key of ['path', 'operation', 'exitCode', 'matches', 'entries', 'total']) pushKnown(parts, meta, key, key);
  }

  if (!result.success && result.error) parts.push(`${zh ? '错误' : 'error'}=${clip(result.error, 120)}`);
  return parts.filter(Boolean).join(' / ') || (zh ? `${toolCall.name} 已完成` : `${toolCall.name} completed`);
}

export function recoveryHint(toolCall: ToolCall, result: ToolResult, language: 'zh-CN' | 'en-US'): string {
  const zh = language !== 'en-US';
  const meta = result.metadata ?? {};
  const errorText = [result.error, result.output, JSON.stringify(meta)].filter(Boolean).join('\n').toLowerCase();

  if (meta.phase === 'permission' || meta.errorCategory === 'permission' || errorText.includes('permission')) {
    return zh
      ? '下一步：说明为什么需要该权限，缩小操作范围后重新请求确认，或改用只读检查。'
      : 'Next: explain why permission is needed, narrow the scope, and request approval again or switch to a read-only check.';
  }
  if (meta.errorCategory === 'validation' || errorText.includes('validation') || errorText.includes('invalid')) {
    return zh
      ? '下一步：修正工具参数；必要时先读取文件或列目录，确认路径和参数格式。'
      : 'Next: fix the tool arguments; read the file or list the directory first if path or shape is uncertain.';
  }
  if ((toolCall.name === 'write_file' || toolCall.name === 'edit_file') && errorText.includes('existing file has not been read')) {
    return zh
      ? '\u4e0b\u4e00\u6b65\uff1a\u5148\u5bf9\u76ee\u6807\u6587\u4ef6\u6267\u884c\u5b8c\u6574 read_file\uff0c\u4e0d\u8981\u5e26 offset/limit\uff1b\u786e\u8ba4\u6700\u65b0\u5185\u5bb9\u540e\u518d\u91cd\u8bd5\u5199\u5165\u6216\u7f16\u8f91\u3002'
      : 'Next: run a full read_file on the target without offset/limit, confirm the latest content, then retry the write or edit.';
  }
  if ((toolCall.name === 'write_file' || toolCall.name === 'edit_file') && errorText.includes('only part of this file was read')) {
    return zh
      ? '\u4e0b\u4e00\u6b65\uff1a\u5f53\u524d\u53ea\u6709\u7247\u6bb5\u89c6\u56fe\u3002\u8bf7\u91cd\u65b0 read_file \u8bfb\u53d6\u5b8c\u6574\u6587\u4ef6\uff0c\u518d\u6267\u884c\u5199\u5165\u6216\u7f16\u8f91\u3002'
      : 'Next: the current view is partial. Reread the full file before writing or editing.';
  }
  if ((toolCall.name === 'write_file' || toolCall.name === 'edit_file') && errorText.includes('file has changed since it was read')) {
    return zh
      ? '\u4e0b\u4e00\u6b65\uff1a\u6587\u4ef6\u5728\u8bfb\u53d6\u540e\u53d1\u751f\u53d8\u5316\u3002\u8bf7\u91cd\u65b0 read_file \u83b7\u53d6\u6700\u65b0\u7248\u672c\uff0c\u518d\u57fa\u4e8e\u65b0\u5185\u5bb9\u91cd\u8bd5\u3002'
      : 'Next: the file changed after it was read. Reread the latest version and retry from that content.';
  }
  if (toolCall.name === 'edit_file' && (errorText.includes('old_string') || errorText.includes('not found'))) {
    return zh
      ? '\u4e0b\u4e00\u6b65\uff1a\u91cd\u65b0 read_file \u8bfb\u53d6\u76ee\u6807\u6587\u4ef6\uff0c\u590d\u5236\u5305\u542b\u7a7a\u767d\u548c\u6362\u884c\u7684\u7cbe\u786e old_string\uff1b\u4e0d\u786e\u5b9a\u4f4d\u7f6e\u65f6\u5148\u7528 grep_search \u5b9a\u4f4d\u5f53\u524d\u6587\u672c\u3002'
      : 'Next: reread the target file, copy an exact old_string including whitespace and line endings, or use grep_search to locate the current text.';
  }
  if (errorText.includes('enoent') || errorText.includes('not exist') || errorText.includes('not found') || errorText.includes('不存在')) {
    return zh
      ? '下一步：先用 list_directory 或 grep_search 确认真实路径，再重试。'
      : 'Next: confirm the real path with list_directory or grep_search, then retry.';
  }
  if (toolCall.name === 'edit_file' && (errorText.includes('old_string') || errorText.includes('not found'))) {
    return zh
      ? '下一步：重新读取目标文件，复制更精确的 old_string，或缩小替换范围。'
      : 'Next: read the target file again, copy a more exact old_string, or narrow the replacement.';
  }
  if (toolCall.name === 'execute_command' || toolCall.name === 'git') {
    return zh
      ? '下一步：查看 stderr/退出码，调整命令或先运行更小的诊断命令。'
      : 'Next: inspect stderr/exit code, adjust the command, or run a smaller diagnostic command first.';
  }
  return zh
    ? '下一步：根据工具输出缩小范围，修正输入后重试；如果涉及写入，请先确认文件状态。'
    : 'Next: narrow the scope from the tool output, fix the input, and retry; if writing, confirm file state first.';
}

function compactToolResultForModel(
  toolCall: ToolCall,
  result: ToolResult,
  summary: string,
  recoverySuggestion: string | undefined,
  language: 'zh-CN' | 'en-US',
): ToolResult {
  const zh = language !== 'en-US';
  const preview = createPreview(result.output, MODEL_RESULT_PREVIEW_CHARS);
  const body = [
    `<tool_result name="${toolCall.name}" status="${result.success ? 'success' : 'error'}">`,
    zh ? '摘要:' : 'summary:',
    `- ${summary}`,
    `- duration_ms: ${result.duration}`,
    recoverySuggestion ? `- ${zh ? '恢复建议' : 'recovery'}: ${recoverySuggestion}` : null,
    zh ? '输出预览:' : 'output preview:',
    preview,
    `metadata: ${JSON.stringify({ ...result.metadata, compactedForModel: true, originalChars: result.output.length })}`,
    '</tool_result>',
  ].filter((line): line is string => line !== null).join('\n');

  return {
    ...result,
    output: body,
    metadata: { ...result.metadata, compactedForModel: true, originalChars: result.output.length },
  };
}

function createPreview(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const cut = head.lastIndexOf('\n');
  const end = cut > maxChars * 0.6 ? cut : maxChars;
  return `${head.slice(0, end)}\n... [model tool result preview truncated ${text.length - end} chars]`;
}

function firstString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function pushKnown(parts: string[], meta: Record<string, unknown>, key: string, label: string): void {
  const value = meta[key];
  if (value === undefined || value === null || value === '') return;
  parts.push(`${label}=${formatValue(value)}`);
}

function pushDiff(parts: string[], meta: Record<string, unknown>, language: 'zh-CN' | 'en-US'): void {
  const diff = meta.diff;
  if (!diff || typeof diff !== 'object') return;
  const record = diff as Record<string, unknown>;
  const added = typeof record.addedLines === 'number' ? record.addedLines : undefined;
  const removed = typeof record.removedLines === 'number' ? record.removedLines : undefined;
  if (added === undefined && removed === undefined) return;
  parts.push(language === 'en-US' ? `change=+${added ?? 0} -${removed ?? 0}` : `变更=+${added ?? 0} -${removed ?? 0}`);
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return clip(displayPath(value), 100);
  return clip(String(value), 100);
}

function displayPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'unknown';
  const normalized = value.replace(/\\/g, '/');
  if (normalized.length <= 90) return normalized;
  return `.../${basename(normalized)}`;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}
