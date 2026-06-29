import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AddMemoryInput, AddMemoryResult, MemoryListOptions, MemoryRecord, MemoryScope, MemoryType } from './types.js';
import { defaultScopeForMemoryType } from './types.js';
import { assertMemoryPolicy } from './MemoryPolicy.js';

export interface MemoryStoreOptions {
  cwd?: string;
  globalDir?: string;
}

interface MemoryEvent {
  event: 'add' | 'archive';
  timestamp: number;
  record?: MemoryRecord;
  id?: string;
  reason?: string;
}

export class MemoryStore {
  readonly cwd: string;
  readonly globalDir: string;
  readonly projectDir: string;
  readonly globalPath: string;
  readonly projectPath: string;

  constructor(options: MemoryStoreOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.globalDir = options.globalDir ?? join(homedir(), '.roxycode');
    this.projectDir = join(this.cwd, '.roxycode');
    this.globalPath = join(this.globalDir, 'memory.jsonl');
    this.projectPath = join(this.projectDir, 'memory.jsonl');
  }

  async add(input: AddMemoryInput): Promise<AddMemoryResult> {
    const scope = input.scope ?? defaultScopeForMemoryType(input.type);
    const content = normalizeContent(input.content);
    assertMemoryPolicy({ ...input, scope, content });
    const existing = await this.findDuplicate(content, input.type, scope);
    if (existing) return { record: existing, created: false };

    const now = Date.now();
    const record: MemoryRecord = {
      id: createMemoryId(input.type),
      type: input.type,
      scope,
      source: input.source ?? 'manual',
      content,
      summary: input.summary?.trim() || undefined,
      tags: normalizeTags(input.tags),
      confidence: clampConfidence(input.confidence),
      createdAt: now,
      updatedAt: now,
      sessionId: input.sessionId,
      characterId: input.characterId,
      metadata: input.metadata,
    };

    await this.append(scope, { event: 'add', timestamp: now, record });
    return { record, created: true };
  }

  async list(options: MemoryListOptions = {}): Promise<MemoryRecord[]> {
    const scopes: MemoryScope[] = options.scope ? [options.scope] : ['global', 'project'];
    const records = new Map<string, MemoryRecord>();
    const archived = new Set<string>();

    for (const scope of scopes) {
      for (const event of await this.readEvents(scope)) {
        if (event.event === 'archive' && event.id) {
          archived.add(event.id);
          records.delete(event.id);
          continue;
        }
        if (event.event === 'add' && event.record) records.set(event.record.id, event.record);
      }
    }

    let result = Array.from(records.values());
    if (!options.includeArchived) result = result.filter(record => !record.archivedAt && !archived.has(record.id));
    if (options.type) result = result.filter(record => record.type === options.type);
    if (options.query?.trim()) {
      const q = options.query.trim().toLowerCase();
      result = result.filter(record => [record.content, record.summary ?? '', record.tags.join(' ')].join(' ').toLowerCase().includes(q));
    }

    result.sort((a, b) => b.updatedAt - a.updatedAt);
    return result.slice(0, options.limit ?? result.length);
  }

  async get(id: string): Promise<MemoryRecord | null> {
    return (await this.list({ includeArchived: false })).find(record => record.id === id || record.id.startsWith(id)) ?? null;
  }

  async archive(id: string, reason?: string): Promise<boolean> {
    const record = await this.get(id);
    if (!record) return false;
    await this.append(record.scope, { event: 'archive', timestamp: Date.now(), id: record.id, reason });
    return true;
  }

  async clear(scope: MemoryScope): Promise<void> {
    const path = this.pathForScope(scope);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '', 'utf8');
  }

  getPaths(): Record<MemoryScope, string> {
    return { global: this.globalPath, project: this.projectPath };
  }

  private async append(scope: MemoryScope, event: MemoryEvent): Promise<void> {
    const path = this.pathForScope(scope);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8');
  }

  private async readEvents(scope: MemoryScope): Promise<MemoryEvent[]> {
    const path = this.pathForScope(scope);
    if (!existsSync(path)) return [];
    const raw = await readFile(path, 'utf8');
    return raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap(line => {
      try {
        return [JSON.parse(line) as MemoryEvent];
      } catch {
        return [];
      }
    });
  }

  private async findDuplicate(content: string, type: MemoryType, scope: MemoryScope): Promise<MemoryRecord | null> {
    const normalized = normalizeForCompare(content);
    return (await this.list({ type, scope })).find(record => normalizeForCompare(record.content) === normalized) ?? null;
  }

  private pathForScope(scope: MemoryScope): string {
    return scope === 'global' ? this.globalPath : this.projectPath;
  }
}

export function renderMemoriesForPrompt(records: MemoryRecord[], language: 'zh-CN' | 'en-US'): string {
  if (records.length === 0) return '';
  const isZh = language !== 'en-US';
  const grouped = groupByType(records);
  const lines: string[] = [
    isZh
      ? '## RoxyCode \u8bb0\u5fc6\u7cfb\u7edf'
      : '## RoxyCode Memory System',
    isZh
      ? '\u4ee5\u4e0b\u5185\u5bb9\u6765\u81ea RoxyCode \u957f\u671f\u8bb0\u5fc6\u3002\u8bb0\u5fc6\u53ef\u80fd\u8fc7\u671f\uff1b\u6d89\u53ca\u6587\u4ef6\u3001\u51fd\u6570\u3001\u547d\u4ee4\u6216\u5f53\u524d\u9879\u76ee\u72b6\u6001\u65f6\uff0c\u5fc5\u987b\u5148\u7528\u5de5\u5177\u6838\u9a8c\u3002'
      : 'The following comes from RoxyCode long-term memory. Memories may be stale; verify files, functions, commands, and current project state before acting on them.',
  ];

  for (const type of Object.keys(grouped) as MemoryType[]) {
    lines.push('', `### ${type}`);
    for (const record of grouped[type] ?? []) {
      const tags = record.tags.length ? ` [${record.tags.join(', ')}]` : '';
      lines.push(`- (${record.scope}/${record.source})${tags} ${record.content}`);
    }
  }

  return lines.join('\n');
}

function groupByType(records: MemoryRecord[]): Partial<Record<MemoryType, MemoryRecord[]>> {
  return records.reduce<Partial<Record<MemoryType, MemoryRecord[]>>>((grouped, record) => {
    grouped[record.type] ??= [];
    grouped[record.type]!.push(record);
    return grouped;
  }, {});
}

function normalizeContent(content: string): string {
  const normalized = content.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error('Memory content cannot be empty');
  return normalized;
}

function normalizeForCompare(content: string): string {
  return content.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeTags(tags: string[] | undefined): string[] {
  return Array.from(new Set((tags ?? []).map(tag => tag.trim().toLowerCase()).filter(Boolean))).slice(0, 12);
}

function clampConfidence(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function createMemoryId(type: MemoryType): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${type}-${Date.now().toString(36)}-${random}`;
}
