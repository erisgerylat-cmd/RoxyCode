/**
 * Agent 系统核心类型定义
 */

import type { Message, ToolCall, ToolResult } from '../core/types/message.js';

/**
 * Agent 事件类型
 */
export type AgentEvent =
  | { type: 'status'; status: StatusType; message: string; elapsed: number; tokens: TokenCount }
  | { type: 'text_chunk'; text: string; tokens: TokenCount }
  | { type: 'tool_start'; tool: string; args: Record<string, any> }
  | { type: 'tool_end'; tool: string; result: ToolResult; duration: number }
  | { type: 'plan_generated'; steps: PlanStep[] }
  | { type: 'step_start'; step: number; total: number; description: string }
  | { type: 'step_end'; step: number; success: boolean }
  | { type: 'question'; question: Question }
  | { type: 'error'; error: Error; recoverable: boolean }
  | { type: 'stats'; stats: ExecutionStats };

export type StatusType =
  | 'thinking'
  | 'analyzing'
  | 'planning'
  | 'executing'
  | 'reading'
  | 'writing'
  | 'running';

export interface TokenCount {
  input: number;
  output: number;
  total: number;
}

export interface PlanStep {
  id: string;
  description: string;
  instruction: string;
  dependencies: string[];
}

export interface Question {
  id: string;
  text: string;
  options: QuestionOption[];
  defaultOption?: string;
}

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface ExecutionStats {
  elapsed: number;
  totalTokens: TokenCount;
  toolCalls: number;
  costUSD?: number;
}

/**
 * Agent 执行结果
 */
export interface AgentResult {
  success: boolean;
  messages: Message[];
  stats: ExecutionStats;
  error?: Error;
}

/**
 * Agent 模式类型
 */
export type AgentMode = 'lite' | 'economic' | 'standard' | 'ultimate';

/**
 * 执行追踪器
 */
export class ExecutionTracker {
  private startTime: number;
  private tokens: TokenCount = { input: 0, output: 0, total: 0 };
  private toolCallCount = 0;
  private llmCallStartTime: number | null = null;
  private toolCallStartTime: number | null = null;

  constructor() {
    this.startTime = Date.now();
  }

  elapsed(): number {
    return Date.now() - this.startTime;
  }

  startLlmCall(): void {
    this.llmCallStartTime = Date.now();
  }

  endLlmCall(usage: { inputTokens: number; outputTokens: number }): void {
    this.tokens.input += usage.inputTokens;
    this.tokens.output += usage.outputTokens;
    this.tokens.total = this.tokens.input + this.tokens.output;
    this.llmCallStartTime = null;
  }

  startToolCall(): void {
    this.toolCallStartTime = Date.now();
    this.toolCallCount++;
  }

  endToolCall(): number {
    if (!this.toolCallStartTime) return 0;
    const duration = Date.now() - this.toolCallStartTime;
    this.toolCallStartTime = null;
    return duration;
  }

  totalTokens(): TokenCount {
    return { ...this.tokens };
  }

  snapshot(): ExecutionStats {
    return {
      elapsed: this.elapsed(),
      totalTokens: this.totalTokens(),
      toolCalls: this.toolCallCount,
    };
  }
}
