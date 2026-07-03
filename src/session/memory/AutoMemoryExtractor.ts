import type { LLMProvider } from '../../core/types/llm.js';
import { systemMessage, userMessage, type Message } from '../../core/types/message.js';
import { messageToText } from '../store/SessionStore.js';
import { buildAutoMemoryExtractionPrompt } from './MemoryPrompts.js';
import type { AddMemoryInput, MemoryType } from './types.js';
import { isMemoryScope, isMemoryType } from './types.js';

export interface AutoMemoryExtractorOptions {
  llmProvider: LLMProvider;
  language: 'zh-CN' | 'en-US';
  characterId?: string;
  sessionId?: string;
  intervalTurns?: number;
}

export class AutoMemoryExtractor {
  private readonly llmProvider: LLMProvider;
  private readonly language: 'zh-CN' | 'en-US';
  private readonly characterId?: string;
  private readonly sessionId?: string;
  private readonly intervalTurns: number;

  constructor(options: AutoMemoryExtractorOptions) {
    this.llmProvider = options.llmProvider;
    this.language = options.language;
    this.characterId = options.characterId;
    this.sessionId = options.sessionId;
    this.intervalTurns = Math.max(1, Math.floor(options.intervalTurns ?? 1));
  }

  shouldExtract(messages: Message[]): boolean {
    const relevant = messages.filter(message => message.role !== 'system');
    if (relevant.length < 2) return false;
    if (this.intervalTurns <= 1) return true;
    const turns = messages.filter(message => message.role === 'user').length;
    return turns > 0 && turns % this.intervalTurns === 0;
  }

  async extract(messages: Message[]): Promise<AddMemoryInput[]> {
    if (!this.shouldExtract(messages)) return [];
    const relevant = messages.filter(message => message.role !== 'system').slice(-8);

    const transcript = relevant.map((message, index) => `#${index + 1} ${message.role}\n${messageToText(message)}`).join('\n\n');

    try {
      const result = await this.runRestrictedExtractionAgent(transcript);
      return parseMemoryJson(result.text).map(item => ({
        ...item,
        source: 'auto' as const,
        sessionId: this.sessionId,
        characterId: this.characterId,
      }));
    } catch {
      return [];
    }
  }

  private async runRestrictedExtractionAgent(transcript: string): Promise<{ text: string }> {
    return this.llmProvider.chat({
      messages: [
        systemMessage(buildAutoMemoryExtractionPrompt({ language: this.language, characterId: this.characterId })),
        userMessage(transcript),
      ],
      tools: [],
      toolChoice: 'none',
      temperature: 0,
      maxTokens: 1200,
    });
  }
}

function parseMemoryJson(raw: string): AddMemoryInput[] {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.memories)) return [];

  return parsed.memories.flatMap(item => {
    if (!isRecord(item)) return [];
    if (!isMemoryType(item.type)) return [];
    if (typeof item.content !== 'string' || !item.content.trim()) return [];
    const scope = isMemoryScope(item.scope) ? item.scope : undefined;
    const tags = Array.isArray(item.tags) ? item.tags.map(tag => String(tag)) : [];
    const confidence = typeof item.confidence === 'number' ? item.confidence : undefined;
    return [{
      type: item.type as MemoryType,
      scope,
      content: item.content,
      summary: typeof item.summary === 'string' ? item.summary : undefined,
      tags,
      confidence,
    }];
  });
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim().startsWith('{')) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
