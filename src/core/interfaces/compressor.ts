/**
 * 上下文压缩策略端口 [EXTENSION POINT]
 *
 * 用户可通过实现此接口自定义上下文压缩行为。
 * 四层压缩：Prevention → Truncation → Summary → Retrieval
 */

import type { Message } from '../types/message.js';

/** 压缩策略名称 */
export type CompressorLayer = 'prevention' | 'truncation' | 'summary' | 'retrieval';

/** 压缩请求 */
export interface CompressRequest {
  /** 当前消息列表 */
  messages: Message[];
  /** 当前 token 使用量 */
  currentTokens: number;
  /** 目标 token 数量 */
  targetTokens: number;
  /** 最大上下文窗口 */
  maxContextTokens: number;
}

/** 压缩结果 */
export interface CompressResult {
  /** 压缩后的消息列表 */
  messages: Message[];
  /** 压缩后的 token 数量 */
  compressedTokens: number;
  /** 使用的压缩层 */
  layerUsed: CompressorLayer;
  /** 移除的消息数量 */
  removedCount: number;
  /** 压缩摘要（如有） */
  summary?: string;
}

/** 上下文压缩策略接口 */
export interface CompressorStrategy {
  /** 策略名称 */
  readonly name: string;

  /** 策略所属层 */
  readonly layer: CompressorLayer;

  /**
   * 执行压缩
   * @param request 压缩请求
   * @returns 压缩结果，如果此层无法进一步压缩则返回 null
   */
  compress(request: CompressRequest): Promise<CompressResult | null>;
}
