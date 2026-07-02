/**
 * LLM Provider 鎺ュ彛涓庣浉鍏崇被鍨?
 *
 * [EXTENSION POINT] 鐢ㄦ埛鍙€氳繃瀹炵幇 LLMProvider 鎺ュ彛鎺ュ叆鏂扮殑 LLM銆?
 * 鍥戒骇妯″瀷锛圦wen/GLM/DeepSeek锛夊潎鍏煎 OpenAI Chat Completions API銆?
 */

import type { Message, ToolCall } from './message.js';
import type { ToolDefinition } from './tool.js';

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// LLM 浣跨敤閲忕粺璁?
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?

/** Token 浣跨敤閲忎笌璐圭敤 */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 鍙€夎垂鐢紙閰嶇疆浜嗗畾浠锋墠鏈夛級 */
  cost?: number;
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// LLM 娴佸紡 chunk
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?

/** 娴佸紡杈撳嚭鐨勫崟涓?chunk */
export type LLMChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'done'; usage: LLMUsage; toolCalls: ToolCall[]; finishReason: string };

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// LLM 璋冪敤鍙傛暟
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?

export type LLMToolChoice = 'auto' | 'none' | { type: 'function'; name: string };

/** LLM 璋冪敤閫夐」 */
export interface LLMCallOptions {
  messages: Message[];
  tools?: ToolDefinition[];
  toolChoice?: LLMToolChoice;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** 鏀寔鍙栨秷 */
  signal?: AbortSignal;
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// LLM Provider 鎺ュ彛 [EXTENSION POINT]
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?

/**
 * LLM 鎻愪緵鑰呮帴鍙?
 *
 * 瀹炵幇姝ゆ帴鍙ｅ嵆鍙帴鍏ユ柊鐨勫ぇ妯″瀷銆?
 * 鍙傝€?engine/llm/BaseLLMProvider.ts 鐨?OpenAI-compatible 鍩虹被銆?
 */
export interface LLMProvider {
  /** Provider 鏍囪瘑绗︼紙濡?'qwen', 'deepseek'锛?*/
  readonly id: string;

  /** 鏄剧ず鍚嶇О */
  readonly name: string;

  /** 鏀寔鐨勬渶澶т笂涓嬫枃绐楀彛锛坱oken 鏁帮級 */
  readonly maxContextTokens: number;

  /** 鏄惁鏀寔宸ュ叿璋冪敤锛團unction Calling锛?*/
  readonly supportsTools: boolean;

  /** 娴佸紡瀵硅瘽璋冪敤 鈥?杩斿洖 AsyncIterable chunk 娴?*/
  chatStream(options: LLMCallOptions): AsyncIterable<LLMChunk>;

  /** 闈炴祦寮忓崟娆¤皟鐢紙Lite 妯″紡鐢級 */
  chat(options: LLMCallOptions): Promise<{ text: string; usage: LLMUsage }>;

  /** 浼扮畻 token 鏁伴噺锛堢敤浜庝笂涓嬫枃绠＄悊锛?*/
  countTokens(text: string): Promise<number>;

  /** 妫€鏌?API Key 鏄惁鏈夋晥锛堝惎鍔ㄦ椂璋冪敤锛?*/
  validate(): Promise<boolean>;
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// LLM Provider 閰嶇疆
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?

/** LLM Provider 瀹炰緥鍖栭厤缃?*/
export interface LLMProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  fallbackModels?: string[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

