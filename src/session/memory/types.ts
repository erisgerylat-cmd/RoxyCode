export const MEMORY_TYPES = ['user', 'project', 'feedback', 'reference', 'learning', 'workflow'] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];
export type MemoryScope = 'global' | 'project';
export type MemorySource = 'manual' | 'auto';

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  source: MemorySource;
  content: string;
  summary?: string;
  tags: string[];
  confidence: number;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  sessionId?: string;
  characterId?: string;
  metadata?: Record<string, unknown>;
}

export interface AddMemoryInput {
  type: MemoryType;
  content: string;
  scope?: MemoryScope;
  source?: MemorySource;
  summary?: string;
  tags?: string[];
  confidence?: number;
  sessionId?: string;
  characterId?: string;
  metadata?: Record<string, unknown>;
}

export interface AddMemoryResult {
  record: MemoryRecord;
  created: boolean;
}

export interface PendingMemoryRecord {
  id: string;
  candidate: AddMemoryInput & {
    scope: MemoryScope;
    source: 'auto';
  };
  reason: string;
  createdAt: number;
  sessionId?: string;
  characterId?: string;
  policy?: {
    severity: 'allow' | 'warn';
    reasons: string[];
    suggestions: string[];
  };
}

export interface QueuePendingMemoryResult {
  queued: boolean;
  duplicate: boolean;
  rejected: boolean;
  pending?: PendingMemoryRecord;
  existing?: MemoryRecord | PendingMemoryRecord;
  reasons: string[];
  suggestions: string[];
}

export interface ApprovePendingMemoryResult {
  pending: PendingMemoryRecord;
  result: AddMemoryResult;
}

export interface MemoryListOptions {
  type?: MemoryType;
  scope?: MemoryScope;
  query?: string;
  limit?: number;
  includeArchived?: boolean;
}

export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (MEMORY_TYPES as readonly string[]).includes(value);
}

export function isMemoryScope(value: unknown): value is MemoryScope {
  return value === 'global' || value === 'project';
}

export function defaultScopeForMemoryType(type: MemoryType): MemoryScope {
  if (type === 'project' || type === 'reference') return 'project';
  return 'global';
}
