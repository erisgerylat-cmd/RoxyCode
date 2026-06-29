/**
 * grep_search 工具实现
 * 在文件中搜索文本内容
 */

import { readdir, readFile, stat } from 'fs/promises';
import { resolve, join, relative } from 'path';
import type { SimpleTool, SimpleToolResult } from '../../adapters/index.js';

export const grepSearchTool: SimpleTool = {
  name: 'grep_search',
  description: '在文件中搜索文本内容。支持正则表达式和递归搜索。',
  riskLevel: 'safe',

  async execute(args: Record<string, any>, ctx: any): Promise<SimpleToolResult> {
    const startTime = Date.now();

    try {
      const {
        pattern,
        path = '.',
        filePattern = '*',
        caseSensitive = false,
        maxResults = 100,
      } = args;

      if (!pattern || typeof pattern !== 'string') {
        return {
          success: false,
          data: null,
          error: 'Missing or invalid pattern parameter',
          duration: Date.now() - startTime,
        };
      }

      // 解析绝对路径
      const absolutePath = resolve(ctx.cwd || process.cwd(), path);

      // 创建正则表达式
      const regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');

      // 搜索文件
      const matches = await searchDirectory(
        absolutePath,
        regex,
        filePattern,
        maxResults
      );

      return {
        success: true,
        data: {
          pattern,
          matches,
          count: matches.length,
          truncated: matches.length >= maxResults,
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        data: null,
        error: `Search failed: ${err.message}`,
        duration: Date.now() - startTime,
      };
    }
  },
};

async function searchDirectory(
  dir: string,
  regex: RegExp,
  filePattern: string,
  maxResults: number,
  results: any[] = []
): Promise<any[]> {
  if (results.length >= maxResults) return results;

  try {
    const entries = await readdir(dir);

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = join(dir, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        // 跳过 node_modules, .git 等
        if (['.git', 'node_modules', '.next', 'dist', 'build'].includes(entry)) {
          continue;
        }
        await searchDirectory(fullPath, regex, filePattern, maxResults, results);
      } else if (stats.isFile()) {
        // 检查文件扩展名
        if (filePattern !== '*' && !entry.endsWith(filePattern)) {
          continue;
        }

        try {
          const content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n');

          lines.forEach((line, lineNumber) => {
            if (results.length >= maxResults) return;

            const match = regex.exec(line);
            if (match) {
              results.push({
                file: relative(process.cwd(), fullPath),
                line: lineNumber + 1,
                content: line.trim(),
                match: match[0],
              });
            }
          });
        } catch {
          // 跳过无法读取的文件
        }
      }
    }
  } catch {
    // 跳过无法访问的目录
  }

  return results;
}
