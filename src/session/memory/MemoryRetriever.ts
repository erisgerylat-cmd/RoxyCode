import type { MemoryRecord, MemoryType } from './types.js';

export interface MemoryRetrievalOptions {
  limit?: number;
  now?: number;
  minScore?: number;
  preferredTypes?: MemoryType[];
}

export interface MemoryRetrievalResult {
  record: MemoryRecord;
  score: number;
  matchedTerms: string[];
  reasons: string[];
}

interface IndexedMemory {
  record: MemoryRecord;
  terms: Map<string, number>;
  tagTerms: Set<string>;
  summaryTerms: Set<string>;
}

const DEFAULT_RECALL_LIMIT = 5;
const MS_PER_DAY = 86_400_000;
const CONTENT_WEIGHT = 1;
const SUMMARY_WEIGHT = 2;
const TAG_WEIGHT = 3;
const MANUAL_SOURCE_BOOST = 0.15;
const RECENT_MEMORY_BOOST = 0.2;
const STALE_MEMORY_PENALTY = 0.2;
const TYPE_PREFERENCE_BOOST = 0.6;

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
  user: ['user', 'preference', 'prefer', 'style', 'role', 'goal', 'language', 'techstack', '\u6211', '\u7528\u6237', '\u504f\u597d', '\u4e60\u60ef', '\u89d2\u8272', '\u76ee\u6807', '\u8bed\u8a00', '\u6280\u672f\u6808'],
  project: ['project', 'deadline', 'decision', 'incident', 'goal', 'requirement', '\u9879\u76ee', '\u9700\u6c42', '\u80cc\u666f', '\u51b3\u7b56', '\u4e8b\u6545', '\u622a\u6b62'],
  feedback: ['feedback', 'correction', 'avoid', 'stop', 'review', '\u53cd\u9988', '\u7ea0\u6b63', '\u4e0d\u8981', '\u907f\u514d', '\u5ba1\u67e5'],
  reference: ['reference', 'doc', 'docs', 'link', 'ticket', 'dashboard', '\u53c2\u8003', '\u6587\u6863', '\u94fe\u63a5', '\u5de5\u5355', '\u770b\u677f'],
  learning: ['learn', 'learning', 'teach', 'explain', 'beginner', 'depth', '\u5b66\u4e60', '\u6559\u5b66', '\u89e3\u91ca', '\u521d\u5b66', '\u6982\u5ff5', '\u6df1\u5ea6'],
  workflow: ['workflow', 'command', 'branch', 'commit', 'review', 'test', '\u6d41\u7a0b', '\u547d\u4ee4', '\u5206\u652f', '\u63d0\u4ea4', '\u6d4b\u8bd5'],
};

export class MemoryRetriever {
  private readonly indexed: IndexedMemory[];
  private readonly documentFrequency = new Map<string, number>();
  private readonly now: number;

  constructor(records: MemoryRecord[], options: { now?: number } = {}) {
    this.now = options.now ?? Date.now();
    this.indexed = records.map(record => indexMemory(record));
    for (const item of this.indexed) {
      for (const term of item.terms.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }
  }

  retrieve(query: string, options: MemoryRetrievalOptions = {}): MemoryRetrievalResult[] {
    const queryTerms = uniqueTerms(extractSearchTerms(query));
    if (queryTerms.length === 0) return [];

    const limit = Math.max(1, options.limit ?? DEFAULT_RECALL_LIMIT);
    const minScore = options.minScore ?? 0;
    const preferredTypes = new Set(options.preferredTypes ?? []);
    return this.indexed
      .map(item => this.score(item, queryTerms, preferredTypes))
      .filter(result => result.score > minScore)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.record.updatedAt - a.record.updatedAt;
      })
      .slice(0, limit);
  }

  private score(item: IndexedMemory, queryTerms: string[], preferredTypes: ReadonlySet<MemoryType>): MemoryRetrievalResult {
    const matchedTerms: string[] = [];
    const reasons: string[] = [];
    let score = 0;

    for (const term of queryTerms) {
      const tf = item.terms.get(term) ?? 0;
      if (tf <= 0) continue;
      const idf = inverseDocumentFrequency(term, this.indexed.length, this.documentFrequency);
      let weight = CONTENT_WEIGHT;
      if (item.summaryTerms.has(term)) weight = Math.max(weight, SUMMARY_WEIGHT);
      if (item.tagTerms.has(term)) weight = Math.max(weight, TAG_WEIGHT);
      score += tf * idf * weight;
      matchedTerms.push(term);
      if (item.tagTerms.has(term)) reasons.push(`tag:${term}`);
      else if (item.summaryTerms.has(term)) reasons.push(`summary:${term}`);
      else reasons.push(`content:${term}`);
    }

    const typeHints = TYPE_HINTS[item.record.type].map(normalizeTerm);
    if (queryTerms.some(term => typeHints.includes(term))) {
      score += 0.75;
      reasons.push(`type:${item.record.type}`);
    }

    if (item.record.scope === 'project' && queryTerms.some(term => ['\u9879\u76ee', '\u9700\u6c42', 'project', 'repo'].includes(term))) {
      score += 0.3;
      reasons.push('scope:project');
    }

    if (score > 0 && preferredTypes.has(item.record.type)) {
      score += TYPE_PREFERENCE_BOOST;
      reasons.push(`character-prefers:${item.record.type}`);
    }

    if (score <= 0) return { record: item.record, score: 0, matchedTerms: [], reasons: [] };

    if (item.record.source === 'manual') {
      score += MANUAL_SOURCE_BOOST;
      reasons.push('source:manual');
    }

    const ageDays = memoryAgeDays(item.record.updatedAt, this.now);
    if (ageDays <= 7) {
      score += RECENT_MEMORY_BOOST;
      reasons.push('fresh');
    } else if (ageDays > 180) {
      score -= STALE_MEMORY_PENALTY;
      reasons.push('stale-penalty');
    }

    return {
      record: item.record,
      score: roundScore(score),
      matchedTerms: uniqueTerms(matchedTerms),
      reasons: uniqueTerms(reasons),
    };
  }
}

export function extractSearchTerms(text: string): string[] {
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

function indexMemory(record: MemoryRecord): IndexedMemory {
  const terms = new Map<string, number>();
  const addTerms = (text: string, weight = 1) => {
    for (const term of extractSearchTerms(text)) terms.set(term, (terms.get(term) ?? 0) + weight);
  };

  addTerms(record.content, 1);
  if (record.summary) addTerms(record.summary, 1.25);
  for (const tag of record.tags) addTerms(tag, 1.5);

  return {
    record,
    terms,
    tagTerms: new Set(record.tags.flatMap(tag => extractSearchTerms(tag))),
    summaryTerms: new Set(extractSearchTerms(record.summary ?? '')),
  };
}

function inverseDocumentFrequency(term: string, totalDocuments: number, documentFrequency: Map<string, number>): number {
  const df = documentFrequency.get(term) ?? 0;
  return Math.log((1 + totalDocuments) / (1 + df)) + 1;
}

function memoryAgeDays(timestampMs: number, now: number): number {
  return Math.max(0, Math.floor((now - timestampMs) / MS_PER_DAY));
}

function normalizeTerm(value: string): string {
  return value.trim().toLowerCase();
}

function containsCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function uniqueTerms(values: string[]): string[] {
  return Array.from(new Set(values));
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}
