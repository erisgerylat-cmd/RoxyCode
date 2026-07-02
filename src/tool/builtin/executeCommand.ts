import type { Tool } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { emitToolProgress } from '../progress/ToolProgress.js';
import { okBody, optionalNumberArg, stringArg, truncate } from '../utils/args.js';
import { runCommand } from '../utils/process.js';
import { classifyShellRuntime } from '../utils/shellRisk.js';

export const executeCommandTool: Tool = {
  definition: {
    name: 'execute_command',
    description: '\u6267\u884c\u672c\u5730 shell \u547d\u4ee4\u3002',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '\u8981\u6267\u884c\u7684\u547d\u4ee4\u3002' },
        timeout_ms: { type: 'number', description: '\u8d85\u65f6\u65f6\u95f4\u3002', default: 30000 },
      },
      required: ['command'],
    },
  },
  isReadOnly: false,
  riskLevel: 'high',
  concurrency: 'exclusive',
  interruptBehavior: 'block',
  isConcurrencySafe(args, ctx) {
    const command = typeof args.command === 'string' ? args.command : '';
    return classifyShellRuntime(command, ctx).concurrencySafe;
  },
  isDestructive(args, ctx) {
    const command = typeof args.command === 'string' ? args.command : '';
    return classifyShellRuntime(command, ctx).safetyLevel !== 'allow';
  },
  getPermissionPrompt(args, ctx) {
    return {
      title: ctx.language === 'en-US' ? 'Confirm command execution' : '\u786e\u8ba4\u6267\u884c\u547d\u4ee4',
      message: ctx.language === 'en-US' ? 'Shell commands can modify files or system state.' : 'Shell \u547d\u4ee4\u53ef\u80fd\u4fee\u6539\u6587\u4ef6\u6216\u7cfb\u7edf\u72b6\u6001\u3002',
      details: [`command: ${stringArg(args, 'command')}`],
      riskLevel: 'high',
    };
  },
  async execute(args, ctx) {
    const started = Date.now();
    const command = stringArg(args, 'command');
    const timeoutMs = optionalNumberArg(args, 'timeout_ms') ?? 30_000;
    const shellRisk = classifyShellRuntime(command, ctx);
    emitToolProgress(ctx, { type: 'command_start', command, timeoutMs, shellLevel: shellRisk.safetyLevel });
    const output = await runShell(command, ctx, timeoutMs);
    emitToolProgress(ctx, {
      type: 'command_complete',
      command,
      exitCode: output.exitCode,
      timedOut: output.timedOut,
      stdoutChars: output.stdout.length,
      stderrChars: output.stderr.length,
    });
    const stdout = truncate(output.stdout, 12_000);
    const stderr = truncate(output.stderr, 4_000);
    const body = okBody('\u547d\u4ee4\u6267\u884c\u5b8c\u6210', [
      `command: ${command}`,
      `exit_code: ${output.exitCode}`,
      `stdout:\n${stdout.text || '(empty)'}`,
      `stderr:\n${stderr.text || '(empty)'}`,
    ]);
    return {
      success: output.exitCode === 0 && !output.timedOut,
      output: formatToolResult('execute_command', output.exitCode === 0 && !output.timedOut, body, ctx, { command, exitCode: output.exitCode, timedOut: output.timedOut, shellLevel: shellRisk.safetyLevel }),
      error: output.exitCode === 0 && !output.timedOut ? undefined : `Command failed with exit code ${output.exitCode}`,
      duration: Date.now() - started,
      metadata: { command, exitCode: output.exitCode, timedOut: output.timedOut, shellLevel: shellRisk.safetyLevel, matchedRule: shellRisk.matchedRule, stdoutTruncated: stdout.truncated, stderrTruncated: stderr.truncated },
    };
  },
  getAuditSummary(args, result) {
    return { command: args.command, operation: 'execute', success: result?.success };
  },
};

function runShell(command: string, ctx: Parameters<typeof runCommand>[2], timeoutMs: number) {
  const onOutput = (stream: 'stdout' | 'stderr', text: string) => emitToolProgress(ctx, { type: 'output_chunk', command, stream, text });
  if (process.platform === 'win32') {
    return runCommand('powershell.exe', ['-NoProfile', '-Command', command], ctx, { timeoutMs, onOutput });
  }
  return runCommand('sh', ['-lc', command], ctx, { timeoutMs, onOutput });
}
