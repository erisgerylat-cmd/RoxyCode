# RoxyCode Memory 系统

本文档记录 RoxyCode 第 8 阶段 Memory 系统的当前实现、Claude Code 对照、工程设计原因，以及后续增强方向。

## 当前状态

Memory 系统已经落地为 `src/session/memory` 模块，并接入 REPL、Agent RuntimeContext、自动记忆提取和 `/memory` 命令。

已实现能力：

- 记忆分类：`user`、`project`、`feedback`、`reference`、`learning`、`workflow`
- 手动记忆：`/memory add <type> [--scope global|project] [--tag a,b] <content>`
- 记忆查看：`/memory`、`/memory list`、`/memory types`、`/memory policy`、`/memory paths`
- 记忆归档：`/memory forget <id>`，使用 JSONL 事件追加归档，不直接删除历史事件
- 自动记忆：Agent 完成一轮回答后，通过 `AutoMemoryExtractor` 从近期会话提取长期记忆候选
- 自动记忆开关：`/memory auto status|on|off`，底层配置为 `memory.auto`
- RuntimeContext 注入：Agent Loop 每轮加载 `ROXY.md`、`.roxycode/project.json`、`.roxycode/profile.json`、长期记忆和工作流摘要
- 保存策略闸门：`MemoryPolicy` 在 `MemoryStore.add()` 前统一校验，手动与自动路径都不能绕过

## Claude Code 对照

Claude Code 相关源码位置：

- `claude-code-main/src/memdir/memoryTypes.ts`
- `claude-code-main/src/memdir/memdir.ts`
- `claude-code-main/src/memdir/findRelevantMemories.ts`
- `claude-code-main/src/memdir/memoryAge.ts`
- `claude-code-main/src/memdir/paths.ts`
- `claude-code-main/src/commands/memory/memory.tsx`

Claude Code 的核心设计：

- 类型边界是闭合集合：`user`、`feedback`、`project`、`reference`
- Memory 保存的是未来会话仍有价值、且无法从当前仓库直接推导的信息
- 明确禁止保存代码模式、架构、文件路径、项目结构、git 历史、近期变更、临时任务状态、调试过程和已写入 `CLAUDE.md` 的内容
- Memory 可能过期；涉及文件、函数、flag、命令或当前项目状态时，需要先读文件或 grep 验证
- 用户要求忽略 memory 时，要按空 memory 处理，不引用、不对比、不暗示
- `/memory` 更偏向打开和编辑 Markdown memory 文件；底层是文件式 memory 目录、frontmatter 和 `MEMORY.md` 索引
- `findRelevantMemories.ts` 使用选择器只召回与当前 query 明确相关的少量记忆，避免把所有长期记忆塞进上下文

RoxyCode 采用的部分：

- 保留 Claude Code 的四类基础边界：`user`、`project`、`feedback`、`reference`
- 保留“不保存可推导事实”和“使用前验证”的安全原则
- 在 RuntimeContext 中显式提醒模型：记忆可能过期，涉及当前代码状态时必须核验
- 在保存链路上加入策略闸门，避免模型或用户把代码快照、密钥、git 活动误写进长期记忆

RoxyCode 优化的部分：

- 新增 `learning`：服务中文教学、解释深度、学习路线、初学者体验和二次元/角色化学习偏好
- 新增 `workflow`：服务个人命令习惯、review 仪式、分支/提交习惯、角色化工作流和“每个人自己的 Claude Code”定位
- 使用 JSONL 事件日志，而不是直接让用户编辑 Markdown，便于 CLI 展示、审计、归档、去重、未来向量索引和可视化管理
- 提供 `/memory policy`，让中文用户直接理解“什么该记、什么不该记”
- `/memory add` 被策略拒绝时，会用中文解释原因和建议，而不是只抛异常

## 文件结构

```text
src/session/memory/
  types.ts                 # Memory 类型、scope、source、记录结构
  MemoryStore.ts           # JSONL 事件日志存储、去重、归档、prompt 渲染
  MemoryPolicy.ts          # 保存前策略校验，拦截密钥、代码事实、git 活动、临时状态等
  AutoMemoryExtractor.ts   # 通过 LLM 从近期会话中提取长期记忆候选
  index.ts                 # barrel export

src/commands/builtin/memory.ts
  # /memory 命令、手动 add/list/forget/policy/auto/paths

src/engine/agent/RuntimeContext.ts
  # 加载 ROXY.md、project/profile、memory、workflow，并注入 Agent system prompt

src/ui/repl/REPL.ts
  # Agent done 后触发自动记忆提取；被 MemoryPolicy 拒绝的候选会跳过
```

## 存储设计

```text
~/.roxycode/memory.jsonl              # global 记忆
<project>/.roxycode/memory.jsonl      # project 记忆
```

默认 scope：

- `project`、`reference` 默认保存到 `project`
- `user`、`feedback`、`learning`、`workflow` 默认保存到 `global`
- 用户可以通过 `--scope global|project` 覆盖

JSONL 使用追加事件：

- `add`：写入一条完整 `MemoryRecord`
- `archive`：归档指定 id，不破坏历史事件
- 读取时重放事件并过滤归档记录
- 去重按 `type + scope + normalized content` 判断

选择 JSONL 的原因：

- 比直接改 Markdown 更适合 CLI 命令和中文菜单
- 更容易记录 `source=manual|auto`、`characterId`、`sessionId`、`confidence`、`tags`
- 未来可以无损接入向量索引、记忆确认面板、角色化 memory UI 和团队同步
- 保留完整事件历史，便于排查“为什么模型记住了这个”

## 保存策略

`MemoryPolicy` 是本阶段新增的工程级闸门。它位于 `MemoryStore.add()` 内部，因此所有写入路径都会经过同一套规则。

会被拒绝的内容：

- 密钥、token、密码、private key、API key
- 原始代码块、堆栈、报错全文
- 文件路径、file:line、函数/类/组件位置等需要从仓库验证的事实
- git log、git blame、commit hash、PR 活动、近期变更、activity log
- 当前会话临时状态，例如“刚刚修了”“当前正在做”“本轮对话”
- 项目架构、目录结构、代码约定等可从仓库或 ROXY.md 推导的信息
- `workflow` 中的高危命令习惯，例如 `rm -rf`、`git reset --hard`、`git clean -fd`

允许但会提示谨慎的内容：

- `project` 记忆，因为项目事实衰减更快，使用前必须验证
- `workflow` 中的常规构建/测试/review 习惯，例如“每次完成修改前先运行 pnpm run build”
- `learning` 中稳定的解释偏好，例如“讲 TypeScript 时先讲概念再给代码例子”

这对应 Claude Code 的 `WHAT_NOT_TO_SAVE_SECTION` 和 `TRUSTING_RECALL_SECTION`，但 RoxyCode 把它从 prompt 约束提升为代码级校验。优势是国产模型或小模型即使没有完全遵守提取 prompt，也不能绕过 Store 写入污染长期记忆。

## 使用示例

```bash
/memory types
/memory policy
/memory add learning 我希望 TypeScript 解释先讲概念再给代码例子
/memory add workflow --scope project 每次完成修改前先运行 pnpm run build
/memory list --type workflow
/memory forget workflow-lx123abc
/memory auto status
/memory auto off
```

策略拒绝示例：

```bash
/memory add user api_key=sk-xxxx
```

RoxyCode 会拒绝保存，并提示这是密钥类内容，应放入环境变量或密钥管理系统。

## 与 Agent Loop 的关系

Memory 不是当前任务计划，也不是代码索引。

- 当前任务状态应该放在会话历史、计划、workflow 执行过程或任务列表里
- 当前代码事实应该通过 `read_file`、`grep_search`、`list_directory`、git 工具实时读取
- Memory 只保存未来会话仍有价值的用户偏好、项目背景、外部引用、学习方式和工作习惯

这和 Claude Code 的设计一致：Memory 是长期上下文，不应该替代 plan、task、git、文件读取和项目文档。

## 后续增强

当前版本还没有做语义召回。现在 RuntimeContext 加载最近 24 条记忆，适合作为早期闭环，但不是最终形态。

下一步建议：

- 实现 query-time selective recall：参考 Claude Code `findRelevantMemories.ts`，只召回与当前问题明显相关的 3-5 条记忆
- 为每条 memory 渲染 age/staleness note：参考 Claude Code `memoryAge.ts`，旧记忆单独提示“这是旧快照”
- 增加自动记忆候选确认面板：角色用中文解释“为什么建议保存这条记忆”，用户可允许/拒绝
- 增加 `/memory edit` 或 `/memory update`：允许用户修订旧记忆，而不是只能归档再添加
- 增加角色化记忆视图：同一条学习/工作流记忆可以根据 Roxy、Eris、Nanahoshi 等角色呈现不同解释风格
- 增加团队/项目共享记忆：在 `.roxycode/memory.jsonl` 基础上扩展团队同步，但必须保留路径安全校验

## 2026-06-29 优化：Selective Recall 与记忆年龄提示

本次根据文档中的后续增强项，补齐了 Memory 的查询时选择性召回和 per-memory age/staleness note。

实现位置：

- `src/session/memory/MemoryRecall.ts`：新增本地确定性召回器，按当前用户 query、tags、content、memory type hint、scope、source、更新时间综合打分。
- `src/engine/agent/RuntimeContext.ts`：从原来的最近 24 条 memory 改为先读取候选，再根据当前用户输入选择最多 5 条注入 Agent RuntimeContext。
- `src/session/memory/MemoryStore.ts`：prompt 渲染每条 memory 时追加更新时间，例如“今天 / 昨天 / N 天前”；超过 1 天的记忆会带旧快照提醒。
- `src/engine/agent/AgentLoop.ts`：调用 `loadRuntimeContext` 时传入当前 `userInput`，让召回器能按任务选择记忆。

对照 Claude Code：

- Claude Code `findRelevantMemories.ts` 使用一个轻量 side query 让模型从 memory manifest 中选择最多 5 条相关记忆，优势是语义判断更强。
- Claude Code `memoryAge.ts` 把 mtime 转成 “today / yesterday / N days ago”，并对旧记忆生成 staleness caveat，避免模型把旧快照当成当前事实。

RoxyCode 当前选择：

- 先实现本地确定性 selector，不额外消耗模型 token，不依赖网络，适合中文用户和国产模型不稳定时的基础体验。
- 召回结果更可预测，也便于后续给 `/memory recall <query>` 做可解释展示。
- 缺点是语义能力弱于 Claude Code 的 LLM selector。后续可以在 `MemoryRecall.ts` 上增加可选 LLM rerank：本地召回先筛 20 条，再让模型选 3-5 条。

产品化意义：

- RoxyCode 不再把所有长期记忆塞进上下文，而是让“每个人自己的 Claude Code”只带当前任务真正需要的个人偏好、学习方式和工作流习惯。
- 旧记忆会显式提醒“这是旧快照”，更适合教学型、中文业务开发和长期个性化使用，减少模型根据过期信息误导用户。


## MEMORY.md Index and Cross Links

RoxyCode now keeps a generated MEMORY.md next to each memory.jsonl file. This follows Claude Code's memdir idea: keep a compact Markdown index for human review while the durable source of truth remains structured storage.

- Global memories: ~/.roxycode/memory.jsonl and ~/.roxycode/MEMORY.md
- Project memories: .roxycode/memory.jsonl and .roxycode/MEMORY.md
- The index is rebuilt after add, archive, and clear.
- Index rendering is capped at 200 entries to avoid bloating prompt-visible context.
- Memory text may reference another memory with [[memory-id]] or [[summary-slug]]. MemoryGraph parses those links and marks edges as resolved or unresolved.

Compared with Claude Code, RoxyCode keeps the JSONL event log for auditability and adds the Markdown index as a teaching-friendly view rather than replacing the store.
