/**
 * 念话模式渲染器
 */

import chalk from 'chalk';
import type { Character } from '../../aesthetic/character/types.js';

export class TelepathyMode {
  private enabled: boolean = false;

  toggle(): boolean { this.enabled = !this.enabled; return this.enabled; }
  setEnabled(value: boolean): void { this.enabled = value; }
  isEnabled(): boolean { return this.enabled; }

  render(text: string, character: Character): string {
    if (!this.enabled) return text;
    const color = chalk.hex(character.theme.tagline);
    return color.italic(`（${character.name}的念话）${text}`);
  }

  getPromptAddon(character: Character): string {
    if (!this.enabled) return '';
    return `\n\n【当前处于念话模式】\n请以心灵感应的方式回答。你的回复应像内心独白一样，更加感性、私密、直接。\n- 不要使用正式的敬语，用更自然的内心语气\n- 可以用"..."表达犹豫或思考\n- 可以用括号表达动作或情绪，如（微笑）（歪头）\n- 回答前加上"..."表示心灵连接`;
  }

  renderToggleMessage(character: Character): string {
    if (this.enabled) {
      return chalk.hex(character.theme.tagline)(
        `\n  ✦ 念话模式已开启\n  ${chalk.dim('角色的回答将以心灵感应形式显示')}\n  ${chalk.dim('再次输入 /telepathy 关闭')}\n`
      );
    }
    return chalk.dim(`\n  念话模式已关闭\n  恢复普通对话模式\n`);
  }
}
