/**
 * DeepSeekProvider — 深度求索
 *
 * 接入 DeepSeek 系列模型（V4 代际 + R 系列推理双线矩阵）。
 * 以断层领先的低价和强悍的代码能力横扫企业级 API 市场。
 * API 兼容 OpenAI Chat Completions 格式。
 *
 * 默认模型: deepseek-chat (DeepSeek V3)
 * API 文档: https://platform.deepseek.com/api-docs
 */

import { BaseLLMProvider, type RetryConfig } from './BaseLLMProvider.js';
import type { LLMProviderConfig } from '../../core/types/llm.js';

/** DeepSeek 2026 模型上下文长度表 */
const DEEPSEEK_MODELS: Record<string, { maxContextTokens: number; displayName: string }> = {
  // ── V4 代际（2026 旗舰） ──
  'deepseek-v4-pro': { maxContextTokens: 1_000_000, displayName: 'DeepSeek V4-Pro (1M)' },
  'deepseek-v4-flash': { maxContextTokens: 1_000_000, displayName: 'DeepSeek V4-Flash (1M)' },
  // ── R 系列推理 ──
  'deepseek-r2': { maxContextTokens: 131_072, displayName: 'DeepSeek R2 (128K)' },
  'deepseek-r1': { maxContextTokens: 131_072, displayName: 'DeepSeek R1 (128K)' },
  // ── V3 代际（稳健商用） ──
  'deepseek-chat': { maxContextTokens: 131_072, displayName: 'DeepSeek V3 (128K)' },
  'deepseek-v3.1': { maxContextTokens: 131_072, displayName: 'DeepSeek V3.1 (128K)' },
  // ── Coder 系列 ──
  'deepseek-coder': { maxContextTokens: 131_072, displayName: 'DeepSeek Coder V2' },
};

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MAX_CONTEXT = 131_072;

export class DeepSeekProvider extends BaseLLMProvider {
  readonly id = 'deepseek';
  readonly name = 'DeepSeek';
  readonly supportsTools = true;
  readonly maxContextTokens: number;

  constructor(config: LLMProviderConfig, retry?: Partial<RetryConfig>) {
    super(config, retry);
    const modelInfo = DEEPSEEK_MODELS[config.model];
    this.maxContextTokens = modelInfo?.maxContextTokens ?? DEFAULT_MAX_CONTEXT;
  }

  protected override get baseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }
}
