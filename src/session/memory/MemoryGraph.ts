import type { MemoryRecord } from './types.js';

export interface MemoryGraphNode {
  id: string;
  label: string;
  type: MemoryRecord['type'];
  scope: MemoryRecord['scope'];
}

export interface MemoryGraphEdge {
  from: string;
  to: string;
  label: string;
  resolved: boolean;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}

export function extractMemoryLinks(text: string): string[] {
  const links = new Set<string>();
  for (const match of text.matchAll(/\[\[([^\]\r\n]{1,120})\]\]/g)) {
    const value = match[1]?.trim();
    if (value) links.add(value);
  }
  return Array.from(links);
}

export function buildMemoryGraph(records: MemoryRecord[]): MemoryGraph {
  const nodes = records.map(record => ({
    id: record.id,
    label: record.summary || summarize(record.content),
    type: record.type,
    scope: record.scope,
  }));
  const lookup = buildLookup(records);
  const edges: MemoryGraphEdge[] = [];

  for (const record of records) {
    const links = extractMemoryLinks([record.content, record.summary ?? '', record.tags.join(' ')].join(' '));
    for (const link of links) {
      const target = lookup.get(normalizeLink(link));
      edges.push({
        from: record.id,
        to: target?.id ?? link,
        label: link,
        resolved: Boolean(target),
      });
    }
  }

  return { nodes, edges };
}

function buildLookup(records: MemoryRecord[]): Map<string, MemoryRecord> {
  const lookup = new Map<string, MemoryRecord>();
  for (const record of records) {
    lookup.set(normalizeLink(record.id), record);
    if (record.summary) lookup.set(normalizeLink(record.summary), record);
    lookup.set(normalizeLink(summarize(record.content)), record);
  }
  return lookup;
}

function summarize(content: string): string {
  const normalized = content.trim().replace(/\s+/g, ' ');
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function normalizeLink(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}
