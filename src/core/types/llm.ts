/**
 * LLM Provider 接口与相关类型。
 *
 * [EXTENSION POINT] 用户可以实现 LLMProvider 接口来接入新的 LLM。
 * 国产模型（Qwen/GLM/DeepSeek）均通过 OpenAI Chat Completions 兼容层接入。
 */

import type { Message, ToolCall } from './message.js';
import type { ToolDefinition } from './tool.js';

/** Token 使用量与费用统计。 */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 可选费用，只有配置定价后才会出现。 */
  cost?: number;
}

/** 流式输出的单个 chunk。 */
export type LLMChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'done'; usage: LLMUsage; toolCalls: ToolCall[]; finishReason: string };

export type LLMToolChoice = 'auto' | 'none' | { type: 'function'; name: string };

export interface LLMToolResultPairingRepair {
  originalMessageCount: number;
  repairedMessageCount: number;
  insertedSyntheticResults: number;
  removedOrphanResults: number;
  removedDuplicateToolUses: number;
  removedDuplicateToolResults: number;
}

/** LLM 调用参数。 */
export interface LLMCallOptions {
  messages: Message[];
  tools?: ToolDefinition[];
  toolChoice?: LLMToolChoice;
  onToolResultPairingRepair?: (report: LLMToolResultPairingRepair) => void | Promise<void>;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** 支持取消请求。 */
  signal?: AbortSignal;
}

/**
 * LLM 提供者接口。
 *
 * 实现此接口即可接入新的大模型。
 * 参考 `engine/llm/BaseLLMProvider.ts` 中的 OpenAI-compatible 基类。
 */
export interface LLMProvider {
  /** Provider 标识符，例如 `qwen`、`deepseek`。 */
  readonly id: string;

  /** 展示名称。 */
  readonly name: string;

  /** 支持的最大上下文窗口，单位为 token。 */
  readonly maxContextTokens: number;

  /** 是否支持工具调用（Function Calling / Tool Calling）。 */
  readonly supportsTools: boolean;

  /** 流式对话调用，返回 AsyncIterable chunk 流。 */
  chatStream(options: LLMCallOptions): AsyncIterable<LLMChunk>;

  /** 非流式单次调用，用于 Lite 模式等简单场景。 */
  chat(options: LLMCallOptions): Promise<{ text: string; usage: LLMUsage }>;

  /** 估算 token 数量，用于上下文管理。 */
  countTokens(text: string): Promise<number>;

  /** 检查 API Key 是否有效，通常在启动或配置验证时调用。 */
  validate(): Promise<boolean>;
}

/** LLM Provider 实例化配置。 */
export interface LLMProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  providerId?: string;
  fallbackModels?: string[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}
