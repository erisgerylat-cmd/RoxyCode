import type { RoxyCodeConfig } from '../core/types/config.js';
import type { HookRunner } from '../hooks/types.js';
import type { ToolCall, ToolResult } from '../core/types/message.js';

export type ToolRiskLevel = 'low' | 'medium' | 'high';
export type ToolPermissionMode = 'strict' | 'auto-approve' | 'read-only';
export type ToolPermissionBehavior = 'allow' | 'deny' | 'ask';

export interface ToolParameterProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  default?: unknown;
  items?: ToolParameterProperty;
}

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export interface ToolPermissionPrompt {
  title: string;
  message: string;
  details: string[];
  riskLevel: ToolRiskLevel;
  requiresSecondConfirmation?: boolean;
}

export interface ToolPermissionDecision {
  behavior: ToolPermissionBehavior;
  reason: string;
  prompt?: ToolPermissionPrompt;
}

export interface ToolExecutionContext {
  cwd: string;
  sessionId: string;
  config: RoxyCodeConfig;
  language?: 'zh-CN' | 'en-US';
  permissionMode?: ToolPermissionMode;
  explain?: boolean;
  signal?: AbortSignal;
  env?: Record<string, string>;
  confirm?: (prompt: ToolPermissionPrompt) => Promise<boolean>;
  confirmSecond?: (prompt: ToolPermissionPrompt) => Promise<boolean>;
  characterId?: RoxyCodeConfig['character']['current'];
  hooks?: HookRunner;
}

export interface Tool {
  readonly definition: ToolDefinition;
  readonly isReadOnly: boolean;
  readonly riskLevel: ToolRiskLevel;
  execute(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>;
  preflight?(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string | null>;
  getAffectedPaths?(args: Record<string, unknown>, ctx: ToolExecutionContext): string[];
  getPermissionPrompt?(args: Record<string, unknown>, ctx: ToolExecutionContext): ToolPermissionPrompt;
  getAuditSummary?(args: Record<string, unknown>, result?: ToolResult): Record<string, unknown>;
}

export interface ToolInvocation extends Omit<ToolCall, 'id'> {
  id?: string;
}

export interface ToolAuditRecord {
  id: string;
  sessionId: string;
  toolName: string;
  startedAt: string;
  duration: number;
  success: boolean;
  permission: ToolPermissionDecision;
  cwd: string;
  riskLevel: ToolRiskLevel;
  readOnly: boolean;
  input: Record<string, unknown>;
  summary?: Record<string, unknown>;
  error?: string;
  metadata?: Record<string, unknown>;
}
