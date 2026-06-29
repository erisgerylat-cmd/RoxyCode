import type { LLMProvider } from '../../core/types/llm.js';
import { systemMessage, userMessage, type Message } from '../../core/types/message.js';
import { messageToText } from '../store/SessionStore.js';
import type { AddMemoryInput, MemoryType } from './types.js';
import { isMemoryScope, isMemoryType } from './types.js';

export interface AutoMemoryExtractorOptions {
  llmProvider: LLMProvider;
  language: 'zh-CN' | 'en-US';
  characterId?: string;
  sessionId?: string;
}

export class AutoMemoryExtractor {
  private readonly llmProvider: LLMProvider;
  private readonly language: 'zh-CN' | 'en-US';
  private readonly characterId?: string;
  private readonly sessionId?: string;

  constructor(options: AutoMemoryExtractorOptions) {
    this.llmProvider = options.llmProvider;
    this.language = options.language;
    this.characterId = options.characterId;
    this.sessionId = options.sessionId;
  }

  async extract(messages: Message[]): Promise<AddMemoryInput[]> {
    const relevant = messages.filter(message => message.role !== 'system').slice(-8);
    if (relevant.length < 2) return [];

    const transcript = relevant.map((message, index) => `#${index + 1} ${message.role}\n${messageToText(message)}`).join('\n\n');

    try {
      const result = await this.llmProvider.chat({
        messages: [systemMessage(this.buildPrompt()), userMessage(transcript)],
        temperature: 0,
      });
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

  private buildPrompt(): string {
    const typeGuide = [
      'user: stable user role, goals, preferences, background.',
      'project: non-derivable project goals, decisions, deadlines, incidents, rationale.',
      'feedback: user corrections or validated working preferences for how the agent should behave.',
      'reference: where to find external information, dashboards, docs, tickets, communities.',
      'learning: how the user wants explanations, study path, concepts they are learning, anime/custom UI learning preferences.',
      'workflow: recurring commands, review ritual, branch/commit habits, preferred agent mode, character-based workspace habits.',
    ].join('\n');

    if (this.language === 'en-US') {
      return [
        'Extract only durable memories useful in future coding-agent sessions.',
        'Return strict JSON: {"memories":[{"type":"user|project|feedback|reference|learning|workflow","scope":"global|project","content":"...","summary":"...","tags":["..."],"confidence":0.0}]}',
        'Return {"memories":[]} when nothing is worth saving.',
        'Do not save code facts, file structure, git history, temporary task state, secrets, API keys, or anything already obvious from project files.',
        'Memory types:',
        typeGuide,
      ].join('\n');
    }

    return [
      '\u4ece\u4e0b\u9762\u7684\u7f16\u7a0b Agent \u4f1a\u8bdd\u4e2d\u63d0\u53d6\u4ec5\u5bf9\u672a\u6765\u4f1a\u8bdd\u6709\u7528\u7684\u957f\u671f\u8bb0\u5fc6\u3002',
      '\u53ea\u80fd\u8f93\u51fa\u4e25\u683c JSON\uff1a{"memories":[{"type":"user|project|feedback|reference|learning|workflow","scope":"global|project","content":"...","summary":"...","tags":["..."],"confidence":0.0}]}',
      '\u5982\u679c\u6ca1\u6709\u503c\u5f97\u4fdd\u5b58\u7684\u5185\u5bb9\uff0c\u8f93\u51fa {"memories":[]}\u3002',
      '\u4e0d\u8981\u4fdd\u5b58\u4ee3\u7801\u4e8b\u5b9e\u3001\u6587\u4ef6\u7ed3\u6784\u3001git \u5386\u53f2\u3001\u4e34\u65f6\u4efb\u52a1\u72b6\u6001\u3001\u5bc6\u94a5\u3001API Key\uff0c\u4e5f\u4e0d\u8981\u4fdd\u5b58\u9879\u76ee\u6587\u4ef6\u5df2\u7ecf\u660e\u786e\u5199\u660e\u7684\u5185\u5bb9\u3002',
      '\u8bb0\u5fc6\u7c7b\u578b\uff1a',
      typeGuide,
    ].join('\n');
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