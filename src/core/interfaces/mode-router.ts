/**
 * 推理模式选择策略端口 [EXTENSION POINT]
 *
 * 当用户选择 'auto' 模式时，由 ModeRouter 自动判断应使用哪个推理模式。
 */

import type { SessionMode } from '../types/session.js';

/** 模式路由上下文 */
export interface ModeRouteContext {
  /** 用户输入文本 */
  userInput: string;
  /** 当前消息数量 */
  messageCount: number;
  /** 当前 token 使用量 */
  currentTokens: number;
  /** 是否有工具调用需求（简单启发式） */
  hasToolNeeds?: boolean;
}

/** 推理模式（不含 'auto'） */
export type ResolvedMode = 'lite' | 'economic' | 'standard' | 'ultimate';

/** 模式路由端口接口 */
export interface ModeRouterPort {
  /**
   * 根据上下文自动选择推理模式
   * @param context 路由上下文
   * @returns 选择的推理模式
   */
  resolve(context: ModeRouteContext): ResolvedMode;
}
