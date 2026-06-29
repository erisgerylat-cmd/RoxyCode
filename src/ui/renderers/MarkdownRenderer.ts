/**
 * Markdown 终端渲染器
 *
 * 将 Markdown 文本渲染为终端输出（代码块、列表、标题等）。
 * 使用 chalk 实现丰富的终端格式化，无需外部依赖。
 */

import chalk from 'chalk';

/** Markdown 渲染选项 */
export interface MarkdownRenderOptions {
  /** 代码块高亮（暂用 chalk 简单着色） */
  highlight?: boolean;
  /** 最大行宽 */
  maxWidth?: number;
  /** 主题色 */
  theme?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
}

/** 代码块语言映射到简化的语法高亮颜色 */
const LANGUAGE_COLORS: Record<string, (code: string) => string> = {
  typescript: (code) => highlightTypeScript(code),
  ts: (code) => highlightTypeScript(code),
  javascript: (code) => highlightJavaScript(code),
  js: (code) => highlightJavaScript(code),
  python: (code) => highlightPython(code),
  py: (code) => highlightPython(code),
  json: (code) => highlightJSON(code),
  bash: (code) => highlightBash(code),
  sh: (code) => highlightBash(code),
  shell: (code) => highlightBash(code),
  powershell: (code) => highlightBash(code),
  ps1: (code) => highlightBash(code),
  default: (code) => chalk.dim(code),
};

/** TypeScript/JavaScript 语法高亮 */
function highlightTypeScript(code: string): string {
  return code
    // 关键字
    .replace(/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|implements|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|void|null|undefined|true|false|interface|type|enum|namespace|module|declare|abstract|readonly|private|protected|public|static|get|set|constructor)\b/g, 
      chalk.magenta('$1'))
    // 字符串
    .replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, (match) => chalk.green(match))
    // 数字
    .replace(/\b(\d+\.?\d*)\b/g, chalk.cyan('$1'))
    // 注释
    .replace(/(\/\/.*$)/gm, chalk.dim('$1'))
    .replace(/(\/\*[\s\S]*?\*\/)/g, chalk.dim('$1'))
    // 函数调用
    .replace(/\b([a-zA-Z_$][\w$]*)\s*\(/g, chalk.blue('$1') + '(')
    // 类型注解
    .replace(/:\s*([A-Z][\w$]*)/g, ': ' + chalk.yellow('$1'));
}

/** JavaScript 语法高亮 */
function highlightJavaScript(code: string): string {
  return code
    .replace(/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|void|null|undefined|true|false)\b/g, 
      chalk.magenta('$1'))
    .replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, (match) => chalk.green(match))
    .replace(/\b(\d+\.?\d*)\b/g, chalk.cyan('$1'))
    .replace(/(\/\/.*$)/gm, chalk.dim('$1'))
    .replace(/(\/\*[\s\S]*?\*\/)/g, chalk.dim('$1'))
    .replace(/\b([a-zA-Z_$][\w$]*)\s*\(/g, chalk.blue('$1') + '(');
}

/** Python 语法高亮 */
function highlightPython(code: string): string {
  return code
    .replace(/\b(def|class|return|if|elif|else|for|while|break|continue|pass|import|from|as|try|except|finally|raise|with|yield|lambda|and|or|not|in|is|None|True|False|self|print|range|len|list|dict|set|tuple|str|int|float|bool)\b/g, 
      chalk.magenta('$1'))
    .replace(/(["'])(?:(?!\1|\\).|\\.)*\1/g, (match) => chalk.green(match))
    .replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, chalk.green('$1'))
    .replace(/#.*$/gm, chalk.dim('$&'))
    .replace(/\b(\d+\.?\d*)\b/g, chalk.cyan('$1'))
    .replace(/\b([a-zA-Z_][\w]*)\s*\(/g, chalk.blue('$1') + '(');
}

/** JSON 语法高亮 */
function highlightJSON(code: string): string {
  return code
    .replace(/"([^"]+)"\s*:/g, chalk.cyan('"$1"') + ':')
    .replace(/:\s*"([^"]*)"/g, ': ' + chalk.green('"$1"'))
    .replace(/:\s*(\d+\.?\d*)/g, ': ' + chalk.yellow('$1'))
    .replace(/:\s*(true|false|null)/g, ': ' + chalk.magenta('$1'));
}

/** Bash/Shell 语法高亮 */
function highlightBash(code: string): string {
  return code
    .replace(/#.*$/gm, chalk.dim('$&'))
    .replace(/\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|local|export|source|alias|unalias|cd|ls|grep|find|cat|echo|printf|read|test|true|false)\b/g, 
      chalk.magenta('$1'))
    .replace(/(["'])(?:(?!\1|\\).|\\.)*\1/g, (match) => chalk.green(match))
    .replace(/\$\{?[\w]+\}?/g, chalk.cyan('$&'))
    .replace(/\b(\d+)\b/g, chalk.yellow('$1'));
}

/** 解析内联 Markdown 格式 */
function parseInlineMarkdown(text: string): string {
  // 粗体 **text** 或 __text__
  text = text.replace(/\*\*(.+?)\*\*/g, chalk.bold('$1'));
  text = text.replace(/__(.+?)__/g, chalk.bold('$1'));
  
  // 斜体 *text* 或 _text_
  text = text.replace(/\*(.+?)\*/g, chalk.italic('$1'));
  text = text.replace(/_(.+?)_/g, chalk.italic('$1'));
  
  // 行内代码 `code`
  text = text.replace(/`([^`]+)`/g, chalk.bgGray.black(' $1 '));
  
  // 链接 [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, chalk.blue.underline('$1') + chalk.dim(' ($2)'));
  
  // 图片 ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, chalk.blue('[Image: $1]') + chalk.dim(' ($2)'));
  
  return text;
}

/** 检测是否为空行 */
function isEmptyLine(line: string): boolean {
  return line.trim().length === 0;
}

/** 渲染代码块围栏 */
function renderCodeBlock(lines: string[], startIdx: number, options?: MarkdownRenderOptions): { rendered: string; endIdx: number } {
  const fenceLine = lines[startIdx].trim();
  const language = fenceLine.slice(3).trim().toLowerCase();
  const codeLines: string[] = [];
  let endIdx = startIdx + 1;
  
  // 收集代码块内容
  while (endIdx < lines.length && !lines[endIdx].trim().startsWith('```')) {
    codeLines.push(lines[endIdx]);
    endIdx++;
  }
  
  // 跳过结束围栏
  if (endIdx < lines.length) {
    endIdx++;
  }
  
  const code = codeLines.join('\n');
  const maxLen = options?.maxWidth || process.stdout.columns || 120;
  const innerWidth = maxLen - 4; // 留出边距
  
  // 应用语法高亮
  const highlighter = LANGUAGE_COLORS[language] || LANGUAGE_COLORS.default;
  const highlightedCode = options?.highlight !== false ? highlighter(code) : code;
  
  // 构建代码块输出
  const result: string[] = [];
  const borderColor = options?.theme?.primary || '#5B9BD5';
  const border = chalk.hex(borderColor);
  
  // 顶部边框
  result.push(border('  ┌' + '─'.repeat(Math.min(innerWidth, maxLen - 6)) + '┐'));
  
  // 语言标签
  if (language && language !== 'default') {
    const label = ` ${language} `;
    const padding = Math.max(0, Math.min(innerWidth, maxLen - 6) - label.length);
    result.push(border('│') + chalk.bgHex(borderColor).black(label) + ' '.repeat(padding) + border('│'));
    result.push(border('├' + '─'.repeat(Math.min(innerWidth, maxLen - 6)) + '┤'));
  }
  
  // 代码内容
  const codeLinesHighlighted = highlightedCode.split('\n');
  for (const codeLine of codeLinesHighlighted) {
    const truncated = codeLine.length > innerWidth - 2 ? codeLine.slice(0, innerWidth - 5) + '...' : codeLine;
    const padding = Math.max(0, innerWidth - 2 - visibleLength(truncated));
    result.push(border('│') + ' ' + truncated + ' '.repeat(padding) + border('│'));
  }
  
  // 底部边框
  result.push(border('└' + '─'.repeat(Math.min(innerWidth, maxLen - 6)) + '┘'));
  
  return { rendered: result.join('\n'), endIdx };
}

/** 获取字符串的可见长度（去除 ANSI 转义序列） */
function visibleLength(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * 简单的 Markdown → 终端文本转换
 *
 * 支持：
 * - 标题 (# ## ### 等)
 * - 列表 (有序/无序)
 * - 代码块 (带语言高亮)
 * - 行内格式 (粗体、斜体、代码)
 * - 引用块
 * - 分割线
 * - 链接和图片
 */
export function renderMarkdown(text: string, options?: MarkdownRenderOptions): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;
  const maxLen = options?.maxWidth || process.stdout.columns || 120;
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // 空行
    if (isEmptyLine(trimmed)) {
      result.push('');
      i++;
      continue;
    }
    
    // 代码块
    if (trimmed.startsWith('```')) {
      const { rendered, endIdx } = renderCodeBlock(lines, i, options);
      result.push(rendered);
      i = endIdx;
      continue;
    }
    
    // 标题
    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const title = parseInlineMarkdown(match[2]);
        const titleFormatted = formatHeading(title, level, options);
        result.push(titleFormatted);
        i++;
        continue;
      }
    }
    
    // 分割线
    if (/^[-*_]{3,}$/.test(trimmed)) {
      result.push(chalk.dim('  ' + '─'.repeat(Math.min(maxLen - 4, 60))));
      i++;
      continue;
    }
    
    // 引用块
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ''));
        i++;
      }
      const quoteText = quoteLines.join(' ');
      const parsed = parseInlineMarkdown(quoteText);
      result.push(chalk.dim('  │ ') + chalk.italic(parsed));
      continue;
    }
    
    // 无序列表
    if (/^[-*+]\s+/.test(trimmed)) {
      const content = trimmed.replace(/^[-*+]\s+/, '');
      const parsed = parseInlineMarkdown(content);
      result.push(chalk.hex(options?.theme?.accent || '#FFD700')('  • ') + parsed);
      i++;
      continue;
    }
    
    // 有序列表
    if (/^\d+\.\s+/.test(trimmed)) {
      const match = trimmed.match(/^(\d+)\.\s+(.+)$/);
      if (match) {
        const num = match[1];
        const content = parseInlineMarkdown(match[2]);
        result.push(chalk.hex(options?.theme?.secondary || '#7EC8E3')(`  ${num}. `) + content);
        i++;
        continue;
      }
    }
    
    // 任务列表
    if (/^[-*+]\s+\[[ x]\]\s+/.test(trimmed)) {
      const match = trimmed.match(/^[-*+]\s+\[([ x])\]\s+(.+)$/);
      if (match) {
        const checked = match[1] === 'x';
        const content = parseInlineMarkdown(match[2]);
        const checkbox = checked ? chalk.green('✓') : chalk.dim('○');
        result.push(`  ${checkbox} ${checked ? chalk.dim(content) : content}`);
        i++;
        continue;
      }
    }
    
    // 普通段落
    const parsed = parseInlineMarkdown(trimmed);
    result.push('  ' + parsed);
    i++;
  }
  
  return result.join('\n');
}

/** 格式化标题 */
function formatHeading(title: string, level: number, options?: MarkdownRenderOptions): string {
  const primaryColor = options?.theme?.primary || '#5B9BD5';
  const secondaryColor = options?.theme?.secondary || '#7EC8E3';
  
  switch (level) {
    case 1:
      return '\n' + chalk.hex(primaryColor).bold.underline(`  ${title}`) + '\n';
    case 2:
      return '\n' + chalk.hex(primaryColor).bold(`  ${title}`) + '\n' + chalk.dim('  ' + '─'.repeat(Math.min(60, title.length + 4)));
    case 3:
      return '\n' + chalk.hex(secondaryColor).bold(`  ${title}`);
    case 4:
      return chalk.hex(secondaryColor)(`  ${title}`);
    case 5:
      return chalk.dim.bold(`  ${title}`);
    case 6:
      return chalk.dim(`  ${title}`);
    default:
      return `  ${title}`;
  }
}

/**
 * 流式 Markdown 渲染器
 *
 * 用于实时流式输出，逐块处理 Markdown 内容
 */
export class StreamingMarkdownRenderer {
  private buffer: string = '';
  private inCodeBlock: boolean = false;
  private codeBlockLanguage: string = '';
  private codeBlockContent: string[] = [];
  private options?: MarkdownRenderOptions;
  
  constructor(options?: MarkdownRenderOptions) {
    this.options = options;
  }
  
  /** 写入一块文本 */
  write(chunk: string): void {
    this.buffer += chunk;
    this.processBuffer();
  }
  
  /** 处理缓冲区中的内容 */
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // 最后一行可能不完整
    
    for (const line of lines) {
      this.processLine(line);
    }
  }
  
  /** 处理单行 */
  private processLine(line: string): void {
    const trimmed = line.trim();
    
    // 代码块开始/结束
    if (trimmed.startsWith('```')) {
      if (this.inCodeBlock) {
        // 结束代码块
        this.renderCodeBlock();
        this.inCodeBlock = false;
        this.codeBlockLanguage = '';
        this.codeBlockContent = [];
      } else {
        // 开始代码块
        this.inCodeBlock = true;
        this.codeBlockLanguage = trimmed.slice(3).trim();
      }
      return;
    }
    
    if (this.inCodeBlock) {
      this.codeBlockContent.push(line);
      return;
    }
    
    // 普通行处理
    const rendered = renderMarkdown(line, this.options);
    process.stdout.write(rendered + '\n');
  }
  
  /** 渲染代码块 */
  private renderCodeBlock(): void {
    const code = this.codeBlockContent.join('\n');
    const highlighter = LANGUAGE_COLORS[this.codeBlockLanguage] || LANGUAGE_COLORS.default;
    const highlighted = this.options?.highlight !== false ? highlighter(code) : code;
    
    const maxLen = this.options?.maxWidth || process.stdout.columns || 120;
    const borderColor = this.options?.theme?.primary || '#5B9BD5';
    const border = chalk.hex(borderColor);
    const innerWidth = maxLen - 6;
    
    // 顶部边框
    process.stdout.write(border('  ┌' + '─'.repeat(innerWidth) + '┐') + '\n');
    
    // 语言标签
    if (this.codeBlockLanguage) {
      const label = ` ${this.codeBlockLanguage} `;
      const padding = Math.max(0, innerWidth - label.length);
      process.stdout.write(border('│') + chalk.bgHex(borderColor).black(label) + ' '.repeat(padding) + border('│') + '\n');
      process.stdout.write(border('├' + '─'.repeat(innerWidth) + '┤') + '\n');
    }
    
    // 代码内容
    const codeLines = highlighted.split('\n');
    for (const codeLine of codeLines) {
      const truncated = codeLine.length > innerWidth - 2 ? codeLine.slice(0, innerWidth - 5) + '...' : codeLine;
      const padding = Math.max(0, innerWidth - 2 - visibleLength(truncated));
      process.stdout.write(border('│') + ' ' + truncated + ' '.repeat(padding) + border('│') + '\n');
    }
    
    // 底部边框
    process.stdout.write(border('└' + '─'.repeat(innerWidth) + '┘') + '\n');
  }
  
  /** 刷新缓冲区 */
  flush(): void {
    if (this.buffer) {
      this.processLine(this.buffer);
      this.buffer = '';
    }
  }
}
