/**
 * QwenProvider — 通义千问（阿里云 DashScope）
 *
 * 默认 LLM Provider，接入阿里云通义千问系列模型。
 * 2026 年构建了从极简问答到 10M 超长文本再到多模态视觉的最全产品线。
 * API 兼容 OpenAI Chat Completions 格式。
 *
 * 默认模型: qwen-max
 * API 文档: https://help.aliyun.com/document_detail/2712195.html
 */

import { BaseLLMProvider, type RetryConfig } from './BaseLLMProvider.js';
import type { LLMProviderConfig } from '../../core/types/llm.js';

/** 通义千问 2026 模型上下文长度表 */
const QWEN_MODELS: Record<string, { maxContextTokens: number; displayName: string }> = {
  // ── 3.6 代际（2026 旗舰） ──
  'qwen-max': { maxContextTokens: 1_000_000, displayName: 'Qwen 3.6-Max (1M 旗舰深度思考)' },
  'qwen-max-latest': { maxContextTokens: 1_000_000, displayName: 'Qwen 3.6-Max Latest' },
  'qwen3.6-plus': { maxContextTokens: 131_072, displayName: 'Qwen 3.6-Plus (128K 全能多模态)' },
  'qwen3.6-flash': { maxContextTokens: 131_072, displayName: 'Qwen 3.6-Flash (128K 通用生成)' },
  // ── Plus / Turbo 系列 ──
  'qwen-plus': { maxContextTokens: 131_072, displayName: 'Qwen Plus (128K)' },
  'qwen-plus-latest': { maxContextTokens: 131_072, displayName: 'Qwen Plus Latest' },
  'qwen-turbo': { maxContextTokens: 32_768, displayName: 'Qwen Turbo (32K 极速高并发)' },
  'qwen-turbo-latest': { maxContextTokens: 32_768, displayName: 'Qwen Turbo Latest' },
  // ── 超长文本 ──
  'qwen-long': { maxContextTokens: 10_000_000, displayName: 'Qwen Long (10M 超长文档)' },
  // ── 代码专用 ──
  'qwen-coder-plus': { maxContextTokens: 131_072, displayName: 'Qwen Coder Plus' },
  'qwen-coder-turbo': { maxContextTokens: 131_072, displayName: 'Qwen Coder Turbo' },
  // ── 推理专用 ──
  'qwq-32b': { maxContextTokens: 131_072, displayName: 'QwQ 32B (推理)' },
};

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MAX_CONTEXT = 131_072;

export class QwenProvider extends BaseLLMProvider {
  readonly id = 'qwen';
  readonly name = '通义千问';
  readonly supportsTools = true;
  readonly maxContextTokens: number;

  constructor(config: LLMProviderConfig, retry?: Partial<RetryConfig>) {
    super(config, retry);
    const modelInfo = QWEN_MODELS[config.model];
    this.maxContextTokens = modelInfo?.maxContextTokens ?? DEFAULT_MAX_CONTEXT;
  }

  protected override get baseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }
}
