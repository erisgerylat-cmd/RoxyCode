/**
 * GLMProvider — 智谱 GLM
 *
 * 接入智谱 AI 的 GLM 系列模型。
 * 2026 策略：Flash 免费抢入口，GLM-5/5.1 主打长程 Agent 与国产算力适配。
 * API 兼容 OpenAI Chat Completions 格式。
 *
 * 默认模型: glm-5
 * API 文档: https://open.bigmodel.cn/dev/api
 */

import { BaseLLMProvider } from './BaseLLMProvider.js';
import type { LLMProviderConfig } from '../../core/types/llm.js';

/** 智谱 GLM 2026 模型上下文长度表 */
const GLM_MODELS: Record<string, { maxContextTokens: number; displayName: string }> = {
  // ── GLM-5 系列（2026 旗舰） ──
  'glm-5.1': { maxContextTokens: 200_000, displayName: 'GLM-5.1 (200K+ 长程Agent)' },
  'glm-5': { maxContextTokens: 131_072, displayName: 'GLM-5 (128K 企业旗舰)' },
  // ── GLM-4 系列（稳健中坚） ──
  'glm-4-plus': { maxContextTokens: 131_072, displayName: 'GLM-4-Plus (128K 工具调用)' },
  'glm-4-air': { maxContextTokens: 131_072, displayName: 'GLM-4-Air (128K 性价比)' },
  'glm-4-flash': { maxContextTokens: 131_072, displayName: 'GLM-4-Flash (128K 免费)' },
  'glm-4-long': { maxContextTokens: 1_000_000, displayName: 'GLM-4-Long (1M 超长)' },
  // ── 多模态 ──
  'glm-4v': { maxContextTokens: 8_000, displayName: 'GLM-4V (8K 视觉)' },
  'glm-4v-plus': { maxContextTokens: 8_000, displayName: 'GLM-4V-Plus (8K 视觉)' },
  // ── 代码 ──
  'codegeex-4': { maxContextTokens: 131_072, displayName: 'CodeGeeX-4' },
};

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MAX_CONTEXT = 131_072;

export class GLMProvider extends BaseLLMProvider {
  readonly id = 'glm';
  readonly name = '智谱 GLM';
  readonly supportsTools = true;
  readonly maxContextTokens: number;

  constructor(config: LLMProviderConfig) {
    super(config);
    const modelInfo = GLM_MODELS[config.model];
    this.maxContextTokens = modelInfo?.maxContextTokens ?? DEFAULT_MAX_CONTEXT;
  }

  protected override get baseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }
}
