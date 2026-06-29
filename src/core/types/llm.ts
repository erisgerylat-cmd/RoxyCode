/**
 * LLM Provider 接口与相关类型
 *
 * [EXTENSION POINT] 用户可通过实现 LLMProvider 接口接入新的 LLM。
 * 国产模型（Qwen/GLM/DeepSeek）均兼容 OpenAI Chat Completions API。
 */

import type { Message, ToolCall } from './message.js';
import type { ToolDefinition } from './tool.js';

// ═══════════════════════════════════════════════════════════════
// LLM 使用量统计
// ═══════════════════════════════════════════════════════════════

/** Token 使用量与费用 */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 可选费用（配置了定价才有） */
  cost?: number;
}

// ═══════════════════════════════════════════════════════════════
// LLM 流式 chunk
// ═══════════════════════════════════════════════════════════════

/** 流式输出的单个 chunk */
export type LLMChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'done'; usage: LLMUsage; toolCalls: ToolCall[]; finishReason: string };

// ═══════════════════════════════════════════════════════════════
// LLM 调用参数
// ═══════════════════════════════════════════════════════════════

/** LLM 调用选项 */
export interface LLMCallOptions {
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** 支持取消 */
  signal?: AbortSignal;
}

// ═══════════════════════════════════════════════════════════════
// LLM Provider 接口 [EXTENSION POINT]
// ═══════════════════════════════════════════════════════════════

/**
 * LLM 提供者接口
 *
 * 实现此接口即可接入新的大模型。
 * 参考 engine/llm/BaseLLMProvider.ts 的 OpenAI-compatible 基类。
 */
export interface LLMProvider {
  /** Provider 标识符（如 'qwen', 'deepseek'） */
  readonly id: string;

  /** 显示名称 */
  readonly name: string;

  /** 支持的最大上下文窗口（token 数） */
  readonly maxContextTokens: number;

  /** 是否支持工具调用（Function Calling） */
  readonly supportsTools: boolean;

  /** 流式对话调用 — 返回 AsyncIterable chunk 流 */
  chatStream(options: LLMCallOptions): AsyncIterable<LLMChunk>;

  /** 非流式单次调用（Lite 模式用） */
  chat(options: LLMCallOptions): Promise<{ text: string; usage: LLMUsage }>;

  /** 估算 token 数量（用于上下文管理） */
  countTokens(text: string): Promise<number>;

  /** 检查 API Key 是否有效（启动时调用） */
  validate(): Promise<boolean>;
}

// ═══════════════════════════════════════════════════════════════
// LLM Provider 配置
// ═══════════════════════════════════════════════════════════════

/** LLM Provider 实例化配置 */
export interface LLMProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}
