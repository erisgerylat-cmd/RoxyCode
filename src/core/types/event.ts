/**
 * AgentEvent 统一事件类型
 *
 * 所有 Agent Loop 通过 AsyncGenerator yield 的事件联合类型。
 * UI 层通过消费此事件流进行渲染。
 */

import type { ToolCall, ToolResult } from './message.js';
import type { LLMUsage } from './llm.js';

// ═══════════════════════════════════════════════════════════════
// 状态类型
// ═══════════════════════════════════════════════════════════════

/** Agent 状态枚举 */
export type StatusType =
  | 'thinking'    // LLM 推理中
  | 'analyzing'   // 分析任务
  | 'planning'    // 生成计划
  | 'executing'   // 执行中
  | 'searching'   // 搜索中
  | 'waiting'     // 等待用户
  | 'done'        // 完成
  | 'error';      // 出错

// ═══════════════════════════════════════════════════════════════
// 计划步骤
// ═══════════════════════════════════════════════════════════════

/** 执行计划中的单步 */
export interface PlanStep {
  description: string;
  /** 给 LLM 的具体指令 */
  instruction: string;
  /** 是否为只读步骤 */
  isReadOnly: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 提问
// ═══════════════════════════════════════════════════════════════

/** Agent 主动提问 */
export interface Question {
  text: string;
  options?: Array<{
    label: string;
    value: string;
    recommended?: boolean;
  }>;
  default?: string;
}

// ═══════════════════════════════════════════════════════════════
// 执行统计
// ═══════════════════════════════════════════════════════════════

/** 执行统计信息 */
export interface ExecutionStats {
  totalTokens: { input: number; output: number };
  /** 总耗时（毫秒） */
  totalDuration: number;
  llmCalls: number;
  toolCalls: number;
  toolNames: string[];
  cost?: number;
  steps?: { completed: number; total: number };
}

/** 创建空的执行统计 */
export function emptyStats(): ExecutionStats {
  return {
    totalTokens: { input: 0, output: 0 },
    totalDuration: 0,
    llmCalls: 0,
    toolCalls: 0,
    toolNames: [],
  };
}

// ═══════════════════════════════════════════════════════════════
// Agent 执行结果（AsyncGenerator 的 return 值）
// ═══════════════════════════════════════════════════════════════

/** Agent Loop 执行结果 */
export interface AgentResult {
  success: boolean;
  /** 最终回复文本 */
  finalText?: string;
  stats: ExecutionStats;
  error?: Error;
}

// ═══════════════════════════════════════════════════════════════
// AgentEvent 联合类型 — 所有 yield 的事件
// ═══════════════════════════════════════════════════════════════

/** Agent 事件联合类型 — UI 层消费此事件流 */
export type AgentEvent =
  // ── 状态变更 ──
  | { type: 'status'; status: StatusType; message: string; elapsed: number; tokens: { input: number; output: number } }

  // ── 文本流 ──
  | { type: 'text_chunk'; text: string }
  | { type: 'text_done'; fullText: string }

  // ── 工具调用 ──
  | { type: 'tool_start'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_end'; tool: string; result: ToolResult; duration: number }

  // ── 计划（Standard 模式） ──
  | { type: 'plan_generated'; steps: PlanStep[] }
  | { type: 'step_start'; step: number; total: number; description: string }
  | { type: 'step_end'; step: number; success: boolean }

  // ── 主动提问 ──
  | { type: 'question'; question: Question }

  // ── 多 Agent（Ultimate 模式） ──
  | { type: 'agent_spawn'; agentId: string; task: string }
  | { type: 'agent_done'; agentId: string; success: boolean }

  // ── 错误 ──
  | { type: 'error'; error: Error; recoverable: boolean }

  // ── 提示词优化 ──
  | { type: 'prompt_optimize_start'; strategy: string }
  | { type: 'prompt_optimize_chunk'; text: string; phase: 'analyze' | 'rewrite' }
  | { type: 'prompt_optimize_done'; optimized: string; strategy: string; qualityScore: number }

  // ── 最终统计 ──
  | { type: 'stats'; stats: ExecutionStats };
