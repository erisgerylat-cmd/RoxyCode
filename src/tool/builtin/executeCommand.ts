import type { Tool, ToolProgressEvent } from '../types.js';
import { buildTool } from '../builder/ToolBuilder.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { okBody, optionalNumberArg, stringArg, truncate } from '../utils/args.js';
import { runCommand } from '../utils/process.js';
import { classifyShellRuntime } from '../utils/shellRisk.js';

export const executeCommandTool: Tool = buildTool({
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
  concurrency: 'exclusive',
  concurrencySafe: false,
  destructive: true,
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
      title: ctx.language === 'en-US' ? 'Confirm command execution' : '确认执行命令',
      message: ctx.language === 'en-US' ? 'Shell commands can modify files or system state.' : 'Shell 命令可能修改文件或系统状态。',
      details: [`command: ${stringArg(args, 'command')}`],
      riskLevel: 'high',
    };
  },
  async *stream(args, ctx) {
    const started = Date.now();
    const command = stringArg(args, 'command');
    const timeoutMs = optionalNumberArg(args, 'timeout_ms') ?? 30_000;
    const shellRisk = classifyShellRuntime(command, ctx);
    yield { type: 'progress', progress: { type: 'command_start', command, timeoutMs, shellLevel: shellRisk.safetyLevel } };

    const pendingProgress: ToolProgressEvent[] = [];
    let wake: (() => void) | null = null;
    const pushProgress = (event: ToolProgressEvent) => {
      pendingProgress.push(event);
      wake?.();
      wake = null;
    };
    const outputPromise = runShell(command, ctx, timeoutMs, pushProgress);
    let output: Awaited<ReturnType<typeof runShell>>;

    while (true) {
      while (pendingProgress.length > 0) {
        yield { type: 'progress', progress: pendingProgress.shift()! };
      }

      const race = await Promise.race([
        outputPromise.then(value => ({ type: 'done' as const, value }), error => ({ type: 'error' as const, error })),
        new Promise<{ type: 'progress' }>(resolve => { wake = () => resolve({ type: 'progress' }); }),
      ]);

      if (race.type === 'progress') continue;
      wake = null;
      if (race.type === 'error') throw race.error;
      output = race.value;
      break;
    }

    while (pendingProgress.length > 0) {
      yield { type: 'progress', progress: pendingProgress.shift()! };
    }
    yield {
      type: 'progress',
      progress: {
        type: 'command_complete',
        command,
        exitCode: output.exitCode,
        timedOut: output.timedOut,
        stdoutChars: output.stdout.length,
        stderrChars: output.stderr.length,
      },
    };
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
      output: formatToolResult('execute_command', output.exitCode === 0 && !output.timedOut, body, ctx, { command, exitCode: output.exitCode, timedOut: output.timedOut, shellLevel: shellRisk.safetyLevel }),
      error: output.exitCode === 0 && !output.timedOut ? undefined : `Command failed with exit code ${output.exitCode}`,
      duration: Date.now() - started,
      metadata: { command, exitCode: output.exitCode, timedOut: output.timedOut, shellLevel: shellRisk.safetyLevel, matchedRule: shellRisk.matchedRule, stdoutTruncated: stdout.truncated, stderrTruncated: stderr.truncated },
    };
  },
  getAuditSummary(args, result) {
    return { command: args.command, operation: 'execute', success: result?.success };
  },
});

function runShell(command: string, ctx: Parameters<typeof runCommand>[2], timeoutMs: number, onProgress: (event: ToolProgressEvent) => void) {
  const onOutput = (stream: 'stdout' | 'stderr', text: string) => onProgress({ type: 'output_chunk', command, stream, text });
  if (process.platform === 'win32') {
    return runCommand('powershell.exe', ['-NoProfile', '-Command', command], ctx, { timeoutMs, onOutput });
  }
  return runCommand('sh', ['-lc', command], ctx, { timeoutMs, onOutput });
}
