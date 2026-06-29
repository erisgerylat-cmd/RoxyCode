/**
 * 会话类型定义
 */

import type { Message } from './message.js';
import type { ExecutionStats } from './event.js';

// ═══════════════════════════════════════════════════════════════
// 会话模式
// ═══════════════════════════════════════════════════════════════

/** 推理模式 */
export type SessionMode = 'auto' | 'lite' | 'economic' | 'standard' | 'ultimate';

// ═══════════════════════════════════════════════════════════════
// 会话元数据
// ═══════════════════════════════════════════════════════════════

/** 会话元数据 */
export interface SessionMeta {
  id: string;
  /** 自动生成的会话标题 */
  title?: string;
  createdAt: number;
  updatedAt: number;
  mode: SessionMode;
  characterId: string;
  /** 累计统计 */
  totalStats: ExecutionStats;
  messageCount: number;
}

// ═══════════════════════════════════════════════════════════════
// 会话
// ═══════════════════════════════════════════════════════════════

/** 会话实例 */
export interface Session {
  meta: SessionMeta;
  messages: Message[];
  workingDirectory: string;
  /** 当前激活的 Skill（如果有） */
  activeSkillId?: string;
  /** 短期记忆（当前会话的工作笔记） */
  workingNotes: string[];
}
