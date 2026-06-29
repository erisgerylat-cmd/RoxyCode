/**
 * 提示词优化器 — 核心类
 *
 * 使用 LLM 分析用户输入 → 选择最佳策略 → 生成优化后的提示词。
 * 提供两种模式：
 * 1. 非流式：optimize() — 一次性返回完整结果
 * 2. 流式：optimizeStream() — AsyncGenerator 逐步 yield 事件
 *
 * 与现有架构集成：
 * - LLMProvider: 调用 LLM 进行分析
 * - ContextManager: 确保输出在 token 限制内
 * - AgentEvent: yield prompt_optimize_* 事件
 */

import type { LLMProvider } from '../../core/types/llm.js';
import type { Message } from '../../core/types/message.js';
import { systemMessage, userMessage } from '../../core/types/message.js';
import type {
  PromptStrategyType,
  PromptAnalysis,
  OptimizationResult,
  PromptOptimizerOptions,
  PromptOptimizeEvent,
} from './types.js';
import {
  getStrategy,
  autoSelectStrategy,
  type StrategyContext,
} from './strategies.js';
import {
  ANALYZE_SYSTEM_PROMPT,
  buildAnalyzePrompt,
  REWRITE_SYSTEM_PROMPT,
  buildRewritePrompt,
} from './templates.js';

/** 默认的空分析结果（LLM 不可用时的回退） */
function emptyAnalysis(input: string): PromptAnalysis {
  return {
    goal: input,
    constraints: [],
    expectedFormat: '',
    contextHints: [],
    ambiguityScore: 0.5,
    recommendedStrategy: 'structured',
    missingInfo: [],
  };
}

/**
 * 提示词优化器
 *
 * 用法：
 *   const optimizer = new PromptOptimizer({ llmProvider });
 *   const result = await optimizer.optimize('帮我写一个排序算法', { strategy: 'auto' });
 *   console.log(result.optimized);
 *
 * 流式用法：
 *   for await (const event of optimizer.optimizeStream('...', { strategy: 'auto' })) {
 *     // 处理 optimize_start / analyze_chunk / rewrite_chunk / optimize_done 事件
 *   }
 */
export class PromptOptimizer {
  private llmProvider: LLMProvider;

  constructor(options: { llmProvider: LLMProvider }) {
    this.llmProvider = options.llmProvider;
  }

  /** 更新 LLM Provider */
  setLLMProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
  }

  // ─── 非流式优化 ──────────────────────────────────────────

  /**
   * 非流式优化：一次性返回完整结果
   */
  async optimize(
    userInput: string,
    options: PromptOptimizerOptions = {},
  ): Promise<OptimizationResult> {
    // 1. 分析阶段
    const analysis = await this.analyze(userInput);

    // 2. 选择策略
    const strategyType = this.resolveStrategy(options.strategy, analysis);

    // 3. 执行策略
    const strategyResult = this.executeStrategy(strategyType, {
      original: userInput,
      analysis,
      characterName: options.characterName,
      characterPrompt: options.characterPrompt,
      maxTokens: options.maxTokens,
    });

    // 4. Token 限制裁剪
    let optimized = strategyResult.optimized;
    if (options.maxTokens && options.maxTokens > 0) {
      const tokens = await this.llmProvider.countTokens(optimized);
      if (tokens > options.maxTokens) {
        optimized = await this.trimToTokenLimit(optimized, options.maxTokens);
      }
    }

    // 5. 质量评分
    const qualityScore = this.calculateQuality(analysis, strategyResult.changes.length);

    return {
      original: userInput,
      optimized,
      strategy: strategyType,
      analysis,
      changes: strategyResult.changes,
      estimatedTokens: await this.llmProvider.countTokens(optimized),
      qualityScore,
    };
  }

  // ─── 流式优化（AsyncGenerator） ───────────────────────────

  /**
   * 流式优化：逐步 yield 事件
   *
   * 可集成到 Agent Loop 的事件流中：
   *   for await (const event of optimizer.optimizeStream(input)) { ... }
   */
  async *optimizeStream(
    userInput: string,
    options: PromptOptimizerOptions = {},
  ): AsyncGenerator<PromptOptimizeEvent> {
    try {
      const strategyType = options.strategy ?? 'auto';
      yield { type: 'optimize_start', strategy: strategyType };

      // ── 分析阶段 ──
      yield { type: 'analyze_start' };

      const analysis = await this.analyzeStream(userInput, function* (chunk) {
        yield { type: 'analyze_chunk' as const, text: chunk };
      });

      yield { type: 'analyze_done', analysis };

      // ── 策略选择 ──
      const resolvedStrategy = this.resolveStrategy(strategyType, analysis);
      yield { type: 'rewrite_start', strategy: resolvedStrategy };

      // ── 重写阶段 ──
      const strategyResult = this.executeStrategy(resolvedStrategy, {
        original: userInput,
        analysis,
        characterName: options.characterName,
        characterPrompt: options.characterPrompt,
        maxTokens: options.maxTokens,
      });

      let optimized = strategyResult.optimized;

      // 流式输出优化结果
      // 按句子/段落切块模拟流式
      const chunks = this.splitIntoChunks(optimized);
      for (const chunk of chunks) {
        yield { type: 'rewrite_chunk', text: chunk };
      }

      // Token 限制裁剪
      if (options.maxTokens && options.maxTokens > 0) {
        const tokens = await this.llmProvider.countTokens(optimized);
        if (tokens > options.maxTokens) {
          optimized = await this.trimToTokenLimit(optimized, options.maxTokens);
        }
      }

      yield { type: 'rewrite_done', optimized };

      // ── 完成 ──
      const qualityScore = this.calculateQuality(analysis, strategyResult.changes.length);
      const result: OptimizationResult = {
        original: userInput,
        optimized,
        strategy: resolvedStrategy,
        analysis,
        changes: strategyResult.changes,
        estimatedTokens: await this.llmProvider.countTokens(optimized),
        qualityScore,
      };

      yield { type: 'optimize_done', result };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      yield { type: 'optimize_error', error, recoverable: true };
    }
  }

  // ─── 内部方法 ──────────────────────────────────────────────

  /** LLM 分析用户输入（非流式） */
  private async analyze(userInput: string): Promise<PromptAnalysis> {
    try {
      const messages: Message[] = [
        systemMessage(ANALYZE_SYSTEM_PROMPT),
        userMessage(buildAnalyzePrompt(userInput)),
      ];

      const { text } = await this.llmProvider.chat({
        messages,
        temperature: 0.3,
        maxTokens: 1024,
      });

      return this.parseAnalysisJSON(text);
    } catch {
      // LLM 不可用时回退到空分析
      return emptyAnalysis(userInput);
    }
  }

  /** LLM 分析（流式，内部 yield chunks） */
  private async analyzeStream(
    userInput: string,
    onChunk: (chunk: string) => Generator<PromptOptimizeEvent>,
  ): Promise<PromptAnalysis> {
    try {
      const messages: Message[] = [
        systemMessage(ANALYZE_SYSTEM_PROMPT),
        userMessage(buildAnalyzePrompt(userInput)),
      ];

      let fullText = '';
      for await (const chunk of this.llmProvider.chatStream({
        messages,
        temperature: 0.3,
        maxTokens: 1024,
      })) {
        if (chunk.type === 'text') {
          fullText += chunk.text;
        }
      }

      return this.parseAnalysisJSON(fullText);
    } catch {
      return emptyAnalysis(userInput);
    }
  }

  /** 解析 LLM 返回的 JSON 分析结果 */
  private parseAnalysisJSON(text: string): PromptAnalysis {
    try {
      // 尝试提取 JSON（LLM 可能在 JSON 前后有额外文本）
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return emptyAnalysis('');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        goal: parsed.goal ?? '',
        constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
        expectedFormat: parsed.expectedFormat ?? '',
        contextHints: Array.isArray(parsed.contextHints) ? parsed.contextHints : [],
        ambiguityScore: typeof parsed.ambiguityScore === 'number'
          ? Math.max(0, Math.min(1, parsed.ambiguityScore))
          : 0.5,
        recommendedStrategy: this.validateStrategy(parsed.recommendedStrategy),
        missingInfo: Array.isArray(parsed.missingInfo) ? parsed.missingInfo : [],
      };
    } catch {
      return emptyAnalysis('');
    }
  }

  /** 校验策略类型 */
  private validateStrategy(s: unknown): PromptStrategyType {
    const valid: PromptStrategyType[] = ['structured', 'fewshot', 'cot', 'rolebased', 'auto'];
    if (typeof s === 'string' && valid.includes(s as PromptStrategyType)) {
      return s as PromptStrategyType;
    }
    return 'structured';
  }

  /** 解析最终策略 */
  private resolveStrategy(
    requested: PromptStrategyType | undefined,
    analysis: PromptAnalysis,
  ): PromptStrategyType {
    if (requested && requested !== 'auto') {
      return requested;
    }
    return autoSelectStrategy(analysis);
  }

  /** 执行策略 */
  private executeStrategy(
    type: PromptStrategyType,
    ctx: StrategyContext,
  ): { optimized: string; changes: import('./types.js').OptimizationChange[] } {
    const strategy = getStrategy(type);
    if (!strategy) {
      // 回退到结构化策略
      const fallback = getStrategy('structured')!;
      return fallback.execute(ctx);
    }
    return strategy.execute(ctx);
  }

  /** 将文本裁剪到 token 限制内 */
  private async trimToTokenLimit(text: string, maxTokens: number): Promise<string> {
    const tokens = await this.llmProvider.countTokens(text);
    if (tokens <= maxTokens) return text;

    // 按比例裁剪（简单策略：按字符比例截断）
    const ratio = maxTokens / tokens;
    const trimLen = Math.floor(text.length * ratio * 0.9); // 留 10% 余量
    return text.slice(0, trimLen) + '\n\n[... 内容已截断以适应 token 限制]';
  }

  /** 计算优化质量评分 */
  private calculateQuality(analysis: PromptAnalysis, changeCount: number): number {
    let score = 0.5; // 基础分

    // 变更越多说明优化越充分（但不超过某个上限）
    score += Math.min(changeCount * 0.1, 0.3);

    // 原始模糊度高 + 优化后结构化 → 加分
    if (analysis.ambiguityScore > 0.5) {
      score += 0.1;
    }

    // 识别到约束和格式 → 加分
    if (analysis.constraints.length > 0) score += 0.05;
    if (analysis.expectedFormat) score += 0.05;

    return Math.min(1, score);
  }

  /** 将文本按句子/段落切块（用于模拟流式输出） */
  private splitIntoChunks(text: string): string[] {
    const chunks: string[] = [];
    const lines = text.split('\n');
    let buffer = '';

    for (const line of lines) {
      buffer += line + '\n';
      // 每 2-3 行一个 chunk
      if (buffer.split('\n').length >= 3) {
        chunks.push(buffer);
        buffer = '';
      }
    }

    if (buffer) {
      chunks.push(buffer);
    }

    return chunks;
  }
}
