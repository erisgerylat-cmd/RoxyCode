import type { ToolResult } from '../../core/types/message.js';
import type { ToolRegistry } from '../registry/ToolRegistry.js';
import type { PermissionGuard } from '../permission/PermissionGuard.js';
import type { AuditLog } from '../audit/AuditLog.js';
import type { Tool, ToolAuditRecord, ToolExecutionContext, ToolInvocation, ToolPermissionDecision } from '../types.js';
import { backupAffectedFiles, type BackupRecord } from '../security/FileBackup.js';

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly permissionGuard: PermissionGuard,
    private readonly auditLog: AuditLog,
  ) {}

  async execute(invocation: ToolInvocation, ctx: ToolExecutionContext): Promise<ToolResult> {
    const started = Date.now();
    const id = invocation.id ?? `${invocation.name}-${started}`;
    const tool = this.registry.get(invocation.name);

    if (!tool) {
      return {
        success: false,
        output: formatToolResult(invocation.name, false, '工具不存在。', ctx),
        error: `Unknown tool: ${invocation.name}`,
        duration: Date.now() - started,
        metadata: { tool: invocation.name, id },
      };
    }

    let permission: ToolPermissionDecision = { behavior: 'deny', reason: '权限检查尚未完成。' };
    let backups: BackupRecord[] = [];
    let hookContexts: string[] = [];
    let result: ToolResult;

    try {
      validateArguments(tool, invocation.arguments);
      const preflightError = await tool.preflight?.(invocation.arguments, ctx);
      if (preflightError) {
        result = fail(tool.definition.name, preflightError, started, ctx, { phase: 'preflight' });
        permission = { behavior: 'deny', reason: preflightError };
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
        result = fail(tool.definition.name, beforeHook.reason ?? 'Hook blocked tool execution.', started, ctx, {
          phase: 'before_tool_hook',
          hooks: beforeHook.executions,
        });
        permission = { behavior: 'deny', reason: beforeHook.reason ?? 'Hook blocked tool execution.' };
        return result;
      }
      hookContexts = beforeHook?.additionalContexts ?? [];

      permission = await this.permissionGuard.check(tool, invocation.arguments, ctx);
      if (permission.behavior !== 'allow') {
        result = fail(tool.definition.name, permission.reason, started, ctx, {
          phase: 'permission',
          permissionPrompt: permission.prompt,
        });
        return result;
      }

      backups = await backupAffectedFiles(tool, invocation.arguments, ctx);
      result = await tool.execute(invocation.arguments, ctx);
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
        result = fail(tool.definition.name, afterHook.reason ?? 'Hook blocked after tool execution.', started, ctx, {
          phase: 'after_tool_hook',
          hooks: afterHook.executions,
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
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = fail(tool.definition.name, message, started, ctx, { phase: 'execute', backups });
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
          metadata: backups.length > 0 ? { backups } : undefined,
        };
        await this.auditLog.record(record).catch(() => undefined);
      }
    }
  }
}

function validateArguments(tool: Tool, args: Record<string, unknown>): void {
  const schema = tool.definition.parameters;
  for (const key of schema.required ?? []) {
    if (!(key in args)) throw new Error(`Missing required argument: ${key}`);
  }

  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties[key];
    if (!property || value === undefined || value === null) continue;
    if (property.type === 'array') {
      if (!Array.isArray(value)) throw new Error(`Argument ${key} must be array`);
      continue;
    }
    if (property.type === 'object') {
      if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`Argument ${key} must be object`);
      continue;
    }
    if (typeof value !== property.type) throw new Error(`Argument ${key} must be ${property.type}`);
    if (property.enum && typeof value === 'string' && !property.enum.includes(value)) {
      throw new Error(`Argument ${key} must be one of: ${property.enum.join(', ')}`);
    }
  }
}

function fail(toolName: string, message: string, started: number, ctx: ToolExecutionContext, metadata: Record<string, unknown>): ToolResult {
  return {
    success: false,
    output: formatToolResult(toolName, false, message, ctx, metadata),
    error: message,
    duration: Date.now() - started,
    metadata: { tool: toolName, ...metadata },
  };
}

export function formatToolResult(toolName: string, success: boolean, body: string, ctx: ToolExecutionContext, metadata: Record<string, unknown> = {}): string {
  const status = success ? 'success' : 'error';
  const isZh = ctx.language !== 'en-US';
  const explanation = ctx.explain
    ? `\n${isZh ? '初学者解释' : 'Beginner note'}: ${success ? (isZh ? '工具已完成。请优先阅读摘要，再根据路径或命令输出继续判断。' : 'The tool completed. Read the summary first, then inspect paths or command output.') : (isZh ? '工具未执行成功。请先查看错误原因，再决定是否修改参数或请求用户授权。' : 'The tool did not complete. Check the error and decide whether to adjust arguments or request permission.')}`
    : '';
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
