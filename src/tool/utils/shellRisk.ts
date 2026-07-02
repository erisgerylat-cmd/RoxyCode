import { classifyShellCommand } from '../security/ShellSafety.js';
import type { ToolExecutionContext } from '../types.js';

export interface ShellRuntimeRisk {
  safetyLevel: 'allow' | 'ask' | 'dangerous';
  concurrencySafe: boolean;
  interruptBehavior: 'cancel' | 'block';
  readOnlyLike: boolean;
  matchedRule?: string;
  reasons: string[];
}

export function classifyShellRuntime(command: string, ctx: ToolExecutionContext): ShellRuntimeRisk {
  const shell = classifyShellCommand(command, ctx.config.security.shell.whitelist);
  const readOnlyLike = shell.level === 'allow';
  return {
    safetyLevel: shell.level,
    concurrencySafe: readOnlyLike,
    interruptBehavior: readOnlyLike ? 'cancel' : 'block',
    readOnlyLike,
    matchedRule: shell.matchedRule,
    reasons: shell.reasons,
  };
}