/**
 * core/types barrel export
 *
 * 统一导出所有共享类型，其他模块只需：
 *   import type { Message, ToolCall, LLMProvider, ... } from '../core/types/index.js';
 */

// 消息系统
export type {
  Role,
  ToolCall,
  ToolResult,
  MessageContent,
  Message,
} from './message.js';
export { userMessage, assistantMessage, systemMessage, toolResultMessage } from './message.js';

// LLM 系统
export type {
  LLMUsage,
  LLMChunk,
  LLMCallOptions,
  LLMProvider,
  LLMProviderConfig,
} from './llm.js';

// 工具系统
export type {
  ToolParameterSchema,
  ToolDefinition,
  ToolExecutionContext,
  Tool,
} from './tool.js';

// Skill 系统
export type {
  SkillMode,
  Skill,
  SkillYamlSchema,
} from './skill.js';

// 会话系统
export type {
  SessionMode,
  SessionMeta,
  Session,
} from './session.js';

// Hook 系统
export type {
  HookSystem,
  HookRegistration,
} from './hook.js';

// 事件系统
export type {
  StatusType,
  PlanStep,
  Question,
  ExecutionStats,
  AgentResult,
  AgentEvent,
} from './event.js';
export { emptyStats } from './event.js';

// 配置系统
export type {
  MCPServerConfig,
  RoxyCodeConfig,
} from './config.js';
export { DEFAULT_CONFIG } from './config.js';
