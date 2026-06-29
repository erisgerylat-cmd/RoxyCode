/**
 * 主题渲染器 — 根据角色主题色生成 Chalk 实例
 */

import chalk, { type ChalkInstance } from 'chalk';
import type { CharacterTheme } from '../../aesthetic/character/types.js';

export interface ThemeColors {
  primary: ChalkInstance;
  secondary: ChalkInstance;
  accent: ChalkInstance;
  tagline: ChalkInstance;
  dim: ChalkInstance;
  error: ChalkInstance;
  success: ChalkInstance;
  text: ChalkInstance;
}

export class ThemeRenderer {
  private colors: ThemeColors;

  constructor(theme: CharacterTheme) {
    this.colors = ThemeRenderer.buildColors(theme);
  }

  /** 根据角色主题构建 Chalk 颜色实例 */
  private static buildColors(theme: CharacterTheme): ThemeColors {
    return {
      primary:   chalk.hex(theme.primary),
      secondary: chalk.hex(theme.secondary),
      accent:    chalk.hex(theme.accent),
      tagline:   chalk.hex(theme.tagline),
      dim:       chalk.hex(theme.dim),
      error:     chalk.hex(theme.error),
      success:   chalk.hex(theme.success),
      text:      chalk.white,
    };
  }

  /** 热更新主题 */
  updateTheme(theme: CharacterTheme): void {
    this.colors = ThemeRenderer.buildColors(theme);
  }

  /** 获取颜色实例 */
  get primary(): ChalkInstance { return this.colors.primary; }
  get secondary(): ChalkInstance { return this.colors.secondary; }
  get accent(): ChalkInstance { return this.colors.accent; }
  get tagline(): ChalkInstance { return this.colors.tagline; }
  get dim(): ChalkInstance { return this.colors.dim; }
  get error(): ChalkInstance { return this.colors.error; }
  get success(): ChalkInstance { return this.colors.success; }
  get text(): ChalkInstance { return this.colors.text; }

  /** 渲染一个带颜色方块的色值预览 */
  renderColorBlock(hex: string, width: number = 6): string {
    const block = '█'.repeat(width);
    return chalk.hex(hex)(block);
  }
}
