/**
 * Skill 系统类型定义
 *
 * [EXTENSION POINT] 用户可通过 YAML 文件定义自定义 Skill。
 * Skill 文件放在 .roxycode/skills/ 目录下即可自动加载。
 */

import type { Message } from './message.js';

// ═══════════════════════════════════════════════════════════════
// Skill 推理模式
// ═══════════════════════════════════════════════════════════════

/** Skill 推荐的推理模式 */
export type SkillMode = 'lite' | 'economic' | 'standard' | 'ultimate';

// ═══════════════════════════════════════════════════════════════
// Skill 定义 [EXTENSION POINT]
// ═══════════════════════════════════════════════════════════════

/** Skill 接口 — 运行时 Skill 实例 */
export interface Skill {
  /** Skill 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 描述（展示给用户） */
  description: string;
  /** 触发命令（如 '/fix-bug'） */
  trigger: string;
  /** System Prompt（注入到对话开头） */
  systemPrompt: string;
  /** 允许使用的工具列表（空数组 = 所有工具） */
  allowedTools: string[];
  /** 推荐推理模式 */
  mode: SkillMode;
  /** 可选：预置的对话消息（如示例） */
  seedMessages?: Message[];
  /** 可选：来源路径（YAML 文件路径或 'builtin'） */
  source?: string;
}

// ═══════════════════════════════════════════════════════════════
// Skill YAML Schema
// ═══════════════════════════════════════════════════════════════

/** Skill YAML 文件的 Schema（.roxycode/skills/*.yml） */
export interface SkillYamlSchema {
  name: string;
  description: string;
  trigger: string;
  systemPrompt: string;
  tools?: string[];
  mode?: SkillMode;
}
