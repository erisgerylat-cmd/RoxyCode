/**
 * 输入处理器
 *
 * 处理用户输入的多行粘贴、特殊字符等。
 * 增强功能：
 * - 多行输入支持
 * - 历史记录管理
 * - 输入验证
 * - 快捷键支持
 */

/** 处理原始输入（去除多余空白、处理多行粘贴） */
export function processInput(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')     // 统一换行符
    .replace(/\r/g, '\n')
    .trim();
}

/** 检查输入是否为多行（粘贴内容） */
export function isMultiLine(input: string): boolean {
  return input.includes('\n');
}

/** 检查输入是否为命令 */
export function isCommand(input: string): boolean {
  return input.startsWith('/');
}

/** 检查输入是否为空 */
export function isEmpty(input: string): boolean {
  return input.trim().length === 0;
}

/** 检查输入是否为特殊快捷键 */
export function isSpecialKey(input: string): boolean {
  // 检测 Ctrl+C, Ctrl+D, ESC 等
  return input === '\x03' || input === '\x04' || input === '\x1b';
}

/** 历史记录管理器 */
export class InputHistory {
  private history: string[] = [];
  private maxSize: number;
  private currentIndex: number = -1;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  /** 添加输入到历史 */
  add(input: string): void {
    if (!input.trim()) return;
    
    // 避免重复
    if (this.history.length > 0 && this.history[this.history.length - 1] === input) {
      return;
    }
    
    this.history.push(input);
    
    // 限制大小
    if (this.history.length > this.maxSize) {
      this.history.shift();
    }
    
    this.currentIndex = this.history.length;
  }

  /** 获取上一条历史 */
  getPrevious(): string | null {
    if (this.history.length === 0) return null;
    
    if (this.currentIndex > 0) {
      this.currentIndex--;
    }
    
    return this.history[this.currentIndex] || null;
  }

  /** 获取下一条历史 */
  getNext(): string | null {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      return this.history[this.currentIndex];
    }
    
    this.currentIndex = this.history.length;
    return '';
  }

  /** 重置索引 */
  resetIndex(): void {
    this.currentIndex = this.history.length;
  }

  /** 获取历史记录 */
  getHistory(): string[] {
    return [...this.history];
  }

  /** 清空历史 */
  clear(): void {
    this.history = [];
    this.currentIndex = -1;
  }

  /** 搜索历史 */
  search(query: string): string[] {
    const lowerQuery = query.toLowerCase();
    return this.history.filter(item => 
      item.toLowerCase().includes(lowerQuery)
    ).reverse();
  }
}

/** 输入验证器 */
export interface InputValidator {
  validate: (input: string) => string | null; // 返回错误信息或 null
  suggestion?: string;
}

/** 创建命令验证器 */
export function createCommandValidator(validCommands: string[]): InputValidator {
  return {
    validate: (input: string) => {
      if (!input.startsWith('/')) return null;
      
      const cmd = input.split(' ')[0].toLowerCase();
      if (!validCommands.includes(cmd)) {
        return `未知命令: ${cmd}`;
      }
      return null;
    },
    suggestion: '输入 /help 查看可用命令',
  };
}

/** 输入格式化器 */
export interface InputFormatter {
  format: (input: string) => string;
}

/** 创建代码块格式化器 */
export function createCodeBlockFormatter(): InputFormatter {
  return {
    format: (input: string) => {
      // 检测是否为代码块
      if (input.startsWith('```') && input.endsWith('```')) {
        return input;
      }
      
      // 检测是否包含代码特征
      const codePatterns = [
        /^(function|class|const|let|var|import|export|def|if|for|while)\s/m,
        /[{}\[\]();]/,
        /^\s*(\/\/|#|\/\*)/m,
      ];
      
      const hasCodePattern = codePatterns.some(pattern => pattern.test(input));
      
      if (hasCodePattern && !input.startsWith('`')) {
        // 可能是代码，添加代码块标记
        return '```\n' + input + '\n```';
      }
      
      return input;
    },
  };
}

/** 输入建议 */
export interface InputSuggestion {
  text: string;
  description: string;
  value: string;
}

/** 获取输入建议 */
export function getInputSuggestions(
  input: string,
  commands: Array<{ name: string; description: string; aliases?: string[] }>,
): InputSuggestion[] {
  if (!input.startsWith('/')) return [];
  
  const query = input.slice(1).toLowerCase();
  const suggestions: InputSuggestion[] = [];
  
  for (const cmd of commands) {
    // 检查主命令名
    if (cmd.name.toLowerCase().startsWith(query)) {
      suggestions.push({
        text: `/${cmd.name}`,
        description: cmd.description,
        value: `/${cmd.name}`,
      });
    }
    
    // 检查别名
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        if (alias.toLowerCase().startsWith(query)) {
          suggestions.push({
            text: `/${alias}`,
            description: `${cmd.description} (别名)`,
            value: `/${cmd.name}`,
          });
        }
      }
    }
  }
  
  return suggestions.slice(0, 5); // 最多返回5个建议
}

/** 多行输入收集器 */
export class MultiLineCollector {
  private lines: string[] = [];
  private isOpen: boolean = false;
  private openPattern: RegExp;
  private closePattern: RegExp;

  constructor(openPattern: RegExp = /^```/, closePattern: RegExp = /^```$/) {
    this.openPattern = openPattern;
    this.closePattern = closePattern;
  }

  /** 尝试添加一行 */
  addLine(line: string): { complete: boolean; content?: string } {
    if (!this.isOpen) {
      // 检查是否开始多行输入
      if (this.openPattern.test(line)) {
        this.isOpen = true;
        this.lines = [];
        return { complete: false };
      }
      return { complete: true, content: line };
    }
    
    // 检查是否结束多行输入
    if (this.closePattern.test(line)) {
      this.isOpen = false;
      const content = this.lines.join('\n');
      this.lines = [];
      return { complete: true, content };
    }
    
    // 添加到多行内容
    this.lines.push(line);
    return { complete: false };
  }

  /** 检查是否正在收集 */
  isCollecting(): boolean {
    return this.isOpen;
  }

  /** 获取当前收集的内容 */
  getCurrentContent(): string {
    return this.lines.join('\n');
  }

  /** 重置 */
  reset(): void {
    this.lines = [];
    this.isOpen = false;
  }
}
