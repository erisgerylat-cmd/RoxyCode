import chalk from 'chalk';
import type { Character } from '../../aesthetic/character/types.js';
import { DEFAULT_LANGUAGE, t, type Language } from '../../i18n/index.js';
import { renderSprite } from '../renderers/SpriteRenderer.js';

/**
 * RoxyCode 启动欢迎画面
 * 灵感来源：Claude Code 的 boxed splash screen
 * 中央展示 RoxyCode ASCII 艺术字（ANSI Shadow 风格）
 * 支持角色主题色驱动
 */

// ═══════════════════════════════════════════════════════════════
// RoxyCode ASCII Art — ANSI Shadow figlet 风格
// 清晰可辨认 "ROXY CODE"
// ═══════════════════════════════════════════════════════════════

const LOGO_ART = [
  '██████╗  ██████╗ ██╗  ██╗██╗   ██╗',
  '██╔══██╗██╔═══██╗╚██╗██╔╝╚██╗ ██╔╝',
  '██████╔╝██║   ██║ ╚███╔╝  ╚████╔╝ ',
  '██╔══██╗██║   ██║ ██╔██╗   ╚██╔╝  ',
  '██║  ██║╚██████╔╝██╔╝ ██╗   ██║   ',
  '╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝   ╚═╝   ',
  ' ██████╗ ██████╗ ██████╗ ███████╗ ',
  '██╔════╝██╔═══██╗██╔══██╗██╔════╝ ',
  '██║     ██║   ██║██║  ██║█████╗   ',
  '██║     ██║   ██║██║  ██║██╔══╝   ',
  '╚██████╗╚██████╔╝██████╔╝███████╗ ',
  ' ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝ ',
];

const DEFAULT_TAGLINE = '░▒▓  AI Programming Assistant  ▓▒░';

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function visibleLen(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padRight(str: string, len: number): string {
  const padding = Math.max(0, len - visibleLen(str));
  return str + ' '.repeat(padding);
}

function center(str: string, width: number): string {
  const padding = Math.max(0, Math.floor((width - visibleLen(str)) / 2));
  return ' '.repeat(padding) + str;
}

function fitPlain(str: string, width: number): string {
  if (visibleLen(str) <= width) return str;
  if (width <= 1) return '…'.slice(0, width);
  return str.slice(0, Math.max(0, width - 1)) + '…';
}

// ═══════════════════════════════════════════════════════════════
// 主题构建（从角色动态生成）
// ═══════════════════════════════════════════════════════════════

interface SplashTheme {
  border: (s: string) => string;
  title: (s: string) => string;
  logo: (s: string) => string;
  tagline: (s: string) => string;
  text: (s: string) => string;
  dim: (s: string) => string;
  highlight: (s: string) => string;
  tip: (s: string) => string;
  path: (s: string) => string;
  info: (s: string) => string;
}

/** 默认主题色（洛琪希水蓝色，向后兼容） */
const DEFAULT_THEME_COLORS = {
  primary:   '#5B9BD5',
  secondary: '#7EC8E3',
  accent:    '#FFD700',
  tagline:   '#98D8C8',
  dim:       '#888888',
};

function buildTheme(character?: Character): SplashTheme {
  const colors = character?.theme ?? DEFAULT_THEME_COLORS;
  return {
    border:    chalk.hex(colors.primary),
    title:     chalk.hex(colors.primary).bold,
    logo:      chalk.hex(colors.secondary).bold,
    tagline:   chalk.hex(colors.tagline),
    text:      chalk.white,
    dim:       chalk.hex(colors.dim),
    highlight: chalk.hex(colors.accent),
    tip:       chalk.hex(colors.tagline),
    path:      chalk.hex('#666666'),
    info:      chalk.hex(colors.primary),
  };
}

// ═══════════════════════════════════════════════════════════════
// 渲染主函数
// ═══════════════════════════════════════════════════════════════

export interface SplashOptions {
  version?: string;
  model?: string;
  provider?: string;
  cwd?: string;
  tips?: string[];
  whatsNew?: string[];
  character?: Character;
  startupQuote?: string;
  language?: Language;
  aestheticMode?: 'minimal' | 'balanced' | 'immersive';
}

export function renderSplash(options: SplashOptions = {}): string {
  const {
    version = '0.1.0',
    model = 'DeepSeek / Qwen / GLM',
    provider = '国产大模型',
    cwd = process.cwd(),
    character,
    startupQuote,
    language = DEFAULT_LANGUAGE,
    aestheticMode = 'balanced',
  } = options;

  const theme = buildTheme(character);
  const text = t(language).splash;

  const tips = options.tips ?? (language === 'zh-CN' ? character?.splash.tips : undefined) ?? text.defaultTips;

  const whatsNew = options.whatsNew ?? text.whatsNew;

  const tagline = (language === 'zh-CN' ? character?.splash.tagline : undefined) ?? text.tagline ?? DEFAULT_TAGLINE;
  const welcome = (language === 'zh-CN' ? character?.splash.welcome : undefined) ?? text.welcome;

  const termWidth = process.stdout.columns || 100;
  const boxWidth = Math.min(Math.max(termWidth - 4, 80), 120);
  const innerWidth = boxWidth - 2;

  // ── 左右分栏 ──
  const artWidth = 38;
  const divider = theme.border(' │ ');
  const dividerLen = 3;
  const rightWidth = innerWidth - artWidth - dividerLen;

  const lines: string[] = [];

  // ── 顶部边框 ──
  const title = ` RoxyCode v${version} `;
  const titlePad = boxWidth - 2 - visibleLen(title);
  const leftDash = '─'.repeat(Math.floor(titlePad / 2));
  const rightDash = '─'.repeat(Math.ceil(titlePad / 2));
  lines.push(theme.border('╭') + leftDash + theme.title(title) + rightDash + theme.border('╮'));

  // ── 构建右侧内容 ──
  const rightLines: string[] = [];
  rightLines.push('');
  rightLines.push(theme.highlight(fitPlain(`  ${text.tipsTitle}`, rightWidth)));
  tips.forEach(t => rightLines.push(theme.tip(fitPlain(`  ${t}`, rightWidth))));
  rightLines.push(theme.dim('  ' + '─'.repeat(Math.max(0, rightWidth - 6))));
  rightLines.push(theme.highlight(fitPlain(`  ${text.whatsNewTitle}`, rightWidth)));
  whatsNew.forEach(t => rightLines.push(theme.text(fitPlain(`  ${t}`, rightWidth))));

  // 左侧内容：logo + tagline + 欢迎语
  const leftLines: string[] = [];
  leftLines.push('');
  LOGO_ART.forEach(line => leftLines.push(theme.logo(center(line, artWidth))));
  leftLines.push('');
  leftLines.push(theme.tagline(center(tagline, artWidth)));
  leftLines.push('');
  leftLines.push(theme.highlight(center(welcome, artWidth)));
  leftLines.push(theme.path(center(cwd, artWidth)));

  // 补齐左右高度
  const maxHeight = Math.max(leftLines.length, rightLines.length);
  while (leftLines.length < maxHeight) leftLines.push('');
  while (rightLines.length < maxHeight) rightLines.push('');

  // ── 渲染每一行 ──
  for (let i = 0; i < maxHeight; i++) {
    const lLine = padRight(leftLines[i], artWidth);
    const rLine = padRight(rightLines[i], rightWidth);
    lines.push(theme.border('│') + lLine + divider + rLine + theme.border('│'));
  }

  // ── 底部边框 ──
  lines.push(theme.border('╰') + '─'.repeat(boxWidth - 2) + theme.border('╯'));

  // ── 底部信息栏 ──
  const infoText = ` ${model} · ${provider} · ${text.footerSwitch}`;
  lines.push(theme.info(' ▎') + theme.dim(infoText));

  // ── 启动台词彩蛋 ──
  if (startupQuote && character) {
    lines.push('');
    lines.push(theme.dim('  "') + theme.highlight(startupQuote) + theme.dim('"'));
    lines.push(theme.dim(`  —— ${character.name} · ${character.title}`));
  }

  // ── Pixel / ASCII 小伙伴 ──
  if (character?.companion) {
    const sprite = renderSprite({
      companion: character.companion,
      theme: character.theme,
      state: 'idle',
      showLine: aestheticMode === 'immersive',
      aestheticMode,
    });
    if (sprite) {
      lines.push('');
      lines.push(sprite);
    }
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// 快捷显示
// ═══════════════════════════════════════════════════════════════

export function showSplash(options?: SplashOptions): void {
  console.log(renderSplash(options));
  console.log();
}
