/**
 * 工具系统类型定义
 *
 * 实际实现位于 src/tool/：ToolRegistry -> PermissionGuard -> ToolExecutor -> AuditLog。
 * 这里保留 core/types 的统一导出入口，避免上层模块依赖具体目录结构。
 */

export type {
  Tool,
  ToolAuditRecord,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocation,
  ToolParameterProperty,
  ToolParameterSchema,
  ToolPermissionDecision,
  ToolPermissionMode,
  ToolPermissionPrompt,
  ToolRiskLevel,
} from '../../tool/types.js';
