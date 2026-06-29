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
} from './types.js';
export { ToolRegistry } from './registry/ToolRegistry.js';
export { PermissionGuard } from './permission/PermissionGuard.js';
export { ToolExecutor, formatToolResult } from './executor/ToolExecutor.js';
export { AuditLog } from './audit/AuditLog.js';
export { getBuiltinTools } from './builtin/index.js';
export {
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  grepSearchTool,
  executeCommandTool,
  gitTool,
} from './builtin/index.js';

import { AuditLog } from './audit/AuditLog.js';
import { getBuiltinTools } from './builtin/index.js';
import { ToolExecutor } from './executor/ToolExecutor.js';
import { PermissionGuard } from './permission/PermissionGuard.js';
import { ToolRegistry } from './registry/ToolRegistry.js';

export function createDefaultToolExecutor(cwd: string = process.cwd()): ToolExecutor {
  const registry = new ToolRegistry();
  registry.registerMany(getBuiltinTools());
  return new ToolExecutor(registry, new PermissionGuard(), new AuditLog(cwd));
}

export function createDefaultToolRuntime(cwd: string = process.cwd()): {
  registry: ToolRegistry;
  executor: ToolExecutor;
} {
  const registry = new ToolRegistry();
  registry.registerMany(getBuiltinTools());
  return {
    registry,
    executor: new ToolExecutor(registry, new PermissionGuard(), new AuditLog(cwd)),
  };
}
