/**
 * 魔眼调试模式
 */

import chalk from 'chalk';
import type { Character } from '../../aesthetic/character/types.js';

export interface DemonEyeStats {
  model?: string;
  temperature?: number;
  topP?: number;
  contextUsed?: number;
  contextMax?: number;
  toolCalls?: number;
  toolNames?: string[];
  llmLatencyMs?: number;
  toolLatencyMs?: number;
  heapUsedMB?: number;
  rssMB?: number;
  sessionId?: string;
  mode?: string;
}

export class DemonEyeMode {
  private enabled: boolean = false;

  toggle(): boolean { this.enabled = !this.enabled; return this.enabled; }
  setEnabled(value: boolean): void { this.enabled = value; }
  isEnabled(): boolean { return this.enabled; }

  render(stats: DemonEyeStats, character: Character): string {
    if (!this.enabled) return '';
    const border = chalk.hex(character.theme.primary);
    const dim = chalk.hex(character.theme.dim);
    const accent = chalk.hex(character.theme.accent);
    const contextPercent = stats.contextMax ? ((stats.contextUsed ?? 0) / stats.contextMax * 100).toFixed(1) : '?';
    const lines: string[] = [];
    lines.push(border('  ⌈ ') + accent('魔眼') + border(` ${'─'.repeat(44)}`));
    lines.push(border('  │') + dim(`  Model: ${stats.model ?? '?'}  Temperature: ${stats.temperature ?? '?'}  Top-P: ${stats.topP ?? '?'}`));
    lines.push(border('  │') + dim(`  Context: ${this.formatNum(stats.contextUsed)}/${this.formatNum(stats.contextMax)} tokens (${contextPercent}%)`));
    lines.push(border('  │') + dim(`  Tool Calls: ${stats.toolCalls ?? 0}${stats.toolNames ? ` (${stats.toolNames.join(', ')})` : ''}`));
    lines.push(border('  │') + dim(`  Latency: LLM ${stats.llmLatencyMs ?? '?'}ms avg | Tool ${stats.toolLatencyMs ?? '?'}ms avg`));
    lines.push(border('  │') + dim(`  Memory: Heap ${stats.heapUsedMB ?? '?'}MB / RSS ${stats.rssMB ?? '?'}MB`));
    lines.push(border('  │') + dim(`  Session: ${stats.sessionId ?? '?'} | Mode: ${stats.mode ?? '?'}`));
    lines.push(border(`  ⌊ ${'─'.repeat(50)}`));
    return lines.join('\n');
  }

  renderToggleMessage(character: Character): string {
    if (this.enabled) {
      return chalk.hex(character.theme.accent)(
        `\n  ⌈ 魔眼模式已开启\n  ${chalk.dim('StatusBar 下方将显示详细技术信息')}\n  ${chalk.dim('再次输入 /demon-eye 关闭')}\n`
      );
    }
    return chalk.dim(`\n  魔眼模式已关闭\n`);
  }

  static getMemoryStats(): { heapUsedMB: number; rssMB: number } {
    const mem = process.memoryUsage();
    return { heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024), rssMB: Math.round(mem.rss / 1024 / 1024) };
  }

  private formatNum(n?: number): string {
    if (n === undefined) return '?';
    if (n < 1000) return String(n);
    return `${(n / 1000).toFixed(1)}k`;
  }
}
