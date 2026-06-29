/**
 * 提示词优化策略实现
 *
 * 四种内置策略：
 * 1. Structured — 结构化提示（角色/任务/约束/输出格式）
 * 2. FewShot    — Few-shot 示例（附加输入输出样本）
 * 3. CoT        — Chain-of-Thought 推理链（分步引导）
 * 4. RoleBased  — 角色化提示（结合角色人设）
 *
 * 每种策略接收 PromptAnalysis + 原始文本，返回优化后的文本。
 */

import type { PromptAnalysis, PromptStrategyType, OptimizationChange } from './types.js';

/** 策略执行上下文 */
export interface StrategyContext {
  /** 原始用户输入 */
  original: string;
  /** LLM 分析结果 */
  analysis: PromptAnalysis;
  /** 角色名称（rolebased 用） */
  characterName?: string;
  /** 角色 System Prompt（rolebased 用） */
  characterPrompt?: string;
  /** 最大 token 限制 */
  maxTokens?: number;
}

/** 策略执行结果 */
export interface StrategyResult {
  /** 优化后的提示词 */
  optimized: string;
  /** 变更记录 */
  changes: OptimizationChange[];
}

// ═══════════════════════════════════════════════════════════════
// 策略接口
// ═══════════════════════════════════════════════════════════════

/** 优化策略接口 */
export interface OptimizationStrategyExecutor {
  readonly type: PromptStrategyType;
  execute(ctx: StrategyContext): StrategyResult;
}

// ═══════════════════════════════════════════════════════════════
// Structured 策略
// ═══════════════════════════════════════════════════════════════

export class StructuredStrategy implements OptimizationStrategyExecutor {
  readonly type = 'structured' as const;

  execute(ctx: StrategyContext): StrategyResult {
    const { original, analysis } = ctx;
    const changes: OptimizationChange[] = [];
    const parts: string[] = [];

    // 1. 角色设定（如果有）
    if (analysis.contextHints.length > 0) {
      parts.push(`## 背景\n${analysis.contextHints.join('\n')}`);
      changes.push({ type: 'added', description: '添加背景上下文' });
    }

    // 2. 任务目标（明确化）
    const goalText = analysis.goal
      ? analysis.goal
      : original;
    parts.push(`## 任务\n${goalText}`);
    if (analysis.goal && analysis.goal !== original) {
      changes.push({ type: 'clarified', description: '明确化任务目标', content: analysis.goal });
    }

    // 3. 约束条件
    if (analysis.constraints.length > 0) {
      const constraintsText = analysis.constraints.map(c => `- ${c}`).join('\n');
      parts.push(`## 约束\n${constraintsText}`);
      changes.push({ type: 'added', description: `添加 ${analysis.constraints.length} 条约束条件` });
    }

    // 4. 输出格式
    if (analysis.expectedFormat) {
      parts.push(`## 输出格式\n${analysis.expectedFormat}`);
      changes.push({ type: 'added', description: '指定输出格式' });
    }

    // 5. 补充信息提示
    if (analysis.missingInfo.length > 0) {
      const missingText = analysis.missingInfo.map(m => `- ${m}`).join('\n');
      parts.push(`## 补充说明\n请同时考虑以下方面：\n${missingText}`);
      changes.push({ type: 'added', description: `补充 ${analysis.missingInfo.length} 个建议维度` });
    }

    const optimized = parts.join('\n\n');

    return { optimized, changes };
  }
}

// ═══════════════════════════════════════════════════════════════
// Few-shot 策略
// ═══════════════════════════════════════════════════════════════

export class FewShotStrategy implements OptimizationStrategyExecutor {
  readonly type = 'fewshot' as const;

  /** 根据任务类型推断示例模板 */
  private inferExamples(goal: string): string {
    const lowerGoal = goal.toLowerCase();

    if (lowerGoal.includes('翻译') || lowerGoal.includes('translate')) {
      return [
        '### 示例',
        '**输入**: "Hello, how are you?"',
        '**输出**: "你好，最近怎么样？"',
        '',
        '**输入**: "The weather is nice today."',
        '**输出**: "今天天气很好。"',
      ].join('\n');
    }

    if (lowerGoal.includes('重构') || lowerGoal.includes('refactor') || lowerGoal.includes('代码')) {
      return [
        '### 示例',
        '**输入**: "这段代码太长了，帮我优化"',
        '**输出**: (分析代码结构 → 提取重复逻辑 → 给出重构方案 → 展示优化后代码)',
      ].join('\n');
    }

    if (lowerGoal.includes('格式化') || lowerGoal.includes('format') || lowerGoal.includes('转换')) {
      return [
        '### 示例',
        '**输入**: 原始数据/文本',
        '**输出**: 按指定格式转换后的结果',
      ].join('\n');
    }

    // 通用示例
    return [
      '### 示例',
      '**输入**: [你的具体请求]',
      '**输出**: [期望的详细回答]',
    ].join('\n');
  }

  execute(ctx: StrategyContext): StrategyResult {
    const { original, analysis } = ctx;
    const changes: OptimizationChange[] = [];
    const parts: string[] = [];

    // 任务描述
    parts.push(analysis.goal || original);

    // 添加 Few-shot 示例
    const examples = this.inferExamples(analysis.goal || original);
    parts.push(examples);
    changes.push({ type: 'added', description: '添加 Few-shot 输入输出示例' });

    // 约束条件（如果识别到）
    if (analysis.constraints.length > 0) {
      parts.push('### 要求\n' + analysis.constraints.map(c => `- ${c}`).join('\n'));
      changes.push({ type: 'added', description: '添加约束要求' });
    }

    // 输出格式
    if (analysis.expectedFormat) {
      parts.push(`### 输出格式\n${analysis.expectedFormat}`);
      changes.push({ type: 'added', description: '指定输出格式' });
    }

    return { optimized: parts.join('\n\n'), changes };
  }
}

// ═══════════════════════════════════════════════════════════════
// CoT 策略
// ═══════════════════════════════════════════════════════════════

export class CoTStrategy implements OptimizationStrategyExecutor {
  readonly type = 'cot' as const;

  execute(ctx: StrategyContext): StrategyResult {
    const { original, analysis } = ctx;
    const changes: OptimizationChange[] = [];
    const parts: string[] = [];

    // 任务描述
    parts.push(analysis.goal || original);

    // CoT 引导
    const cotGuide = [
      '',
      '请按以下步骤思考并回答：',
      '',
      '1. **理解问题**: 分析请求的核心意图和关键要素',
      '2. **拆解步骤**: 将任务分解为可执行的子步骤',
      '3. **逐步推理**: 对每个步骤进行详细分析和推理',
      '4. **给出结论**: 基于推理给出最终答案或方案',
      '5. **验证检查**: 回顾检查是否有遗漏或错误',
    ].join('\n');

    parts.push(cotGuide);
    changes.push({ type: 'added', description: '添加 Chain-of-Thought 分步推理引导' });

    // 约束条件
    if (analysis.constraints.length > 0) {
      parts.push('### 约束\n' + analysis.constraints.map(c => `- ${c}`).join('\n'));
    }

    // 补充思考方向
    if (analysis.missingInfo.length > 0) {
      parts.push('### 额外考虑\n请同时考虑：' + analysis.missingInfo.map(m => `\n- ${m}`).join(''));
      changes.push({ type: 'added', description: '添加额外思考维度' });
    }

    return { optimized: parts.join('\n\n'), changes };
  }
}

// ═══════════════════════════════════════════════════════════════
// RoleBased 策略
// ═══════════════════════════════════════════════════════════════

export class RoleBasedStrategy implements OptimizationStrategyExecutor {
  readonly type = 'rolebased' as const;

  execute(ctx: StrategyContext): StrategyResult {
    const { original, analysis, characterName, characterPrompt } = ctx;
    const changes: OptimizationChange[] = [];
    const parts: string[] = [];

    // 角色化引导
    if (characterName) {
      parts.push(`你现在是 ${characterName}，请以你的角色风格来完成任务。`);
      changes.push({ type: 'added', description: `添加 ${characterName} 角色化引导` });
    }

    if (characterPrompt) {
      parts.push(`### 角色设定\n${characterPrompt}`);
      changes.push({ type: 'added', description: '注入角色 System Prompt' });
    }

    // 任务
    parts.push(`### 任务\n${analysis.goal || original}`);

    // 约束
    if (analysis.constraints.length > 0) {
      parts.push('### 约束\n' + analysis.constraints.map(c => `- ${c}`).join('\n'));
    }

    // 输出风格（角色化）
    parts.push('### 输出要求\n请以符合角色性格的方式回答，保持角色一致性。');
    changes.push({ type: 'added', description: '添加角色化输出要求' });

    if (analysis.expectedFormat) {
      parts.push(`### 格式\n${analysis.expectedFormat}`);
    }

    return { optimized: parts.join('\n\n'), changes };
  }
}

// ═══════════════════════════════════════════════════════════════
// 策略工厂
// ═══════════════════════════════════════════════════════════════

/** 策略注册表 */
const STRATEGY_REGISTRY: Record<PromptStrategyType, OptimizationStrategyExecutor | null> = {
  structured: new StructuredStrategy(),
  fewshot: new FewShotStrategy(),
  cot: new CoTStrategy(),
  rolebased: new RoleBasedStrategy(),
  auto: null, // auto 由 Optimizer 处理
};

/** 获取策略实例 */
export function getStrategy(type: PromptStrategyType): OptimizationStrategyExecutor | null {
  return STRATEGY_REGISTRY[type] ?? null;
}

/**
 * 自动选择最佳策略
 *
 * 根据分析结果中的 recommendedStrategy 和输入特征决定。
 */
export function autoSelectStrategy(analysis: PromptAnalysis): PromptStrategyType {
  // 优先使用 LLM 推荐的策略
  if (analysis.recommendedStrategy && analysis.recommendedStrategy !== 'auto') {
    return analysis.recommendedStrategy;
  }

  // 根据模糊度判断
  if (analysis.ambiguityScore > 0.7) {
    return 'structured'; // 非常模糊 → 结构化
  }

  // 根据任务类型判断
  const goal = analysis.goal.toLowerCase();
  if (goal.includes('推理') || goal.includes('分析') || goal.includes('debug') || goal.includes('调试')) {
    return 'cot';
  }
  if (goal.includes('翻译') || goal.includes('格式') || goal.includes('转换')) {
    return 'fewshot';
  }

  // 默认结构化
  return 'structured';
}
