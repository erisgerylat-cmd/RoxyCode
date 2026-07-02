import chalk from 'chalk';
import { basename } from 'node:path';
import type { Character } from '../../aesthetic/character/types.js';
import type { ToolCall, ToolResult } from '../../core/types/message.js';
import type { Tool } from '../../tool/index.js';

interface ToolActivityRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  argsBuffer: string;
  requestedAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  success?: boolean;
  error?: string;
  resultSummary?: string;
  permissionWaitingAt?: number;
  concurrency?: Tool['concurrency'];
  interruptBehavior?: Tool['interruptBehavior'];
}

export interface ToolActivityRendererOptions {
  character: Character;
  language: 'zh-CN' | 'en-US';
}

export class ToolActivityRenderer {
  private character: Character;
  private language: 'zh-CN' | 'en-US';
  private readonly records = new Map<string, ToolActivityRecord>();
  private readonly order: string[] = [];
  private readonly toolMetadata = new Map<string, Tool>();

  constructor(options: ToolActivityRendererOptions) {
    this.character = options.character;
    this.language = options.language;
  }

  updateCharacter(character: Character): void {
    this.character = character;
  }

  setLanguage(language: 'zh-CN' | 'en-US'): void {
    this.language = language;
  }

  setTools(tools: Tool[]): void {
    this.toolMetadata.clear();
    for (const tool of tools) this.toolMetadata.set(tool.definition.name, tool);
  }

  resetTurn(): void {
    this.records.clear();
    this.order.length = 0;
  }

  beginToolCall(toolCall: ToolCall): void {
    const record = this.ensureRecord(toolCall);
    if (record.startedAt || record.completedAt) return;
    const line = this.isZh()
      ? `${this.label('queued')} ${toolCall.name} - \u6b63\u5728\u63a5\u6536\u5de5\u5177\u53c2\u6570...`
      : `${this.label('queued')} ${toolCall.name} - receiving tool arguments...`;
    console.log(chalk.dim(`  ${line}`));
  }

  appendToolCallDelta(id: string, argsDelta: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.argsBuffer += argsDelta;
  }

  getArgumentProgress(id: string): string | undefined {
    const record = this.records.get(id);
    if (!record || record.argsBuffer.length === 0) return undefined;
    const size = formatCount(record.argsBuffer.length);
    return this.isZh()
      ? `\u6b63\u5728\u63a5\u6536 ${record.name} \u53c2\u6570 (${size} chars)`
      : `Receiving ${record.name} arguments (${size} chars)`;
  }

  markToolExecuting(toolCall: ToolCall): void {
    const record = this.ensureRecord(toolCall);
    record.name = toolCall.name;
    record.args = toolCall.arguments;
    this.applyToolMetadata(record);
    record.startedAt = Date.now();
    this.renderExecutionCard(record);
  }


  markPermissionWaiting(prompt: { title: string; riskLevel: string; requiresSecondConfirmation?: boolean }, second = false): void {
    const record = this.getLastOpenRecord();
    if (record) record.permissionWaitingAt = Date.now();
    const color = chalk.hex(this.character.theme.accent);
    const risk = this.riskLabel(prompt.riskLevel);
    const prefix = this.isZh() ? '[\u7b49\u5f85\u786e\u8ba4]' : '[permission]';
    const secondHint = second
      ? (this.isZh() ? ' / \u4e8c\u6b21\u786e\u8ba4' : ' / second confirmation')
      : prompt.requiresSecondConfirmation
        ? (this.isZh() ? ' / \u9700\u8981\u4e8c\u6b21\u786e\u8ba4' : ' / second confirmation required')
        : '';
    console.log(color(`  ${prefix} ${prompt.title} - ${risk}${secondHint}`));
  }
  markToolResult(toolCall: ToolCall, result: ToolResult): void {
    const record = this.ensureRecord(toolCall);
    record.name = toolCall.name;
    record.args = toolCall.arguments;
    this.applyToolMetadata(record);
    record.completedAt = Date.now();
    record.durationMs = result.duration;
    record.success = result.success;
    record.error = result.error;
    record.resultSummary = summarizeResult(result, this.language);
    this.renderResultLine(record);
  }

  renderTurnSummary(): void {
    const records = this.order.map(id => this.records.get(id)).filter((record): record is ToolActivityRecord => Boolean(record));
    if (records.length === 0) return;
    const completed = records.filter(record => record.completedAt !== undefined);
    if (completed.length === 0) return;
    const failed = completed.filter(record => record.success === false).length;
    const totalDuration = completed.reduce((sum, record) => sum + (record.durationMs ?? 0), 0);
    const grouped = summarizeToolGroups(completed, this.language);
    const title = this.isZh() ? '\u5de5\u5177\u6458\u8981' : 'Tool summary';
    const detail = this.isZh()
      ? `${completed.length} \u6b21\u8c03\u7528 / ${failed} \u6b21\u5931\u8d25 / ${formatElapsed(totalDuration)}`
      : `${completed.length} calls / ${failed} failed / ${formatElapsed(totalDuration)}`;
    console.log(chalk.dim(`  ${title}: ${detail}${grouped ? ` - ${grouped}` : ''}`));
  }


  private getLastOpenRecord(): ToolActivityRecord | undefined {
    for (let index = this.order.length - 1; index >= 0; index--) {
      const record = this.records.get(this.order[index]!);
      if (record && record.completedAt === undefined) return record;
    }
    return undefined;
  }
  private ensureRecord(toolCall: ToolCall): ToolActivityRecord {
    let record = this.records.get(toolCall.id);
    if (!record) {
      record = {
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.arguments,
        argsBuffer: '',
        requestedAt: Date.now(),
      };
      this.records.set(toolCall.id, record);
      this.order.push(toolCall.id);
    }
    return record;
  }

  private renderExecutionCard(record: ToolActivityRecord): void {
    const border = chalk.hex(this.character.theme.primary);
    const accent = chalk.hex(this.character.theme.accent);
    const dim = chalk.dim;
    const title = this.isZh() ? '\u5de5\u5177\u6267\u884c' : 'Tool execution';
    const summary = summarizeArgs(record.name, record.args, this.language, record.argsBuffer);
    const fallback = this.isZh() ? '\u65e0\u5173\u952e\u53c2\u6570' : 'no key arguments';
    const schedule = this.scheduleLabel(record);
    const rows = schedule ? [schedule, ...(summary.length > 0 ? summary : [fallback])] : (summary.length > 0 ? summary : [fallback]);
    console.log('');
    console.log(border('  +-- ') + accent(title) + border(' --+'));
    console.log(border('  | ') + `${this.label('running')} ${record.name}`);
    for (const row of rows.slice(0, 4)) console.log(border('  | ') + dim(row));
    console.log(border('  +') + border('-'.repeat(54)) + border('+'));
  }

  private applyToolMetadata(record: ToolActivityRecord): void {
    const tool = this.toolMetadata.get(record.name);
    record.concurrency = tool?.concurrency;
    record.interruptBehavior = tool?.interruptBehavior;
  }

  private scheduleLabel(record: ToolActivityRecord): string | undefined {
    if (!record.concurrency && !record.interruptBehavior) return undefined;
    const concurrency = record.concurrency === 'safe'
      ? (this.isZh() ? '可并发' : 'concurrent')
      : record.concurrency === 'exclusive'
        ? (this.isZh() ? '独占执行' : 'exclusive')
        : undefined;
    const interrupt = record.interruptBehavior === 'cancel'
      ? (this.isZh() ? '可中断' : 'interruptible')
      : record.interruptBehavior === 'block'
        ? (this.isZh() ? '中断时等待完成' : 'blocks interrupt')
        : undefined;
    return [concurrency, interrupt].filter(Boolean).join(' / ');
  }
  private renderResultLine(record: ToolActivityRecord): void {
    const color = record.success ? chalk.hex(this.character.theme.success) : chalk.hex(this.character.theme.error);
    const status = record.success ? this.label('ok') : this.label('err');
    const duration = formatElapsed(record.durationMs ?? Math.max(0, Date.now() - (record.startedAt ?? record.requestedAt)));
    const summary = record.resultSummary ? ` - ${record.resultSummary}` : '';
    console.log(color(`  ${status} ${record.name} (${duration})${summary}`));
    if (!record.success && record.error) console.log(chalk.hex(this.character.theme.error)(`    ${clip(record.error, 180)}`));
  }

  private label(kind: 'queued' | 'running' | 'ok' | 'err'): string {
    if (this.isZh()) {
      switch (kind) {
        case 'queued': return '[\u5f85\u6267\u884c]';
        case 'running': return '[\u6267\u884c\u4e2d]';
        case 'ok': return '[\u5b8c\u6210]';
        case 'err': return '[\u5931\u8d25]';
      }
    }
    switch (kind) {
      case 'queued': return '[queued]';
      case 'running': return '[running]';
      case 'ok': return '[done]';
      case 'err': return '[failed]';
    }
  }


  private riskLabel(risk: string): string {
    if (!this.isZh()) return risk === 'high' ? 'high risk' : risk === 'medium' ? 'medium risk' : 'low risk';
    return risk === 'high' ? '\u9ad8\u98ce\u9669' : risk === 'medium' ? '\u4e2d\u98ce\u9669' : '\u4f4e\u98ce\u9669';
  }
  private isZh(): boolean {
    return this.language === 'zh-CN';
  }
}

function summarizeToolGroups(records: ToolActivityRecord[], language: 'zh-CN' | 'en-US'): string {
  const groups = new Map<string, number>();
  for (const record of records) {
    const group = toolGroup(record.name, language);
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  return [...groups.entries()].map(([group, count]) => count > 1 ? `${group}x${count}` : group).join(', ');
}

function toolGroup(toolName: string, language: 'zh-CN' | 'en-US'): string {
  const zh = language === 'zh-CN';
  if (toolName === 'read_file' || toolName === 'list_directory') return zh ? '\u8bfb\u53d6' : 'read';
  if (toolName === 'grep_search') return zh ? '\u641c\u7d22' : 'search';
  if (toolName === 'write_file' || toolName === 'edit_file') return zh ? '\u5199\u5165' : 'write';
  if (toolName === 'execute_command') return 'Shell';
  if (toolName === 'git') return 'Git';
  return toolName;
}
function summarizeArgs(toolName: string, args: Record<string, unknown>, language: 'zh-CN' | 'en-US', argsBuffer: string): string[] {
  const rows: string[] = [];
  const path = firstString(args, ['path', 'file', 'targetPath', 'file_path']);
  const command = firstString(args, ['command']);
  const pattern = firstString(args, ['pattern', 'query']);
  const operation = firstString(args, ['operation']);
  const target = firstString(args, ['target']);
  const content = firstString(args, ['content', 'newText', 'replacement']);

  if (path) rows.push(`${label(language, 'path')}: ${clip(path, 120)}`);
  if (command) rows.push(`${label(language, 'command')}: ${clip(command, 120)}`);
  if (pattern) rows.push(`${label(language, 'pattern')}: ${clip(pattern, 120)}`);
  if (operation) rows.push(`${label(language, 'operation')}: ${clip(operation, 80)}`);
  if (target) rows.push(`${label(language, 'target')}: ${clip(target, 100)}`);
  if (typeof args.limit === 'number') rows.push(`limit: ${args.limit}`);
  if (typeof args.offset === 'number') rows.push(`offset: ${args.offset}`);
  if (typeof args.replaceAll === 'boolean') rows.push(`replaceAll: ${args.replaceAll}`);
  if (content) rows.push(`${label(language, 'content')}: ${formatCount(content.length)} chars`);
  if (rows.length === 0 && argsBuffer.length > 0) rows.push(`${label(language, 'arguments')}: ${formatCount(argsBuffer.length)} chars streamed`);
  if (rows.length === 0) {
    const keys = Object.keys(args).slice(0, 4);
    if (keys.length > 0) rows.push(`${toolName}: ${keys.join(', ')}`);
  }
  return rows;
}

function summarizeResult(result: ToolResult, language: 'zh-CN' | 'en-US'): string {
  const metadata = result.metadata ?? {};
  const parts: string[] = [];
  pushMeta(parts, metadata, 'path', language);
  pushMeta(parts, metadata, 'operation', language);
  pushMeta(parts, metadata, 'exitCode', language);
  pushMeta(parts, metadata, 'matches', language);
  pushMeta(parts, metadata, 'entries', language);
  pushMeta(parts, metadata, 'total', language);
  pushMeta(parts, metadata, 'bytes', language);
  pushMeta(parts, metadata, 'totalLines', language);
  pushMeta(parts, metadata, 'timedOut', language);
  if (parts.length > 0) return clip(parts.join(' / '), 180);
  const output = stripToolResultEnvelope(result.output);
  if (!output.trim()) return '';
  return clip(output.replace(/\s+/g, ' ').trim(), 180);
}

function pushMeta(parts: string[], metadata: Record<string, unknown>, key: string, language: 'zh-CN' | 'en-US'): void {
  const value = metadata[key];
  if (value === undefined || value === null || value === '') return;
  parts.push(`${label(language, key)}=${formatMetaValue(key, value)}`);
}

function formatMetaValue(key: string, value: unknown): string {
  if (key === 'path' && typeof value === 'string') return clipPath(value, 80);
  if (key === 'bytes' && typeof value === 'number') return `${formatCount(value)}B`;
  return clip(String(value), 80);
}

function stripToolResultEnvelope(output: string): string {
  return output
    .replace(/^<tool_result[^>]*>\s*/i, '')
    .replace(/\s*<\/tool_result>\s*$/i, '')
    .replace(/metadata:\s*\{.*\}\s*$/s, '')
    .trim();
}

function firstString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function label(language: 'zh-CN' | 'en-US', key: string): string {
  if (language === 'en-US') return key;
  return {
    path: '\u8def\u5f84',
    command: '\u547d\u4ee4',
    pattern: '\u6a21\u5f0f',
    operation: '\u64cd\u4f5c',
    target: '\u76ee\u6807',
    content: '\u5185\u5bb9',
    arguments: '\u53c2\u6570',
    exitCode: '\u9000\u51fa\u7801',
    matches: '\u5339\u914d',
    entries: '\u6761\u76ee',
    total: '\u603b\u6570',
    bytes: '\u5b57\u8282',
    totalLines: '\u603b\u884c\u6570',
    timedOut: '\u8d85\u65f6',
  }[key] ?? key;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

function clipPath(value: string, max: number): string {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.length <= max) return normalized;
  return `.../${basename(normalized)}`;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}