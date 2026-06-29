/**
 * 命令解析器
 *
 * 将用户输入解析为命令名 + 参数列表：
 *   "/character roxy" → { name: 'character', args: ['roxy'] }
 *   "帮我重构代码"    → null（非命令）
 */

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

/** 解析用户输入，判断是否为 Slash 命令 */
export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  // 跳过 "//" 开头的注释
  if (trimmed.startsWith('//')) return null;

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase();
  if (!name) return null;

  return {
    name,
    args: parts.slice(1),
    raw: trimmed,
  };
}
