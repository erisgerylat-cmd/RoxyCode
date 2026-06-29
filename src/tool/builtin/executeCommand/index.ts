/**
 * execute_command 工具实现
 * 执行 Shell 命令
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { SimpleTool, SimpleToolResult } from '../../adapters/index.js';

const execAsync = promisify(exec);

export const executeCommandTool: SimpleTool = {
  name: 'execute_command',
  description: '执行 Shell 命令并返回输出。支持标准的 shell 命令。',
  riskLevel: 'high',

  async execute(args: Record<string, any>, ctx: any): Promise<SimpleToolResult> {
    const startTime = Date.now();

    try {
      const { command, timeout = 30000 } = args;

      if (!command || typeof command !== 'string') {
        return {
          success: false,
          data: null,
          error: 'Missing or invalid command parameter',
          duration: Date.now() - startTime,
        };
      }

      // 执行命令
      const result = await execAsync(command, {
        cwd: ctx.cwd || process.cwd(),
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      return {
        success: true,
        data: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: 0,
        },
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        data: {
          stdout: error.stdout || '',
          stderr: error.stderr || '',
          exitCode: error.code || 1,
        },
        error: `Command failed: ${error.message}`,
        duration: Date.now() - startTime,
      };
    }
  },
};
