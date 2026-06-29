import type { Tool } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { okBody, optionalNumberArg, stringArg, truncate } from '../utils/args.js';
import { runCommand } from '../utils/process.js';

export const executeCommandTool: Tool = {
  definition: {
    name: 'execute_command',
    description: '执行本地 shell 命令。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令。' },
        timeout_ms: { type: 'number', description: '超时时间。', default: 30000 },
      },
      required: ['command'],
    },
  },
  isReadOnly: false,
  riskLevel: 'high',
  getPermissionPrompt(args, ctx) {
    return {
      title: ctx.language === 'en-US' ? 'Confirm command execution' : '确认执行命令',
      message: ctx.language === 'en-US' ? 'Shell commands can modify files or system state.' : 'Shell 命令可能修改文件或系统状态。',
      details: [`command: ${stringArg(args, 'command')}`],
      riskLevel: 'high',
    };
  },
  async execute(args, ctx) {
    const started = Date.now();
    const command = stringArg(args, 'command');
    const timeoutMs = optionalNumberArg(args, 'timeout_ms') ?? 30_000;
    const output = await runShell(command, ctx, timeoutMs);
    const stdout = truncate(output.stdout, 12_000);
    const stderr = truncate(output.stderr, 4_000);
    const body = okBody('命令执行完成', [
      `command: ${command}`,
      `exit_code: ${output.exitCode}`,
      `stdout:\n${stdout.text || '(empty)'}`,
      `stderr:\n${stderr.text || '(empty)'}`,
    ]);
    return {
      success: output.exitCode === 0 && !output.timedOut,
      output: formatToolResult('execute_command', output.exitCode === 0 && !output.timedOut, body, ctx, { command, exitCode: output.exitCode, timedOut: output.timedOut }),
      error: output.exitCode === 0 && !output.timedOut ? undefined : `Command failed with exit code ${output.exitCode}`,
      duration: Date.now() - started,
      metadata: { command, exitCode: output.exitCode, timedOut: output.timedOut, stdoutTruncated: stdout.truncated, stderrTruncated: stderr.truncated },
    };
  },
  getAuditSummary(args, result) {
    return { command: args.command, operation: 'execute', success: result?.success };
  },
};

function runShell(command: string, ctx: Parameters<typeof runCommand>[2], timeoutMs: number) {
  if (process.platform === 'win32') {
    return runCommand('powershell.exe', ['-NoProfile', '-Command', command], ctx, { timeoutMs });
  }
  return runCommand('sh', ['-lc', command], ctx, { timeoutMs });
}
