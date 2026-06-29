/**
 * list_directory 工具实现
 * 列出目录内容
 */

import { readdir, stat } from 'fs/promises';
import { resolve, join } from 'path';
import type { SimpleTool, SimpleToolResult } from '../../adapters/index.js';

export const listDirectoryTool: SimpleTool = {
  name: 'list_directory',
  description: '列出目录内容，返回文件和子目录列表。',
  riskLevel: 'safe',

  async execute(args: Record<string, any>, ctx: any): Promise<SimpleToolResult> {
    const startTime = Date.now();

    try {
      const { path = '.', recursive = false } = args;

      if (typeof path !== 'string') {
        return {
          success: false,
          data: null,
          error: 'Invalid path parameter',
          duration: Date.now() - startTime,
        };
      }

      // 解析绝对路径
      const absolutePath = resolve(ctx.cwd || process.cwd(), path);

      // 读取目录
      const entries = await readdir(absolutePath);

      // 获取每个条目的详细信息
      const items = await Promise.all(
        entries.map(async (name) => {
          const fullPath = join(absolutePath, name);
          try {
            const stats = await stat(fullPath);
            return {
              name,
              type: stats.isDirectory() ? 'directory' : 'file',
              size: stats.size,
              modified: stats.mtime.toISOString(),
            };
          } catch {
            return {
              name,
              type: 'unknown',
              size: 0,
              modified: '',
            };
          }
        })
      );

      return {
        success: true,
        data: {
          path: absolutePath,
          items,
          count: items.length,
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        data: null,
        error: `Failed to list directory: ${err.message}`,
        duration: Date.now() - startTime,
      };
    }
  },
};
