/**
 * Agent 系统入口
 * 统一导出 Agent Loop 和相关类型
 */

export { liteLoop } from './loops/LiteLoop.js';
export { economicLoop } from './loops/EconomicLoop.js';
export { autoSelectMode, route } from './ModeRouter.js';
export { createRuntimeContext } from './RuntimeContext.js';
export type { RuntimeContext } from './RuntimeContext.js';
export type {
  AgentEvent,
  AgentResult,
  AgentMode,
  StatusType,
  TokenCount,
  ExecutionStats,
  PlanStep,
  Question,
  QuestionOption,
} from './types.js';
export { ExecutionTracker } from './types.js';
