/**
 * 魔大陆风格进度条
 *
 * Standard/Ultimate 模式下步骤进度用魔法阵符号渲染：
 * - ◆ 已完成（accent色）
 * - ◇ 当前（primary色，闪烁）
 * - · 未开始（dim色）
 *
 * 示例：◆ ◆ ◇ · · · ·  编排术式中... (3/7)
 */

import chalk from 'chalk';
import type { Character } from '../../aesthetic/character/types.js';

export class MagicProgressBar {
  private character: Character;

  constructor(character: Character) {
    this.character = character;
  }

  /** 角色切换时热更新 */
  updateCharacter(character: Character): void {
    this.character = character;
  }

  /**
   * 渲染进度条
   *
   * @param current 当前步骤（1-based）
   * @param total   总步骤数
   * @param desc    当前步骤描述
   */
  render(current: number, total: number, desc: string): string {
    const symbols: string[] = [];

    for (let i = 1; i <= total; i++) {
      if (i < current) {
        symbols.push(chalk.hex(this.character.theme.accent)('◆'));
      } else if (i === current) {
        symbols.push(chalk.hex(this.character.theme.primary)('◇'));
      } else {
        symbols.push(chalk.hex(this.character.theme.dim)('·'));
      }
    }

    const bar = symbols.join(' ');
    const stepText = this.character.statusText.step(current, total, desc);

    return `  ${bar}  ${chalk.hex(this.character.theme.primary)(stepText)}`;
  }

  /**
   * 渲染多行步骤列表（详细视图）
   */
  renderDetailed(current: number, steps: Array<{ description: string; status: 'pending' | 'active' | 'done' }>): string {
    const lines: string[] = [];
    const c = this.character;

    lines.push('');
    lines.push(chalk.hex(c.theme.primary)(`  ┌── ${c.statusText.planning} ──┐`));

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const num = i + 1;
      let prefix: string;
      let text: string;

      switch (step.status) {
        case 'done':
          prefix = chalk.hex(c.theme.accent)('  ✓');
          text = chalk.hex(c.theme.dim)(step.description);
          break;
        case 'active':
          prefix = chalk.hex(c.theme.primary)('  ◇');
          text = chalk.hex(c.theme.primary).bold(step.description);
          break;
        case 'pending':
          prefix = chalk.hex(c.theme.dim)('  ·');
          text = chalk.hex(c.theme.dim)(step.description);
          break;
      }

      lines.push(chalk.hex(c.theme.primary)('  │') + `${prefix} ${num}. ${text}`);
    }

    lines.push(chalk.hex(c.theme.primary)(`  └${'─'.repeat(40)}┘`));

    return lines.join('\n');
  }
}
