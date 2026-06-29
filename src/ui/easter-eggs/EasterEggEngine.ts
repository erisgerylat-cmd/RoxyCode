/**
 * 彩蛋引擎 — 管理所有彩蛋触发逻辑
 */

import chalk from 'chalk';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import type { Character } from '../../aesthetic/character/types.js';
import { ALL_CHARACTERS, CHARACTER_ORDER } from '../../aesthetic/character/characters/index.js';

export class EasterEggEngine {
  private characterManager: CharacterManager;
  private consecutiveSuccesses: number = 0;
  private consecutiveErrors: number = 0;
  private totalTokens: number = 0;
  private tokenMilestones: Set<number> = new Set([100_000, 500_000, 1_000_000]);

  constructor(characterManager: CharacterManager) {
    this.characterManager = characterManager;
  }

  checkOnSuccess(): string | undefined {
    this.consecutiveSuccesses++;
    this.consecutiveErrors = 0;
    if (this.consecutiveSuccesses >= 10) {
      this.consecutiveSuccesses = 0;
      return this.characterManager.getSpecialQuote('consecutiveSuccess10');
    }
    return undefined;
  }

  checkOnError(): string | undefined {
    this.consecutiveErrors++;
    this.consecutiveSuccesses = 0;
    if (this.consecutiveErrors >= 5) {
      this.consecutiveErrors = 0;
      return this.characterManager.getSpecialQuote('consecutiveErrors5')
        ?? '连续失败了好几次...要不要换个方式试试？';
    }
    return undefined;
  }

  checkOnTokens(tokens: number): string | undefined {
    this.totalTokens += tokens;
    const c = this.characterManager.getCurrentCharacter();
    for (const milestone of this.tokenMilestones) {
      if (this.totalTokens >= milestone) {
        this.tokenMilestones.delete(milestone);
        const k = Math.floor(milestone / 1000);
        return c.easterEggs.special[`tokens${k}k`]
          ?? `魔力值已超过 ${k}k...这是大魔法师级别的消耗了。`;
      }
    }
    return undefined;
  }

  checkOnInput(input: string): string | undefined {
    const lower = input.toLowerCase().trim();
    if (lower.includes('洛琪希是神') || lower.includes('roxy is god')) {
      return this.characterManager.getSpecialQuote('roxyIsGod') ?? '...';
    }
    return undefined;
  }

  renderParty(): string {
    const lines: string[] = [];
    lines.push('');
    lines.push(chalk.hex('#FFD700').bold('  ✦ 全员集合！ ✦'));
    lines.push('');
    for (const id of CHARACTER_ORDER) {
      const c = ALL_CHARACTERS.get(id)!;
      const pool = c.easterEggs.startup;
      const quote = pool[Math.floor(Math.random() * pool.length)];
      const name = chalk.hex(c.theme.primary).bold(`  ${c.name}`);
      const text = chalk.hex(c.theme.tagline)(`"${quote}"`);
      lines.push(`${name}: ${text}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  async renderMagicCircle(): Promise<void> {
    const c = this.characterManager.getCurrentCharacter();
    const primary = chalk.hex(c.theme.primary);
    const accent = chalk.hex(c.theme.accent);
    const frames = [
      ['        ·  ·  ·        ', '      · ╱══════╲ ·      ', '    · ╱  ·    ·  ╲ ·    ', '   · ╱ ·    ◆    · ╲ ·   ', '    · ╲  ·    ·  ╱ ·    ', '      · ╲══════╱ ·      ', '        ·  ·  ·        '],
      ['        ◆  ◆  ◆        ', '      ◆ ╱══════╲ ◆      ', '    ◆ ╱  ◆    ◆  ╲ ◆    ', '   ◆ ╱ ◆    ★    ◆ ╲ ◆   ', '    ◆ ╲  ◆    ◆  ╱ ◆    ', '      ◆ ╲══════╱ ◆      ', '        ◆  ◆  ◆        '],
      ['        ★  ★  ★        ', '      ★ ╱══════╲ ★      ', '    ★ ╱  ★    ★  ╲ ★    ', '   ★ ╱ ★    ◆    ★ ╲ ★   ', '    ★ ╲  ★    ★  ╱ ★    ', '      ★ ╲══════╱ ★      ', '        ★  ★  ★        '],
    ];
    for (const frame of frames) {
      console.clear();
      console.log('');
      console.log(accent.bold('       ✦ 魔法阵展开中... ✦'));
      console.log('');
      for (const line of frame) { console.log(primary(line)); }
      console.log('');
      console.log(chalk.dim('  魔力回路连接中...'));
      await new Promise(r => setTimeout(r, 1000));
    }
    console.clear();
    console.log('');
    console.log(accent.bold('  ✦ 魔法阵启动完成 ✦'));
    console.log(chalk.dim('  魔力回路已就绪。'));
    console.log('');
  }
}
