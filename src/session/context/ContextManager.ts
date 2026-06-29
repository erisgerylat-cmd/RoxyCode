/**
 * 上下文管理器
 *
 * 职责：
 * 1. 跟踪当前会话的 token 使用量
 * 2. 根据配置判断是否需要压缩
 * 3. 按优先级编排压缩策略执行
 *
 * 依赖：
 * - ConfigManager（读取 context.* 配置）
 * - LLMProvider（获取 maxContextTokens、countTokens）
 * - CompressorStrategy[]（注册的压缩策略）
 */

import type { ConfigManager } from '../../core/ConfigManager.js';
import type { LLMProvider } from '../../core/types/llm.js';
import type { Message } from '../../core/types/message.js';
import type {
  CompressorStrategy,
  CompressResult,
} from '../../core/interfaces/compressor.js';

/** 默认最大上下文 token 数（当 Provider 也未指定时使用） */
const DEFAULT_MAX_CONTEXT_TOKENS = 128_000;

/** 上下文状态快照 */
export interface ContextStatus {
  /** 实际生效的最大 token 数 */
  maxContextTokens: number;
  /** 当前已使用 token 数 */
  currentTokens: number;
  /** 使用率 (0~1) */
  usageRatio: number;
  /** 是否启用自动压缩 */
  compressionEnabled: boolean;
  /** 压缩阈值 */
  compressThreshold: number;
  /** 是否已达到压缩阈值 */
  needsCompression: boolean;
  /** 消息数量 */
  messageCount: number;
  /** maxTokens 来源 */
  source: 'user-config' | 'provider-default' | 'global-default';
  /** 已注册的压缩策略名称列表 */
  registeredStrategies: string[];
}

export interface ContextManagerOptions {
  configManager: ConfigManager;
  llmProvider: LLMProvider;
}

/**
 * 上下文管理器
 *
 * 管理消息列表的 token 计数和自动压缩。
 */
export class ContextManager {
  private configManager: ConfigManager;
  private llmProvider: LLMProvider;
  private strategies: CompressorStrategy[] = [];

  constructor(options: ContextManagerOptions) {
    this.configManager = options.configManager;
    this.llmProvider = options.llmProvider;
  }

  /**
   * 注册压缩策略（按注册顺序优先级执行）
   */
  registerStrategy(strategy: CompressorStrategy): void {
    this.strategies.push(strategy);
  }

  /**
   * 获取当前生效的最大上下文 token 数
   *
   * 优先级：用户配置 > Provider 默认值 > 全局常量
   */
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

  /**
   * 计算消息列表的 token 总量
   *
   * 利用 Message.metadata.tokens 缓存，无缓存时使用简单估算。
   */
  async countMessagesTokens(messages: Message[]): Promise<number> {
    let totalTokens = 0;

    for (const msg of messages) {
      if (msg.metadata?.tokens) {
        // 使用缓存的 token 计数
        totalTokens += msg.metadata.tokens.input + msg.metadata.tokens.output;
      } else {
        // 简单估算：字符数 / 3
        const content = typeof msg.content === 'string'
          ? msg.content
          : msg.content.map(c => ('text' in c ? c.text : '')).join('');
        totalTokens += Math.ceil(content.length / 3);
      }
    }

    return totalTokens;
  }

  /**
   * 判断是否需要压缩
   *
   * 逻辑：enableCompression === true
   *    && currentTokens / maxContextTokens >= compressThreshold
   */
  async needsCompression(messages: Message[]): Promise<boolean> {
    const compressionEnabled = this.configManager.get('context.enableCompression') as boolean;
    if (!compressionEnabled) return false;

    const { value: maxTokens } = this.getEffectiveMaxTokens();
    const currentTokens = await this.countMessagesTokens(messages);
    const threshold = this.configManager.get('context.compressThreshold') as number;

    return currentTokens / maxTokens >= threshold;
  }

  /**
   * 执行压缩：遍历 strategies，返回第一个成功的结果
   *
   * targetTokens = maxContextTokens * (compressThreshold - 0.1)
   * 目标不是压到 0%，而是压到阈值以下 10%，避免反复触发
   */
  async compress(messages: Message[]): Promise<CompressResult | null> {
    const { value: maxTokens } = this.getEffectiveMaxTokens();
    const currentTokens = await this.countMessagesTokens(messages);
    const threshold = this.configManager.get('context.compressThreshold') as number;

    // 目标：压到阈值以下 10%
    const targetRatio = Math.max(0.1, threshold - 0.1);
    const targetTokens = Math.floor(maxTokens * targetRatio);

    // 如果已经低于目标，无需压缩
    if (currentTokens <= targetTokens) return null;

    // 按注册顺序尝试压缩策略
    for (const strategy of this.strategies) {
      const result = await strategy.compress({
        messages,
        currentTokens,
        targetTokens,
        maxContextTokens: maxTokens,
      });

      if (result) {
        return result;
      }
    }

    // 所有策略都无法压缩
    return null;
  }

  /**
   * 获取上下文状态快照（供 /context 命令使用）
   */
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

  /**
   * 主入口：Agent Loop 调用
   *
   * 检查并自动压缩，返回（可能压缩后的）消息列表。
   */
  async ensureWithinLimit(messages: Message[]): Promise<Message[]> {
    const compressionEnabled = this.configManager.get('context.enableCompression') as boolean;

    // 压缩未启用，直接返回
    if (!compressionEnabled) return messages;

    // 检查是否需要压缩
    if (!(await this.needsCompression(messages))) return messages;

    // 执行压缩
    const result = await this.compress(messages);
    if (result) {
      return result.messages;
    }

    // 压缩失败但已超限 — 返回原消息，让 LLM Provider 自行处理
    return messages;
  }
}
