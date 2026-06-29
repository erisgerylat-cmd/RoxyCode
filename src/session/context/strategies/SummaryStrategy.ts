import type { LLMProvider } from '../../../core/types/llm.js';
import { assistantMessage, systemMessage, userMessage, type Message } from '../../../core/types/message.js';
import type {
  CompressorLayer,
  CompressRequest,
  CompressResult,
  CompressorStrategy,
} from '../../../core/interfaces/compressor.js';
import { messageToText } from '../../store/SessionStore.js';

export interface SummaryStrategyOptions {
  llmProvider: LLMProvider;
  language?: 'zh-CN' | 'en-US';
  preserveRecent?: number;
}

export class SummaryStrategy implements CompressorStrategy {
  readonly name = 'summary';
  readonly layer: CompressorLayer = 'summary';

  private readonly llmProvider: LLMProvider;
  private readonly language: 'zh-CN' | 'en-US';
  private readonly preserveRecent: number;

  constructor(options: SummaryStrategyOptions) {
    this.llmProvider = options.llmProvider;
    this.language = options.language ?? 'zh-CN';
    this.preserveRecent = options.preserveRecent ?? 6;
  }

  async compress(request: CompressRequest): Promise<CompressResult | null> {
    const { messages, currentTokens, targetTokens } = request;
    if (currentTokens <= targetTokens) return null;

    const systemMessages = messages.filter(message => message.role === 'system');
    const nonSystemMessages = messages.filter(message => message.role !== 'system');
    if (nonSystemMessages.length <= this.preserveRecent + 2) return null;

    const olderMessages = nonSystemMessages.slice(0, -this.preserveRecent);
    const recentMessages = nonSystemMessages.slice(-this.preserveRecent);
    const transcript = olderMessages
      .map((message, index) => `#${index + 1} ${message.role}\n${messageToText(message)}`)
      .join('\n\n');

    try {
      const result = await this.llmProvider.chat({
        messages: [
          systemMessage(this.buildSystemPrompt()),
          userMessage(transcript),
        ],
        temperature: 0.2,
      });

      const summary = result.text.trim();
      if (!summary) return null;

      const summaryMessage = assistantMessage(this.renderSummaryMessage(summary));
      summaryMessage.metadata = { mode: 'summary' };

      const compressedMessages = [...systemMessages, summaryMessage, ...recentMessages];
      const compressedTokens = estimateMessagesTokens(compressedMessages);
      return {
        messages: compressedMessages,
        compressedTokens,
        layerUsed: 'summary',
        removedCount: olderMessages.length,
        summary,
      };
    } catch {
      return null;
    }
  }

  private buildSystemPrompt(): string {
    if (this.language === 'en-US') {
      return [
        'Compress the following coding-agent transcript into a compact continuation summary.',
        'Preserve user goals, project facts, files touched, tool results, decisions, unresolved tasks, and learning preferences.',
        'Do not invent facts. Keep commands, paths, symbols, and code identifiers verbatim.',
      ].join('\n');
    }

    return [
      '\u8bf7\u628a\u4e0b\u9762\u7684\u7f16\u7a0b Agent \u4f1a\u8bdd\u538b\u7f29\u6210\u4e00\u4efd\u53ef\u7ee7\u7eed\u5de5\u4f5c\u7684\u4e2d\u6587\u6458\u8981\u3002',
      '\u5fc5\u987b\u4fdd\u7559\uff1a\u7528\u6237\u76ee\u6807\u3001\u9879\u76ee\u4e8b\u5b9e\u3001\u5df2\u67e5\u770b\u6216\u4fee\u6539\u7684\u6587\u4ef6\u3001\u5de5\u5177\u6267\u884c\u7ed3\u679c\u3001\u5173\u952e\u51b3\u7b56\u3001\u672a\u5b8c\u6210\u4e8b\u9879\u3001\u98ce\u9669\u3001\u7528\u6237\u504f\u597d\u548c\u5b66\u4e60\u578b\u8bb0\u5fc6\u3002',
      '\u4e0d\u8981\u7f16\u9020\u4e8b\u5b9e\u3002\u547d\u4ee4\u3001\u8def\u5f84\u3001\u914d\u7f6e\u952e\u3001\u51fd\u6570\u540d\u3001\u7c7b\u540d\u548c\u4ee3\u7801\u6807\u8bc6\u7b26\u5fc5\u987b\u4fdd\u6301\u539f\u6837\u3002',
      '\u6458\u8981\u8981\u9762\u5411\u4e0b\u4e00\u8f6e RoxyCode \u7ee7\u7eed\u6267\u884c\uff0c\u800c\u4e0d\u662f\u9762\u5411\u6700\u7ec8\u7528\u6237\u6c47\u62a5\u3002',
    ].join('\n');
  }

  private renderSummaryMessage(summary: string): string {
    if (this.language === 'en-US') {
      return `Conversation summary for continuation:\n${summary}`;
    }
    return `\u4ee5\u4e0b\u662f\u4e3a\u4e86\u7ee7\u7eed\u5f53\u524d RoxyCode \u4f1a\u8bdd\u800c\u751f\u6210\u7684\u4e0a\u4e0b\u6587\u6458\u8981\uff1a\n${summary}`;
  }
}

function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((total, message) => total + Math.ceil(messageToText(message).length / 3), 0);
}