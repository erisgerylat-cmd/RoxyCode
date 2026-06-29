/**
 * read_file 工具实现
 * 读取文件内容
 */

import { readFile as fsReadFile } from 'fs/promises';
import { resolve } from 'path';
import type { SimpleTool, SimpleToolResult } from '../../adapters/index.js';

export const readFileTool: SimpleTool = {
  name: 'read_file',
  description: '读取文件内容。支持读取文本文件，返回文件内容。',
  riskLevel: 'safe',

  async execute(args: Record<string, any>, ctx: any): Promise<SimpleToolResult> {
    const startTime = Date.now();

    try {
      const { path, encoding = 'utf-8' } = args;

      if (!path || typeof path !== 'string') {
        return {
          success: false,
          data: null,
          error: 'Missing or invalid path parameter',
          duration: Date.now() - startTime,
        };
      }

      // 解析绝对路径
      const absolutePath = resolve(ctx.cwd || process.cwd(), path);

      // 读取文件
      const content = await fsReadFile(absolutePath, encoding);

      return {
        success: true,
        data: {
          path: absolutePath,
          content,
          size: content.length,
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        data: null,
        error: `Failed to read file: ${err.message}`,
        duration: Date.now() - startTime,
      };
    }
  },
};
