## Workflow / Skill

RoxyCode supports process-oriented workflows through `/workflow` and `.roxycode/workflows/*.yml`.

- Built-in Chinese workflows: `spring-crud`, `vue-page`, `bug-fix`, `test-generate`, `code-review`.
- Project workflows can override built-ins by using the same `id`.
- `/workflow run <id>` renders a structured prompt and sends it through the existing Agent Loop, so tool calls still pass through permission confirmation and audit logging.
- See `docs/WORKFLOW_SYSTEM.md` for schema, examples, and the Claude Code comparison.
# RoxyCode — 二次元可定制的中文 AI 编程工作台

> 面向二次元程序员、中文开发者和 vibe coding 用户的 AI 编程工具。RoxyCode 学习 Claude Code 的成熟 agentic coding 骨架，同时把二次元审美定制、中文体验、国产模型、教学友好、个人深度定制作为产品核心。

---

## 一、产品概述

### 1.1 产品定位

RoxyCode 不是 Claude Code 的中文壳，而是“每个人自己的二次元 Claude Code”：一个可配置、可记忆、可教学、可工作流化、可审美定制的个人 AI 开发工作台。

RoxyCode 的产品方向由两部分组成：

1. **成熟工程骨架**：参考 Claude Code 在命令系统、Hooks、Memory、Skills、Plugins、Agent 运行态上的成熟设计。
2. **二次元/中文/国产模型/教学友好体验**：面向二次元程序员和中文用户，默认中文菜单和页面，国产模型一等公民，支持角色伙伴、审美主题、用户画像、项目画像、角色化指导和中文业务工作流。

核心差异化：

- **国产模型优先** — 接入 Qwen、GLM、DeepSeek 等国内主流大模型
- **中文体验优先** — 默认中文菜单、中文页面、中文提示，支持 `/language` 切换英文
- **二次元审美定制** — 角色、主题、台词、ASCII/Pixel 小伙伴、状态栏文案和沉浸式工作台可配置
- **初学者友好** — 5 分钟上手，一句话生成可运行项目
- **业务强适配** — 深度理解 Spring Boot、React、Vue 等主流框架
- **深度个性化** — 通过 Profile、Project Profile、Memory、Workflow、Character 定制成个人工具
- **多 Agent 原生** — 文件锁、原子 claim、coordinator 从第一天就是一等公民
- **开放平台** — MCP 协议接入任意外部工具
- **成本可控** — 四级推理模式，按需消耗 Token

### 1.1.1 与 Claude Code 的参考关系

RoxyCode 会持续对照本地 Claude Code 源码 `D:\Programing\cc\claude-code-main`，采用“相近能力参考成熟实现，差异能力做成产品特色”的原则。

| 能力 | Claude Code 参考位置 | Claude Code 做得好的地方 | RoxyCode 采用/优化方向 |
|------|----------------------|---------------------------|------------------------|
| 命令系统 | `src/commands.ts` | 内置命令、插件命令、Skill 命令、MCP 命令统一加载，并有可用性过滤 | 学习统一注册与动态加载；额外强化中文命令说明和业务 Workflow |
| Hooks | `src/schemas/hooks.ts` | `command` / `prompt` / `http` / `agent` 四类 Hook，支持 matcher 条件 | 学习 schema 化和 matcher；提供中文向导生成 Hook 配置 |
| Memory | `src/memdir/memoryTypes.ts` | `user` / `feedback` / `project` / `reference` 分类清晰，明确不该存什么 | 采用基础分类；新增 `learning` / `workflow`，服务教学和个人习惯 |
| 运行态状态 | `src/bootstrap/state.ts` | 集中管理插件、Hook、Agent、Skill、错误日志等运行态 | 学习集中运行态；RoxyCode 增加 profile/project/workflow 状态 |
| 扩展生态 | `plugins` / `skills` / `commands` 相关加载逻辑 | 插件、Skill 和命令可以共同进入工具能力面 | 学习统一扩展入口；优先服务国内框架模板和中文场景 |
| 主题外观 | `src/commands/theme/index.ts` | 提供主题切换入口，保持工程工具克制 | 参考入口设计，但扩展为主题、角色、sprite、台词的审美层 |
| 陪伴小伙伴 | `src/buddy/companion.ts` / `src/buddy/sprites.ts` | seeded companion、rarity、stats、ASCII 多帧 sprite，成本低且稳定 | 参考确定性生成和轻量 sprite；RoxyCode 将其产品化为可定制 coding partner |

**取舍原则：**
- Claude Code 已验证成熟的工程骨架，RoxyCode 不重复发明。
- Claude Code 不突出的中文体验、国产模型、教学路线、个人工作流和二次元审美定制，是 RoxyCode 的重点产品特色。
- 审美层不能阻塞工程层；角色、台词、sprite、沉浸效果必须可关闭、可降噪、可配置。

### 1.2 目标用户

| 用户类型 | 痛点 | RoxyCode 如何解决 |
|----------|------|-------------------|
| 初学开发者 | 不会搭项目、不熟悉框架 | 一句话生成项目脚手架 |
| 实习/初级工程师 | 写业务代码慢、查文档多 | 自动写 CRUD、配置、测试 |
| 中级开发者 | 重复性工作多 | 批量重构、自动化脚本 |
| 二次元程序员 | 工具高效但缺少审美和个性 | 角色、主题、台词、小伙伴和工作流定制 |
| Vibe coding 用户 | 想用自然语言快速做项目，但缺少工程约束 | 教学引导、中文工作流、安全确认、自动审查 |
| 想定制 Claude Code 的用户 | 想拥有自己的 coding assistant | Profile、Project Profile、Workflow、Memory、自定义角色 |

### 1.3 典型使用场景

```
场景 1：项目脚手架
> 帮我创建一个 Spring Boot 用户管理系统
→ 自动生成完整项目结构、实体类、Controller、Service、Mapper

场景 2：业务代码生成
> 给 UserController 加一个分页查询接口
→ 自动读取现有代码，新增接口、Service 方法、SQL

场景 3：Bug 修复
> 启动报错 NullPointerException at UserService.java:42
→ 自动读取代码、定位问题、生成修复方案

场景 4：多 Agent 协同
> /ultimate 开发完整用户管理模块（前后端+数据库）
→ 拆解为 3 个子任务，并行执行，汇总结果

场景 5：MCP 外部工具
> 查一下 GitHub 上这个 issue 的详情
→ 通过 MCP 调用 GitHub API，返回 issue 内容

场景 6：个人深度定制
> /profile init
→ 选择中文/英文、技术栈、解释深度、默认角色、模型策略，生成个人开发画像

场景 7：项目画像
> /project init
→ 扫描项目并生成 ROXY.md + .roxycode/project.json，后续回答自动遵守项目规范

场景 8：中文业务工作流
> /workflow spring-crud 用户管理
→ 按项目规范生成 Entity、Mapper、Service、Controller、测试和接口文档

场景 9：二次元审美定制
> /aesthetic immersive
→ 启用完整角色化体验：主题、状态栏术语、ASCII 小伙伴、成功/失败台词

场景 10：自定义 Coding Partner
> /character create
→ 创建自己的二次元编程伙伴，配置语气、工作模式、审查重点和主题色
```

---

## 二、核心能力

### 2.1 能力全景

```
┌─────────────────────────────────────────────────────────────────┐
│                       RoxyCode 能力全景                          │
├──────────────┬──────────────────────────────────────────────────┤
│  交互层       │ CLI REPL · Slash 命令 · Tab 补全 · 流式渲染       │
├──────────────┼──────────────────────────────────────────────────┤
│  Agent 层     │ 四级循环（Lite/Economic/Standard/Ultimate）       │
│              │ 多 Agent 协同 · 主动提问 · 任务规划               │
├──────────────┼──────────────────────────────────────────────────┤
│  工具层       │ 文件操作 · Shell 执行 · Git · 代码搜索            │
│              │ 项目检测 · MCP 外部工具 · 插件扩展                 │
├──────────────┼──────────────────────────────────────────────────┤
│  智能层       │ Skill 系统 · 生命系统 · 向量记忆                  │
│              │ 上下文压缩 · 状态感知                             │
├──────────────┼──────────────────────────────────────────────────┤
│  审美层       │ 角色 · 主题 · 台词 · ASCII/Pixel 小伙伴 · 沉浸档位 │
├──────────────┼──────────────────────────────────────────────────┤
│  LLM 层       │ Qwen · GLM · DeepSeek · OpenAI · Claude         │
│              │ 统一接口 · 流式调用 · Tool Use                     │
├──────────────┼──────────────────────────────────────────────────┤
│  扩展层       │ MCP 协议 · Hooks · Skills · Plugins · Feature Flag│
└──────────────┴──────────────────────────────────────────────────┘
```

### 2.1.1 当前完成状态（截至当前代码）

以下状态以当前 `src/` 代码为准，不把设计文档中尚未实现的能力视为完成。

| 模块 | 当前状态 | 已完成内容 | 主要欠缺 |
|------|----------|------------|----------|
| CLI 入口 | ✅ 可运行 | `src/index.ts` 组装 Config、Character、LLM、Context、Splash、REPL | 缺少参数解析、非交互任务模式、错误恢复 |
| 启动画面 | ✅ 基本完成 | RoxyCode 艺术字、角色主题、中文默认、英文切换 | 需要更完整的窄屏适配和可配置布局 |
| 双语机制 | 🟡 基础完成 | `src/i18n/`，`ui.language`，`/language zh/en`，核心菜单双语 | 角色台词、细分命令页面、错误提示还未完全迁移 |
| 角色系统 | 🟡 原型完成 | 内置多个角色、主题色、状态文字、启动台词、`/character` | 缺少用户自定义角色、角色工作模式策略 |
| 审美层 | 🟡 概念和部分基础完成 | 启动画面、角色主题色、角色台词、状态文字已有基础 | 缺少 `/aesthetic`、主题包、sprite 小伙伴、沉浸档位、自定义资源加载 |
| Slash 命令 | ✅ 已实现 | 内置命令 + `CommandLoader` 动态聚合 workflow/plugin/skill；`.roxycode/workflows/*.yml` 自动生成 `/wf:<id>`；开发态热重载 | 后续补 MCP prompt 命令和更完整的远程模式过滤 |
| REPL/输入 | 🟡 原型完成 | RawLineReader、命令面板、Tab 补全、历史、非 TTY 串行执行 | 缺少成熟终端 UI 状态机、会话恢复、远程模式 |
| LLM Provider | 🟡 基础完成 | OpenAI-compatible 基类，Qwen/GLM/DeepSeek/OpenAI Provider | 缺少真实调用链集成、模型验证向导、fallbackModel |
| 上下文管理 | 🟡 基础完成 | ContextManager、压缩阈值、TruncationStrategy | 缺少摘要压缩、向量召回、working set 管理 |
| Prompt 优化 | 🟡 原型完成 | PromptOptimizer、策略、`/optimize` | 缺少与 Agent Loop 的深度集成 |
| 工具系统 | ❌ 未实现 | 仅有 `src/tool/index.ts` 预留 | read/edit/write/shell/git/grep/glob、权限、备份均缺失 |
| Agent Loop | ❌ 未实现 | 仅有接口和设计文档 | Lite/Economic/Standard/Ultimate 执行内核缺失 |
| 权限系统 | ❌ 未实现 | 配置中有 security 字段 | 缺少 PermissionGuard、确认流程、审计日志 |
| 会话持久化 | ❌ 未实现 | 有类型设计 | 缺少 JSONL SessionStore、resume、export、rewind |
| Memory | ✅ 已实现 | `src/session/memory` | JSONL 事件存储、MEMORY.md 索引、user/feedback/project/reference/learning/workflow 分类、TF-IDF top-5 召回、自动提取和 cross-link |
| Workflow | ✅ 已实现 | `/workflow`、`.roxycode/workflows/*.yml`、内置中文业务工作流、Agent Loop 投递 | 后续可继续做动态 Skill 命令和可视化编辑 |
| Profile | ❌ 未实现 | 新产品定位已明确 | 缺少个人画像和项目画像 |
| MCP/Plugin/Hook | ❌ 未实现 | 配置和文档预留 | 缺少协议客户端、Hook schema、插件加载器 |
| 多 Agent | ❌ 未实现 | 文档设计较完整 | 缺少 Coordinator、文件锁、任务 claim、依赖图 |

### 2.1.2 当前与 Claude Code 的主要差距

对照 Claude Code 已有实现，RoxyCode 当前最欠缺的是“执行内核”和“可扩展定制内核”。

| 差距 | Claude Code 现状 | RoxyCode 当前状态 | 优先级 |
|------|------------------|-------------------|--------|
| 统一命令加载 | `commands.ts` 聚合 builtin、skills、plugins、MCP、dynamic skills，并做过滤 | 已实现 `CommandLoader` + workflow/plugin/skill source + `CommandWatcher`，MCP prompt 命令后续补齐 | 中 |
| Hook schema | `schemas/hooks.ts` 用 Zod 定义 command/prompt/http/agent Hook | 只有文档级设计 | 高 |
| Memory 分类 | `memdir/memoryTypes.ts` 约束 memory 类型、保存边界、过期风险 | 只有向量记忆概念 | 高 |
| Agent 执行循环 | QueryEngine/query 流程承载工具调用和消息循环 | 自然语言输入暂未进入 Agent Loop | 最高 |
| 工具与权限 | 工具执行、权限、远程安全过滤为核心路径 | 工具层空壳 | 最高 |
| Profile/Project 深度定制 | CC 有设置、memory、commands、skills，但个人定制不是核心产品心智 | RoxyCode 尚未实现，但应作为特色 | 最高 |
| 二次元审美层 | CC 有 `/theme` 和 buddy/companion，但偏轻量点缀 | RoxyCode 已有角色主题雏形，但缺少完整审美系统 | 最高 |
| 插件/Skill 动态能力 | 技能和插件可进入命令/工具面 | 只有配置和文档 | 中 |

### 2.1.3 RoxyCode 应重点补齐的深度定制能力

| 能力 | 文件/目录建议 | 价值 | 与 Claude Code 对比 |
|------|---------------|------|---------------------|
| 个人画像 Profile | `.roxycode/profile.json` / `src/profile/` | 记录用户水平、技术栈、解释深度、默认角色、模型策略 | CC memory 能记录用户信息；RoxyCode 把它产品化成第一入口 |
| 项目画像 Project Profile | `ROXY.md` + `.roxycode/project.json` / `src/project/` | 固化项目启动命令、规范、业务词汇、禁止修改区域 | 类似 CLAUDE.md，但更结构化、更中文化 |
| 中文业务 Workflow | `.roxycode/workflows/*.yml` / `src/workflow/` | 一键 CRUD、页面、测试、修 Bug、生成文档 | CC 有命令/skills；RoxyCode 做国内框架场景模板 |
| 记忆分类扩展 | `.roxycode/memory/` / `src/memory/` | 让工具越来越懂用户和项目 | 参考 CC 四分类，新增 learning/workflow |
| 自定义角色 | `.roxycode/characters/*.json` / `src/character/loader` | 让每个用户拥有自己的导师/同事/reviewer | CC 有 output-style/theme；RoxyCode 做角色化工作模式 |
| 审美层 Aesthetic | `.roxycode/themes` / `.roxycode/sprites` / `src/aesthetic/` | 在不牺牲工程效率的前提下提供二次元沉浸体验 | CC 的 buddy/theme 是轻量点缀；RoxyCode 将其作为核心差异化 |
| 中文配置向导 | `/init` `/profile` `/project` `/model` | 降低非资深用户使用门槛 | CC 工程化强，RoxyCode 要更面向中文用户 |

### 2.1.4 二次元审美层设计原则

RoxyCode 摒弃“高效工具必须放弃审美定制”的旧式 agent 设计，但不把审美置于工程能力之上。

**三条硬原则：**
- **工程层优先**：Agent Loop、工具执行、权限、安全、测试永远优先。
- **审美层可降噪**：角色台词、sprite、沉浸状态可调节，不强迫所有用户接受完整二次元体验。
- **角色影响策略**：角色不是皮肤，而是会影响解释深度、主动提问、默认推理模式、审查重点和风险偏好的工作模式。

**审美档位：**

| 档位 | 命令 | 说明 |
|------|------|------|
| 极简 | `/aesthetic minimal` | 只保留主题色和少量角色语气，适合严肃开发 |
| 平衡 | `/aesthetic balanced` | 默认档位，保留角色化反馈但不频繁打断 |
| 沉浸 | `/aesthetic immersive` | 完整二次元体验：台词、小伙伴、世界观状态文案、完成反馈 |

**可定制资源：**

```text
.roxycode/
  themes/              # 主题色、边框、状态栏风格
  characters/          # 自定义角色人设和工作策略
  sprites/             # ASCII / Pixel 小伙伴
  dialogues/           # 成功、失败、等待、风险提醒台词
```

### 2.2 四级推理模式

不同任务复杂度使用不同的 Agent Loop 实现，精确控制 Token 消耗：

| 模式 | 循环结构 | Token 消耗 | 适用场景 | 触发方式 |
|------|----------|-----------|----------|----------|
| **Lite** | 单轮直出 | ~1-2K | 简单问答、概念解释 | `/lite` 或自动 |
| **Economic** | ReAct 串行 | ~15-30K | 日常开发、读写代码 | `/economic` 或自动 |
| **Standard** | 规划→执行→验证 | ~50-100K | 复杂重构、多文件改动 | `/standard` 或自动 |
| **Ultimate** | 多 Agent 并行 | ~100K+ | 大型任务、前后端联调 | `/ultimate` 或自动 |

**自动选择逻辑：**
- 简单问答（无文件引用、无代码关键词）→ Lite
- 单步操作（涉及 1-2 个文件）→ Economic
- 多步复杂任务（涉及 3+ 文件、重构类关键词）→ Standard
- 全栈/多模块任务（前后端、联调等关键词）→ Ultimate

### 2.3 实时状态反馈（Claude Code 风格）

Agent 执行过程中持续显示状态行：

```
· Churning… (3s · ↓ 0 tokens)
· Churning… (8s · ↓ 2.1k · ↑ 1.5k tokens)
· Reading src/app.ts… (0.8s · ↓ 1.2k tokens)
· Writing src/app.ts… (0.2s · ↓ 2.1k · ↑ 800 tokens)
· Running npm install… (3.2s · ↓ 2.1k tokens)
· Step [3/7] Implementing Redis datasource… (6s · ↓ 3.5k tokens)
· Done (12s · ↓ 5.5k · ↑ 1.2k tokens · $0.03)
```

**费用显示规则：**
- 未配置价格 → 不显示费用
- 配置了 Token 价格 → 显示 `$0.03`
- 配置了 Coding Plan（套餐内）→ 显示 `Plan: 12.3% used`
- 配置了 Coding Plan（超出）→ 显示 `$0.02 overage`

### 2.4 主动提问系统

Agent 在关键节点主动向用户提问，提高输出质量：

```
任务开始前（需求澄清）：
  ❓ 你提到"帮我加缓存"，有几种方案：
  1. 🟢 本地缓存（Caffeine）— 简单快速
  2. 🟡 Redis 分布式缓存 — 支持集群
  3. 🔵 多级缓存 — ⭐ 推荐
  请选择 [1/2/3]：

任务执行中（进度确认）：
  ❓ 数据库表结构已设计完成，是否需要调整？

任务完成后（结果审查）：
  ❓ 本次修改涉及 5 个文件，共 127 行变更，是否需要逐个审查？
```

**提问偏好：** `always` / `smart`（默认）/ `minimal` / `never`

### 2.5 Slash 命令系统

```
系统命令：
  /help              显示帮助信息
  /mode <name>       切换推理模式 (lite/economic/standard/ultimate)
  /config            查看/修改配置
  /clear             清空当前对话上下文
  /version           显示版本信息

会话命令：
  /history           查看对话历史摘要
  /save              保存当前会话
  /resume <id>       恢复历史会话
  /export            导出对话为 Markdown
  /undo              撤销上一步工具操作（回滚文件）
  /retry             重试上一次 LLM 调用
  /compact           手动触发上下文压缩

任务命令：
  /stop              停止当前任务
  /pause             暂停任务（可恢复）
  /plan              查看当前执行计划
  /step              手动进入下一步（Standard 模式）
  /approve           批准当前待确认的操作
  /reject            拒绝当前待确认的操作

信息命令：
  /stats             查看当前会话统计（tokens、耗时、费用）
  /cost              查看费用明细
  /context           查看上下文使用情况
  /tools             查看可用工具列表
  /skills            查看可用 Skill 列表
  /plugins           查看已加载插件
  /memory            查看记忆内容

Skill 命令：
  /create-project    创建项目脚手架
  /fix-bug           修复 Bug
  /explain           解释代码
  /review            代码审查
  /test              编写测试
  /commit            智能提交
  /docs              编写文档
  /analyze           项目分析
```

### 2.6 多 Agent 协同（一等公民）

多 Agent 从第一天就是一等公民，基础设施包括：

```
├── 文件锁机制 — 多 Agent 并行修改同一文件时的冲突解决
├── 原子 Claim — 任务的原子认领，防止重复执行
├── 依赖图 — 任务之间的 blocking 关系 + 循环检测
├── 兄弟 Abort — 关键工具失败时中止同批次其他工具
└── Coordinator — 任务拆解→并行执行→冲突解决→结果汇总
```

**执行流程：**
```
用户："开发完整用户管理模块（前后端+数据库）"
  │
  ▼
Coordinator 拆解任务：
  ├── Agent A (后端)：开发 REST API + 数据库
  ├── Agent B (前端)：开发 React 页面
  └── Agent C (测试)：编写接口测试
  │
  ▼ 并行执行（文件锁保证安全）
  ├── Agent A: [3/5] ✓
  ├── Agent B: [2/4] ⏳
  └── Agent C: [1/3] ⏳
  │
  ▼ 汇总结果
  · Done (2m 15s · ↓ 112.3k tokens · $0.35)
```

### 2.7 向量记忆（跨会话召回）

```
记忆层次：
├── 短期记忆（当前会话）
│   ├── 用户目标理解
│   ├── 工作笔记
│   ├── 决策记录
│   └── 错误经验
│
└── 长期记忆（跨会话，向量检索）
    ├── 用户偏好（代码风格、常用库）
    ├── 项目记忆（关键文件、架构）
    └── 学习到的知识

向量检索流程：
  用户："上次那个分页查询怎么写的？"
    │
    ▼
  向量检索历史会话
    │
    ▼
  召回相关记忆：
    ├── [2024-01-15] 实现了 UserController 分页查询
    │   使用 PageHelper + MyBatis-Plus
    └── [2024-01-20] 优化了分页性能
        添加了数据库索引
```

### 2.8 MCP 协议接入

通过标准协议接入任意外部工具：

```json
{
  "mcp": {
    "servers": {
      "github": {
        "command": "npx",
        "args": ["@modelcontextprotocol/server-github"],
        "env": { "GITHUB_TOKEN": "..." }
      },
      "postgres": {
        "command": "npx",
        "args": ["@modelcontextprotocol/server-postgres"],
        "env": { "DATABASE_URL": "..." }
      }
    }
  }
}
```

### 2.9 Skill 系统

| Skill | 触发命令 | 说明 |
|-------|----------|------|
| 创建项目 | `/create-project` | 根据需求生成项目脚手架 |
| 修复 Bug | `/fix-bug` | 分析错误信息并修复 |
| 解释代码 | `/explain` | 详细解释代码逻辑和设计 |
| 代码审查 | `/review` | 审查代码质量、安全性和性能 |
| 编写测试 | `/test` | 为代码编写单元测试 |
| 智能提交 | `/commit` | 分析变更并生成 commit message |

支持自定义 Skill（YAML 格式）：

```yaml
# .roxycode/skills/deploy.yml
name: deploy
description: 部署项目到服务器
trigger: /deploy
systemPrompt: |
  你是一个 DevOps 工程师。
tools:
  - execute_command
  - read_file
mode: standard
```

### 2.10 上下文管理

四层压缩策略：

```
Layer 1: 预防 — 减少不必要的上下文
Layer 2: 裁剪 — 移除低价值内容
Layer 3: 摘要 — 用 LLM 生成对话摘要
Layer 4: 检索 — 向量召回历史信息（一等公民）
```

---

## 三、工具系统

### 3.1 内置工具

| 类别 | 工具 | 说明 |
|------|------|------|
| 文件 | `read_file` | 读取文件内容（支持行号范围） |
| 文件 | `write_file` | 创建/覆盖写入文件 |
| 文件 | `edit_file` | 精准文本替换（old → new） |
| 文件 | `delete_file` | 删除文件（需确认） |
| 文件 | `list_directory` | 列出目录内容 |
| Shell | `execute_command` | 执行 Shell 命令 |
| Git | `git_status` / `git_diff` / `git_commit` / `git_branch` | Git 操作 |
| 搜索 | `grep_search` / `file_find` | 代码搜索 |
| 项目 | `detect_project` / `analyze_structure` | 项目理解 |

### 3.2 工具执行管道（权限硬编码）

```
每个工具调用必须经过（不可跳过）：
  1. Zod 校验 → 2. Tool 自检 → 3. Pre-Hooks
  → 4. canUseTool（不可绕过）→ 5. 执行 → 6. Post-Hooks
```

---

## 四、架构设计原则

> 详细设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)

| # | 原则 | 核心价值 |
|---|------|----------|
| 1 | **Async Generator 驱动** | `async function*` 串联整个架构，线性可读 + 流式处理 |
| 2 | **流式工具执行** | LLM 还在输出时就开始执行工具，延迟降低 60%+ |
| 3 | **权限硬编码必经路径** | 不可绕过的安全管道 |
| 4 | **构建时特性隔离** | 实验性功能构建时消除 |
| 5 | **多 Agent 一等公民** | 文件锁、原子 claim、依赖图、coordinator |
| 6 | **扩展性贯穿始终** | MCP + Hooks + Skills + Plugins |

---

## 五、DDD 架构设计

### 5.1 限界上下文

```
┌─────────────────────────────────────────────────────────────────┐
│                        RoxyCode 系统                            │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │  对话上下文     │  │  执行上下文     │  │  智能上下文     │       │
│  │  Conversation  │  │  Execution    │  │  Intelligence │       │
│  │               │  │               │  │               │       │
│  │  · 会话管理    │  │  · Agent Loop │  │  · Skill 系统  │       │
│  │  · 消息历史    │  │  · 工具调用    │  │  · 生命系统    │       │
│  │  · 上下文压缩  │  │  · 多Agent协同 │  │  · 向量记忆    │       │
│  │  · Slash 命令  │  │  · 任务规划    │  │  · 提问策略    │       │
│  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘       │
│          └──────────────────┼──────────────────┘               │
│                             │                                  │
│                    ┌────────▼────────┐                         │
│                    │  LLM 上下文      │                         │
│                    │  · 模型管理 · 统一接口 · 费用计算            │
│                    └────────┬────────┘                         │
│                    ┌────────▼────────┐                         │
│                    │  工具上下文      │                         │
│                    │  · 文件 · Shell · Git · MCP · 插件         │
│                    └─────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 目标文件架构

```
src/
├── index.ts                         # CLI Composition Root
├── core/                            # 稳定核心类型、配置、内置角色
├── i18n/                            # 中文/英文资源
├── runtime/                         # 运行态聚合，参考 Claude Code bootstrap/state
├── commands/                        # Slash 命令聚合，参考 Claude Code commands.ts
├── ui/                              # REPL、Splash、Renderer、Screen
├── aesthetic/                       # 二次元审美层：主题、sprite、台词、沉浸档位
├── profile/                         # 用户画像
├── project/                         # 项目画像、ROXY.md
├── workflow/                        # 中文业务工作流
├── agent/                           # Lite/Economic/Standard/Ultimate Agent Loop
├── tool/                            # 工具注册、执行、权限、审计、内置工具
├── engine/                          # LLM Provider
├── session/                         # 会话、上下文、JSONL 持久化
├── memory/                          # 长期记忆与向量检索
├── extension/                       # hooks / mcp / skills / plugins
└── shared/                          # 跨模块纯工具
```

**设计取舍：**
- 参考 Claude Code 顶层功能域结构，让 `commands/tool/agent/memory/workflow/aesthetic` 都容易发现。
- 不采用纯 DDD 多层目录作为第一层，否则 CLI 工具的扩展点会被埋得太深。
- 用模块依赖规则保证边界：`ui` 不直接调 LLM，`agent` 不绕过 `tool`，`aesthetic` 不参与权限决策。
- 详细文件架构、迁移映射和依赖图见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

---

## 六、技术选型

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 架构 | DDD 分层 | 业务复杂，需要清晰边界和可测试性 |
| 语言 | TypeScript 5.x | 强类型、AI 工具生态主流 |
| 运行时 | Node.js 20 LTS | 异步 I/O 适合 Agent 并发 |
| 包管理 | pnpm | 快、严格、省磁盘 |
| CLI | Commander.js + Inquirer.js | 成熟轻量 |
| 终端渲染 | Chalk + Ora | 简单好用 |
| LLM SDK | OpenAI SDK | 国产模型都兼容 OpenAI 格式 |
| 向量存储 | hnswlib-node | 本地向量检索，无外部依赖 |
| MCP | @modelcontextprotocol/sdk | 官方 SDK |
| 测试 | Vitest | 快、TS 原生 |
| 构建 | tsup (esbuild) | 极快 |

---

## 七、开发路线图

### Phase 0：稳定化与产品基线（已进行）

```
✅ TypeScript 编译通过
✅ tsup 构建通过
✅ CLI 入口 + 启动画面 + REPL
✅ 角色主题系统
✅ 双语基础设施（默认中文，/language 切换英文）
✅ LLM Provider 基础抽象
✅ 上下文管理基础实现
✅ Slash 命令注册表与动态加载基础

验收：项目可构建，启动页可展示，核心菜单默认中文，英文可切换
```

### Phase 1：个人深度定制入口（优先）

```
□ /profile init：生成个人画像
□ /project init：生成 ROXY.md + .roxycode/project.json
□ /aesthetic：设置 minimal / balanced / immersive 审美档位
□ /theme：加载主题包
□ /sprite：加载 ASCII / Pixel 小伙伴
✅ /workflow list/run：加载中文业务工作流
□ 自定义角色加载：.roxycode/characters/*.json
□ 配置向导：模型、语言、技术栈、解释深度、执行风格

验收：用户能在 5 分钟内把 RoxyCode 配成“自己的二次元 AI 编程工作台”
```

### Phase 2：Agent Loop + 工具系统主干

```
□ LiteLoop：单轮问答
□ EconomicLoop：ReAct 工具循环
□ ToolRegistry + ToolExecutor
□ read_file / edit_file / write_file / list_directory
□ grep_search / file_find
□ execute_command
□ StatusBar 接入 AgentEvent

验收：自然语言输入能真正读文件、改文件、执行命令，并把结果回写给模型
```

### Phase 3：权限、安全与会话持久化

```
□ PermissionGuard：路径限制、命令限制、高危操作确认
□ FileBackup：写文件前备份
□ AuditLog：工具调用审计
□ JsonlSessionStore：会话增量保存
□ /resume /export /rewind
□ fallbackModel 配置

验收：能安全执行真实项目修改，崩溃后可恢复，危险操作不可绕过
```

### Phase 4：Memory + Workflow + Skill

```
✅ Memory 分类：user / feedback / project / reference / learning / workflow
✅ Memory 读写、MEMORY.md 索引、top-5 召回与过期验证规则
✅ Workflow YAML schema
✅ 内置中文工作流：spring-crud / vue-page / bug-fix / test-generate / code-review
✅ Skill 命令动态加载：`.roxycode/skills/*/SKILL.md` -> `/skill:<name> [task]`
✅ /memory /workflow（/skills 后续扩展）

验收：RoxyCode 能记住用户偏好和项目习惯，并复用中文业务工作流
```

### Phase 5：Standard/Ultimate + MCP/Plugin

```
□ StandardLoop：计划→执行→验证
□ UltimateLoop：多 Agent 并行
□ FileLock + TaskClaimer + DependencyGraph
□ AgentCoordinator
□ MCP Client + MCP Tool Adapter
□ Hook schema：command / prompt / http / agent
□ Plugin loader

验收：复杂任务可规划执行，多 Agent 可并行，MCP/Hook/Plugin 能扩展能力
```

---

## 八、学习路线

```
第 1 周：TypeScript 基础（类型、函数、类、模块、Async Generator）
第 2 周：Node.js 实践（fs、child_process、流、事件）
第 3 周：DDD 概念 + Agent 基础（ReAct、Function Calling）
第 4 周：开始开发 Phase 1
第 5-6 周：Phase 2
第 7-8 周：Phase 3
第 9-10 周：Phase 4
第 11-12 周：Phase 5
```

---

## 九、配置文件示例

```json
{
  "llm": {
    "provider": "qwen",
    "model": "qwen-max",
    "apiKey": "sk-xxx",
    "baseUrl": "https://dashscope.aliyuncs.com/v1"
  },
  "mode": "auto",
  "questioning": { "mode": "smart" },
  "cost": {
    "pricingMethod": "token",
    "tokenPricing": { "inputPricePer1K": 0.02, "outputPricePer1K": 0.06 }
  },
  "mcp": {
    "servers": {
      "github": {
        "command": "npx",
        "args": ["@modelcontextprotocol/server-github"]
      }
    }
  },
  "security": {
    "apiKeyEncryption": true,
    "fileAccess": { "mode": "project-only", "backupBeforeWrite": true },
    "shell": { "mode": "whitelist", "requireConfirmation": true }
  }
}
```

---

## 十、术语表

| 术语 | 说明 |
|------|------|
| Agent | 智能体，能自主调用工具完成任务的 AI 程序 |
| Agent Loop | Agent 的核心循环（推理→执行→观察） |
| Async Generator | TypeScript 异步生成器，用于流式处理 |
| MCP | Model Context Protocol，Anthropic 提出的开放标准 |
| DDD | Domain-Driven Design，领域驱动设计 |
| Token | LLM 处理文本的基本单位（约 0.7 个汉字） |
| Skill | 预定义的提示词模板 + 工具组合 |
| Plugin | 可扩展 RoxyCode 能力的外部模块 |
