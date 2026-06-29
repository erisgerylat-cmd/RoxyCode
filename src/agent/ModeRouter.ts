/**
 * Agent 模式路由器
 * 根据输入和配置选择合适的 Agent Loop
 */

import type { AgentMode } from './types.js';
import type { RuntimeContext } from './RuntimeContext.js';
import { liteLoop } from './loops/LiteLoop.js';
import { economicLoop } from './loops/EconomicLoop.js';

/**
 * 自动选择 Agent 模式
 *
 * @param input - 用户输入
 * @param ctx - 运行时上下文
 * @returns 推荐的模式
 */
export function autoSelectMode(input: string, ctx: RuntimeContext): AgentMode {
  const lower = input.toLowerCase();

  // 检查是否包含代码关键词
  const codeKeywords = ['文件', '代码', '读取', '写入', '修改', '执行', 'file', 'code', 'read', 'write', 'edit', 'execute'];
  const hasCodeKeyword = codeKeywords.some(kw => lower.includes(kw));

  // 检查是否包含复杂任务关键词
  const complexKeywords = ['重构', '优化', '全部', '批量', 'refactor', 'optimize', 'all', 'batch'];
  const hasComplexKeyword = complexKeywords.some(kw => lower.includes(kw));

  // 检查是否包含问答关键词
  const questionKeywords = ['什么', '为什么', '怎么', '如何', '解释', 'what', 'why', 'how', 'explain'];
  const hasQuestionKeyword = questionKeywords.some(kw => lower.includes(kw));

  // 决策逻辑
  if (hasComplexKeyword) {
    return 'standard'; // 复杂任务用 Standard（暂未实现，降级到 economic）
  }

  if (hasCodeKeyword) {
    return 'economic'; // 涉及代码操作用 Economic
  }

  if (hasQuestionKeyword && !hasCodeKeyword) {
    return 'lite'; // 纯问答用 Lite
  }

  // 默认使用 Economic（更安全）
  return 'economic';
}

/**
 * 路由到对应的 Agent Loop
 *
 * @param mode - Agent 模式
 * @param input - 用户输入
 * @param ctx - 运行时上下文
 */
export function route(mode: AgentMode, input: string, ctx: RuntimeContext) {
  switch (mode) {
    case 'lite':
      return liteLoop(input, ctx);

    case 'economic':
      return economicLoop(input, ctx);

    case 'standard':
      // TODO: 实现 StandardLoop
      console.warn('[ModeRouter] Standard mode not implemented, falling back to Economic');
      return economicLoop(input, ctx);

    case 'ultimate':
      // TODO: 实现 UltimateLoop
      console.warn('[ModeRouter] Ultimate mode not implemented, falling back to Economic');
      return economicLoop(input, ctx);

    default:
      return economicLoop(input, ctx);
  }
}
