import type { ConfigManager } from '../../core/ConfigManager.js';
import type { LLMProvider } from '../../core/types/llm.js';
import type { Message } from '../../core/types/message.js';
import type {
  CompressorStrategy,
  CompressResult,
} from '../../core/interfaces/compressor.js';
import { estimateMessagesTokens, microcompactMessages } from './MicroCompact.js';

const DEFAULT_MAX_CONTEXT_TOKENS = 128_000;

export interface ContextStatus {
  maxContextTokens: number;
  currentTokens: number;
  usageRatio: number;
  compressionEnabled: boolean;
  compressThreshold: number;
  needsCompression: boolean;
  messageCount: number;
  source: 'user-config' | 'provider-default' | 'global-default';
  registeredStrategies: string[];
}

export interface ContextManagerOptions {
  configManager: ConfigManager;
  llmProvider: LLMProvider;
}

export class ContextManager {
  private configManager: ConfigManager;
  private llmProvider: LLMProvider;
  private strategies: CompressorStrategy[] = [];

  constructor(options: ContextManagerOptions) {
    this.configManager = options.configManager;
    this.llmProvider = options.llmProvider;
  }

  registerStrategy(strategy: CompressorStrategy): void {
    this.strategies.push(strategy);
  }

  getEffectiveMaxTokens(): { value: number; source: ContextStatus['source'] } {
    const configured = this.configManager.get('context.maxTokens') as number;

    if (configured > 0) {
      return { value: configured, source: 'user-config' };
    }

    if (this.llmProvider.maxContextTokens > 0) {
      return { value: this.llmProvider.maxContextTokens, source: 'provider-default' };
    }

    return { value: DEFAULT_MAX_CONTEXT_TOKENS, source: 'global-default' };
  }

  async countMessagesTokens(messages: Message[]): Promise<number> {
    return estimateMessagesTokens(messages);
  }

  async needsCompression(messages: Message[]): Promise<boolean> {
    const compressionEnabled = this.configManager.get('context.enableCompression') as boolean;
    if (!compressionEnabled) return false;

    const { value: maxTokens } = this.getEffectiveMaxTokens();
    const currentTokens = await this.countMessagesTokens(messages);
    const threshold = this.configManager.get('context.compressThreshold') as number;

    return currentTokens / maxTokens >= threshold;
  }

  async compress(messages: Message[]): Promise<CompressResult | null> {
    const { value: maxTokens } = this.getEffectiveMaxTokens();
    const threshold = this.configManager.get('context.compressThreshold') as number;
    const targetRatio = Math.max(0.1, threshold - 0.1);
    const targetTokens = Math.floor(maxTokens * targetRatio);

    const microcompact = microcompactMessages(messages);
    const inputMessages = microcompact.messages;
    const currentTokens = microcompact.tokensAfter;

    if (currentTokens <= targetTokens) {
      if (!microcompact.changed) return null;
      return {
        messages: inputMessages,
        compressedTokens: currentTokens,
        layerUsed: 'prevention',
        removedCount: 0,
        summary: `microcompact shortened ${microcompact.compactedToolResults} old tool result(s) before full compaction.`,
      };
    }

    for (const strategy of this.strategies) {
      const result = await strategy.compress({
        messages: inputMessages,
        currentTokens,
        targetTokens,
        maxContextTokens: maxTokens,
      });

      if (result) return result;
    }

    return null;
  }

  async getStatus(messages: Message[]): Promise<ContextStatus> {
    const compressionEnabled = this.configManager.get('context.enableCompression') as boolean;
    const threshold = this.configManager.get('context.compressThreshold') as number;
    const { value: maxTokens, source } = this.getEffectiveMaxTokens();
    const currentTokens = await this.countMessagesTokens(messages);

    return {
      maxContextTokens: maxTokens,
      currentTokens,
      usageRatio: maxTokens > 0 ? currentTokens / maxTokens : 0,
      compressionEnabled,
      compressThreshold: threshold,
      needsCompression: compressionEnabled && (currentTokens / maxTokens >= threshold),
      messageCount: messages.length,
      source,
      registeredStrategies: this.strategies.map(s => s.name),
    };
  }

  async ensureWithinLimit(messages: Message[]): Promise<Message[]> {
    const compressionEnabled = this.configManager.get('context.enableCompression') as boolean;
    if (!compressionEnabled) return messages;

    const microcompact = microcompactMessages(messages);
    const inputMessages = microcompact.messages;
    if (!(await this.needsCompression(inputMessages))) return inputMessages;

    const result = await this.compress(inputMessages);
    if (result) return result.messages;

    return inputMessages;
  }
}
