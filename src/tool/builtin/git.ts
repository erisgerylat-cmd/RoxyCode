import type { Tool } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';
import { okBody, optionalStringArg } from '../utils/args.js';
import { runCommand } from '../utils/process.js';

export const gitTool: Tool = {
  definition: {
    name: 'git',
    description: '\u6267\u884c\u53d7\u9650 Git \u64cd\u4f5c\uff1astatus\u3001diff\u3001log\u3001branch\u3002',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: 'Git \u64cd\u4f5c\u3002', enum: ['status', 'diff', 'log', 'branch'] },
        target: { type: 'string', description: '\u53ef\u9009\u76ee\u6807\uff0c\u4f8b\u5982\u6587\u4ef6\u8def\u5f84\u3001\u5206\u652f\u540d\u6216\u63d0\u4ea4\u8303\u56f4\u3002' },
      },
      required: ['operation'],
    },
  },
  isReadOnly: true,
  riskLevel: 'low',
  concurrency: 'safe',
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
    const output = await runCommand('git', gitArgs, ctx, { timeoutMs: 30_000 });
    const body = okBody('Git \u64cd\u4f5c\u5b8c\u6210', [
      `operation: ${operation}`,
      `command: git ${gitArgs.join(' ')}`,
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
