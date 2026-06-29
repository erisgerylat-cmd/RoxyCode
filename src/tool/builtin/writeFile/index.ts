/**
 * write_file 工具实现
 * 写入文件内容
 */

import { writeFile as fsWriteFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import type { SimpleTool, SimpleToolResult } from '../../adapters/index.js';

export const writeFileTool: SimpleTool = {
  name: 'write_file',
  description: '写入文件内容。如果文件不存在则创建，如果存在则覆盖。',
  riskLevel: 'high',

  async execute(args: Record<string, any>, ctx: any): Promise<SimpleToolResult> {
    const startTime = Date.now();

    try {
      const { path, content, encoding = 'utf-8' } = args;

      if (!path || typeof path !== 'string') {
        return {
          success: false,
          data: null,
          error: 'Missing or invalid path parameter',
          duration: Date.now() - startTime,
        };
      }

      if (content === undefined || content === null) {
        return {
          success: false,
          data: null,
          error: 'Missing content parameter',
          duration: Date.now() - startTime,
        };
      }

      // 解析绝对路径
      const absolutePath = resolve(ctx.cwd || process.cwd(), path);

      // 确保目录存在
      const dir = dirname(absolutePath);
      await mkdir(dir, { recursive: true });

      // 写入文件
      await fsWriteFile(absolutePath, content, encoding);

      return {
        success: true,
        data: {
          path: absolutePath,
          size: content.length,
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        data: null,
        error: `Failed to write file: ${err.message}`,
        duration: Date.now() - startTime,
      };
    }
  },
};
