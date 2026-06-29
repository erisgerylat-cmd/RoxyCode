import chalk from 'chalk';
import { basename } from 'node:path';
import type { Character } from '../../aesthetic/character/types.js';
import type { Language } from '../../i18n/index.js';

export interface PromptStatusSnapshot {
  character: Character;
  language: Language;
  providerName: string;
  providerId: string;
  model: string;
  mode: string;
  contextWindow: number;
  turns: number;
  commandCount: number;
  historyCount: number;
  elapsedMs: number;
  cwd: string;
}

export class InteractionRenderer {
  private character: Character;

  constructor(character: Character) {
    this.character = character;
  }

  updateCharacter(character: Character): void {
    this.character = character;
  }

  renderPromptStatus(snapshot: PromptStatusSnapshot): void {
    const language = snapshot.language === 'zh-CN' ? '\u4e2d\u6587' : 'English';
    const labels = snapshot.language === 'zh-CN'
      ? {
          role: '\u89d2\u8272',
          mode: '\u6a21\u5f0f',
          model: '\u6a21\u578b',
          ctx: '\u4e0a\u4e0b\u6587',
          turns: '\u8f6e\u6b21',
          commands: '\u547d\u4ee4',
          history: '\u5386\u53f2',
          lang: '\u8bed\u8a00',
        }
      : { role: 'Role', mode: 'Mode', model: 'Model', ctx: 'Context', turns: 'Turns', commands: 'Cmds', history: 'History', lang: 'Lang' };

    const provider = snapshot.providerName || snapshot.providerId;
    const segments = [
      'RoxyCode',
      `${labels.role} ${snapshot.character.name}`,
      `${labels.mode} ${formatMode(snapshot.mode)}`,
      `${labels.model} ${provider}/${snapshot.model}`,
      `${labels.ctx} ${formatCompactNumber(snapshot.contextWindow)}`,
      `${labels.turns} ${snapshot.turns}`,
      `${labels.commands} ${snapshot.commandCount}`,
      `${labels.history} ${snapshot.historyCount}`,
      `${labels.lang} ${language}`,
      basename(snapshot.cwd),
      formatElapsed(snapshot.elapsedMs),
    ];

    const line = ` ${segments.join(' | ')} `;
    console.log(chalk.hex(snapshot.character.theme.dim)(`  ${truncateVisible(line, terminalWidth() - 4)}`));
  }

  renderUserInput(input: string, kind: 'command' | 'message'): void {
    const color = kind === 'command' ? this.character.theme.secondary : this.character.theme.primary;
    const label = kind === 'command' ? 'command' : this.character.name;
    console.log(chalk.hex(color)(`  > ${label}: ${input.trim()}`));
  }

  renderCommandResult(name: string, durationMs: number, handled: boolean): void {
    const text = handled ? `/${name} completed in ${formatElapsed(durationMs)}` : `/${name} was not found`;
    const color = handled ? this.character.theme.success : this.character.theme.error;
    console.log(chalk.hex(color)(`  ${handled ? 'OK' : 'ERR'} ${text}`));
  }

  renderCommandError(name: string, durationMs: number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.hex(this.character.theme.error)(`  ERR /${name} failed in ${formatElapsed(durationMs)}: ${message}`));
  }

  renderMessagePlaceholder(input: string, language: Language): void {
    const labels = language === 'zh-CN'
      ? {
          title: '\u8bf7\u6c42\u5df2\u6536\u5230',
          pending: 'Agent Loop \u6b63\u5728\u8fde\u63a5\u6a21\u578b\u6d41\u5f0f\u8f93\u51fa\u548c\u5de5\u5177\u8c03\u7528\u95ed\u73af\u3002',
          next: '\u8fd9\u91cc\u4f1a\u663e\u793a\u5b9e\u65f6\u56de\u590d\u3001\u5de5\u5177\u8c03\u7528\u3001\u6743\u9650\u786e\u8ba4\u548c\u6700\u7ec8\u7ed3\u679c\u3002',
          length: '\u8f93\u5165\u957f\u5ea6',
        }
      : {
          title: 'Request received',
          pending: 'Agent Loop is connecting model streaming and tool calls.',
          next: 'This area will show live output, tool calls, permission checks, and final results.',
          length: 'Input length',
        };

    const border = chalk.hex(this.character.theme.primary);
    const accent = chalk.hex(this.character.theme.accent);
    const dim = chalk.dim;
    const width = Math.min(72, Math.max(48, terminalWidth() - 8));
    const bodyWidth = width - 4;

    console.log(border(`  +-${'-'.repeat(width - 2)}-+`));
    console.log(border('  | ') + accent(labels.title.padEnd(bodyWidth)) + border(' |'));
    console.log(border('  | ') + dim(truncateVisible(labels.pending, bodyWidth).padEnd(bodyWidth)) + border(' |'));
    console.log(border('  | ') + dim(truncateVisible(labels.next, bodyWidth).padEnd(bodyWidth)) + border(' |'));
    console.log(border('  | ') + dim(`${labels.length}: ${input.length} chars`.padEnd(bodyWidth)) + border(' |'));
    console.log(border(`  +-${'-'.repeat(width - 2)}-+`));
  }
}

function terminalWidth(): number {
  return process.stdout.columns || 100;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function formatMode(mode: string): string {
  if (!mode || mode === 'auto') return 'auto(Standard)';
  return mode;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function truncateVisible(value: string, maxLength: number): string {
  if (visibleLength(value) <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, Math.max(0, maxLength));
  return `${value.slice(0, maxLength - 3)}...`;
}
