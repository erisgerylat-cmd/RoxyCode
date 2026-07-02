import { randomUUID, createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type {
  TelemetryAttributes,
  TelemetryEvent,
  TelemetryEventCategory,
  TelemetryLogInput,
  TelemetryLoggerInit,
  TelemetrySnapshot,
  TelemetrySpan,
} from './types.js';

const DEFAULT_MAX_ATTRIBUTE_CHARS = 500;
const MAX_DEPTH = 5;
const SECRET_KEY_PATTERN = /api[_-]?key|authorization|bearer|token|secret|password|credential|cookie/i;
const ABSOLUTE_WINDOWS_PATH = /^[a-zA-Z]:[\\/]/;

export class TelemetryLogger {
  private readonly cwd: string;
  private readonly path: string;
  private readonly maxAttributeChars: number;
  private enabled: boolean;
  private sessionId?: string;
  private runtimeId?: string;
  private sequence = 0;
  private eventCount = 0;
  private droppedEvents = 0;
  private lastEvent?: TelemetrySnapshot['lastEvent'];
  private lastError?: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(init: TelemetryLoggerInit = {}) {
    this.cwd = resolve(init.cwd ?? process.cwd());
    this.path = join(this.cwd, '.roxycode', 'telemetry', 'events.jsonl');
    this.enabled = init.enabled ?? process.env.ROXY_TELEMETRY_DISABLED !== '1';
    this.sessionId = init.sessionId;
    this.runtimeId = init.runtimeId;
    this.maxAttributeChars = init.maxAttributeChars ?? DEFAULT_MAX_ATTRIBUTE_CHARS;
  }

  getPath(): string {
    return this.path;
  }

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  setRuntime(runtimeId: string): void {
    this.runtimeId = runtimeId;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  log(input: TelemetryLogInput): Promise<void> {
    if (!this.enabled) return Promise.resolve();

    const event: TelemetryEvent = {
      id: randomUUID(),
      sequence: this.sequence++,
      timestamp: new Date().toISOString(),
      name: normalizeEventName(input.name),
      category: input.category,
      sessionId: this.sessionId,
      runtimeId: this.runtimeId,
      durationMs: input.durationMs === undefined ? undefined : Math.max(0, Math.round(input.durationMs)),
      success: input.success,
      attributes: sanitizeAttributes(input.attributes ?? {}, this.cwd, this.maxAttributeChars),
    };

    return this.enqueue(event);
  }

  startSpan(name: string, category: TelemetryEventCategory, attributes: Record<string, unknown> = {}): TelemetrySpan {
    const id = randomUUID();
    const startedAt = Date.now();
    void this.log({
      name: `${name}.start`,
      category,
      attributes: { spanId: id, ...attributes },
    });

    return {
      id,
      name,
      startedAt,
      end: input => this.log({
        name: `${name}.end`,
        category,
        durationMs: Date.now() - startedAt,
        success: input?.success,
        attributes: { spanId: id, ...attributes, ...(input?.attributes ?? {}) },
      }),
    };
  }

  async flush(): Promise<void> {
    await this.writeQueue.catch(() => undefined);
  }

  snapshot(): TelemetrySnapshot {
    return {
      enabled: this.enabled,
      path: this.path,
      eventCount: this.eventCount,
      droppedEvents: this.droppedEvents,
      lastEvent: this.lastEvent ? { ...this.lastEvent } : undefined,
      lastError: this.lastError,
    };
  }

  private enqueue(event: TelemetryEvent): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await appendFile(this.path, `${JSON.stringify(event)}\n`, 'utf8');
        this.eventCount += 1;
        this.lastEvent = {
          name: event.name,
          category: event.category,
          timestamp: event.timestamp,
          success: event.success,
        };
        this.lastError = undefined;
      })
      .catch(error => {
        this.droppedEvents += 1;
        this.lastError = error instanceof Error ? error.message : String(error);
      });
    return this.writeQueue;
  }
}

export function sanitizeAttributes(
  attributes: Record<string, unknown>,
  cwd: string = process.cwd(),
  maxChars = DEFAULT_MAX_ATTRIBUTE_CHARS,
): TelemetryAttributes {
  return sanitizeRecord(attributes, resolve(cwd), maxChars, 0);
}

function sanitizeRecord(value: Record<string, unknown>, cwd: string, maxChars: number, depth: number): TelemetryAttributes {
  const out: TelemetryAttributes = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = sanitizeValue(item, key, cwd, maxChars, depth + 1);
  }
  return out;
}

function sanitizeValue(value: unknown, key: string, cwd: string, maxChars: number, depth: number): TelemetryAttributes[string] {
  if (depth > MAX_DEPTH) return '[max_depth]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (SECRET_KEY_PATTERN.test(value)) return '[redacted_like_secret]';
    const normalized = normalizePathLikeValue(value, key, cwd);
    return clip(normalized, maxChars);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item, index) => sanitizeValue(item, `${key}.${index}`, cwd, maxChars, depth + 1));
  }
  if (typeof value === 'object') {
    return sanitizeRecord(value as Record<string, unknown>, cwd, maxChars, depth + 1);
  }
  if (value === undefined) return null;
  return clip(String(value), maxChars);
}

function normalizePathLikeValue(value: string, key: string, cwd: string): string {
  const trimmed = value.trim();
  if (!looksLikePath(key, trimmed)) return value;

  try {
    const absolute = resolve(trimmed);
    const rel = relative(cwd, absolute);
    if (rel && !rel.startsWith('..') && !ABSOLUTE_WINDOWS_PATH.test(rel)) {
      return `<project>/${rel.replace(/\\/g, '/')}`;
    }
  } catch {
    return value;
  }

  if (ABSOLUTE_WINDOWS_PATH.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\\\')) {
    return `[path:${hashString(trimmed)}]`;
  }
  return value;
}

function looksLikePath(key: string, value: string): boolean {
  if (/path|file|cwd|dir|workspace/i.test(key)) return true;
  return ABSOLUTE_WINDOWS_PATH.test(value)
    || value.startsWith('/')
    || value.startsWith('\\\\')
    || value.includes('\\\\')
    || value.includes('/');
}

function normalizeEventName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 120) || 'unknown_event';
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}... [truncated ${value.length - maxChars} chars]`;
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
