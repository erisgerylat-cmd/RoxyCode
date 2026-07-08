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
  if (days === 0) return '\u4eca\u5929';
  if (days === 1) return '\u6628\u5929';
  return `${days} \u5929\u524d`;
}

export function memoryFreshnessText(timestampMs: number, language: 'zh-CN' | 'en-US', now: number = Date.now()): string {
  const days = memoryAgeDays(timestampMs, now);
  if (days <= 1) return '';
  if (language === 'en-US') {
    return `This memory is ${days} days old. Treat it as a snapshot and verify current code, files, commands, or project state before relying on it.`;
  }
  return `\u8fd9\u6761\u8bb0\u5fc6\u5df2\u6709 ${days} \u5929\u3002\u8bf7\u628a\u5b83\u5f53\u4f5c\u65e7\u5feb\u7167\uff1b\u6d89\u53ca\u5f53\u524d\u4ee3\u7801\u3001\u6587\u4ef6\u3001\u547d\u4ee4\u6216\u9879\u76ee\u72b6\u6001\u65f6\uff0c\u5fc5\u987b\u5148\u9a8c\u8bc1\u3002`;
}
