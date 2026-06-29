/**
 * AgentEvent 事件渲染器
 *
 * 消费 AgentEvent 流（for await），分发到各渲染组件：
 * - status → StatusBar
 * - text_chunk → 流式输出（支持 Markdown 渲染）
 * - tool_start/tool_end → 工具调用指示器
 * - plan_generated/step_* → 进度条
 * - question → 提问交互
 * - error → 角色化错误消息
 * - stats → 统计面板
 * 
 * 增强功能：
 * - 流式 Markdown 渲染
 * - 工具执行详情可视化
 * - 实时进度反馈
 * - 错误恢复提示
 */

import chalk from 'chalk';
import type { AgentEvent } from '../../core/types/event.js';
import type { Character } from '../../aesthetic/character/types.js';
import { StatusBar } from './StatusBar.js';
import { MagicProgressBar } from './MagicProgressBar.js';
import { StreamingMarkdownRenderer, renderMarkdown } from './MarkdownRenderer.js';

/** 事件渲染器选项 */
export interface EventRendererOptions {
  character: Character;
  showStatusBar?: boolean;
  /** 是否启用 Markdown 渲染 */
  enableMarkdown?: boolean;
  /** 最大输出宽度 */
  maxWidth?: number;
}

/** 工具执行信息 */
interface ToolExecution {
  tool: string;
  args: Record<string, unknown>;
  startTime: number;
  description: string;
}

/** AgentEvent 事件渲染器 */
export class EventRenderer {
  private character: Character;
  private statusBar: StatusBar;
  private progressBar: MagicProgressBar;
  private markdownRenderer: StreamingMarkdownRenderer;
  private fullText: string = '';
  private options: EventRendererOptions;
  private currentTool: ToolExecution | null = null;
  private toolHistory: ToolExecution[] = [];
  private isStreaming: boolean = false;

  constructor(options: EventRendererOptions) {
    this.character = options.character;
    this.options = options;
    this.statusBar = new StatusBar(options.character);
    this.progressBar = new MagicProgressBar(options.character);
    this.markdownRenderer = new StreamingMarkdownRenderer({
      theme: {
        primary: options.character.theme.primary,
        secondary: options.character.theme.secondary,
        accent: options.character.theme.accent,
      },
      maxWidth: options.maxWidth,
    });
  }

  /** 角色切换时热更新 */
  updateCharacter(character: Character): void {
    this.character = character;
    this.statusBar.updateCharacter(character);
    this.progressBar.updateCharacter(character);
    this.markdownRenderer = new StreamingMarkdownRenderer({
      theme: {
        primary: character.theme.primary,
        secondary: character.theme.secondary,
        accent: character.theme.accent,
      },
      maxWidth: this.options.maxWidth,
    });
  }

  /** 获取 StatusBar 实例（供外部直接使用） */
  getStatusBar(): StatusBar { return this.statusBar; }

  /** 获取 ProgressBar 实例 */
  getProgressBar(): MagicProgressBar { return this.progressBar; }

  /** 获取当前累积的完整文本 */
  getFullText(): string { return this.fullText; }

  /** 获取工具执行历史 */
  getToolHistory(): ToolExecution[] { return [...this.toolHistory]; }

  /**
   * 处理单个 AgentEvent
   *
   * 在 Agent Loop 的 for await 循环中调用：
   *   for await (const event of agentLoop(...)) {
   *     renderer.handleEvent(event);
   *   }
   */
  handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'status':
        this.handleStatus(event);
        break;

      case 'text_chunk':
        this.handleTextChunk(event);
        break;

      case 'text_done':
        this.handleTextDone(event);
        break;

      case 'tool_start':
        this.handleToolStart(event);
        break;

      case 'tool_end':
        this.handleToolEnd(event);
        break;

      case 'plan_generated':
        this.handlePlanGenerated(event);
        break;

      case 'step_start':
        this.handleStepStart(event);
        break;

      case 'step_end':
        this.handleStepEnd(event);
        break;

      case 'question':
        this.handleQuestion(event);
        break;

      case 'agent_spawn':
        this.handleAgentSpawn(event);
        break;

      case 'agent_done':
        this.handleAgentDone(event);
        break;

      case 'error':
        this.handleError(event);
        break;

      case 'stats':
        this.handleStats(event);
        break;
    }
  }

  /** 处理状态变更 */
  private handleStatus(event: Extract<AgentEvent, { type: 'status' }>): void {
    this.statusBar.setState(event.status as any);
    this.statusBar.updateTokens(event.tokens.input, event.tokens.output);
    
    // 流式输出开始
    if (event.status === 'executing' && !this.isStreaming) {
      this.isStreaming = true;
      this.statusBar.onStreamStart();
    }
  }

  /** 处理文本块 */
  private handleTextChunk(event: Extract<AgentEvent, { type: 'text_chunk' }>): void {
    this.fullText += event.text;
    this.statusBar.onStreamChunk(event.text);
    
    // 使用 Markdown 渲染器或直接输出
    if (this.options.enableMarkdown !== false) {
      this.markdownRenderer.write(event.text);
    } else {
      process.stdout.write(event.text);
    }
  }

  /** 处理文本完成 */
  private handleTextDone(event: Extract<AgentEvent, { type: 'text_done' }>): void {
    if (this.isStreaming) {
      this.isStreaming = false;
      this.statusBar.onStreamEnd();
    }
    
    // 刷新 Markdown 渲染器缓冲区
    if (this.options.enableMarkdown !== false) {
      this.markdownRenderer.flush();
    }
    
    if (this.fullText) {
      console.log();
    }
  }

  /** 处理工具开始 */
  private handleToolStart(event: Extract<AgentEvent, { type: 'tool_start' }>): void {
    this.statusBar.onToolStart(event.tool, event.args);
    
    // 记录工具执行
    const toolExecution: ToolExecution = {
      tool: event.tool,
      args: event.args,
      startTime: Date.now(),
      description: this.getToolDescription(event.tool, event.args),
    };
    this.currentTool = toolExecution;
    this.toolHistory.push(toolExecution);
    
    // 显示工具调用详情
    this.renderToolStart(toolExecution);
  }

  /** 处理工具结束 */
  private handleToolEnd(event: Extract<AgentEvent, { type: 'tool_end' }>): void {
    this.statusBar.onToolEnd();
    
    if (this.currentTool) {
      const duration = Date.now() - this.currentTool.startTime;
      this.renderToolEnd(this.currentTool, event.result.success, duration, event.result.error);
      this.currentTool = null;
    }
    
    if (!event.result.success) {
      console.log(chalk.red(`  ✗ ${event.result.error ?? '执行失败'}`));
    }
  }

  /** 处理计划生成 */
  private handlePlanGenerated(event: Extract<AgentEvent, { type: 'plan_generated' }>): void {
    console.log(this.progressBar.renderDetailed(0,
      event.steps.map(s => ({ description: s.description, status: 'pending' as const }))
    ));
  }

  /** 处理步骤开始 */
  private handleStepStart(event: Extract<AgentEvent, { type: 'step_start' }>): void {
    console.log(this.progressBar.render(event.step, event.total, event.description));
  }

  /** 处理步骤结束 */
  private handleStepEnd(event: Extract<AgentEvent, { type: 'step_end' }>): void {
    // 步骤结束由下次 step_start 更新
    if (!event.success) {
      console.log(chalk.red(`  ✗ 步骤 ${event.step} 失败`));
    }
  }

  /** 处理提问 */
  private handleQuestion(event: Extract<AgentEvent, { type: 'question' }>): void {
    console.log(chalk.yellow(`\n  ❓ ${event.question.text}`));
    if (event.question.options) {
      for (const opt of event.question.options) {
        const marker = opt.recommended ? chalk.hex(this.character.theme.accent)('  ◆') : chalk.dim('  ◇');
        const label = chalk.white(opt.label);
        const recTag = opt.recommended ? chalk.hex(this.character.theme.accent)(' [推荐]') : '';
        console.log(`${marker} ${label}${recTag}`);
      }
    }
  }

  /** 处理 Agent 生成 */
  private handleAgentSpawn(event: Extract<AgentEvent, { type: 'agent_spawn' }>): void {
    console.log(chalk.cyan(`  🤖 Agent ${event.agentId}: ${event.task}`));
  }

  /** 处理 Agent 完成 */
  private handleAgentDone(event: Extract<AgentEvent, { type: 'agent_done' }>): void {
    const status = event.success ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${status} Agent ${event.agentId} ${event.success ? '完成' : '失败'}`);
  }

  /** 处理错误 */
  private handleError(event: Extract<AgentEvent, { type: 'error' }>): void {
    if (!event.recoverable) {
      console.log(chalk.red(`\n  ✗ ${event.error.message}`));
    } else {
      console.log(chalk.yellow(`  ⚠ ${event.error.message} (可恢复)`));
    }
  }

  /** 处理统计 */
  private handleStats(event: Extract<AgentEvent, { type: 'stats' }>): void {
    // 统计信息在 StatusBar.end() 中显示
    if (event.stats.cost !== undefined) {
      this.statusBar.setCost(event.stats.cost);
    }
  }

  /** 获取工具描述 */
  private getToolDescription(tool: string, args: Record<string, unknown>): string {
    const descriptions: Record<string, (a: Record<string, unknown>) => string> = {
      read_file: (a) => `读取 ${basename(String(a.path ?? a.file ?? 'file'))}`,
      write_file: (a) => `写入 ${basename(String(a.path ?? a.file ?? 'file'))}`,
      edit_file: (a) => `编辑 ${basename(String(a.path ?? a.file ?? 'file'))}`,
      delete_file: (a) => `删除 ${basename(String(a.path ?? a.file ?? 'file'))}`,
      execute_command: (a) => `执行 ${String(a.command ?? 'cmd').split(' ')[0]}`,
      grep_search: () => '搜索代码',
      file_find: () => '查找文件',
      glob_search: () => '模式匹配搜索',
      git_commit: () => 'Git 提交',
      git_status: () => 'Git 状态',
      git_diff: () => 'Git 差异',
      web_fetch: (a) => `获取 ${String(a.url ?? 'URL').slice(0, 50)}`,
      web_search: (a) => `搜索 ${String(a.query ?? '').slice(0, 30)}`,
    };
    return (descriptions[tool] || (() => tool))(args);
  }

  /** 渲染工具开始 */
  private renderToolStart(tool: ToolExecution): void {
    const border = chalk.hex(this.character.theme.primary);
    const dim = chalk.dim;
    const accent = chalk.hex(this.character.theme.accent);
    
    console.log('');
    console.log(border('  ┌── ') + accent('⚙ 工具调用') + border(' ──┐'));
    console.log(border('  │') + ` ${tool.description}`);
    
    // 显示关键参数
    const importantArgs = this.getImportantArgs(tool.tool, tool.args);
    if (importantArgs.length > 0) {
      console.log(border('  │'));
      for (const arg of importantArgs) {
        console.log(border('  │') + dim(`   ${arg}`));
      }
    }
    
    console.log(border('  └') + '─'.repeat(40) + border('┘'));
  }

  /** 渲染工具结束 */
  private renderToolEnd(tool: ToolExecution, success: boolean, duration: number, error?: string): void {
    const statusIcon = success ? chalk.green('✓') : chalk.red('✗');
    const durationStr = duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`;
    
    console.log(`  ${statusIcon} ${tool.description} ${chalk.dim(`(${durationStr})`)}`);
    
    if (!success && error) {
      console.log(chalk.red(`    ✗ ${error}`));
    }
  }

  /** 获取重要参数 */
  private getImportantArgs(tool: string, args: Record<string, unknown>): string[] {
    const result: string[] = [];
    
    switch (tool) {
      case 'read_file':
      case 'write_file':
      case 'edit_file':
      case 'delete_file':
        if (args.path) result.push(`路径: ${args.path}`);
        if (args.file) result.push(`文件: ${args.file}`);
        break;
      case 'execute_command':
        if (args.command) result.push(`命令: ${args.command}`);
        break;
      case 'grep_search':
        if (args.pattern) result.push(`模式: ${args.pattern}`);
        if (args.path) result.push(`路径: ${args.path}`);
        break;
      case 'web_fetch':
        if (args.url) result.push(`URL: ${args.url}`);
        break;
      case 'web_search':
        if (args.query) result.push(`查询: ${args.query}`);
        break;
    }
    
    return result.slice(0, 3); // 最多显示3个参数
  }

  /** 渲染执行摘要 */
  renderSummary(): void {
    if (this.toolHistory.length === 0) return;
    
    const border = chalk.hex(this.character.theme.primary);
    const dim = chalk.dim;
    const accent = chalk.hex(this.character.theme.accent);
    
    console.log('');
    console.log(border('  ┌── ') + accent('执行摘要') + border(' ──┐'));
    
    // 统计工具调用
    const toolCounts = new Map<string, number>();
    for (const tool of this.toolHistory) {
      toolCounts.set(tool.tool, (toolCounts.get(tool.tool) || 0) + 1);
    }
    
    for (const [tool, count] of toolCounts) {
      const description = this.getToolDescription(tool, {});
      console.log(border('  │') + ` ${description}: ${count} 次`);
    }
    
    console.log(border('  └') + '─'.repeat(40) + border('┘'));
  }
}

/** 获取文件名 */
function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}
