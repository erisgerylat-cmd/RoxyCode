/**
 * 消息系统核心类型
 *
 * 定义对话消息、工具调用、工具结果等核心数据结构。
 * 这些是整个架构中最基础的类型，被所有模块共享。
 */

// ═══════════════════════════════════════════════════════════════
// 消息角色
// ═══════════════════════════════════════════════════════════════

export type Role = 'system' | 'user' | 'assistant' | 'tool';

// ═══════════════════════════════════════════════════════════════
// 工具调用
// ═══════════════════════════════════════════════════════════════

/** LLM 发出的工具调用请求 */
export interface ToolCall {
  /** 唯一 ID（LLM 生成） */
  id: string;
  /** 工具名称 */
  name: string;
  /** 参数 */
  arguments: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 工具执行结果
// ═══════════════════════════════════════════════════════════════

/** 工具执行后返回给 LLM 的结果 */
export interface ToolResult {
  /** 是否执行成功 */
  success: boolean;
  /** 返回给 LLM 的文本内容 */
  output: string;
  /** 错误信息（仅失败时） */
  error?: string;
  /** 执行耗时（毫秒） */
  duration: number;
  /** 附加信息（如文件路径、命令输出等） */
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 消息内容块（支持多模态）
// ═══════════════════════════════════════════════════════════════

/** 消息内容块（结构化内容） */
export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolCall: ToolCall }
  | { type: 'tool_result'; toolCallId: string; result: ToolResult };

// ═══════════════════════════════════════════════════════════════
// 消息
// ═══════════════════════════════════════════════════════════════

/** 对话消息 */
export interface Message {
  role: Role;
  /** 简单文本 或 结构化内容块 */
  content: string | MessageContent[];
  /** 创建时间戳 */
  timestamp: number;
  /** 可选元数据 */
  metadata?: {
    tokens?: { input: number; output: number };
    model?: string;
    mode?: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// 辅助构造函数
// ═══════════════════════════════════════════════════════════════

/** 创建用户消息 */
export function userMessage(text: string): Message {
  return { role: 'user', content: text, timestamp: Date.now() };
}

/** 创建助手消息 */
export function assistantMessage(text: string): Message {
  return { role: 'assistant', content: text, timestamp: Date.now() };
}

/** 创建系统消息 */
export function systemMessage(text: string): Message {
  return { role: 'system', content: text, timestamp: Date.now() };
}

/** 创建工具结果消息 */
export function toolResultMessage(toolCall: ToolCall, result: ToolResult): Message {
  return {
    role: 'tool',
    content: [{ type: 'tool_result', toolCallId: toolCall.id, result }],
    timestamp: Date.now(),
  };
}
