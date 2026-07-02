/**
 * 角色化状态栏 (Claude Code 风格)
 *
 * 基于 STATUS_BAR.md 设计，集成角色 StatusTextMap，
 * 将通用状态文字替换为角色化表达。
 * 
 * 增强功能：
 * - 动画状态指示器
 * - 更丰富的状态显示
 * - 工具执行进度可视化
 * - 成本追踪显示
 */

import chalk from 'chalk';
import { basename } from 'node:path';
import type { Character } from '../../aesthetic/character/types.js';

export type StatusState = 'thinking' | 'analyzing' | 'planning' | 'executing' | 'searching' | 'waiting' | 'done' | 'error' | 'tool';

/** 动画帧序列 */
const ANIMATION_FRAMES: Record<StatusState, string[]> = {
  thinking: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  analyzing: ['◐', '◓', '◑', '◒'],
  planning: ['◉', '◎', '●', '○'],
  executing: ['▶', '▷', '▸', '▹'],
  searching: ['🔍', '🔎'],
  waiting: ['⏸', '⏯'],
  tool: ['⚙', '⛭', '⛮'],
  done: ['✓', '✔', '✓'],
  error: ['✗', '✘', '✗'],
};

export class StatusBar {
  private startTime: number = 0;
  private inputTokens: number = 0;
  private outputTokens: number = 0;
  private currentLabel: string = '';
  private currentState: StatusState = 'thinking';
  private timer: ReturnType<typeof setInterval> | null = null;
  private character: Character;
  private animationFrame: number = 0;
  private toolStartTime: number = 0;
  private currentTool: string = '';
  private cost: number | null = null;
  private isStreaming: boolean = false;
  private lastOutputLength: number = 0;

  constructor(character: Character) {
    this.character = character;
  }

  /** 角色切换时热更新 */
  updateCharacter(character: Character): void {
    this.character = character;
  }

  /** 启动状态栏 */
  start(): void {
    this.startTime = Date.now();
    this.currentState = 'thinking';
    this.currentLabel = '';
    this.currentTool = '';
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cost = null;
    this.animationFrame = 0;
    this.isStreaming = false;
    this.lastOutputLength = 0;
    this.timer = setInterval(() => this.refresh(), 80); // 更快的刷新率
    this.refresh();
  }

  /** 更新 Token 计数 */
  updateTokens(input: number, output: number): void {
    this.inputTokens = input;
    this.outputTokens = output;
  }

  /** 设置状态 */
  setState(state: StatusState): void {
    this.currentState = state;
    this.animationFrame = 0;
  }

  /** 设置自定义状态文案 */
  setLabel(label: string): void {
    this.currentLabel = label;
  }

  /** 当前是否正在刷新 */
  isActive(): boolean {
    return this.timer !== null;
  }

  /** 设置成本 */
  setCost(cost: number): void {
    this.cost = cost;
  }

  /** 开始流式输出 */
  onStreamStart(): void {
    this.isStreaming = true;
    this.lastOutputLength = 0;
  }

  /** 更新流式输出进度 */
  onStreamChunk(text: string): void {
    this.lastOutputLength += text.length;
  }

  /** 结束流式输出 */
  onStreamEnd(): void {
    this.isStreaming = false;
  }

  /** 工具开始 */
  onToolStart(tool: string, args: any): void {
    this.currentState = 'tool';
    this.currentTool = tool;
    this.toolStartTime = Date.now();
    const text = this.character.statusText;
    const labels: Record<string, (a: any) => string> = {
      read_file:       (a) => text.reading(basename(a.path ?? a.file ?? 'file')),
      write_file:      (a) => text.writing(basename(a.path ?? a.file ?? 'file')),
      edit_file:       (a) => text.writing(basename(a.path ?? a.file ?? 'file')),
      delete_file:     (a) => text.writing(basename(a.path ?? a.file ?? 'file')),
      execute_command: (a) => text.running((a.command ?? 'cmd').split(' ')[0]),
      grep_search:     ()  => text.searching,
      file_find:       ()  => text.searching,
      git_commit:      ()  => text.running('git commit'),
      git_status:      ()  => text.running('git status'),
      git_diff:        ()  => text.running('git diff'),
      glob_search:     ()  => text.searching,
      web_fetch:       ()  => text.running('fetch'),
      web_search:      ()  => text.searching,
    };
    this.currentLabel = (labels[tool] || (() => tool))(args);
  }

  /** 工具结束 */
  onToolEnd(): void {
    this.currentState = 'thinking';
    this.currentLabel = '';
    this.currentTool = '';
  }

  /** 停止刷新并清除当前状态行，不输出完成信息 */
  clear(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isStreaming = false;
    this.currentLabel = '';
    this.currentTool = '';
    process.stdout.write('\r\x1b[K');
  }

  /** 刷新显示 */
  private refresh(): void {
    const elapsed = this.formatElapsed(Date.now() - this.startTime);
    const tokens = this.formatTokens();
    const label = this.getLabel();
    const animation = this.getAnimation();
    const toolProgress = this.getToolProgress();
    const streamIndicator = this.getStreamIndicator();
    
    // 构建状态行
    let line = `${animation} ${label}`;
    if (toolProgress) {
      line += ` ${toolProgress}`;
    }
    if (streamIndicator) {
      line += ` ${streamIndicator}`;
    }
    line += ` (${elapsed} · ${tokens})`;
    
    // 成本显示
    if (this.cost !== null) {
      line += ` · $${this.cost.toFixed(4)}`;
    }

    // 终端宽度截断保护
    const maxLen = process.stdout.columns || 120;
    const truncated = line.length > maxLen ? line.slice(0, maxLen - 3) + '...' : line;

    // 使用主题色，增加状态变化
    const color = this.getStateColor();
    process.stdout.write(`\r\x1b[K${chalk.hex(color)(truncated)}`);
  }

  /** 获取当前标签 */
  private getLabel(): string {
    if (this.currentLabel) {
      return this.currentLabel;
    }
    const text = this.character.statusText;
    switch (this.currentState) {
      case 'thinking':  return text.thinking;
      case 'analyzing': return text.analyzing;
      case 'planning':  return text.planning;
      case 'executing': return text.executing;
      case 'searching': return text.searching;
      case 'waiting':   return text.waiting;
      default:          return text.thinking;
    }
  }

  /** 获取动画帧 */
  private getAnimation(): string {
    const frames = ANIMATION_FRAMES[this.currentState] || ANIMATION_FRAMES.thinking;
    const frame = frames[this.animationFrame % frames.length];
    this.animationFrame++;
    return frame;
  }

  /** 获取工具执行进度 */
  private getToolProgress(): string {
    if (this.currentState !== 'tool' || !this.currentTool) {
      return '';
    }
    const toolElapsed = Date.now() - this.toolStartTime;
    if (toolElapsed > 2000) { // 超过2秒显示工具耗时
      return chalk.dim(`[${this.formatElapsed(toolElapsed)}]`);
    }
    return '';
  }

  /** 获取流式输出指示器 */
  private getStreamIndicator(): string {
    if (!this.isStreaming) {
      return '';
    }
    const chars = this.lastOutputLength;
    if (chars > 0) {
      return chalk.dim(`↓ ${this.formatNumber(chars)} chars`);
    }
    return '';
  }

  /** 获取状态颜色 */
  private getStateColor(): string {
    switch (this.currentState) {
      case 'thinking':  return this.character.theme.primary;
      case 'analyzing': return this.character.theme.secondary;
      case 'planning':  return this.character.theme.accent;
      case 'executing': return this.character.theme.primary;
      case 'searching': return this.character.theme.tagline;
      case 'waiting':   return this.character.theme.dim;
      case 'tool':      return this.character.theme.secondary;
      case 'done':      return this.character.theme.success;
      case 'error':     return this.character.theme.error;
      default:          return this.character.theme.primary;
    }
  }

  /** 格式化数字 */
  private formatNumber(n: number): string {
    if (n < 1000) return `${n}`;
    if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1000000).toFixed(1)}M`;
  }

  /** 结束状态栏 */
  end(cost?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const elapsed = this.formatElapsed(Date.now() - this.startTime);
    const tokens = this.formatTokens();
    const costStr = cost ? ` · ${cost}` : '';
    const doneLabel = this.character.statusText.done;
    
    // 成功完成动画
    const successFrames = ['✓', '✔', '✓'];
    const frame = successFrames[Math.floor(Date.now() / 200) % successFrames.length];
    
    console.log(`\r\x1b[K${chalk.hex(this.character.theme.success)(`${frame} ${doneLabel} (${elapsed} · ${tokens}${costStr})`)}`);
  }

  /** 显示错误 */
  showError(message: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const elapsed = this.formatElapsed(Date.now() - this.startTime);
    const tokens = this.formatTokens();
    const errorLabel = this.character.statusText.error;
    
    // 错误动画
    const errorFrames = ['✗', '✘', '✗'];
    const frame = errorFrames[Math.floor(Date.now() / 200) % errorFrames.length];
    
    console.log(`\r\x1b[K${chalk.hex(this.character.theme.error)(`${frame} ${errorLabel}: ${message} (${elapsed} · ${tokens})`)}`);
  }

  private formatElapsed(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  }

  private formatTokens(): string {
    const fmt = (n: number) => this.formatNumber(n);
    if (this.outputTokens === 0) return `↓ ${fmt(this.inputTokens)} tokens`;
    return `↓ ${fmt(this.inputTokens)} · ↑ ${fmt(this.outputTokens)} tokens`;
  }
}
