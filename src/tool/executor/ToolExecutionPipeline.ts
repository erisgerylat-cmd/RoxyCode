import type { ToolCall, ToolResult } from '../../core/types/message.js';
import type { RuntimeContext } from '../../agent/RuntimeContext.js';
import type { ToolExecutionContext } from '../types.js';
import type { ToolExecutor } from './ToolExecutor.js';

/**
 * Compatibility wrapper kept for older imports.
 * The real path is ToolRegistry -> PermissionGuard -> ToolExecutor -> AuditLog.
 */
export class ToolExecutionPipeline {
  constructor(private readonly executor: ToolExecutor) {}

  async execute(toolCall: ToolCall, ctx: RuntimeContext): Promise<ToolResult> {
    return this.executor.execute(toolCall, toToolExecutionContext(ctx));
  }
}

function toToolExecutionContext(ctx: RuntimeContext): ToolExecutionContext {
  return {
    cwd: ctx.cwd,
    sessionId: ctx.sessionId,
    config: ctx.config.snapshot(),
    language: 'zh-CN',
    permissionMode: 'strict',
    explain: true,
  };
}
