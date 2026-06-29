/**
 * 命令面板 (Claude Code 风格 — 多级菜单)
 *
 * 当用户输入 `/` 时在终端显示浮动命令选择列表：
 * - ↑/↓ 方向键导航
 * - Enter 确认选择
 * - Esc 返回上级 / 关闭面板
 * - 输入过滤列表
 * - 多级菜单（子命令导航）
 * - 面包屑路径显示
 * - 分类显示 + 描述
 * - 主题色驱动
 */

import chalk from 'chalk';
import { DEFAULT_CATEGORY_META, type CommandCategory } from '../../commands/CommandRegistry.js';

/** 面板中显示的通用项目 */
export interface PaletteItem {
  /** 项目标识名（用于命令解析） */
  name: string;
  /** 描述文字 */
  description: string;
  /** 别名列表（仅顶级命令使用） */
  aliases: string[];
  /** 分类（仅顶级命令使用） */
  category: CommandCategory;
  /** 是否有下级菜单（显示 ▶ 箭头） */
  hasChildren?: boolean;
  /** 选中后是否需要用户手动输入（不自动执行） */
  needsInput?: boolean;
  /** 自定义显示标签 */
  label?: string;
  /** 自定义图标 */
  icon?: string;
}

/** 面板选项 */
export interface PaletteOptions {
  /** 最大可见行数 */
  maxVisible?: number;
  /** 终端宽度 */
  width?: number;
}

/** 菜单级别状态 */
interface MenuLevel {
  /** 级别标签（如 "character", "context"） */
  label: string;
  /** 该级别的项目列表 */
  items: PaletteItem[];
  /** 进入此级别时的完整输入文本 */
  bufferText: string;
}

/**
 * 命令面板
 *
 * 在输入行下方渲染浮动列表，支持：
 * - 过滤搜索
 * - 方向键导航
 * - 多级菜单（子命令）
 * - 面包屑路径
 * - 高亮选中项
 */
export class CommandPalette {
  private items: PaletteItem[] = [];
  private filtered: PaletteItem[] = [];
  private selectedIndex: number = 0;
  private renderedRows: number = 0;
  private query: string = '';
  private options: PaletteOptions;
  /** 菜单级别栈（空 = 顶级命令列表） */
  private levelStack: MenuLevel[] = [];

  constructor(options: PaletteOptions = {}) {
    this.options = {
      maxVisible: options.maxVisible ?? 10,
      width: options.width ?? 0,
    };
  }

  /** 设置可用命令列表（顶级） */
  setItems(items: PaletteItem[]): void {
    this.items = items;
  }

  /** 是否可见（有过滤结果） */
  get visible(): boolean {
    return this.filtered.length > 0;
  }

  /** 当前选中项 */
  get selected(): PaletteItem | null {
    return this.filtered[this.selectedIndex] ?? null;
  }

  /** 获取当前过滤后的列表 */
  get filteredItems(): PaletteItem[] {
    return [...this.filtered];
  }

  /** 获取选中索引 */
  get currentIndex(): number {
    return this.selectedIndex;
  }

  /** 当前是否在子菜单级别 */
  get isSubLevel(): boolean {
    return this.levelStack.length > 0;
  }

  /** 当前菜单深度 */
  get depth(): number {
    return this.levelStack.length;
  }

  /** 获取面包屑路径 */
  get breadcrumbs(): string[] {
    return this.levelStack.map(l => l.label);
  }

  // ─── 过滤 ──────────────────────────────────────────────

  /** 根据查询词过滤当前级别的项目列表 */
  filter(query: string): void {
    this.query = query.toLowerCase();
    const sourceItems = this.levelStack.length > 0
      ? this.levelStack[this.levelStack.length - 1].items
      : this.items;

    if (!this.query) {
      this.filtered = [...sourceItems];
    } else {
      this.filtered = sourceItems.filter(item => {
        const displayName = (item.label || item.name).toLowerCase();
        const rawName = item.name.toLowerCase();
        if (displayName.startsWith(this.query)) return true;
        if (rawName.startsWith(this.query)) return true;
        if (item.aliases.some(a => a.toLowerCase().startsWith(this.query))) return true;
        if (displayName.includes(this.query)) return true;
        if (rawName.includes(this.query)) return true;
        // 也在描述中搜索
        if (item.description.toLowerCase().includes(this.query)) return true;
        return false;
      });

      // 排序：前缀匹配优先
      this.filtered.sort((a, b) => {
        const aName = `${a.name} ${a.label ?? ''}`.toLowerCase();
        const bName = `${b.name} ${b.label ?? ''}`.toLowerCase();
        const aStarts = aName.startsWith(this.query) ? 0 : 1;
        const bStarts = bName.startsWith(this.query) ? 0 : 1;
        return aStarts - bStarts;
      });
    }

    // 确保选中项在可见范围内
    if (this.selectedIndex >= this.filtered.length) {
      this.selectedIndex = Math.max(0, this.filtered.length - 1);
    }
  }

  // ─── 导航 ──────────────────────────────────────────────

  /** 向上移动选中项 */
  moveUp(): void {
    if (this.filtered.length === 0) return;
    this.selectedIndex = this.selectedIndex > 0
      ? this.selectedIndex - 1
      : this.filtered.length - 1;
  }

  /** 向下移动选中项 */
  moveDown(): void {
    if (this.filtered.length === 0) return;
    this.selectedIndex = this.selectedIndex < this.filtered.length - 1
      ? this.selectedIndex + 1
      : 0;
  }

  // ─── 多级菜单管理 ──────────────────────────────────────

  /**
   * 进入子菜单级别
   *
   * @param label 级别标签（如命令名）
   * @param items 该级别的项目列表
   * @param bufferText 进入时的输入文本
   */
  pushLevel(label: string, items: PaletteItem[], bufferText: string): void {
    // 保存当前状态到栈
    this.levelStack.push({
      label,
      items,
      bufferText,
    });
    this.selectedIndex = 0;
    this.query = '';
    this.filtered = [...items];
  }

  /**
   * 返回上一级菜单
   *
   * @returns 返回的级别的 bufferText（用于恢复输入框文本），null 表示已在顶级
   */
  popLevel(): string | null {
    if (this.levelStack.length === 0) return null;
    const popped = this.levelStack.pop()!;
    this.selectedIndex = 0;
    this.query = '';

    // 恢复到上一级的项目列表
    if (this.levelStack.length > 0) {
      const parent = this.levelStack[this.levelStack.length - 1];
      this.filtered = [...parent.items];
      return parent.bufferText;
    } else {
      this.filtered = [...this.items];
      return null; // 回到顶级
    }
  }

  /** 完全重置状态 */
  reset(): void {
    this.selectedIndex = 0;
    this.query = '';
    this.filtered = [];
    this.renderedRows = 0;
    this.levelStack = [];
  }

  // ─── 渲染 ────────────────────────────────────────────────

  /** 渲染面板到终端（在输入行下方） */
  render(theme: {
    primary: string;
    secondary: string;
    accent: string;
    dim: string;
  }): void {
    // 先清除上一次的渲染
    this.clear();

    if (this.filtered.length === 0) {
      this.renderedRows = 0;
      return;
    }

    const maxVisible = this.options.maxVisible!;
    const terminalWidth = this.options.width || process.stdout.columns || 80;
    const boxWidth = Math.min(terminalWidth - 4, 62);

    // 计算可见范围（滚动窗口）
    let startIdx = 0;
    if (this.selectedIndex >= maxVisible) {
      startIdx = this.selectedIndex - maxVisible + 1;
    }
    const endIdx = Math.min(startIdx + maxVisible, this.filtered.length);
    const visibleItems = this.filtered.slice(startIdx, endIdx);

    const border = chalk.hex(theme.primary);
    const accent = chalk.hex(theme.accent);
    const dim = chalk.dim;

    const lines: string[] = [];

    // ── 面包屑路径（子菜单时显示） ──
    if (this.levelStack.length > 0) {
      const crumbs = this.levelStack.map(l => l.label).join(' › ');
      const crumbLine = ` ← ${crumbs}`;
      lines.push(border(`  │`) + dim(crumbLine.padEnd(boxWidth - 3)) + border('│'));
      lines.push(border(`  │`) + dim('─'.repeat(boxWidth - 3)) + border('│'));
    }

    // ── 项目列表 ──
    let lastCategory: CommandCategory | null = null;
    let itemCount = 0;

    for (let i = 0; i < visibleItems.length; i++) {
      const item = visibleItems[i];
      const globalIndex = startIdx + i;
      const isSelected = globalIndex === this.selectedIndex;

      // 分类标题（仅顶级时显示，当分类变化时）
      if (this.levelStack.length === 0 && item.category !== lastCategory) {
        lastCategory = item.category;
        const meta = DEFAULT_CATEGORY_META[item.category];
        if (meta) {
          if (itemCount > 0) {
            lines.push(border(`  │`) + dim('─'.repeat(boxWidth - 3)) + border('│'));
          }
          const catLine = ` ${meta.icon} ${meta.label}`;
          lines.push(border(`  │`) + dim(catLine.padEnd(boxWidth - 3)) + border('│'));
          itemCount = 0;
        }
      }

      // 项目行
      const displayName = item.label || `/${item.name}`;
      const icon = item.icon ? `${item.icon} ` : '';
      const childArrow = item.hasChildren ? chalk.dim(' ›') : '';

      const fixedNameWidth = 18;
      const nameStr = icon + displayName;
      const namePad = Math.max(1, fixedNameWidth - nameStr.length);

      const descMaxLen = boxWidth - fixedNameWidth - 8;
      const desc = item.description.length > descMaxLen
        ? item.description.slice(0, descMaxLen - 1) + '…'
        : item.description;

      if (isSelected) {
        // 选中行：背景高亮
        const arrow = accent(' ▸ ');
        const name = chalk.bgHex(theme.primary).black.bold(` ${nameStr} `);
        const padding = ' '.repeat(Math.max(1, namePad - 1));
        const descCol = chalk.bgHex(theme.primary).black(` ${desc}`);
        const arrowCol = item.hasChildren ? chalk.bgHex(theme.primary).black(' ›') : '';
        const fill = ' '.repeat(Math.max(0, boxWidth - fixedNameWidth - desc.length - 6));

        lines.push(border('  │') + arrow + name + padding + descCol + arrowCol + fill + border('│'));
      } else {
        // 普通行
        const arrow = '   ';
        const name = chalk.white(` ${nameStr}`);
        const padding = ' '.repeat(Math.max(1, namePad));
        const descCol = dim(` ${desc}`);
        const fill = ' '.repeat(Math.max(0, boxWidth - fixedNameWidth - desc.length - 5));

        lines.push(border('  │') + arrow + name + padding + descCol + childArrow + fill + border('│'));
      }

      itemCount++;
    }

    // ── 底部状态栏 ──
    const scrollIndicator = this.filtered.length > maxVisible
      ? dim(` ${startIdx + 1}-${endIdx}/${this.filtered.length}`)
      : dim(` ${this.filtered.length} 项`);

    const navParts: string[] = [dim(' ↑↓ 选择'), dim(' ↵ 确认')];
    if (this.levelStack.length > 0) {
      navParts.push(dim(' Esc 返回'));
    } else {
      navParts.push(dim(' Esc 关闭'));
    }
    const navHint = navParts.join(dim(' · '));

    const statusContent = scrollIndicator + navHint;
    const statusPad = Math.max(0, boxWidth - visibleLen(statusContent));
    lines.push(border(`  ├`) + '─'.repeat(boxWidth) + border('┤'));
    lines.push(border(`  │`) + statusContent + ' '.repeat(statusPad) + border('│'));

    // ── 边框 ──
    const topBorder = border(`  ┌`) + '─'.repeat(boxWidth) + border('┐');
    const bottomBorder = border(`  └`) + '─'.repeat(boxWidth) + border('┘');

    // 输出
    process.stdout.write('\n' + topBorder + '\n');
    for (const line of lines) {
      process.stdout.write(line + '\n');
    }
    process.stdout.write(bottomBorder + '\n');

    this.renderedRows = lines.length + 3; // +3 = top border + bottom border + leading newline

    // 将光标移回输入行
    process.stdout.write(`\x1b[${this.renderedRows}A`);
  }

  /** 清除面板渲染（通过 ANSI 擦除） */
  clear(): void {
    if (this.renderedRows === 0) return;

    // 向下移到面板第一行，然后逐行清除
    process.stdout.write(`\x1b[${1}B`);

    for (let i = 0; i < this.renderedRows; i++) {
      process.stdout.write('\x1b[2K');
      if (i < this.renderedRows - 1) {
        process.stdout.write('\x1b[1B');
      }
    }

    // 回到输入行
    process.stdout.write(`\x1b[${this.renderedRows}A`);
    process.stdout.write('\r');

    this.renderedRows = 0;
  }

  /** 面板是否正在显示 */
  get isRendered(): boolean {
    return this.renderedRows > 0;
  }
}

// ─── 工具函数 ─────────────────────────────────────────────

/** 获取字符串的可见长度 */
function visibleLen(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}
