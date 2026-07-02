import type { MemoryRecord, MemoryType } from './types.js';

export interface MemoryRecallOptions {
  limit?: number;
  now?: number;
}

interface ScoredMemory {
  record: MemoryRecord;
  score: number;
  matchedTerms: string[];
}

const DEFAULT_RECALL_LIMIT = 5;
const MS_PER_DAY = 86_400_000;

const EN_STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'are',
  'can',
  'code',
  'current',
  'for',
  'from',
  'how',
  'into',
  'now',
  'please',
  'project',
  'should',
  'that',
  'the',
  'this',
  'use',
  'with',
  'you',
]);

const TYPE_HINTS: Record<MemoryType, string[]> = {
  user: ['user', 'preference', 'prefer', 'style', 'role', 'goal', '我', '用户', '偏好', '习惯', '角色', '目标'],
  project: ['project', 'deadline', 'decision', 'incident', 'goal', '项目', '需求', '背景', '决策', '事故', '截止'],
  feedback: ['feedback', 'correction', 'avoid', 'stop', 'review', '反馈', '纠正', '不要', '避免', '审查'],
  reference: ['reference', 'doc', 'docs', 'link', 'ticket', 'dashboard', '参考', '文档', '链接', '工单', '看板'],
  learning: ['learn', 'learning', 'teach', 'explain', 'beginner', '学习', '教学', '解释', '初学', '概念'],
  workflow: ['workflow', 'command', 'branch', 'commit', 'review', 'test', '流程', '命令', '分支', '提交', '测试'],
};

export function selectRelevantMemories(query: string, records: MemoryRecord[], options: MemoryRecallOptions = {}): MemoryRecord[] {
  const limit = Math.max(1, options.limit ?? DEFAULT_RECALL_LIMIT);
  const queryTerms = extractSearchTerms(query);
  if (queryTerms.length === 0) return [];

  const scored = records
    .map(record => scoreMemory(record, queryTerms, options.now ?? Date.now()))
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.record.updatedAt - a.record.updatedAt;
    });

  return scored.slice(0, limit).map(item => item.record);
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

function scoreMemory(record: MemoryRecord, queryTerms: string[], now: number): ScoredMemory {
  const contentTerms = new Set(extractSearchTerms([record.content, record.summary ?? ''].join(' ')));
  const tagTerms = new Set(record.tags.flatMap(tag => extractSearchTerms(tag)));
  const matchedTerms: string[] = [];
  let score = 0;

  for (const term of queryTerms) {
    if (tagTerms.has(term)) {
      score += 4;
      matchedTerms.push(term);
      continue;
    }
    if (contentTerms.has(term)) {
      score += 2;
      matchedTerms.push(term);
    }
  }

  const typeBoost = TYPE_HINTS[record.type].some(hint => queryTerms.includes(normalizeTerm(hint)));
  if (typeBoost) score += 2;

  if (record.scope === 'project' && queryTerms.some(term => ['项目', '需求', 'project', 'repo'].includes(term))) score += 1;

  // Metadata only ranks already-relevant memories; it must not pull unrelated records into context.
  if (score <= 0) return { record, score: 0, matchedTerms: [] };

  if (record.source === 'manual') score += 0.25;

  const ageDays = memoryAgeDays(record.updatedAt, now);
  if (ageDays <= 7) score += 0.5;
  else if (ageDays > 180) score -= 0.5;

  return { record, score, matchedTerms: Array.from(new Set(matchedTerms)) };
}

function extractSearchTerms(text: string): string[] {
  const normalized = text.toLowerCase();
  const terms = new Set<string>();
  const matches = normalized.match(/[a-z0-9_./:-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];

  for (const raw of matches) {
    const term = normalizeTerm(raw);
    if (!term || EN_STOP_WORDS.has(term)) continue;
    terms.add(term);
    if (containsCjk(term) && term.length > 2) {
      for (let i = 0; i < term.length - 1; i++) terms.add(term.slice(i, i + 2));
    }
  }

  return Array.from(terms);
}

function normalizeTerm(value: string): string {
  return value.trim().toLowerCase();
}

function containsCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}
