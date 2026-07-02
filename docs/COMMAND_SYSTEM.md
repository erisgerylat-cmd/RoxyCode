# RoxyCode 命令系统

本文记录 Command System 1.2 的实现结果，以及它与 Claude Code 命令体系的对应关系。

## 目标

RoxyCode 的 Slash 命令不再只是固定内置列表。Workflow、Plugin、Skill 都可以被动态发现，进入统一加载器，并在开发模式下热重载。

## Claude Code 对照

Claude Code 的相关实现主要分布在：

- `src/commands.ts`：`getCommands(cwd)` 聚合 builtin、skills、plugins、workflow、MCP prompts 和 dynamic skills。
- `src/utils/plugins/loadPluginCommands.ts`：把插件命令转换成 prompt-style slash command，并附带来源元数据。
- `src/skills/loadSkillsDir.ts`：扫描磁盘技能目录，把 Skill 元数据转成命令。
- `src/utils/skills/skillChangeDetector.ts`：监听技能文件变化，做 debounce、清缓存、通知 REPL 更新命令。
- `src/commands/reload-plugins/reload-plugins.ts`：在不中断会话的情况下刷新插件生态。

我们参考的核心不是某个类名，而是边界设计：所有命令来源必须先转换成同一个 Command contract，然后 REPL 的帮助、补全、面板和执行都只依赖这个统一结果。

## RoxyCode 实现

本次实现文件：

- `src/commands/sources/types.ts`：定义 `DynamicCommandSource`、`discover()`、可选 `watchPaths()`，并在加载上下文里加入 `reservedNames`。
- `src/commands/sources/WorkflowCommandSource.ts`：把 workflow 转成 `/wf:<id>` prompt 命令，workflow alias 会转成 `/wf:<alias>`。
- `src/commands/sources/PluginCommandSource.ts`：通过 `PluginLoader -> collectPluginContributions -> createPluginCommands` 加载插件命令。
- `src/commands/sources/SkillCommandSource.ts`：扫描 `.roxycode/skills/*/SKILL.md`，生成 `/skill:<name> [task]` 命令。
- `src/commands/CommandLoader.ts`：统一聚合动态来源，检测重复命令、别名冲突和内置命令保留名冲突。
- `src/commands/CommandRegistry.ts`：新增 `unregister`、`unregisterBySource`、`replaceBySource`，支持按来源原子替换动态命令。
- `src/commands/CommandWatcher.ts`：使用 Node `fs.watch` 做开发态热重载，支持 debounce 和手动触发。
- `src/ui/repl/REPL.ts`：把动态命令、hooks、plugins、MCP runtime state 统一放进异步刷新路径。

## 加载流程

```text
REPL 启动或 /config reload
  -> createDynamicCommandLoader()
  -> WorkflowCommandSource.discover()
  -> PluginCommandSource.discover()
  -> SkillCommandSource.discover()
  -> CommandLoader.load({ reservedNames })
  -> CommandRegistry.registerMany(dynamicCommands)
  -> 同步 help / command palette / tab completion
```

开发态热重载：

```text
ROXY_COMMAND_WATCH=1 pnpm start
  -> CommandWatcher.start()
  -> fs.watch(workflow/plugin/skill directories)
  -> debounce change events
  -> CommandLoader.load()
  -> CommandRegistry.replaceBySource(['workflow', 'plugin', 'skill'], commands)
  -> 同步 help / command palette / tab completion
```

## 安全与稳定性选择

- 动态命令不能覆盖内置命令。`CommandLoader` 会接收内置命令名和别名作为 `reservedNames`。
- 动态命令刷新失败会回滚到上一组动态命令，避免把会话命令表刷坏。
- 来源发现错误会被收集到 errors，不会直接打断 REPL 启动。
- 热重载只在开发态开启：`ROXY_COMMAND_WATCH=1`、`ROXY_DEV=1` 或 `NODE_ENV=development`。

## RoxyCode 优化点

Claude Code 的命令生态更成熟，缓存、插件市场和 skill 监听都更完整。RoxyCode 当前选择轻量实现，是为了在不引入额外依赖的情况下先把扩展边界立住：

- workflow 可以直接成为 `/wf:<id>`，中文业务流程不必藏在二级菜单里；
- plugin、skill、workflow 共用一个 loader，后续接 MCP prompt 命令时不需要再改 REPL 主流程；
- 命令元数据保留中文说明、角色风格、教学友好 prompt 的扩展空间；
- 使用原生 `fs.watch`，先满足 Windows/IDE 终端里的开发体验，等插件生态更复杂后再升级为 chokidar 风格 watcher。

## 当前限制

- MCP prompt 命令还没有合并进 Slash 命令表。
- 原生 `fs.watch` 在非 Windows 平台对深层目录递归监听能力较弱，后续插件目录复杂后需要升级。
- 插件 marketplace、依赖缓存、远程命令过滤仍是后续任务。
