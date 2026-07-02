import type { RoxyCodeConfig } from '../core/types/config.js';
import type { HookRunner } from '../hooks/types.js';
import type { ToolCall, ToolResult } from '../core/types/message.js';
import type { TelemetryLogger } from '../telemetry/index.js';
import type { FileReadState } from './security/FileReadState.js';

export type ToolRiskLevel = 'low' | 'medium' | 'high';
export type ToolConcurrency = 'safe' | 'exclusive';
export type ToolInterruptBehavior = 'cancel' | 'block';
export type ToolPermissionMode = 'strict' | 'auto-approve' | 'read-only';
export type ToolPermissionBehavior = 'allow' | 'deny' | 'ask';
export type ToolPermissionDecisionReason =
  | { type: 'mode'; mode: ToolPermissionMode; reason: string }
  | { type: 'classifier'; classifier: string; reason: string }
  | { type: 'hook'; hookName?: string; reason: string }
  | { type: 'rule'; rule: string; reason: string }
  | { type: 'user'; choice: 'allow' | 'deny'; reason?: string }
  | { type: 'other'; reason: string };

export type PermissionClassificationSource =
  | 'disabled-tool'
  | 'permission-mode'
  | 'path-boundary'
  | 'sensitive-path'
  | 'shell-safety'
  | 'tool-risk'
  | 'fallback';

export interface PermissionClassification {
  behavior: ToolPermissionBehavior;
  source: PermissionClassificationSource;
  riskLevel: ToolRiskLevel;
  reasons: string[];
  details: string[];
  hardDeny?: boolean;
  requiresSecondConfirmation?: boolean;
  matchedRule?: string;
  shellLevel?: 'allow' | 'ask' | 'dangerous';
  affectedPaths?: string[];
}

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
  aliases?: string[];
  searchHint?: string;
  strict?: boolean;
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
  decisionReason?: ToolPermissionDecisionReason;
  updatedInput?: Record<string, unknown>;
  userModified?: boolean;
  acceptFeedback?: string;
  classifier?: PermissionClassification;
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
  telemetry?: TelemetryLogger;
  fileReadState?: FileReadState;
}

export interface Tool {
  readonly definition: ToolDefinition;
  readonly aliases?: string[];
  readonly searchHint?: string;
  readonly maxResultSizeChars?: number;
  readonly strict?: boolean;
  readonly shouldDefer?: boolean;
  readonly concurrency?: ToolConcurrency;
  readonly interruptBehavior?: ToolInterruptBehavior;
  readonly isReadOnly: boolean;
  readonly riskLevel: ToolRiskLevel;
  backfillObservableInput?(input: Record<string, unknown>): void;
  preparePermissionMatcher?(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<(pattern: string) => boolean>;
  isConcurrencySafe?(args: Record<string, unknown>, ctx: ToolExecutionContext): boolean;
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


