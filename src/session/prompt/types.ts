/**
 * 提示词优化系统 — 类型定义
 *
 * 定义优化策略、分析结果、优化结果等核心数据结构。
 * 属于 session/prompt/ 模块。
 */

// ═══════════════════════════════════════════════════════════════
// 优化策略
// ═══════════════════════════════════════════════════════════════

/** 优化策略类型 */
export type PromptStrategyType =
  | 'structured'    // 结构化提示（明确角色/任务/约束/输出格式）
  | 'fewshot'       // Few-shot 示例（附加输入输出示例）
  | 'cot'           // Chain-of-Thought 推理（分步引导）
  | 'rolebased'     // 角色化提示（结合角色人设）
  | 'auto';         // 自动选择最佳策略

/** 优化策略定义 */
export interface PromptStrategy {
  /** 策略类型 */
  type: PromptStrategyType;
  /** 策略名称 */
  name: string;
  /** 策略描述 */
  description: string;
  /** 适用场景标签 */
  tags: string[];
}

/** 所有内置策略 */
export const BUILTIN_STRATEGIES: PromptStrategy[] = [
  {
    type: 'structured',
    name: '结构化提示',
    description: '将模糊请求拆分为角色/任务/约束/输出格式四个维度',
    tags: ['通用', '编码', '分析'],
  },
  {
    type: 'fewshot',
    name: 'Few-shot 示例',
    description: '根据任务类型自动附加相关输入输出示例',
    tags: ['格式化', '转换', '翻译'],
  },
  {
    type: 'cot',
    name: 'CoT 推理链',
    description: '添加分步推理引导，适合复杂逻辑任务',
    tags: ['推理', '数学', '调试'],
  },
  {
    type: 'rolebased',
    name: '角色化提示',
    description: '结合当前角色人设（洛琪希等），增加角色化指令',
    tags: ['对话', '创意', '角色'],
  },
];

// ═══════════════════════════════════════════════════════════════
// 分析结果
// ═══════════════════════════════════════════════════════════════

/** 提示词要素识别结果 */
export interface PromptAnalysis {
  /** 识别出的任务目标 */
  goal: string;
  /** 约束条件列表 */
  constraints: string[];
  /** 期望输出格式 */
  expectedFormat: string;
  /** 上下文依赖（代码片段、文件路径等） */
  contextHints: string[];
  /** 模糊度评分 (0~1, 越高越模糊) */
  ambiguityScore: number;
  /** 推荐的优化策略 */
  recommendedStrategy: PromptStrategyType;
  /** 建议补充的信息 */
  missingInfo: string[];
}

// ═══════════════════════════════════════════════════════════════
// 优化结果
// ═══════════════════════════════════════════════════════════════

/** 优化结果 */
export interface OptimizationResult {
  /** 原始输入 */
  original: string;
  /** 优化后的提示词 */
  optimized: string;
  /** 使用的策略 */
  strategy: PromptStrategyType;
  /** 分析报告 */
  analysis: PromptAnalysis;
  /** 优化变更说明 */
  changes: OptimizationChange[];
  /** 预估 token 数 */
  estimatedTokens: number;
  /** 优化质量评分 (0~1) */
  qualityScore: number;
}

/** 单项优化变更 */
export interface OptimizationChange {
  /** 变更类型 */
  type: 'added' | 'restructured' | 'clarified' | 'removed';
  /** 变更描述 */
  description: string;
  /** 变更内容摘要 */
  content?: string;
}

// ═══════════════════════════════════════════════════════════════
// 优化选项
// ═══════════════════════════════════════════════════════════════

/** 优化选项 */
export interface PromptOptimizerOptions {
  /** 指定策略（默认 auto） */
  strategy?: PromptStrategyType;
  /** 是否保留原始意图的简洁版本 */
  keepConcise?: boolean;
  /** 最大 token 数限制（0 = 不限制） */
  maxTokens?: number;
  /** 是否包含角色人设 */
  includePersona?: boolean;
  /** 当前角色名称（rolebased 策略需要） */
  characterName?: string;
  /** 当前角色 System Prompt */
  characterPrompt?: string;
}

// ═══════════════════════════════════════════════════════════════
// 流式事件
// ═══════════════════════════════════════════════════════════════

/** 优化器流式事件 */
export type PromptOptimizeEvent =
  | { type: 'optimize_start'; strategy: PromptStrategyType }
  | { type: 'analyze_start' }
  | { type: 'analyze_chunk'; text: string }
  | { type: 'analyze_done'; analysis: PromptAnalysis }
  | { type: 'rewrite_start'; strategy: PromptStrategyType }
  | { type: 'rewrite_chunk'; text: string }
  | { type: 'rewrite_done'; optimized: string }
  | { type: 'optimize_done'; result: OptimizationResult }
  | { type: 'optimize_error'; error: Error; recoverable: boolean };
