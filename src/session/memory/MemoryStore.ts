import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  MEMORY_TYPES,
  type AddMemoryInput,
  type AddMemoryResult,
  type ApprovePendingMemoryResult,
  type MemoryListOptions,
  type MemoryRecord,
  type MemoryScope,
  type MemoryType,
  type PendingMemoryRecord,
  type QueuePendingMemoryResult,
} from './types.js';
import { defaultScopeForMemoryType, isMemoryScope, isMemoryType } from './types.js';
import { assertMemoryPolicy, evaluateMemoryCandidate } from './MemoryPolicy.js';
import { memoryAge, memoryFreshnessText, selectRelevantMemories, type MemoryRecallOptions } from './MemoryRecall.js';
import { parseMemoryIndex, renderMemoryIndex, type MemoryIndexEntry } from './MemoryIndex.js';

export interface MemoryStoreOptions {
  cwd?: string;
  globalDir?: string;
}

export interface MemoryStats {
  enabled: boolean;
  total: number;
  global: number;
  project: number;
  byType: Record<MemoryType, number>;
  manual: number;
  auto: number;
  latestUpdatedAt?: number;
  latestAge?: string;
  pending: number;
  paths: Record<MemoryScope, string>;
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
  readonly globalIndexPath: string;
  readonly projectIndexPath: string;
  readonly pendingPath: string;

  constructor(options: MemoryStoreOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.globalDir = options.globalDir ?? join(homedir(), '.roxycode');
    this.projectDir = join(this.cwd, '.roxycode');
    this.globalPath = join(this.globalDir, 'memory.jsonl');
    this.projectPath = join(this.projectDir, 'memory.jsonl');
    this.globalIndexPath = join(this.globalDir, 'MEMORY.md');
    this.projectIndexPath = join(this.projectDir, 'MEMORY.md');
    this.pendingPath = join(this.projectDir, 'memory.pending.json');
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
    await this.rebuildIndex(scope);
    return { record, created: true };
  }

  async saveMemory(input: AddMemoryInput): Promise<AddMemoryResult> {
    return this.add(input);
  }

  async queuePending(input: AddMemoryInput, options: { reason?: string } = {}): Promise<QueuePendingMemoryResult> {
    const scope = input.scope ?? defaultScopeForMemoryType(input.type);
    const content = normalizeContent(input.content);
    const evaluation = evaluateMemoryCandidate({ ...input, scope, content, source: 'auto' });
    if (!evaluation.allowed) {
      return {
        queued: false,
        duplicate: false,
        rejected: true,
        reasons: evaluation.reasons,
        suggestions: evaluation.suggestions,
      };
    }

    const existingMemory = await this.findDuplicate(content, input.type, scope);
    if (existingMemory) {
      return {
        queued: false,
        duplicate: true,
        rejected: false,
        existing: existingMemory,
        reasons: [],
        suggestions: [],
      };
    }

    const pending = await this.listPending();
    const existingPending = pending.find(record => record.candidate.type === input.type
      && record.candidate.scope === scope
      && normalizeForCompare(record.candidate.content) === normalizeForCompare(content));
    if (existingPending) {
      return {
        queued: false,
        duplicate: true,
        rejected: false,
        existing: existingPending,
        reasons: [],
        suggestions: [],
      };
    }

    const now = Date.now();
    const record: PendingMemoryRecord = {
      id: createPendingMemoryId(input.type),
      candidate: {
        ...input,
        scope,
        source: 'auto',
        content,
        tags: normalizeTags(input.tags),
        summary: input.summary?.trim() || undefined,
        confidence: clampConfidence(input.confidence),
        sessionId: input.sessionId,
        characterId: input.characterId,
      },
      reason: options.reason ?? 'auto-extracted',
      createdAt: now,
      sessionId: input.sessionId,
      characterId: input.characterId,
      policy: evaluation.severity === 'warn'
        ? { severity: evaluation.severity, reasons: evaluation.reasons, suggestions: evaluation.suggestions }
        : { severity: 'allow', reasons: [], suggestions: evaluation.suggestions },
    };

    await this.writePending([...pending, record]);
    return {
      queued: true,
      duplicate: false,
      rejected: false,
      pending: record,
      reasons: evaluation.reasons,
      suggestions: evaluation.suggestions,
    };
  }

  async listPending(): Promise<PendingMemoryRecord[]> {
    if (!existsSync(this.pendingPath)) return [];
    try {
      const parsed = JSON.parse(await readFile(this.pendingPath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap(item => normalizePendingRecord(item));
    } catch {
      return [];
    }
  }

  async approvePending(id: string): Promise<ApprovePendingMemoryResult | null> {
    const pending = await this.listPending();
    const index = findPendingIndex(pending, id);
    if (index < 0) return null;
    const [record] = pending.splice(index, 1);
    const result = await this.add(record.candidate);
    await this.writePending(pending);
    return { pending: record, result };
  }

  async rejectPending(id: string, reason?: string): Promise<PendingMemoryRecord | null> {
    const pending = await this.listPending();
    const index = findPendingIndex(pending, id);
    if (index < 0) return null;
    const [record] = pending.splice(index, 1);
    await this.writePending(pending);
    void reason;
    return record;
  }

  async clearPending(): Promise<number> {
    const pending = await this.listPending();
    await this.writePending([]);
    return pending.length;
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

  async listMemories(options: MemoryListOptions = {}): Promise<MemoryRecord[]> {
    return this.list(options);
  }

  async get(id: string): Promise<MemoryRecord | null> {
    return (await this.list({ includeArchived: false })).find(record => record.id === id || record.id.startsWith(id)) ?? null;
  }

  async archive(id: string, reason?: string): Promise<boolean> {
    const record = await this.get(id);
    if (!record) return false;
    await this.append(record.scope, { event: 'archive', timestamp: Date.now(), id: record.id, reason });
    await this.rebuildIndex(record.scope);
    return true;
  }

  async deleteMemory(id: string, reason?: string): Promise<boolean> {
    return this.archive(id, reason);
  }

  async clear(scope: MemoryScope): Promise<void> {
    const path = this.pathForScope(scope);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '', 'utf8');
    await this.rebuildIndex(scope);
  }

  getPaths(): Record<MemoryScope, string> {
    return { global: this.globalPath, project: this.projectPath };
  }

  getIndexPaths(): Record<MemoryScope, string> {
    return { global: this.globalIndexPath, project: this.projectIndexPath };
  }

  async readIndex(scope: MemoryScope): Promise<MemoryIndexEntry[]> {
    const path = this.indexPathForScope(scope);
    if (!existsSync(path)) return [];
    return parseMemoryIndex(await readFile(path, 'utf8'));
  }

  async loadIndex(scope: MemoryScope): Promise<MemoryIndexEntry[]>;
  async loadIndex(): Promise<Record<MemoryScope, MemoryIndexEntry[]>>;
  async loadIndex(scope?: MemoryScope): Promise<MemoryIndexEntry[] | Record<MemoryScope, MemoryIndexEntry[]>> {
    if (scope) return this.readIndex(scope);
    return {
      global: await this.readIndex('global'),
      project: await this.readIndex('project'),
    };
  }

  async recallRelevant(query: string, options: MemoryRecallOptions = {}): Promise<MemoryRecord[]> {
    return selectRelevantMemories(query, await this.list({ includeArchived: false }), options);
  }

  async getStats(options: { enabled?: boolean; language?: 'zh-CN' | 'en-US' } = {}): Promise<MemoryStats> {
    const records = await this.list({ includeArchived: false });
    const byType = MEMORY_TYPES.reduce<Record<MemoryType, number>>((acc, type) => {
      acc[type] = 0;
      return acc;
    }, {} as Record<MemoryType, number>);

    let global = 0;
    let project = 0;
    let manual = 0;
    let auto = 0;
    let latestUpdatedAt: number | undefined;

    for (const record of records) {
      byType[record.type] += 1;
      if (record.scope === 'global') global++;
      else project++;
      if (record.source === 'manual') manual++;
      else auto++;
      latestUpdatedAt = Math.max(latestUpdatedAt ?? 0, record.updatedAt);
    }

    return {
      enabled: options.enabled ?? true,
      total: records.length,
      global,
      project,
      byType,
      manual,
      auto,
      latestUpdatedAt,
      latestAge: latestUpdatedAt ? memoryAge(latestUpdatedAt, options.language ?? 'zh-CN') : undefined,
      pending: (await this.listPending()).length,
      paths: this.getPaths(),
    };
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

  private indexPathForScope(scope: MemoryScope): string {
    return scope === 'global' ? this.globalIndexPath : this.projectIndexPath;
  }

  private async rebuildIndex(scope: MemoryScope): Promise<void> {
    const path = this.indexPathForScope(scope);
    const records = await this.list({ scope, includeArchived: false });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderMemoryIndex(records, { scope }), 'utf8');
  }

  private async writePending(records: PendingMemoryRecord[]): Promise<void> {
    await mkdir(dirname(this.pendingPath), { recursive: true });
    await writeFile(this.pendingPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
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
      const age = memoryAge(record.updatedAt, language);
      const freshness = memoryFreshnessText(record.updatedAt, language);
      const suffix = freshness ? ` ${freshness}` : '';
      lines.push(`- (${record.scope}/${record.source}, ${age})${tags} ${record.content}${suffix}`);
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

function createPendingMemoryId(type: MemoryType): string {
  return `pending-${createMemoryId(type)}`;
}

function findPendingIndex(records: PendingMemoryRecord[], id: string): number {
  return records.findIndex(record => record.id === id || record.id.startsWith(id));
}

function normalizePendingRecord(value: unknown): PendingMemoryRecord[] {
  if (!value || typeof value !== 'object') return [];
  const raw = value as Record<string, unknown>;
  const candidateRaw = raw.candidate;
  if (!candidateRaw || typeof candidateRaw !== 'object') return [];
  const candidate = candidateRaw as Record<string, unknown>;
  if (!isMemoryType(candidate.type)) return [];
  if (!isMemoryScope(candidate.scope)) return [];
  if (candidate.source !== 'auto') return [];
  if (typeof candidate.content !== 'string' || !candidate.content.trim()) return [];
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : createPendingMemoryId(candidate.type);
  const tags = Array.isArray(candidate.tags) ? normalizeTags(candidate.tags.map(String)) : [];
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  return [{
    id,
    candidate: {
      type: candidate.type,
      scope: candidate.scope,
      source: 'auto',
      content: normalizeContent(candidate.content),
      summary: typeof candidate.summary === 'string' ? candidate.summary : undefined,
      tags,
      confidence: typeof candidate.confidence === 'number' ? clampConfidence(candidate.confidence) : undefined,
      sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : undefined,
      characterId: typeof candidate.characterId === 'string' ? candidate.characterId : undefined,
      metadata: candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata as Record<string, unknown> : undefined,
    },
    reason: typeof raw.reason === 'string' ? raw.reason : 'auto-extracted',
    createdAt,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : undefined,
    characterId: typeof raw.characterId === 'string' ? raw.characterId : undefined,
    policy: normalizePendingPolicy(raw.policy),
  }];
}

function normalizePendingPolicy(value: unknown): PendingMemoryRecord['policy'] {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const severity = raw.severity === 'warn' ? 'warn' : raw.severity === 'allow' ? 'allow' : undefined;
  if (!severity) return undefined;
  return {
    severity,
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map(String) : [],
    suggestions: Array.isArray(raw.suggestions) ? raw.suggestions.map(String) : [],
  };
}
