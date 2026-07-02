export type {
  Tool,
  ToolAuditRecord,
  ToolConcurrency,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocation,
  ToolInterruptBehavior,
  ToolProgressEvent,
  ToolProgressSink,
  ToolParameterProperty,
  ToolParameterSchema,
  PermissionClassification,
  PermissionClassificationSource,
  ToolPermissionDecision,
  ToolPermissionDecisionReason,
  ToolPermissionMode,
  ToolPermissionPrompt,
  ToolRiskLevel,
} from './types.js';
export { ToolRegistry } from './registry/ToolRegistry.js';
export { PermissionGuard } from './permission/PermissionGuard.js';
export { PermissionClassifier } from './permission/PermissionClassifier.js';
export {
  DENIAL_LIMITS,
  createDenialTrackingState,
  recordDenial,
  recordSuccess,
  shouldFallbackToPrompting,
} from './permission/DenialTracking.js';
export type { DenialTrackingState } from './permission/DenialTracking.js';
export { ToolExecutor, formatToolResult } from './executor/ToolExecutor.js';
export { AuditLog } from './audit/AuditLog.js';
export { buildTool, withToolDefaults, DEFAULT_MAX_RESULT_SIZE_CHARS } from './builder/ToolBuilder.js';
export { getBuiltinTools } from './builtin/index.js';
export { processToolResultSize } from './storage/ToolResultStorage.js';
export { describeToolProgress, emitToolProgress } from './progress/ToolProgress.js';
export type { PersistedToolResult } from './storage/ToolResultStorage.js';
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
