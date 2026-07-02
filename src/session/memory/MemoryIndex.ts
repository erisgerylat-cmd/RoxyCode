import type { MemoryRecord, MemoryScope, MemoryType } from './types.js';
import { extractMemoryLinks } from './MemoryGraph.js';

export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_INDEX_MAX_ENTRIES = 192;

export interface MemoryIndexEntry {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  summary: string;
  tags: string[];
  links: string[];
  updatedAt?: string;
}

export interface RenderMemoryIndexOptions {
  scope: MemoryScope;
  limit?: number;
  generatedAt?: number;
}

export function renderMemoryIndex(records: MemoryRecord[], options: RenderMemoryIndexOptions): string {
  const generatedAt = new Date(options.generatedAt ?? Date.now()).toISOString();
  const requestedLimit = Math.max(1, Math.min(options.limit ?? MEMORY_INDEX_MAX_ENTRIES, MEMORY_INDEX_MAX_ENTRIES));
  const header = buildHeader(options.scope, generatedAt, 0);
  const lineBudget = Math.max(0, MEMORY_INDEX_MAX_LINES - header.length);
  const limit = Math.min(requestedLimit, lineBudget);
  const sorted = [...records].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  const lines = buildHeader(options.scope, generatedAt, sorted.length);

  for (const record of sorted) {
    const summary = sanitizeInline(record.summary || record.content, 120);
    const tags = record.tags.map(tag => `#${sanitizeTag(tag)}`).filter(tag => tag.length > 1).join(' ');
    const links = extractMemoryLinks([record.content, record.summary ?? ''].join(' '))
      .map(link => `[[${sanitizeInline(link, 80)}]]`)
      .join(', ');
    const suffix = [
      tags,
      links ? `links: ${links}` : '',
      `updated: ${new Date(record.updatedAt).toISOString()}`,
    ].filter(Boolean).join(' | ');
    lines.push(`- [${record.type}/${record.scope}] [[${record.id}]] ${summary}${suffix ? ` (${suffix})` : ''}`);
  }

  return `${lines.slice(0, MEMORY_INDEX_MAX_LINES).join('\n')}\n`;
}

export function parseMemoryIndex(markdown: string): MemoryIndexEntry[] {
  const entries: MemoryIndexEntry[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^- \[([a-z]+)\/(global|project)\] \[\[([^\]]+)\]\] (.*)$/);
    if (!match) continue;
    const [, type, scope, id, rest] = match;
    const metaStart = rest.lastIndexOf(' (');
    const summary = metaStart >= 0 ? rest.slice(0, metaStart).trim() : rest.trim();
    const metadata = metaStart >= 0 ? rest.slice(metaStart + 2, -1) : '';
    entries.push({
      id,
      type: type as MemoryType,
      scope: scope as MemoryScope,
      summary,
      tags: Array.from(metadata.matchAll(/#([a-z0-9_.-]+)/gi)).map(item => item[1]!),
      links: extractMemoryLinks(metadata),
      updatedAt: metadata.match(/updated: ([^|)]+)/)?.[1]?.trim(),
    });
  }
  return entries;
}

function buildHeader(scope: MemoryScope, generatedAt: string, entries: number): string[] {
  return [
    '# RoxyCode Memory Index',
    '',
    `scope: ${scope}`,
    `generatedAt: ${generatedAt}`,
    `entries: ${entries}`,
    '',
    'This file is generated from memory.jsonl. Edit memories with /memory commands instead of editing this index directly.',
    '',
  ];
}

function sanitizeInline(value: string, max: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ').replace(/[()]/g, '');
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function sanitizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]/gi, '-').replace(/-+/g, '-').slice(0, 40);
}
