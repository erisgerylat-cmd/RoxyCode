import type { ToolResult } from '../../core/types/message.js';
import type { ToolRegistry } from '../registry/ToolRegistry.js';
import type { PermissionGuard } from '../permission/PermissionGuard.js';
import type { AuditLog } from '../audit/AuditLog.js';
import type { Tool, ToolAuditRecord, ToolExecutionContext, ToolInvocation, ToolPermissionDecision } from '../types.js';
import { backupAffectedFiles, type BackupRecord } from '../security/FileBackup.js';
import { processToolResultSize } from '../storage/ToolResultStorage.js';
import {
  HookBlockedError,
  PermissionDeniedError,
  ToolExecutionError,
  ToolInputValidationError,
  classifyToolError,
  formatErrorForDisplay,
  formatValidationIssues,
  getRoxyErrorDescriptor,
  type ValidationIssue,
} from '../../core/errors.js';
import type { TelemetryLogger } from '../../telemetry/index.js';

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly permissionGuard: PermissionGuard,
    private readonly auditLog: AuditLog,
  ) {}

  async execute(invocation: ToolInvocation, ctx: ToolExecutionContext): Promise<ToolResult> {
    const started = Date.now();
    const id = invocation.id ?? `${invocation.name}-${started}`;
    const telemetry = ctx.telemetry;
    await telemetry?.log({
      name: 'tool.execute.start',
      category: 'tool',
      attributes: {
        toolName: invocation.name,
        invocationId: id,
        argumentKeys: Object.keys(invocation.arguments),
      },
    }).catch(() => undefined);

    const tool = this.registry.get(invocation.name);

    if (!tool) {
      const error = new ToolExecutionError(`Unknown tool: ${invocation.name}`, {
        code: 'UNKNOWN_TOOL',
        telemetryMessage: 'Unknown tool',
        recoveryAction: 'fix_input',
        details: { toolName: invocation.name },
      });
      const result = fail(invocation.name, error, started, ctx, { phase: 'registry', id });
      await logToolTelemetry(telemetry, {
        toolName: invocation.name,
        id,
        started,
        success: false,
        phase: 'registry',
        error,
        result,
      });
      return result;
    }

    let permission: ToolPermissionDecision = { behavior: 'deny', reason: '\u6743\u9650\u68c0\u67e5\u5c1a\u672a\u5b8c\u6210\u3002' };
    let backups: BackupRecord[] = [];
    let hookContexts: string[] = [];
    let result: ToolResult;

    try {
      const observableInput = { ...invocation.arguments };
      tool.backfillObservableInput?.(observableInput);
      invocation.arguments = observableInput;
      validateArguments(tool, invocation.arguments, ctx);
      const preflightError = await tool.preflight?.(invocation.arguments, ctx);
      if (preflightError) {
        const error = new ToolExecutionError(preflightError, {
          code: 'TOOL_PREFLIGHT_FAILED',
          telemetryMessage: 'Tool preflight failed',
          recoveryAction: 'fix_input',
        });
        result = fail(tool.definition.name, error, started, ctx, { phase: 'preflight' });
        permission = { behavior: 'deny', reason: preflightError, decisionReason: { type: 'other', reason: 'preflight' } };
        await logToolTelemetry(telemetry, {
          toolName: tool.definition.name,
          id,
          started,
          success: false,
          phase: 'preflight',
          permission,
          error,
          result,
        });
        return result;
      }

      const beforeHook = await ctx.hooks?.run('before_tool', {
        cwd: ctx.cwd,
        sessionId: ctx.sessionId,
        language: ctx.language ?? 'zh-CN',
        characterId: ctx.characterId,
        toolName: tool.definition.name,
        toolArgs: invocation.arguments,
      });
      if (beforeHook?.blocked) {
        const error = new HookBlockedError(beforeHook.reason ?? 'Hook blocked tool execution.', {
          details: { hookEvent: 'before_tool', executions: beforeHook.executions },
        });
        result = fail(tool.definition.name, error, started, ctx, {
          phase: 'before_tool_hook',
          hooks: beforeHook.executions,
          hookUpdatedInput: beforeHook.updatedInput,
        });
        permission = {
          behavior: 'deny',
          reason: beforeHook.reason ?? 'Hook blocked tool execution.',
          decisionReason: { type: 'hook', hookName: 'before_tool', reason: beforeHook.reason ?? 'Hook blocked tool execution.' },
        };
        await logToolTelemetry(telemetry, {
          toolName: tool.definition.name,
          id,
          started,
          success: false,
          phase: 'before_tool_hook',
          permission,
          error,
          result,
        });
        return result;
      }
      hookContexts = beforeHook?.additionalContexts ?? [];
      if (beforeHook?.updatedInput) {
        invocation.arguments = { ...invocation.arguments, ...beforeHook.updatedInput };
        validateArguments(tool, invocation.arguments, ctx);
      }

      permission = await this.permissionGuard.check(tool, invocation.arguments, ctx);
      await telemetry?.log({
        name: 'permission.decision',
        category: 'permission',
        success: permission.behavior === 'allow',
        attributes: {
          toolName: tool.definition.name,
          behavior: permission.behavior,
          reasonType: permission.decisionReason?.type,
          classifierSource: permission.classifier?.source,
          riskLevel: permission.classifier?.riskLevel ?? tool.riskLevel,
          hardDeny: permission.classifier?.hardDeny ?? false,
          requiresSecondConfirmation: permission.classifier?.requiresSecondConfirmation ?? false,
        },
      }).catch(() => undefined);
      if (permission.behavior !== 'allow') {
        const error = new PermissionDeniedError(permission.reason, {
          details: {
            prompt: permission.prompt,
            behavior: permission.behavior,
            decisionReason: permission.decisionReason,
            classifier: permission.classifier,
          },
        });
        result = fail(tool.definition.name, error, started, ctx, {
          phase: 'permission',
          permissionPrompt: permission.prompt,
          permissionBehavior: permission.behavior,
          permissionDecisionReason: permission.decisionReason,
          permissionClassification: permission.classifier,
        });
        await logToolTelemetry(telemetry, {
          toolName: tool.definition.name,
          id,
          started,
          success: false,
          phase: 'permission',
          permission,
          error,
          result,
        });
        return result;
      }

      backups = await backupAffectedFiles(tool, invocation.arguments, ctx);
      result = await tool.execute(invocation.arguments, ctx);
      result = await processToolResultSize(tool, result, ctx, id);
      const afterHook = await ctx.hooks?.run('after_tool', {
        cwd: ctx.cwd,
        sessionId: ctx.sessionId,
        language: ctx.language ?? 'zh-CN',
        characterId: ctx.characterId,
        toolName: tool.definition.name,
        toolArgs: invocation.arguments,
        toolResult: result,
        metadata: { success: result.success },
      });
      if (afterHook?.blocked) {
        const error = new HookBlockedError(afterHook.reason ?? 'Hook blocked after tool execution.', {
          details: { hookEvent: 'after_tool', executions: afterHook.executions },
        });
        result = fail(tool.definition.name, error, started, ctx, {
          phase: 'after_tool_hook',
          hooks: afterHook.executions,
        });
        await logToolTelemetry(telemetry, {
          toolName: tool.definition.name,
          id,
          started,
          success: false,
          phase: 'after_tool_hook',
          permission,
          error,
          result,
        });
        return result;
      }
      hookContexts = [...hookContexts, ...(afterHook?.additionalContexts ?? [])];
      if (hookContexts.length > 0) {
        result.metadata = { ...result.metadata, hookContexts };
        result.output = appendMetadata(result.output, { hookContexts });
      }
      if (backups.length > 0) {
        result.metadata = {
          ...result.metadata,
          backups,
        };
        result.output = appendMetadata(result.output, { backups });
      }
      await logToolTelemetry(telemetry, {
        toolName: tool.definition.name,
        id,
        started,
        success: result.success,
        phase: 'execute',
        permission,
        result,
      });
      return result;
    } catch (err) {
      result = fail(tool.definition.name, err, started, ctx, { phase: 'execute', backups });
      await logToolTelemetry(telemetry, {
        toolName: tool.definition.name,
        id,
        started,
        success: false,
        phase: 'execute',
        permission,
        error: err,
        result,
      });
      return result;
    } finally {
      if (tool) {
        const duration = Date.now() - started;
        const record: ToolAuditRecord = {
          id,
          sessionId: ctx.sessionId,
          toolName: tool.definition.name,
          startedAt: new Date(started).toISOString(),
          duration,
          success: Boolean(result!.success),
          permission,
          cwd: ctx.cwd,
          riskLevel: tool.riskLevel,
          readOnly: tool.isReadOnly,
          input: sanitizeInput(invocation.arguments),
          summary: tool.getAuditSummary?.(invocation.arguments, result!),
          error: result!.error,
          metadata: result!.metadata && Object.keys(result!.metadata).length > 0 ? result!.metadata : undefined,
        };
        await this.auditLog.record(record).catch(() => undefined);
      }
    }
  }
}

async function logToolTelemetry(
  telemetry: TelemetryLogger | undefined,
  input: {
    toolName: string;
    id: string;
    started: number;
    success: boolean;
    phase: string;
    permission?: ToolPermissionDecision;
    error?: unknown;
    result?: ToolResult;
  },
): Promise<void> {
  await telemetry?.log({
    name: input.success ? 'tool.execute.success' : 'tool.execute.error',
    category: 'tool',
    durationMs: Date.now() - input.started,
    success: input.success,
    attributes: {
      toolName: input.toolName,
      invocationId: input.id,
      phase: input.phase,
      permissionBehavior: input.permission?.behavior,
      permissionReasonType: input.permission?.decisionReason?.type,
      classifierSource: input.permission?.classifier?.source,
      riskLevel: input.permission?.classifier?.riskLevel,
      outputChars: input.result?.output.length,
      persisted: Boolean(input.result?.metadata?.persistedToolResult),
      errorClass: input.error ? classifyToolError(input.error) : input.result?.metadata?.errorClass,
      errorCode: input.result?.metadata?.errorCode,
    },
  }).catch(() => undefined);
}

function validateArguments(tool: Tool, args: Record<string, unknown>, ctx: ToolExecutionContext): void {
  const schema = tool.definition.parameters;
  const issues: ValidationIssue[] = [];
  for (const key of schema.required ?? []) {
    if (!(key in args)) issues.push({ path: [key], code: 'missing_required', expected: schema.properties[key]?.type });
  }

  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties[key];
    if (!property) {
      issues.push({ path: [key], code: 'unrecognized_key' });
      continue;
    }
    if (value === undefined || value === null) continue;
    if (property.type === 'array') {
      if (!Array.isArray(value)) issues.push({ path: [key], code: 'invalid_type', expected: 'array', received: describeType(value) });
      continue;
    }
    if (property.type === 'object') {
      if (typeof value !== 'object' || Array.isArray(value)) issues.push({ path: [key], code: 'invalid_type', expected: 'object', received: describeType(value) });
      continue;
    }
    if (typeof value !== property.type) issues.push({ path: [key], code: 'invalid_type', expected: property.type, received: describeType(value) });
    if (property.enum && typeof value === 'string' && !property.enum.includes(value)) {
      issues.push({ path: [key], code: 'invalid_enum', options: property.enum });
    }
  }

  if (issues.length > 0) {
    throw new ToolInputValidationError(
      tool.definition.name,
      issues,
      formatValidationIssues(tool.definition.name, issues, ctx.language ?? 'zh-CN'),
    );
  }
}

function fail(toolName: string, error: unknown, started: number, ctx: ToolExecutionContext, metadata: Record<string, unknown>): ToolResult {
  const descriptor = getRoxyErrorDescriptor(error);
  const message = formatErrorForDisplay(error, ctx.language ?? 'zh-CN');
  const resultMetadata = {
    tool: toolName,
    ...metadata,
    errorClass: descriptor.name,
    errorCategory: descriptor.category,
    errorCode: descriptor.code,
    telemetryMessage: descriptor.telemetryMessage,
    recoverable: descriptor.recoverable,
    recoveryAction: descriptor.recoveryAction,
    errorDetails: descriptor.details,
  };
  return {
    success: false,
    output: formatToolResult(toolName, false, message, ctx, resultMetadata),
    error: descriptor.message,
    duration: Date.now() - started,
    metadata: resultMetadata,
  };
}

export function formatToolResult(toolName: string, success: boolean, body: string, ctx: ToolExecutionContext, metadata: Record<string, unknown> = {}): string {
  const status = success ? 'success' : 'error';
  const isZh = ctx.language !== 'en-US';
  const beginnerLabel = isZh ? '\u521d\u5b66\u8005\u89e3\u91ca' : 'Beginner note';
  const successNote = isZh
    ? '\u5de5\u5177\u5df2\u5b8c\u6210\u3002\u8bf7\u4f18\u5148\u9605\u8bfb\u6458\u8981\uff0c\u518d\u6839\u636e\u8def\u5f84\u6216\u547d\u4ee4\u8f93\u51fa\u7ee7\u7eed\u5224\u65ad\u3002'
    : 'The tool completed. Read the summary first, then inspect paths or command output.';
  const failureNote = isZh
    ? '\u5de5\u5177\u672a\u6267\u884c\u6210\u529f\u3002\u8bf7\u5148\u67e5\u770b\u9519\u8bef\u539f\u56e0\uff0c\u518d\u51b3\u5b9a\u662f\u5426\u4fee\u6539\u53c2\u6570\u6216\u8bf7\u6c42\u7528\u6237\u6388\u6743\u3002'
    : 'The tool did not complete. Check the error and decide whether to adjust arguments or request permission.';
  const explanation = ctx.explain ? `\n${beginnerLabel}: ${success ? successNote : failureNote}` : '';
  const meta = Object.keys(metadata).length > 0 ? `\nmetadata: ${JSON.stringify(metadata)}` : '';
  return `<tool_result name="${toolName}" status="${status}">\n${body}${explanation}${meta}\n</tool_result>`;
}

function appendMetadata(output: string, metadata: Record<string, unknown>): string {
  const insert = `\nmetadata: ${JSON.stringify(metadata)}`;
  return output.replace('\n</tool_result>', `${insert}\n</tool_result>`);
}

function sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.length > 500) {
      out[key] = `[${value.length} chars]`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}