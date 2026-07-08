import type { Character } from '../../aesthetic/character/types.js';
import type { RoxyCodeConfig } from '../../core/types/config.js';
import type { LLMProvider, LLMToolResultPairingRepair, LLMUsage } from '../../core/types/llm.js';
import type { Message, ToolCall, ToolResult } from '../../core/types/message.js';
import type { ContextManager } from '../../session/context/ContextManager.js';
import type { HookRunner } from '../../hooks/types.js';
import type { Tool, ToolDefinition, ToolExecutor, ToolPermissionMode, ToolPermissionPrompt, ToolProgressEvent } from '../../tool/index.js';
import type { TelemetryLogger } from '../../telemetry/index.js';
import type { MultiAgentEvent } from '../multi-agent/index.js';
import type { QueryProfileSummary } from '../../runtime/index.js';
import type { TodoStore } from '../../tool/builtin/todoWrite.js';
import type { AgentPhase } from './ToolResultSummarizer.js';
import type { CodeDiagnosticsReport, CodeDiagnosticsRunner } from '../../lsp/index.js';

export type AgentLoopMode = 'lite' | 'economic' | 'standard' | 'ultimate' | 'plan';

export type AgentLoopEvent =
  | MultiAgentEvent
  | { type: 'mode_start'; mode: AgentLoopMode; label: string; description: string }
  | { type: 'agent_phase'; phase: AgentPhase; message: string }
  | { type: 'model_request_start'; phase: 'planning' | 'response' | 'tool_loop' | 'verification'; iteration?: number }
  | { type: 'tool_result_pairing_repaired'; report: LLMToolResultPairingRepair }
  | { type: 'planning'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'assistant_message'; text: string }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'tool_intent'; toolCall: ToolCall; intent: string }
  | { type: 'tool_execution_start'; toolCall: ToolCall }
  | { type: 'tool_progress'; toolCall: ToolCall; progress: ToolProgressEvent }
  | { type: 'tool_result'; toolCall: ToolCall; result: ToolResult }
  | { type: 'tool_result_summary'; toolCall: ToolCall; summary: string; success: boolean; recoverySuggestion?: string }
  | { type: 'diagnostics_result'; report: CodeDiagnosticsReport; summary: string; repairPrompt?: string }
  | { type: 'verification'; text: string }
  | { type: 'context_compacted'; layer: string; beforeTokens: number; afterTokens: number }
  | { type: 'token_budget_continue'; continuationCount: number; pct: number; turnTokens: number; budget: number }
  | { type: 'token_budget_done'; continuationCount: number; pct: number; turnTokens: number; budget: number; diminishingReturns: boolean; durationMs: number }
  | { type: 'agent_start'; name: string; focus: string }
  | { type: 'agent_done'; name: string; text: string; usage: LLMUsage }
  | { type: 'usage'; usage: LLMUsage }
  | { type: 'done'; messages: Message[]; usage: LLMUsage; profile?: QueryProfileSummary }
  | { type: 'error'; error: Error; profile?: QueryProfileSummary };

export interface AgentLoopOptions {
  llmProvider: LLMProvider;
  contextManager: ContextManager;
  toolExecutor: ToolExecutor;
  tools: ToolDefinition[];
  toolRuntimeTools?: Tool[];
  config: RoxyCodeConfig;
  cwd: string;
  sessionId: string;
  character: Character;
  language: 'zh-CN' | 'en-US';
  confirm?: (prompt: ToolPermissionPrompt) => Promise<boolean>;
  confirmSecond?: (prompt: ToolPermissionPrompt) => Promise<boolean>;
  hooks?: HookRunner;
  telemetry?: TelemetryLogger;
  todoStore?: TodoStore;
  runCodeDiagnostics?: CodeDiagnosticsRunner;
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
  toolPermissionMode?: ToolPermissionMode;
}
