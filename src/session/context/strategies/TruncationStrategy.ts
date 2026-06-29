/**
 * 截断策略 [Layer: truncation]
 *
 * 从消息列表头部开始移除旧消息，直到 token 数降到目标以下。
 * 保护规则：
 * - system 消息永不删除
 * - 最近 N 条消息（默认 4）永不删除，保持对话连贯
 * - 工具调用和工具结果作为一组一起删除
 */

import type { Message } from '../../../core/types/message.js';
import type {
  CompressorStrategy,
  CompressorLayer,
  CompressRequest,
  CompressResult,
} from '../../../core/interfaces/compressor.js';

/** 估算消息的 token 数（简单估算：英文 1 token ≈ 4 字符，中文 1 token ≈ 1.5 字符） */
function estimateTokens(message: Message): number {
  const content = typeof message.content === 'string'
    ? message.content
    : message.content.map(c => ('text' in c ? c.text : '')).join('');

  // 简单估算：取字符数 / 3 作为粗略的 token 数
  return Math.ceil(content.length / 3);
}

export interface TruncationStrategyOptions {
  /** 保留的最近消息数（默认 4） */
  preserveRecent?: number;
}

/**
 * 截断策略实现
 *
 * 从消息列表头部删除旧消息，保留最近的对话上下文。
 */
export class TruncationStrategy implements CompressorStrategy {
  readonly name = 'truncation';
  readonly layer: CompressorLayer = 'truncation';

  /** 保留的最近消息数 */
  private preserveRecent: number;

  constructor(options?: TruncationStrategyOptions) {
    this.preserveRecent = options?.preserveRecent ?? 4;
  }

  async compress(request: CompressRequest): Promise<CompressResult | null> {
    const { messages, currentTokens, targetTokens } = request;

    // 已经低于目标，无需压缩
    if (currentTokens <= targetTokens) return null;

    // 分离 system 消息和非 system 消息
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    // 保护最近 N 条
    if (nonSystemMessages.length <= this.preserveRecent) {
      // 消息太少，无法压缩
      return null;
    }

    const protectedMessages = nonSystemMessages.slice(-this.preserveRecent);
    const removableMessages = nonSystemMessages.slice(0, -this.preserveRecent);

    // 从旧到新逐条移除，直到达标
    let removedCount = 0;
    let runningTokens = currentTokens;
    const kept: Message[] = [];

    for (const msg of removableMessages) {
      if (runningTokens <= targetTokens) {
        kept.push(msg);
      } else {
        // 估算这条消息的 token 数
        const msgTokens = msg.metadata?.tokens
          ? msg.metadata.tokens.input + msg.metadata.tokens.output
          : estimateTokens(msg);
        runningTokens -= msgTokens;
        removedCount++;
      }
    }

    if (removedCount === 0) return null;

    return {
      messages: [...systemMessages, ...kept, ...protectedMessages],
      compressedTokens: Math.max(0, runningTokens),
      layerUsed: 'truncation',
      removedCount,
    };
  }
}
