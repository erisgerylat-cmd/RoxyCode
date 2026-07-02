import type { Tool } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { emitToolProgress } from '../progress/ToolProgress.js';
import { okBody, optionalStringArg } from '../utils/args.js';
import { runCommand } from '../utils/process.js';

export const gitTool: Tool = {
  definition: {
    name: 'git',
    description: '执行受限 Git 操作：status、diff、log、branch。',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: 'Git 操作。', enum: ['status', 'diff', 'log', 'branch'] },
        target: { type: 'string', description: '可选目标，例如文件路径、分支名或提交范围。' },
      },
      required: ['operation'],
    },
  },
  isReadOnly: true,
  riskLevel: 'low',
  concurrency: 'safe',
  concurrencySafe: true,
  destructive: false,
  interruptBehavior: 'cancel',
  isDestructive() {
    return false;
  },
  isConcurrencySafe(args) {
    const operation = optionalStringArg(args, 'operation') ?? 'status';
    return ['status', 'diff', 'log', 'branch'].includes(operation);
  },
  async execute(args, ctx) {
    const started = Date.now();
    const operation = optionalStringArg(args, 'operation') ?? 'status';
    const target = optionalStringArg(args, 'target');
    const gitArgs = buildGitArgs(operation, target);
    const command = `git ${gitArgs.join(' ')}`;
    emitToolProgress(ctx, { type: 'command_start', command, timeoutMs: 30_000, shellLevel: 'allow' });
    const output = await runCommand('git', gitArgs, ctx, {
      timeoutMs: 30_000,
      onOutput: (stream, text) => emitToolProgress(ctx, { type: 'output_chunk', command, stream, text }),
    });
    emitToolProgress(ctx, { type: 'command_complete', command, exitCode: output.exitCode, timedOut: output.timedOut, stdoutChars: output.stdout.length, stderrChars: output.stderr.length });
    const body = okBody('Git 操作完成', [
      `operation: ${operation}`,
      `command: ${command}`,
      `exit_code: ${output.exitCode}`,
      `stdout:\n${output.stdout || '(empty)'}`,
      `stderr:\n${output.stderr || '(empty)'}`,
    ]);
    return {
      success: output.exitCode === 0,
      output: formatToolResult('git', output.exitCode === 0, body, ctx, { operation, target, exitCode: output.exitCode }),
      error: output.exitCode === 0 ? undefined : `Git failed with exit code ${output.exitCode}`,
      duration: Date.now() - started,
      metadata: { operation, target, exitCode: output.exitCode },
    };
  },
  getAuditSummary(args) {
    return { operation: args.operation, target: args.target, tool: 'git' };
  },
};

function buildGitArgs(operation: string, target?: string): string[] {
  switch (operation) {
    case 'status':
      return ['status', '--short'];
    case 'diff':
      return target ? ['diff', '--', target] : ['diff'];
    case 'log':
      return target ? ['log', '--oneline', '-n', '20', target] : ['log', '--oneline', '-n', '20'];
    case 'branch':
      return ['branch', '--show-current'];
    default:
      throw new Error(`Unsupported git operation: ${operation}`);
  }
}
