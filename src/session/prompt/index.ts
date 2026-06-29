/**
 * session/prompt/ — 提示词优化模块 barrel export
 *
 * 提供：
 * - PromptOptimizer — 核心优化器类
 * - 类型定义 — PromptStrategyType, OptimizationResult 等
 * - 内置策略 — Structured/FewShot/CoT/RoleBased
 */

export { PromptOptimizer } from './PromptOptimizer.js';
export type {
  PromptStrategyType,
  PromptStrategy,
  PromptAnalysis,
  OptimizationResult,
  OptimizationChange,
  PromptOptimizerOptions,
  PromptOptimizeEvent,
} from './types.js';
export { BUILTIN_STRATEGIES } from './types.js';
export {
  getStrategy,
  autoSelectStrategy,
  StructuredStrategy,
  FewShotStrategy,
  CoTStrategy,
  RoleBasedStrategy,
} from './strategies.js';
