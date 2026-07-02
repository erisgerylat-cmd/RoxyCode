/**
 * 命令注册表
 *
 * 管理所有 Slash 命令的注册与执行。
 * 对照 Claude Code：Claude Code 使用 Command 类型描述命令来源、执行类型、别名、启用状态，
 * 再由 commands.ts 聚合内置命令、skills、plugins、workflow。
 * RoxyCode 先保留轻量同步执行模型，但把这些元数据提前纳入命令定义，方便后续扩展。
 */

/** 命令分类 */
export type CommandCategory =
  | 'basic'       // 基础命令
  | 'dev'         // 开发辅助
  | 'workflow'    // 工作流
  | 'context'     // 上下文管理
  | 'character'   // 角色与个性化
  | 'debug'       // 调试与实验
  | 'system';     // 系统命令

/** 命令来源。对照 Claude Code 的 builtin/plugin/skills/workflow 来源标记，RoxyCode 先保留轻量版本。 */
export type CommandSource = 'builtin' | 'profile' | 'project' | 'skill' | 'workflow' | 'plugin' | 'custom';

/** 命令执行类型。RoxyCode 当前主要执行 local 命令，后续 prompt 命令可用于 Skill/工作流。 */
export type CommandExecutionType = 'local' | 'prompt';

/** 分类元数据 */
export interface CategoryMeta {
  label: string;
  icon: string;
  order: number;
}

/** 所有分类的默认元数据 */
export const DEFAULT_CATEGORY_META: Record<CommandCategory, CategoryMeta> = {
  basic:     { label: '基础命令',     icon: '⌘', order: 0 },
  dev:       { label: '开发辅助',     icon: '🛠', order: 1 },
  workflow:  { label: '工作流',       icon: '◇', order: 2 },
  context:   { label: '上下文管理',   icon: '📐', order: 3 },
  character: { label: '角色与个性化', icon: '🎭', order: 4 },
  debug:     { label: '调试与实验',   icon: '🔬', order: 5 },
  system:    { label: '系统命令',     icon: '⚙', order: 6 },
};

/** 根据语言覆盖分类显示名 */
export function getCategoryMeta(labels?: Partial<Record<CommandCategory, string>>): Record<CommandCategory, CategoryMeta> {
  return {
    basic:     { ...DEFAULT_CATEGORY_META.basic, label: labels?.basic ?? DEFAULT_CATEGORY_META.basic.label },
    dev:       { ...DEFAULT_CATEGORY_META.dev, label: labels?.dev ?? DEFAULT_CATEGORY_META.dev.label },
    workflow:  { ...DEFAULT_CATEGORY_META.workflow, label: labels?.workflow ?? DEFAULT_CATEGORY_META.workflow.label },
    context:   { ...DEFAULT_CATEGORY_META.context, label: labels?.context ?? DEFAULT_CATEGORY_META.context.label },
    character: { ...DEFAULT_CATEGORY_META.character, label: labels?.character ?? DEFAULT_CATEGORY_META.character.label },
    debug:     { ...DEFAULT_CATEGORY_META.debug, label: labels?.debug ?? DEFAULT_CATEGORY_META.debug.label },
    system:    { ...DEFAULT_CATEGORY_META.system, label: labels?.system ?? DEFAULT_CATEGORY_META.system.label },
  };
}

/** 命令处理器 */
export type CommandHandler = (args: string[], context: CommandContext) => Promise<void> | void;

/** 子命令/子选项定义（用于多级菜单） */
export interface SubcommandDefinition {
  /** 子命令名称（显示在菜单中，也作为命令参数） */
  name: string;
  /** 描述文字 */
  description: string;
  /** 是否还有下级菜单 */
  hasChildren?: boolean;
  /** 选中后是否需要用户手动输入参数（如数值） */
  needsInput?: boolean;
  /** 显示标签（可选，默认使用 name） */
  label?: string;
  /** 图标/前缀符号（可选） */
  icon?: string;
}

/** 命令定义 */
export interface CommandDefinition {
  name: string;
  description: string;
  aliases?: string[];
  /** 命令来源，用于帮助、命令面板和未来插件系统展示。 */
  source?: CommandSource;
  /** 命令执行类型。 */
  type?: CommandExecutionType;
  /** 是否在帮助和命令面板中隐藏。 */
  hidden?: boolean;
  /** 动态启用开关；默认启用。 */
  enabled?: () => boolean;
  /** 参数提示，供命令面板/帮助系统展示。 */
  argumentHint?: string;
  /** 命令分类 */
  category?: CommandCategory;
  /** 用法说明（简短） */
  usage?: string;
  /** 示例用法 */
  examples?: string[];
  /** 子命令/子选项（用于多级菜单） */
  subcommands?: SubcommandDefinition[];
  handler: CommandHandler;
}

/** 命令执行上下文 */
export interface CommandContext {
  [key: string]: unknown;
}

/** 命令注册表 */
export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();
  private aliases: Map<string, string> = new Map();

  /** 注册一个命令 */
  register(cmd: CommandDefinition): void {
    if (this.commands.has(cmd.name) || this.aliases.has(cmd.name)) {
      throw new Error(`Command already registered: /${cmd.name}`);
    }

    this.commands.set(cmd.name, {
      source: 'builtin',
      type: 'local',
      ...cmd,
    });

    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        if (this.commands.has(alias) || this.aliases.has(alias)) {
          throw new Error(`Command alias already registered: /${alias}`);
        }
        this.aliases.set(alias, cmd.name);
      }
    }
  }

  /** 批量注册命令，保持调用方聚合入口简洁。 */
  registerMany(commands: CommandDefinition[]): void {
    for (const command of commands) {
      this.register(command);
    }
  }

  /** Unregister a command or alias for dynamic command reload. */
  unregister(name: string): boolean {
    const resolved = this.aliases.get(name) ?? name;
    const command = this.commands.get(resolved);
    if (!command) return false;

    this.commands.delete(resolved);
    for (const [alias, target] of Array.from(this.aliases.entries())) {
      if (target === resolved || alias === name) this.aliases.delete(alias);
    }
    return true;
  }

  /** Unregister multiple commands and return the removed count. */
  unregisterMany(names: string[]): number {
    let removed = 0;
    for (const name of names) {
      if (this.unregister(name)) removed++;
    }
    return removed;
  }

  /** Unregister commands by source, used by workflow/plugin/skill reload. */
  unregisterBySource(source: CommandSource | CommandSource[]): number {
    const sources = new Set(Array.isArray(source) ? source : [source]);
    const names = Array.from(this.commands.values())
      .filter(command => sources.has(command.source ?? 'builtin'))
      .map(command => command.name);
    return this.unregisterMany(names);
  }

  /** Replace commands for a source and roll back if registration fails. */
  replaceBySource(source: CommandSource | CommandSource[], commands: CommandDefinition[]): { removed: number; registered: number } {
    const sources = new Set(Array.isArray(source) ? source : [source]);
    const previous = Array.from(this.commands.values()).filter(command => sources.has(command.source ?? 'builtin'));
    const removed = this.unregisterBySource(Array.from(sources));

    const registered: string[] = [];
    try {
      for (const command of commands) {
        this.register(command);
        registered.push(command.name);
      }
      return { removed, registered: commands.length };
    } catch (error) {
      this.unregisterMany(registered);
      this.registerMany(previous);
      throw error;
    }
  }

  /** 清空命令注册表，用于语言切换后重建命令文案 */
  clear(): void {
    this.commands.clear();
    this.aliases.clear();
  }

  /** 执行命令 */
  async execute(name: string, args: string[], context: CommandContext): Promise<boolean> {
    const resolved = this.aliases.get(name) ?? name;
    const cmd = this.commands.get(resolved);
    if (!cmd || cmd.enabled?.() === false) return false;
    await cmd.handler(args, context);
    return true;
  }

  /** 获取所有已注册命令 */
  list(options: { includeHidden?: boolean } = {}): CommandDefinition[] {
    return Array.from(this.commands.values()).filter(cmd => {
      if (cmd.enabled?.() === false) return false;
      if (!options.includeHidden && cmd.hidden) return false;
      return true;
    });
  }

  /** 按分类获取命令 */
  listByCategory(): Map<CommandCategory, CommandDefinition[]> {
    const grouped = new Map<CommandCategory, CommandDefinition[]>();

    for (const cmd of this.list()) {
      const cat = cmd.category ?? 'basic';
      if (!grouped.has(cat)) {
        grouped.set(cat, []);
      }
      grouped.get(cat)!.push(cmd);
    }

    return grouped;
  }

  /** 检查命令是否存在 */
  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  /** 根据名称获取命令定义 */
  get(name: string): CommandDefinition | undefined {
    const resolved = this.aliases.get(name) ?? name;
    const cmd = this.commands.get(resolved);
    if (!cmd || cmd.enabled?.() === false) return undefined;
    if (cmd.hidden) return undefined;
    return cmd;
  }
}
