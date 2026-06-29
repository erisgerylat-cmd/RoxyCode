/**
 * 工具类型适配器
 * 统一新旧工具接口，解决类型冲突
 */

import type { Tool as LegacyTool, ToolDefinition } from '../types.js';
import type { ToolResult as LegacyToolResult } from '../../core/types/message.js';

/**
 * 简化的工具接口（新版）
 */
export interface SimpleTool {
  name: string;
  description: string;
  schema?: any;
  riskLevel: 'safe' | 'medium' | 'high';
  execute: (args: Record<string, any>, ctx: any) => Promise<SimpleToolResult>;
}

export interface SimpleToolResult {
  success: boolean;
  data: any;
  error?: string;
  duration?: number;
}

/**
 * 工具适配器：将简化工具转换为完整工具接口
 */
export class ToolAdapter {
  /**
   * 将新版简化工具转为旧版完整工具接口
   */
  static toLegacy(simpleTool: SimpleTool): LegacyTool {
    return {
      definition: {
        name: simpleTool.name,
        description: simpleTool.description,
        parameters: {
          type: 'object',
          properties: simpleTool.schema?.properties || {},
          required: simpleTool.schema?.required || []
        }
      },

      isReadOnly: simpleTool.riskLevel === 'safe',

      riskLevel: this.mapRiskLevel(simpleTool.riskLevel),

      async execute(args: Record<string, unknown>, ctx: any): Promise<LegacyToolResult> {
        try {
          const result = await simpleTool.execute(args, ctx);

          return {
            success: result.success,
            output: ToolAdapter.formatOutput(result.data),
            error: result.error,
            duration: result.duration || 0,
            metadata: result.data
          };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          return {
            success: false,
            output: '',
            error: err.message,
            duration: 0
          };
        }
      }
    };
  }

  /**
   * 批量转换工具列表
   */
  static toLegacyBatch(simpleTools: SimpleTool[]): LegacyTool[] {
    return simpleTools.map(tool => this.toLegacy(tool));
  }

  /**
   * 映射风险级别
   */
  private static mapRiskLevel(level: 'safe' | 'medium' | 'high'): 'low' | 'medium' | 'high' {
    return level === 'safe' ? 'low' : level;
  }

  /**
   * 格式化输出内容
   */
  private static formatOutput(data: any): string {
    if (data === null || data === undefined) {
      return '';
    }

    if (typeof data === 'string') {
      return data;
    }

    if (typeof data === 'object') {
      // 如果是文件读取结果，返回内容
      if (data.content) {
        return data.content;
      }

      // 如果是命令执行结果，返回 stdout
      if (data.stdout !== undefined) {
        return data.stdout;
      }

      // 如果是目录列表，格式化输出
      if (data.items && Array.isArray(data.items)) {
        return data.items
          .map((item: any) => `${item.type === 'directory' ? '📁' : '📄'} ${item.name}`)
          .join('\n');
      }

      // 如果是搜索结果，格式化输出
      if (data.matches && Array.isArray(data.matches)) {
        return data.matches
          .map((match: any) => `${match.file}:${match.line}: ${match.content}`)
          .join('\n');
      }

      // 默认返回 JSON
      return JSON.stringify(data, null, 2);
    }

    return String(data);
  }
}
