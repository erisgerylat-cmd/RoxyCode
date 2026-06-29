# RoxyCode 工程级 Agent 设计学习总结

本文档总结截至当前代码状态，RoxyCode 已完成的主要工程能力、每一步的实现细节，以及与 Claude Code 源码的对应关系。目标不是只记录“做了什么”，而是帮助理解一个工程级 coding agent 应该如何拆层、如何串联命令、上下文、工具、权限、模型、记忆和工作流。

Claude Code 参考源码位置：

```text
D:\Programing\cc\claude-code-main
```

RoxyCode 当前核心源码位置：

```text
D:\Programing\RoxyCode\src
```

## 1. 产品定位与总体架构

RoxyCode 当前产品方向是：

> 二次元可定制、中文优先、国产模型友好、教学友好的 AI 编程工作台。

它不是简单复刻 Claude Code，而是学习 Claude Code 的成熟 agentic coding 骨架，再把中文用户、角色系统、个人定制、学习型记忆和中文业务工作流做成产品特色。

当前 RoxyCode 已形成这些主要层次：

```text
CLI 入口
  -> Config / i18n / Character / LLM / Context 初始化
  -> Splash 启动页
  -> REPL 交互循环
  -> Slash Command 系统
  -> Agent Loop
  -> ToolRegistry -> PermissionGuard -> Executor -> AuditLog
  -> Session / Context / Memory / Workflow
```

对应 Claude Code 的设计思想：

- Claude Code 不是一个“单 prompt CLI”，而是由命令系统、工具系统、权限系统、会话上下文、模型流式循环、Skill/Plugin 扩展共同组成。
- RoxyCode 当前采用同样的工程拆层，但在用户体验上走中文和角色定制路线。

## 2. CLI 入口与启动流程

RoxyCode 实现位置：

- `src/index.ts`
- `src/core/ConfigManager.ts`
- `src/ui/splash/SplashRenderer.ts`
- `src/ui/repl/REPL.ts`

实现细节：

1. CLI 启动后加载配置。
2. 初始化角色管理器。
3. 初始化 LLM Provider。
4. 初始化上下文管理器。
5. 渲染 Splash 启动页。
6. 进入 REPL 主循环。

这一层的关键价值是：所有运行时依赖在入口处组装，REPL 不自己创建全局配置，不把系统变成难以测试的隐式单例。

Claude Code 对应参考：

- `src/cli.tsx`
- `src/bootstrap/*`
- `src/bootstrap/state.ts`

Claude Code 的设计重点：

- 启动时构建 app state。
- 集中管理 session、settings、tools、commands、plugins、hooks 等运行时状态。
- CLI 入口尽量只做编排，具体能力下沉到模块。

RoxyCode 的取舍：

- 当前 RoxyCode 的 bootstrap 比 Claude Code 简化很多。
- 但已经具备“入口组装依赖”的骨架，后续可以继续演进为更集中化的 RuntimeState。

## 3. 配置系统

RoxyCode 实现位置：

- `src/core/ConfigManager.ts`
- `src/core/types/config.ts`

已实现能力：

- 默认配置 `DEFAULT_CONFIG`
- 全局配置：`~/.roxycode/config.json`
- 项目配置：`<cwd>/.roxycode/config.json`
- 项目配置覆盖全局配置，全局配置覆盖默认配置
- 支持点路径读取和写入，例如：

```text
ui.language
llm.provider
character.current
memory.auto
workflows.directories
```

当前配置覆盖范围包括：

- 角色
- LLM
- UI 语言
- 推理模式
- 安全策略
- 工具启用
- Skill 目录
- Workflow 目录
- Memory 自动提取
- Context 压缩
- Hook 目录

Claude Code 对应参考：

- `src/utils/settings/*`
- `src/utils/settings/constants.ts`
- `src/utils/settings/managedPath.ts`
- `src/commands/config/*`

Claude Code 的设计重点：

- 多来源 settings：user、project、local、policy、managed、flags。
- settings 不只是 key/value，而是权限、策略、来源优先级共同作用。

RoxyCode 的取舍：

- 目前只做 global/project 两层。
- 好处是更容易学习和调试。
- 后续如果引入团队策略、企业策略、插件策略，可以参考 Claude Code 的 SettingSource 模型继续扩展。

## 4. 双语言机制

RoxyCode 实现位置：

- `src/i18n/index.ts`
- `/language` 命令位于 `src/commands/builtin/index.ts`

已实现能力：

- 默认中文。
- 支持 `/language zh` 和 `/language en`。
- 核心菜单、命令说明、状态栏、部分提示文案双语化。
- `normalizeLanguage()` 统一处理用户输入。

Claude Code 对应参考：

- Claude Code 本体主要是英文产品，没有完整中文本地化机制。
- 可参考其 output style / theme / statusline 的可配置思想，而不是直接照搬 i18n。

RoxyCode 的优化点：

- 中文是默认体验，不是翻译补丁。
- 后续中文确认提示、中文工作流、中文教学解释都会依赖这一层。

## 5. 角色系统与二次元定制体验

RoxyCode 实现位置：

- `src/aesthetic/character/types.ts`
- `src/aesthetic/character/CharacterManager.ts`
- `src/aesthetic/character/characters/*`
- `src/commands/builtin/character.ts`
- `src/ui/renderers/CharacterArt.ts`
- `src/ui/easter-eggs/*`

已实现能力：

- 内置角色：
  - Roxy
  - Rudeus
  - Eris
  - Sylphiette
  - Nanahoshi
- 每个角色有：
  - 名称
  - 标题
  - 描述
  - 主题色
  - 状态文案
  - 启动台词
  - 错误提示风格
- `/character` 命令可切换角色。
- Splash、状态栏、权限提示和 Agent System Prompt 会读取当前角色。

Claude Code 对应参考：

- `src/commands/theme/*`
- `src/commands/output-style/*`
- `src/commands/statusline.js`

Claude Code 的设计重点：

- 允许用户改变输出风格、主题、状态栏。
- 但 Claude Code 不把“角色人格”作为核心产品层。

RoxyCode 的优化点：

- 角色不仅影响颜色，也影响用户体验、权限解释、教学风格和未来 workflow 偏好。
- 注意边界：角色只能影响表达风格，不能改变安全规则。这一点与 Claude Code 的安全策略一致。

## 6. Splash 启动页与状态体验

RoxyCode 实现位置：

- `src/ui/splash/SplashRenderer.ts`
- `src/ui/renderers/StatusBar.ts`
- `src/ui/renderers/InteractionRenderer.ts`
- `STATUS_BAR.md`

已实现能力：

- Claude Code 风格启动框。
- RoxyCode ASCII 艺术字。
- 中文 tips / what's new。
- 当前角色、模型、路径、语言状态显示。
- REPL prompt 前显示类似状态栏的信息。

Claude Code 对应参考：

- Claude Code CLI 启动页和状态栏体验。
- `src/commands/status/index.js`
- `src/commands/statusline.js`
- UI 组件主要在 `src/components/*`

Claude Code 的设计重点：

- 终端 UI 不只是打印文本，而是持续提供当前模型、上下文、路径、模式等运行状态。

RoxyCode 的取舍：

- 当前使用 chalk 和自定义 renderer 实现轻量 TUI。
- 没有引入 React Ink 类渲染框架，降低复杂度。
- 后续如果 UI 状态变复杂，可以参考 Claude Code 的组件化渲染方式。

## 7. REPL 输入体验

RoxyCode 实现位置：

- `src/ui/repl/REPL.ts`
- `src/ui/repl/RawLineReader.ts`
- `src/ui/repl/CommandPalette.ts`
- `src/ui/repl/InputHandler.ts`

已实现能力：

- 原始按键读取。
- `/` 命令面板。
- Tab 补全。
- 输入历史。
- 子命令菜单。
- 非 TTY fallback。
- 用户输入渲染。
- 命令执行结果渲染。
- Agent 流式输出事件渲染。

Claude Code 对应参考：

- `src/utils/processUserInput/*`
- `src/components/*`
- `src/commands/*`

Claude Code 的设计重点：

- 用户输入不是简单 readline。
- Slash command、prompt command、工具结果、模型流式输出、权限确认都要进入同一个交互状态机。

RoxyCode 的取舍：

- 当前 REPL 已具备工程骨架，但还没有 Claude Code 那样完整的队列、复杂 UI 状态和多模态输入。
- 但核心方向正确：输入层不直接处理业务逻辑，而是分发到 Command 或 Agent Loop。

## 8. Slash Command 系统

RoxyCode 实现位置：

- `src/commands/CommandRegistry.ts`
- `src/commands/CommandParser.ts`
- `src/commands/builtin/index.ts`
- `src/commands/builtin/*`

已实现命令类型：

- `/help`
- `/clear`
- `/context`
- `/compact`
- `/memory`
- `/workflow`
- `/resume`
- `/export`
- `/rewind`
- `/model`
- `/status`
- `/optimize`
- `/project`
- `/profile`
- `/character`
- `/party`
- `/demon-eye`
- `/telepathy`
- `/history`
- `/language`
- `/config`
- `/version`
- `/exit`

命令元数据包括：

- `name`
- `description`
- `aliases`
- `source`
- `type`
- `hidden`
- `enabled`
- `argumentHint`
- `category`
- `usage`
- `examples`
- `subcommands`
- `handler`

Claude Code 对应参考：

- `src/commands.ts`
- `src/types/command.ts`

Claude Code 的设计重点：

- 命令不只是函数表。
- 每个命令都有来源、类型、可用性、隐藏状态、参数提示、是否用户可调用等元数据。
- 命令来源包括 builtin、plugin、skills、workflow、mcp 等。

RoxyCode 的取舍：

- 当前命令系统比 Claude Code 简化。
- 但已经引入 `source`、`type`、`category` 等关键扩展点。
- 这为后续动态 Skill、Plugin Command、Workflow Command 打基础。

## 9. Profile 个人定制系统

RoxyCode 实现位置：

- `src/profile/types.ts`
- `src/profile/ProfileInitializer.ts`
- `src/commands/builtin/profile.ts`

已实现能力：

- `/profile init`
- 生成 `.roxycode/profile.json`
- 记录用户偏好：
  - 语言
  - 技术栈
  - 解释深度
  - 默认角色
  - 模型策略
  - 审美模式
  - 备注

Claude Code 对应参考：

- `CLAUDE.md`
- settings
- memory
- output-style

Claude Code 的设计重点：

- Claude Code 会通过项目说明、用户设置、记忆影响模型行为。
- 但它没有把“个人 Claude Code 产品化”作为显式入口。

RoxyCode 的优化点：

- `/profile init` 把用户画像产品化。
- 它不是一个普通配置文件，而是未来个性化 prompt、默认角色、解释深度和模型策略的基础。

## 10. Project 项目画像系统

RoxyCode 实现位置：

- `src/project/types.ts`
- `src/project/ProjectInitializer.ts`
- `src/commands/builtin/project.ts`

已实现能力：

- `/project init`
- 生成：
  - `ROXY.md`
  - `.roxycode/project.json`
- 扫描项目：
  - 包管理器
  - 语言
  - 框架
  - scripts
  - source dirs
  - test dirs

Claude Code 对应参考：

- `CLAUDE.md`
- `src/commands/init.js`
- `src/utils/markdownConfigLoader.js`

Claude Code 的设计重点：

- `CLAUDE.md` 是项目级指导的核心入口。
- 模型必须能读取项目约定，而不是每次从零猜测。

RoxyCode 的优化点：

- 同时生成自然语言 `ROXY.md` 和结构化 `.roxycode/project.json`。
- 结构化画像更适合国产模型和后续工具逻辑读取。

## 11. LLM Provider 系统

RoxyCode 实现位置：

- `src/core/types/llm.ts`
- `src/engine/llm/BaseLLMProvider.ts`
- `src/engine/llm/OpenAIProvider.ts`
- `src/engine/llm/QwenProvider.ts`
- `src/engine/llm/DeepSeekProvider.ts`
- `src/engine/llm/GLMProvider.ts`
- `src/engine/llm/LLMFactory.ts`

已实现能力：

- 统一 LLMProvider 接口。
- OpenAI-compatible 基类。
- Qwen / DeepSeek / GLM / OpenAI Provider。
- 支持 chat。
- 支持 chatStream。
- 支持工具调用 chunk。
- 支持基本错误类型。

Claude Code 对应参考：

- `src/utils/model/*`
- `src/services/*`
- query/tool streaming 相关逻辑

Claude Code 的设计重点：

- 模型调用不是一次性 `complete()`。
- 它需要支持流式输出、tool_use、tool_result、重试、模型切换、上下文预算、权限中断。

RoxyCode 的取舍：

- 选择 OpenAI-compatible 作为第一优先协议。
- 这样 Qwen、DeepSeek、GLM 等国产模型可以用同一套协议适配。
- 这是 RoxyCode 面向中文和国产模型的重要产品取舍。

## 12. Tool 工具系统

RoxyCode 实现位置：

- `src/tool/types.ts`
- `src/tool/registry/ToolRegistry.ts`
- `src/tool/permission/PermissionGuard.ts`
- `src/tool/executor/ToolExecutor.ts`
- `src/tool/audit/AuditLog.ts`
- `src/tool/builtin/*`

已实现工具：

- `read_file`
- `write_file`
- `edit_file`
- `list_directory`
- `grep_search`
- `execute_command`
- `git`

统一执行链路：

```text
ToolRegistry
  -> PermissionGuard
  -> ToolExecutor
  -> AuditLog
```

工具执行上下文包括：

- `cwd`
- `sessionId`
- `config`
- `language`
- `permissionMode`
- `signal`
- `characterId`
- `confirm`
- `confirmSecond`

Claude Code 对应参考：

- `src/tools/*`
- `src/Tool.ts`
- `src/hooks/useCanUseTool.js`
- 权限判断和工具调用相关模块

Claude Code 的设计重点：

- 工具调用是 coding agent 的核心能力。
- 工具必须经过权限系统。
- 模型不能直接任意写文件或执行命令。

RoxyCode 的取舍：

- 当前工具系统已经具备统一链路。
- 工具结果格式更偏中文和国产模型友好。
- 初学者模式可以在工具结果中解释发生了什么。

## 13. 权限与安全系统

RoxyCode 实现位置：

- `src/tool/security/SecurityPolicy.ts`
- `src/tool/security/ShellSafety.ts`
- `src/tool/security/FileBackup.ts`
- `src/tool/security/DangerExplainer.ts`
- `src/tool/permission/PermissionGuard.ts`
- `src/ui/repl/PermissionConfirmPanel.ts`

已实现能力：

- 默认限制在当前项目路径内。
- Shell 白名单和确认机制。
- 写文件前备份。
- 高危操作二次确认。
- 中文危险解释。
- 权限确认面板支持：
  - 允许
  - 拒绝
  - 二次确认

Claude Code 对应参考：

- `src/tools/*`
- `src/hooks/useCanUseTool.js`
- `src/utils/permissions/*`

Claude Code 的设计重点：

- 权限路径不可绕过。
- 工具调用前必须判断当前操作是否允许。
- 高风险操作和外部命令需要用户确认。

RoxyCode 的优化点：

- 中文解释“为什么危险”。
- 可根据角色风格定制提示，但不改变安全结果。
- 这让初学者不仅知道“被拦了”，还知道“为什么不能这么做”。

## 14. Agent Loop

RoxyCode 实现位置：

- `src/engine/agent/types.ts`
- `src/engine/agent/modes.ts`
- `src/engine/agent/prompts.ts`
- `src/engine/agent/RuntimeContext.ts`
- `src/engine/agent/AgentLoop.ts`

已实现四档模式：

- Lite：单轮问答，不主动调用工具。
- Economic：ReAct 工具循环，控制工具调用次数。
- Standard：计划 -> 执行 -> 验证。
- Ultimate：多 Agent 并行分析 -> 执行 -> 验证。

Agent Loop 执行流程：

```text
build system prompt
  -> load runtime context
  -> optional parallel agents
  -> optional planning
  -> model stream
  -> tool call
  -> permission confirm
  -> tool result
  -> continue loop
  -> optional verification
  -> done
```

Claude Code 对应参考：

- query/tool/result 流式循环相关源码
- `src/utils/processUserInput/*`
- `src/tools/*`
- `src/types/command.ts`

Claude Code 的设计重点：

- 模型输出、tool_use、tool_result 是一个循环。
- 不是“模型回答一次就结束”。
- Agent 必须能根据工具结果继续推理。

RoxyCode 的优化点：

- 四档模式显式化，降低中文用户理解成本。
- 用户能明确知道 Lite/Economic/Standard/Ultimate 的能力边界和成本差异。

## 15. Runtime Context 上下文注入

RoxyCode 实现位置：

- `src/engine/agent/RuntimeContext.ts`

已注入内容：

- `ROXY.md`
- `.roxycode/project.json`
- `.roxycode/profile.json`
- Memory 摘要
- Workflow 摘要

注入原则：

- 项目规则优先于个人偏好。
- 安全规则优先于项目和个人。
- Memory 可能过期，涉及代码事实必须先验证。
- Workflow 摘要只告诉模型有哪些流程，不把完整流程塞入上下文。

Claude Code 对应参考：

- `src/utils/markdownConfigLoader.js`
- `CLAUDE.md` 加载逻辑
- Skill discovery / invoked skill 相关逻辑

Claude Code 的设计重点：

- 模型上下文必须包含项目规则。
- Skill/Memory/Settings 都是模型行为的重要输入。

RoxyCode 的优化点：

- 同时支持项目画像、个人画像、记忆和中文工作流。
- 这是“个人 Claude Code”产品化的关键。

## 16. Context 压缩系统

RoxyCode 实现位置：

- `src/session/context/ContextManager.ts`
- `src/session/context/strategies/TruncationStrategy.ts`
- `src/session/context/strategies/SummaryStrategy.ts`

已实现能力：

- 上下文 token 状态估算。
- 最大 token 配置。
- 自动压缩阈值。
- 截断策略。
- 摘要压缩策略。
- `/compact` 手动压缩。

Claude Code 对应参考：

- Claude Code 的 compaction / context management 相关模块。
- `/compact` 命令。
- session resume 和上下文恢复逻辑。

Claude Code 的设计重点：

- 长会话一定会撞上下文限制。
- 成熟 Agent 必须有压缩和恢复能力，而不是简单丢弃历史。

RoxyCode 的取舍：

- 当前摘要压缩已经从简单截断升级。
- 后续还需要 working set、检索式上下文、文件级上下文缓存。

## 17. Session JSONL 会话系统

RoxyCode 实现位置：

- `src/session/store/SessionStore.ts`
- `/resume`
- `/export`
- `/rewind`

已实现能力：

- JSONL 保存会话事件。
- 保存 meta、user、assistant、tool、command、compact、rewind 等事件。
- `/resume` 恢复会话。
- `/export` 导出 text/jsonl。
- `/rewind` 回退消息。

Claude Code 对应参考：

- Claude Code session/log/resume 相关模块。
- `src/commands/resume/*`
- `src/commands/rewind/*`
- `src/commands/export/*`

Claude Code 的设计重点：

- 会话是 Agent 连续性的基础。
- 工具结果、用户输入、模型回答都应该可恢复、可导出、可回退。

RoxyCode 的优化点：

- JSONL 简单、透明、利于调试。
- 后续可以在此基础上做可视化 session browser。

## 18. Memory 长期记忆系统

RoxyCode 实现位置：

- `src/session/memory/types.ts`
- `src/session/memory/MemoryStore.ts`
- `src/session/memory/AutoMemoryExtractor.ts`
- `src/commands/builtin/memory.ts`
- `docs/MEMORY_SYSTEM.md`

记忆分类：

- `user`
- `project`
- `feedback`
- `reference`
- `learning`
- `workflow`

已实现能力：

- 手动添加：

```text
/memory add learning ...
/memory add workflow ...
```

- 列出记忆：

```text
/memory list
/memory list --type workflow
```

- 归档记忆：

```text
/memory forget <id>
```

- 自动记忆：

```text
/memory auto on
/memory auto off
```

- global/project scope。
- Memory 注入 Agent Runtime Context。

Claude Code 对应参考：

- memory 类型边界相关源码。
- Claude Code 的 user / project / feedback / reference 记忆思想。

Claude Code 的设计重点：

- Memory 不是随便保存聊天记录。
- 只保存未来有用、稳定、不可从当前仓库直接推导的信息。
- 记忆必须有类型边界，避免污染模型上下文。

RoxyCode 的优化点：

- 新增 `learning`：服务教学深度、学习风格、正在学习的概念。
- 新增 `workflow`：服务个人习惯、review 仪式、分支/提交习惯、角色化工作流。
- 更符合中文学习型 AI 编程工作台定位。

## 19. Workflow / Skill 系统

RoxyCode 实现位置：

- `src/workflow/types.ts`
- `src/workflow/builtin.ts`
- `src/workflow/yaml.ts`
- `src/workflow/WorkflowLoader.ts`
- `src/workflow/WorkflowPrompt.ts`
- `src/commands/builtin/workflow.ts`
- `docs/WORKFLOW_SYSTEM.md`

已实现内置工作流：

- `spring-crud`
- `vue-page`
- `bug-fix`
- `test-generate`
- `code-review`

支持项目自定义：

```text
.roxycode/workflows/*.yml
```

命令：

```text
/workflow
/workflow list
/workflow show spring-crud
/workflow run spring-crud --entity User --fields "name,email"
/workflow paths
```

执行设计：

```text
/workflow run
  -> load workflow
  -> parse args
  -> render structured prompt
  -> append to JSONL session
  -> enter Agent Loop
  -> model may call tools
  -> tools go through permission and audit
```

Claude Code 对应参考：

- `src/commands.ts`
- `src/types/command.ts`
- `src/skills/loadSkillsDir.ts`
- `src/skills/bundledSkills.ts`
- `src/utils/processUserInput/processSlashCommand.tsx`

Claude Code 的设计重点：

- Skill/Workflow 不应该绕过 Agent Loop。
- 它们应该变成 prompt command，进入统一模型和工具循环。
- `allowedTools`、`whenToUse`、`argumentHint` 等元数据很重要。

RoxyCode 的优化点：

- Claude Code 的 Skill 更通用。
- RoxyCode 把中文业务流程显式产品化。
- Workflow schema 有 `steps`、`verify`、`inputs`，更适合 Spring/Vue/ERP/后台系统等中文业务开发场景。

## 20. Prompt 优化系统

RoxyCode 实现位置：

- `src/session/prompt/PromptOptimizer.ts`
- `src/session/prompt/strategies.ts`
- `src/session/prompt/templates.ts`
- `src/commands/builtin/optimize.ts`

已实现能力：

- `/optimize`
- structured 策略
- few-shot 策略
- chain-of-thought 风格策略
- role-based 策略
- 自动策略选择

Claude Code 对应参考：

- Claude Code 对用户输入会做命令识别、附件识别、上下文注入、工具调用规划。

RoxyCode 的取舍：

- 当前 `/optimize` 是显式命令。
- 后续可以把 prompt 优化融入 Agent Loop 前置阶段。

## 21. 当前完成度总览

当前已经具备工程级 Agent 的核心底座：

- CLI 启动与配置加载
- 中文/英文双语言
- 角色系统
- Splash 和状态栏
- REPL 输入体验
- Slash Command 系统
- Profile / Project 初始化
- LLM Provider 抽象
- 工具系统
- 权限与安全
- Agent Loop 四档模式
- JSONL Session
- Context 压缩
- Memory 系统
- Workflow 系统

仍然需要继续增强的方向：

- 更完整的动态 Skill 加载。
- Plugin 系统。
- MCP 客户端完整接入。
- Hook schema 和 hook runner。
- 更成熟的终端 UI 状态机。
- 更强的上下文检索和 working set 管理。
- 更完整的模型 fallback/retry/cost 策略。
- Workflow 可视化编辑和 marketplace。
- 用户自定义角色资源加载。

## 22. 工程级 Agent 的核心设计思想

从 Claude Code 和 RoxyCode 当前实现可以总结出几个原则。

### 22.1 Agent 不是一个大 prompt

工程级 Agent 至少需要：

- 命令系统
- 上下文系统
- 工具系统
- 权限系统
- 会话系统
- 记忆系统
- 模型流式循环
- 扩展系统

Prompt 只是其中一层。

### 22.2 工具调用必须有统一路径

正确路径：

```text
Model tool_call
  -> ToolRegistry
  -> PermissionGuard
  -> Executor
  -> AuditLog
  -> tool_result
  -> Model continues
```

错误路径：

```text
Workflow/Command 直接写文件或执行 shell
```

RoxyCode 当前 Workflow 坚持不直接执行工具，就是为了保持这条安全路径。

### 22.3 上下文必须分层

上下文来源包括：

- 当前用户输入
- 会话历史
- ROXY.md
- project.json
- profile.json
- memory
- workflow 摘要
- 工具结果

不同上下文有不同优先级。安全规则永远最高。

### 22.4 命令系统要有元数据

命令不只是：

```ts
Record<string, Function>
```

而应该有：

- 来源
- 类型
- 分类
- 可见性
- 参数说明
- 示例
- 子命令
- 是否启用

这就是 Claude Code 的 `CommandBase` 思想，也是 RoxyCode 后续插件化的基础。

### 22.5 Memory 要有边界

Memory 不应该保存：

- 当前代码事实
- 文件路径
- git 临时状态
- 可从项目扫描得到的信息
- secret
- 一次性任务状态

Memory 应该保存：

- 稳定用户偏好
- 反馈
- 学习风格
- 长期工作习惯
- 外部参考位置
- 不可从仓库直接推导的项目决策

### 22.6 Workflow 是过程化经验

Workflow 不是代码模板。

更准确地说，它是：

```text
业务开发经验
  -> 结构化流程
  -> 约束模型行为
  -> 进入 Agent Loop
  -> 由工具系统安全执行
```

这是 RoxyCode 区别于 Claude Code 的重要产品点：面向中文业务开发，而不是只做通用 coding agent。

## 23. 建议的下一步学习路径

如果要继续学习 Claude Code 的工程级 Agent 设计，建议按这个顺序读源码：

1. `src/types/command.ts`
   - 先理解命令类型系统。

2. `src/commands.ts`
   - 理解所有命令来源如何聚合。

3. `src/skills/loadSkillsDir.ts`
   - 理解文件型 Skill 如何变成 prompt command。

4. `src/utils/processUserInput/processSlashCommand.tsx`
   - 理解 slash command 如何进入模型消息。

5. `src/tools/*`
   - 理解工具定义、权限和执行。

6. query / tool loop 相关模块
   - 理解模型如何流式输出、调用工具、接收结果并继续推理。

7. session / memory / compaction 相关模块
   - 理解长会话 Agent 如何保持连续性。

对应 RoxyCode 学习路径：

1. `src/index.ts`
2. `src/ui/repl/REPL.ts`
3. `src/commands/CommandRegistry.ts`
4. `src/commands/builtin/index.ts`
5. `src/engine/agent/AgentLoop.ts`
6. `src/tool/executor/ToolExecutor.ts`
7. `src/tool/permission/PermissionGuard.ts`
8. `src/session/store/SessionStore.ts`
9. `src/session/memory/MemoryStore.ts`
10. `src/workflow/WorkflowLoader.ts`
11. `src/workflow/WorkflowPrompt.ts`

## 24. 一句话总结

RoxyCode 目前已经从“二次元中文 CLI 原型”推进到了“具备工程级 Agent 底座的中文 AI 编程工作台”。它学习 Claude Code 的成熟架构：命令、工具、权限、上下文、会话、记忆、工作流统一进入模型循环；同时把中文体验、国产模型、角色定制、学习记忆和业务工作流做成自己的产品特色。

## 25. Memory 系统更新：工程级长期记忆边界

本次第 8 阶段实现重点不是只增加 `/memory add`，而是把 Memory 做成 Agent 的长期上下文基础设施。

### 25.1 已完成实现

RoxyCode 当前 Memory 相关文件：

- `src/session/memory/types.ts`：定义 `user`、`project`、`feedback`、`reference`、`learning`、`workflow` 六类记忆，以及 `global|project` scope。
- `src/session/memory/MemoryStore.ts`：实现 JSONL 事件存储、去重、归档、读取和 prompt 渲染。
- `src/session/memory/MemoryPolicy.ts`：新增保存策略闸门，统一拦截密钥、代码事实、文件路径、git 活动、临时任务状态和高危 workflow 习惯。
- `src/session/memory/AutoMemoryExtractor.ts`：通过 LLM 从近期会话提取长期记忆候选。
- `src/commands/builtin/memory.ts`：实现 `/memory list|add|forget|types|policy|auto|paths`，并在策略拒绝时输出中文原因和建议。
- `src/ui/repl/REPL.ts`：Agent 完成回答后触发自动记忆提取；不合格候选会被跳过，不影响主对话。
- `src/engine/agent/RuntimeContext.ts`：每轮 Agent Loop 注入项目画像、个人画像、长期记忆和工作流摘要。

### 25.2 Claude Code 对照

Claude Code 的 Memory 主要在 `src/memdir`：

- `memoryTypes.ts`：定义闭合类型 `user`、`feedback`、`project`、`reference`，并明确 `WHAT_NOT_TO_SAVE_SECTION`。
- `memdir.ts`：构建 memory system prompt，要求写入 memory 文件和 `MEMORY.md` 索引。
- `findRelevantMemories.ts`：用选择器只召回与当前 query 明确相关的少量记忆。
- `memoryAge.ts`：为旧记忆添加 stale 提醒，避免模型把旧快照当实时事实。
- `paths.ts`：校验 memory 目录路径，避免项目配置把 memory 指到敏感目录。

Claude Code 的核心思想是：Memory 保存“未来仍有用、且不能从仓库直接推导”的上下文，而不是保存代码索引、git 历史或当前任务进度。

### 25.3 RoxyCode 的设计取舍

RoxyCode 保留 Claude Code 的四类基础记忆边界，同时新增：

- `learning`：面向中文学习、解释深度、概念路线、初学者体验和角色化教学。
- `workflow`：面向个人命令习惯、review 仪式、提交/分支习惯和角色化工作流。

Claude Code 偏文件式 memory，适合高级开发者直接编辑 Markdown。RoxyCode 选择 JSONL 事件日志，原因是：

- 更适合中文 CLI 菜单和命令式交互。
- 可以记录 `source=manual|auto`、`characterId`、`sessionId`、`confidence`、`tags`。
- 更方便做审计、归档、去重、确认面板、向量索引和未来的角色化 memory UI。

### 25.4 为什么新增 MemoryPolicy

只靠 prompt 要求模型“不要保存密钥或代码事实”是不够的，尤其 RoxyCode 未来要兼容 OpenAI-compatible、Qwen、DeepSeek、GLM 等不同模型。不同模型对工具调用 JSON 和系统约束的稳定性不同，所以保存链路必须有代码级闸门。

当前保存路径是：

```text
/manual /memory add 或 AutoMemoryExtractor
  -> MemoryStore.add()
  -> MemoryPolicy.assertMemoryPolicy()
  -> duplicate check
  -> JSONL append
```

这个设计对照 Claude Code 的 `WHAT_NOT_TO_SAVE_SECTION`，但比纯 prompt 更硬：即使自动提取模型输出了不合格候选，也不能写入长期记忆。

### 25.5 后续应继续补齐

当前还缺 Claude Code 级别的 selective recall：RoxyCode 现在注入最近 24 条 memory，后续应参考 `findRelevantMemories.ts`，按当前用户 query 选择最相关的 3-5 条。

还应补齐 per-memory age note：参考 Claude Code `memoryAge.ts`，对旧记忆单独提醒“这是一条旧快照，使用前验证”。这能减少模型把历史事实当当前事实的风险。

最后建议增加自动记忆确认面板：候选记忆先展示给用户，角色用中文解释“为什么建议保存”，用户选择允许、拒绝或改写。这是 RoxyCode 可以强于 Claude Code 的产品化体验点。
## 26. Aesthetic And Deep Character Customization

Phase 10 completes the first version of RoxyCode's product differentiation layer: anime-style aesthetics and deep character customization.

### 26.1 Implemented Files

- `src/aesthetic/character/types.ts`: adds `AestheticMode`, custom `CharacterId`, `CharacterCompanion`, and `CharacterBehavior`.
- `src/aesthetic/character/custom/CharacterTemplate.ts`: generates editable JSON templates for custom characters.
- `src/aesthetic/character/custom/CustomCharacterLoader.ts`: loads global/project character JSON and converts placeholder strings into runtime functions.
- `src/aesthetic/character/CharacterManager.ts`: merges built-in, global, and project characters with priority `project > global > builtin`.
- `src/commands/builtin/aesthetic.ts`: implements `/aesthetic minimal|balanced|immersive`.
- `src/commands/builtin/character.ts`: implements `/character create`, `/character paths`, custom switching, and richer info output.
- `src/ui/renderers/CharacterArt.ts`: supports built-in ASCII and custom `splash.asciiArt`.
- `src/engine/agent/prompts.ts`: injects character behavior into the Agent system prompt without weakening security rules.
- `docs/AESTHETIC_CHARACTER_CUSTOMIZATION.md`: user-facing customization guide and template.

### 26.2 Claude Code Reference

Claude Code reference areas:

- `src/utils/theme.ts`: semantic terminal theme palette.
- `src/commands/theme/index.ts`: local `/theme` command registration.
- `src/buddy/companion.ts`: deterministic companion generation.
- `src/buddy/prompt.ts`: companion prompt boundary; the companion is not Claude itself.
- `src/buddy/types.ts`: companion rarity/species/eyes/hats/stats model.

Claude Code keeps theme and buddy mostly as presentation/companion layers. This is robust, accessible, and safe.

RoxyCode keeps the same safety boundary, but extends character customization into behavior strategy:

- explanation style
- review focus
- risk preference
- preferred Agent Loop mode
- workflow bias
- response rules

This makes the character part of the personal coding workbench, not just a skin.

### 26.3 Why This Design

`/aesthetic` writes `ui.aestheticMode`, similar to Claude Code's config-driven `/theme`. The difference is that RoxyCode aesthetic mode coordinates UI intensity with role presentation.

`/character create` writes project-local templates by default. This is safer than writing global user config because the generated JSON stays inside the current project and can be reviewed.

`CharacterBehavior` is injected into prompts, but never into permission enforcement. This preserves the existing RoxyCode security chain:

```text
ToolRegistry -> PermissionGuard -> Executor -> AuditLog
```

A bold or playful character can recommend a different workflow style, but cannot bypass path restrictions, shell confirmation, write backups, or high-risk second confirmation.

### 26.4 RoxyCode Advantages And Tradeoffs

Advantages over a pure Claude Code clone:

- Chinese-first custom character templates.
- Project-specific personal workbench identity.
- Role behavior affects learning and review style.
- Pixel/ASCII companion is user-editable.

Tradeoffs:

- Custom character changes currently require restart.
- Aesthetic intensity is stored and displayed, but renderer-specific behavior can be expanded further.
- The template is JSON, which is easy to edit but less expressive than a future visual character editor.

### 26.5 Learning Point

The engineering lesson from Claude Code is not simply "add a theme command". The important pattern is:

```text
stable typed metadata
  -> config-backed command
  -> renderer/prompt consumers
  -> safety boundary stays outside customization
```

RoxyCode applies the same pattern, then adds a product-specific layer for anime programmers and vibe-coding users who want their own deeply customized coding agent.

## 11. MCP / Hooks / Plugin 生态扩展底座

本阶段实现了 RoxyCode 的生态化接口：MCP 外部工具、Hooks 自动化扩展点、Plugin 本地插件。它对照 Claude Code 的 `services/mcp`、`utils/hooks`、`utils/plugins` 三组核心模块，但先选择项目本地、中文可读、低依赖的实现路径。

### Claude Code 的对应设计

Claude Code 的生态层有三个关键思想：

1. MCP server 先连接、发现 tools，再把 MCP tools 合入统一工具列表，由主循环和权限系统处理。
2. Hooks 不是散落回调，而是配置驱动的事件系统，支持 command、prompt、http、agent 等执行形态。
3. Plugin 是生态贡献容器，可以贡献 commands、hooks、agents、MCP servers，并通过缓存、marketplace、trust policy 管理来源。

### RoxyCode 的实现

新增模块：

- `src/mcp`：读取 `.roxycode/mcp.json`，通过 stdio JSON-RPC 执行 `initialize`、`tools/list`、`tools/call`，并把工具注册为 `mcp__server__tool`。
- `src/hooks`：读取 `.roxycode/hooks/*.json|yml`，执行 `command/prompt/http/agent` 四类 Hook。
- `src/plugin`：读取 `.roxycode/plugins/<id>/plugin.json`，合并插件贡献的 commands、hooks、mcpServers。
- `src/commands/builtin/extensions.ts`：提供 `/mcp`、`/hooks`、`/plugin` 中文配置向导。

关键接入点：

- `REPL.loadExtensions()` 在会话启动时加载插件、Hooks、MCP tools。
- `ToolExecutor.execute()` 在工具执行前后触发 `before_tool` / `after_tool`，且 MCP tool 仍走权限确认和审计。
- `AgentLoop.run()` 在 `agent_start`、`before_prompt`、`after_response`、`agent_done` 触发 Hook，并把 Hook 返回内容注入上下文。
- 插件命令注册为 `/pluginId:command`，避免污染内置命令命名空间。

### RoxyCode 的产品化取舍

Claude Code 更偏成熟生态平台，复杂度来自 marketplace、缓存、策略、企业级信任。RoxyCode 当前面向中文用户和“个人 Claude Code”定制化体验，所以先提供中文向导模板：

- `/mcp init` 生成 `.roxycode/mcp.json`
- `/hooks init` 生成 `.roxycode/hooks/example.json`
- `/plugin init <id>` 生成 `.roxycode/plugins/<id>/plugin.json`

优势是上手成本低、配置可读、适合教学和中文业务团队落地。劣势是当前还没有 Claude Code 那样完整的 marketplace、OAuth、多传输 MCP、复杂 Hook policy。后续可以在这个骨架上补齐远程生态能力。

## 27. Multi-Agent Ultimate Mode

Phase 12 turns Ultimate mode from simple parallel analysis into an explicit multi-agent runtime.

Implemented files:

- `src/engine/multi-agent/types.ts`
- `src/engine/multi-agent/Coordinator.ts`
- `src/engine/multi-agent/TaskGraph.ts`
- `src/engine/multi-agent/TaskClaimStore.ts`
- `src/engine/multi-agent/FileLockManager.ts`
- `src/engine/multi-agent/ConflictMerger.ts`
- `src/engine/multi-agent/MultiAgentRuntime.ts`
- `src/commands/builtin/agents.ts`
- `docs/MULTI_AGENT_ULTIMATE_MODE.md`

Claude Code comparison:

- Claude Code uses TaskCreate/TaskList/TaskUpdate plus in-process teammate state to make subagents first-class runtime objects.
- Claude Code coordinator permission flow keeps automated checks and user permission decisions separate.
- RoxyCode follows the same design idea: task state, agent identity, dependency graph, atomic claim, file lock, and conflict merge are runtime structures, not just prompt text.

RoxyCode product choice:

- Subagents currently analyze and report; they do not directly write files.
- Real file changes and shell commands still flow through `ToolRegistry -> PermissionGuard -> Executor -> AuditLog`.
- This is safer for the current project stage and preserves character customization, session/context, workflow, memory, MCP, hooks, plugins, and permission confirmation.

Runtime flow:

```text
Ultimate request
  -> Coordinator plan
  -> dependency validation
  -> atomic task claim
  -> advisory file locks
  -> parallel sub-agent analysis
  -> conflict merge report
  -> main Agent plan/tool/verify loop
```

User-facing command:

```text
/agents
/agents status
/agents locks
/agents paths
```

Detailed design notes are in `docs/MULTI_AGENT_ULTIMATE_MODE.md`.
