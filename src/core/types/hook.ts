/**
 * Hook 系统类型定义
 *
 * [EXTENSION POINT] 用户可通过实现 HookSystem 接口拦截关键生命周期事件。
 * 支持多实例组合（priority 排序），管道模式。
 */

import type { Message, ToolCall, ToolResult } from './message.js';
import type { LLMUsage } from './llm.js';
import type { Session } from './session.js';

// ═══════════════════════════════════════════════════════════════
// Hook 系统 [EXTENSION POINT]
// ═══════════════════════════════════════════════════════════════

/**
 * Hook 系统接口
 *
 * 所有 hook 方法均为可选。
 * 返回值语义：
 *   - 返回修改后的对象 → 替换原值
 *   - 返回 null → 使用原值（不修改）
 *   - 返回 { blocked: true } → 阻止执行（仅 onBeforeToolCall）
 */
export interface HookSystem {
  // ── LLM 生命周期 ──
  onBeforeLlmCall?(messages: Message[]): Promise<Message[] | null>;
  onAfterLlmCall?(response: string, usage: { input: number; output: number }): Promise<string | null>;

  // ── 工具生命周期 ──
  onBeforeToolCall?(call: ToolCall): Promise<ToolCall | { blocked: true; reason: string } | null>;
  onAfterToolCall?(call: ToolCall, result: ToolResult): Promise<ToolResult | null>;

  // ── 会话生命周期 ──
  onSessionStart?(session: Session): Promise<void>;
  onSessionEnd?(session: Session): Promise<void>;
  onSessionSave?(session: Session): Promise<void>;

  // ── 错误恢复 ──
  onError?(error: Error, context: { phase: string }): Promise<{ recovered: boolean; message?: string } | null>;

  // ── Agent Loop 生命周期 ──
  onLoopStart?(mode: string, task: string): Promise<void>;
  onLoopEnd?(mode: string, success: boolean): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════
// Hook 注册器
// ═══════════════════════════════════════════════════════════════

/** Hook 注册项（用于组合多个 Hook） */
export interface HookRegistration {
  /** Hook 名称（用于调试日志） */
  name: string;
  /** 优先级（数字越小越先执行） */
  priority: number;
  /** Hook 实现 */
  hooks: Partial<HookSystem>;
}
