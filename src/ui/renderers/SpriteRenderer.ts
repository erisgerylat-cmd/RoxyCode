import chalk from 'chalk';
import type { CharacterCompanion, CharacterTheme } from '../../aesthetic/character/types.js';

export type SpriteState = 'idle' | 'thinking' | 'success' | 'warning' | 'error';

export interface SpriteRenderOptions {
  companion: CharacterCompanion;
  theme: CharacterTheme;
  state?: SpriteState;
  frameIndex?: number;
  showLine?: boolean;
  aestheticMode?: 'minimal' | 'balanced' | 'immersive';
}

/**
 * 渲染角色 Companion 的 ASCII Sprite 到终端。
 *
 * 设计原则：
 * - minimal 模式不渲染 Sprite
 * - balanced 模式只在特殊节点渲染一次（success/warning）
 * - immersive 模式允许持续渲染动画帧
 */
export function renderSprite(options: SpriteRenderOptions): string {
  const { companion, theme, state = 'idle', frameIndex = 0, showLine = true, aestheticMode = 'balanced' } = options;

  // minimal 模式：完全不渲染
  if (aestheticMode === 'minimal') return '';

  // balanced 模式：只在 success/warning 节点渲染
  if (aestheticMode === 'balanced' && state === 'idle') return '';

  const frame = selectFrame(companion.art, frameIndex);
  if (!frame) return '';

  const line = showLine ? selectLine(companion, state) : '';
  const color = pickStateColor(theme, state);

  const lines: string[] = [];
  for (const artLine of frame.split('\n')) {
    lines.push(chalk.hex(color)(artLine));
  }

  if (line) {
    lines.push('');
    lines.push(chalk.hex(color).dim(`  ${companion.name}: `) + chalk.hex(theme.dim)(line));
  }

  return lines.join('\n');
}

/**
 * 提取单个动画帧（art 数组中每个元素是一帧，元素内部可含换行）
 */
function selectFrame(art: string[], index: number): string {
  if (!art.length) return '';
  return art[index % art.length] ?? art[0] ?? '';
}

/**
 * 根据当前状态选择对应台词
 */
function selectLine(companion: CharacterCompanion, state: SpriteState): string {
  const pool = (() => {
    switch (state) {
      case 'thinking':  return companion.thinkingLines;
      case 'success':   return companion.successLines;
      case 'warning':   return companion.warningLines;
      case 'idle':
      default:          return companion.idleLines;
    }
  })();

  if (!pool || pool.length === 0) {
    return companion.idleLines[0] ?? '';
  }

  // 使用基于当前秒的轻量随机，避免每次调用都变化
  const seed = Math.floor(Date.now() / 30_000);
  return pool[seed % pool.length] ?? pool[0] ?? '';
}

/**
 * 根据状态选择颜色
 */
function pickStateColor(theme: CharacterTheme, state: SpriteState): string {
  switch (state) {
    case 'success':   return theme.success;
    case 'warning':
    case 'error':     return theme.error;
    default:          return theme.primary;
  }
}
