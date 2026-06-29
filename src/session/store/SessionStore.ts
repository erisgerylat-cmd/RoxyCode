import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Message } from '../../core/types/message.js';

export type SessionEventType = 'meta' | 'user' | 'assistant' | 'tool' | 'command' | 'compact' | 'rewind' | 'note';

export interface SessionEvent {
  type: SessionEventType;
  timestamp: number;
  sessionId: string;
  cwd: string;
  message?: Message;
  command?: { name: string; args: string[]; raw: string };
  summary?: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionInfo {
  sessionId: string;
  path: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  firstUserText: string;
}

export interface ExportSessionOptions {
  format?: 'text' | 'jsonl';
}

type AppendableSessionEvent = Omit<SessionEvent, 'sessionId' | 'cwd' | 'timestamp'> & { timestamp?: number };

export class SessionStore {
  readonly sessionId: string;
  readonly cwd: string;
  readonly dir: string;
  readonly path: string;

  constructor(cwd: string = process.cwd(), sessionId: string = createSessionId()) {
    this.cwd = cwd;
    this.sessionId = sessionId;
    this.dir = join(cwd, '.roxycode', 'sessions');
    this.path = join(this.dir, `${sessionId}.jsonl`);
  }

  static fromPath(path: string, cwd: string = process.cwd()): SessionStore {
    const file = basename(path);
    const sessionId = file.endsWith('.jsonl') ? file.slice(0, -'.jsonl'.length) : file;
    return new SessionStore(cwd, sessionId);
  }

  async init(meta: Record<string, unknown> = {}): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    if (!existsSync(this.path)) {
      await this.append({ type: 'meta', metadata: meta });
    }
  }

  async append(event: AppendableSessionEvent): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const full: SessionEvent = {
      timestamp: event.timestamp ?? Date.now(),
      sessionId: this.sessionId,
      cwd: this.cwd,
      ...event,
    };
    await appendFile(this.path, `${JSON.stringify(full)}\n`, 'utf8');
  }

  async appendMessage(message: Message, type?: 'user' | 'assistant' | 'tool'): Promise<void> {
    const eventType = type ?? messageRoleToEventType(message);
    await this.append({ type: eventType, message });
  }

  async readEvents(): Promise<SessionEvent[]> {
    if (!existsSync(this.path)) return [];
    const raw = await readFile(this.path, 'utf8');
    return raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line) as SessionEvent);
  }

  async readMessages(): Promise<Message[]> {
    const events = await this.readEvents();
    return events.flatMap(event => event.message ? [event.message] : []);
  }

  async rewind(messageCount: number): Promise<{ removed: number; messages: Message[] }> {
    const events = await this.readEvents();
    const messages = events.filter(event => event.message).map(event => event.message!);
    const keepCount = Math.max(0, Math.min(messageCount, messages.length));
    const keptMessages = messages.slice(0, keepCount);
    const removed = messages.length - keptMessages.length;
    const nextEvents = events.filter(event => !event.message);

    for (const message of keptMessages) {
      nextEvents.push({
        type: messageRoleToEventType(message),
        timestamp: message.timestamp,
        sessionId: this.sessionId,
        cwd: this.cwd,
        message,
      });
    }

    nextEvents.push({
      type: 'rewind',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      cwd: this.cwd,
      note: `rewind to ${keepCount} messages`,
      metadata: { removed },
    });
    await writeFile(this.path, `${nextEvents.map(event => JSON.stringify(event)).join('\n')}\n`, 'utf8');
    return { removed, messages: keptMessages };
  }

  async replaceMessagesWithSummary(summary: string, recentMessages: Message[]): Promise<void> {
    const summaryMessage: Message = {
      role: 'assistant',
      content: summary,
      timestamp: Date.now(),
      metadata: { mode: 'summary' },
    };
    await this.append({ type: 'compact', summary, message: summaryMessage, metadata: { recentMessages: recentMessages.length } });
  }

  async export(options: ExportSessionOptions = {}): Promise<string> {
    const format = options.format ?? 'text';
    if (format === 'jsonl') {
      return existsSync(this.path) ? readFile(this.path, 'utf8') : '';
    }
    return renderMessagesAsText(await this.readMessages());
  }

  async list(): Promise<SessionInfo[]> {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter(file => file.endsWith('.jsonl'));
    const infos = await Promise.all(files.map(file => this.describe(join(this.dir, file))));
    return infos.filter((item): item is SessionInfo => item !== null).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async find(query?: string): Promise<SessionInfo | null> {
    const sessions = await this.list();
    if (!query) return sessions[0] ?? null;
    const normalized = query.toLowerCase();
    return sessions.find(item => item.sessionId === query || item.sessionId.startsWith(query) || item.firstUserText.toLowerCase().includes(normalized)) ?? null;
  }

  private async describe(path: string): Promise<SessionInfo | null> {
    try {
      const raw = await readFile(path, 'utf8');
      const events = raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as SessionEvent);
      const messages = events.flatMap(event => event.message ? [event.message] : []);
      const firstUser = messages.find(message => message.role === 'user');
      const timestamps = events.map(event => event.timestamp).filter((value): value is number => typeof value === 'number');
      const file = basename(path);
      return {
        sessionId: file.slice(0, -'.jsonl'.length),
        path,
        cwd: events[0]?.cwd ?? this.cwd,
        createdAt: timestamps.length ? Math.min(...timestamps) : Date.now(),
        updatedAt: timestamps.length ? Math.max(...timestamps) : 0,
        messageCount: messages.length,
        firstUserText: firstUser ? messageToText(firstUser).slice(0, 80) : '',
      };
    } catch {
      return null;
    }
  }
}

export function createSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function renderMessagesAsText(messages: Message[]): string {
  return messages.map((message, index) => {
    const role = message.role.toUpperCase();
    const time = new Date(message.timestamp).toISOString();
    return `#${index + 1} ${role} ${time}\n${messageToText(message)}`;
  }).join('\n\n');
}

export function messageToText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  return message.content.map(block => {
    if (block.type === 'text') return block.text;
    if (block.type === 'tool_use') return `<tool_use ${block.toolCall.name}> ${JSON.stringify(block.toolCall.arguments)}`;
    return `<tool_result ${block.toolCallId}> ${block.result.success ? block.result.output : block.result.error ?? block.result.output}`;
  }).join('\n');
}

function messageRoleToEventType(message: Message): 'user' | 'assistant' | 'tool' {
  if (message.role === 'user') return 'user';
  if (message.role === 'tool') return 'tool';
  return 'assistant';
}