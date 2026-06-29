import type { Character } from '../../aesthetic/character/types.js';
import type { RoxyCodeConfig } from '../../core/types/config.js';
import type { LLMProvider, LLMUsage } from '../../core/types/llm.js';
import type { Message, ToolCall, ToolResult } from '../../core/types/message.js';
import type { ContextManager } from '../../session/context/ContextManager.js';
import type { HookRunner } from '../../hooks/types.js';
import type { ToolDefinition, ToolExecutor, ToolPermissionPrompt } from '../../tool/index.js';
import type { MultiAgentEvent } from '../multi-agent/index.js';

export type AgentLoopMode = 'lite' | 'economic' | 'standard' | 'ultimate';

export type AgentLoopEvent =
  | MultiAgentEvent
  | { type: 'mode_start'; mode: AgentLoopMode; label: string; description: string }
  | { type: 'planning'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'assistant_message'; text: string }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'tool_result'; toolCall: ToolCall; result: ToolResult }
  | { type: 'verification'; text: string }
  | { type: 'agent_start'; name: string; focus: string }
  | { type: 'agent_done'; name: string; text: string; usage: LLMUsage }
  | { type: 'usage'; usage: LLMUsage }
  | { type: 'done'; messages: Message[]; usage: LLMUsage }
  | { type: 'error'; error: Error };

export interface AgentLoopOptions {
  llmProvider: LLMProvider;
  contextManager: ContextManager;
  toolExecutor: ToolExecutor;
  tools: ToolDefinition[];
  config: RoxyCodeConfig;
  cwd: string;
  sessionId: string;
  character: Character;
  language: 'zh-CN' | 'en-US';
  confirm?: (prompt: ToolPermissionPrompt) => Promise<boolean>;
  confirmSecond?: (prompt: ToolPermissionPrompt) => Promise<boolean>;
  hooks?: HookRunner;
  signal?: AbortSignal;
}

export interface AgentRunInput {
  userInput: string;
  history: Message[];
  mode: AgentLoopMode;
}

export interface AgentModeSpec {
  mode: AgentLoopMode;
  label: string;
  description: string;
  maxIterations: number;
  allowTools: boolean;
  requiresPlan: boolean;
  requiresVerification: boolean;
  parallelAgents: number;
}
