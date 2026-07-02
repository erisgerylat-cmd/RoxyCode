/**
 * OpenAIProvider — OpenAI 及兼容端点
 *
 * 接入 OpenAI 官方 API，或任何兼容 OpenAI Chat Completions 格式的端点。
 * 2026 年 OpenAI 全面转向超高净值的科研、复杂 Agent 和极限推理市场。
 *
 * 适用于：
 * - OpenAI (GPT-5.x 系列, o 系列推理模型)
 * - 自部署的兼容服务（vLLM, Ollama, LocalAI 等）
 * - 其他提供 OpenAI 兼容 API 的厂商
 *
 * API 文档: https://platform.openai.com/docs/api-reference
 */

import { BaseLLMProvider, type RetryConfig } from './BaseLLMProvider.js';
import type { LLMProviderConfig } from '../../core/types/llm.js';

/** OpenAI 2026 模型上下文长度表 */
const OPENAI_MODELS: Record<string, { maxContextTokens: number; displayName: string }> = {
  // ── GPT-5.x 系列（2026 旗舰） ──
  'gpt-5.4-pro': { maxContextTokens: 1_000_000, displayName: 'GPT-5.4 Pro (1M 推理天花板)' },
  'gpt-5.5': { maxContextTokens: 1_000_000, displayName: 'GPT-5.5 (1M 计算机使用)' },
  'gpt-5': { maxContextTokens: 1_000_000, displayName: 'GPT-5 (1M 旗舰标准版)' },
  // ── GPT-4o 系列 ──
  'gpt-4o': { maxContextTokens: 131_072, displayName: 'GPT-4o (128K 多模态基准)' },
  'gpt-4o-mini': { maxContextTokens: 131_072, displayName: 'GPT-4o Mini (128K 轻量)' },
  // ── o 系列推理 ──
  'o1': { maxContextTokens: 200_000, displayName: 'o1 (200K 推理)' },
  'o1-mini': { maxContextTokens: 131_072, displayName: 'o1-mini (128K)' },
  'o1-preview': { maxContextTokens: 131_072, displayName: 'o1-preview (128K)' },
  'o3-mini': { maxContextTokens: 200_000, displayName: 'o3-mini (200K)' },
  // ── 兼容旧版 ──
  'gpt-4-turbo': { maxContextTokens: 131_072, displayName: 'GPT-4 Turbo (128K)' },
  'gpt-3.5-turbo': { maxContextTokens: 16_385, displayName: 'GPT-3.5 Turbo (16K)' },
};

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MAX_CONTEXT = 131_072;

export class OpenAIProvider extends BaseLLMProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';
  readonly supportsTools = true;
  readonly maxContextTokens: number;

  constructor(config: LLMProviderConfig, retry?: Partial<RetryConfig>) {
    super(config, retry);
    const modelInfo = OPENAI_MODELS[config.model];
    this.maxContextTokens = modelInfo?.maxContextTokens ?? DEFAULT_MAX_CONTEXT;
  }

  protected override get baseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }
}
