import { MemoryRetriever, type MemoryRetrievalOptions } from './MemoryRetriever.js';
import type { MemoryRecord } from './types.js';

export interface MemoryRecallOptions extends MemoryRetrievalOptions {}

const MS_PER_DAY = 86_400_000;

export function selectRelevantMemories(query: string, records: MemoryRecord[], options: MemoryRecallOptions = {}): MemoryRecord[] {
  return new MemoryRetriever(records, { now: options.now }).retrieve(query, options).map(item => item.record);
}

export function memoryAgeDays(timestampMs: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - timestampMs) / MS_PER_DAY));
}

export function memoryAge(timestampMs: number, language: 'zh-CN' | 'en-US', now: number = Date.now()): string {
  const days = memoryAgeDays(timestampMs, now);
  if (language === 'en-US') {
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}

export function memoryFreshnessText(timestampMs: number, language: 'zh-CN' | 'en-US', now: number = Date.now()): string {
  const days = memoryAgeDays(timestampMs, now);
  if (days <= 1) return '';
  if (language === 'en-US') {
    return `This memory is ${days} days old. Treat it as a snapshot and verify current code, files, commands, or project state before relying on it.`;
  }
  return `这条记忆已有 ${days} 天。请把它当作旧快照；涉及当前代码、文件、命令或项目状态时，必须先验证。`;
}
