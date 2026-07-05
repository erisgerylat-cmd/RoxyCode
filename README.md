# RoxyCode

二次元可定制的中文 AI 编程工作台。

RoxyCode 的目标不是做 Claude Code 的简单中文外壳，而是把 Claude Code 风格的工程级 Agent 体验、中文开发者友好的交互、国产/兼容 OpenAI 模型支持，以及可深度定制的角色系统组合成一个“每个人自己的 AI 编程台”。

## 当前状态

当前主线已经具备可运行的 CLI、Agent Loop、工具系统、权限安全、Memory、Workflow、MCP/Hook/Plugin 基础、角色包工具链和中英文体验。README 只描述当前代码已经实现或已有测试覆盖的能力；更长期的规划见 [docs/ENGINEERING_ROADMAP.md](docs/ENGINEERING_ROADMAP.md)。

已验证：

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm run build`
- `pnpm test`：130 passed，2 skipped，0 failed

## 与 Claude Code 的对照

RoxyCode 持续参考本地 Claude Code 源码 `D:\Programing\cc\claude-code-main` 的成熟设计，但产品取向不同。

| 能力 | Claude Code 的成熟做法 | RoxyCode 的当前实现与取舍 |
|---|---|---|
| 命令系统 | builtin、skills、plugins、MCP 命令统一聚合 | `CommandRegistry` + `CommandLoader` + workflow/plugin/skill sources，支持动态命令和开发态热重载 |
| 工具调用 | 工具 schema、权限确认、tool_result 闭环是核心路径 | `ToolRegistry -> PermissionGuard -> Executor -> AuditLog`，内置文件、搜索、Shell、Git 工具，并支持流式进度 |
| Agent Loop | 模型流式输出与 tool_use/tool_result 循环 | Lite/Economic/Standard/Ultimate 四档模式，Economic 已形成真实工具调用闭环，Standard/Ultimate 有计划与多 Agent 运行框架 |
| Memory | user/feedback/project/reference 等边界清晰 | 扩展为 user/project/feedback/reference/learning/workflow，支持 MEMORY.md、TF-IDF top-5、cross-link 和自动提取 |
| Workflow/Skill | Skill 作为可复用能力进入命令和模型上下文 | `.roxycode/workflows/*.yml`、内置中文业务工作流、`/workflow run` 和动态 `/wf:<id>` 命令 |
| Hooks/Plugins | 扩展进入运行时，但不绕过权限边界 | command/prompt/http/agent hook、插件命令、角色包 hook 接入，仍经过主 Agent 与安全链路 |
| 审美与角色 | theme/buddy 偏轻量点缀 | 角色影响主题、状态文案、解释风格、风险偏好、工作流建议和角色包扩展能力 |

核心原则：Claude Code 已验证成熟的工程骨架用于参考；RoxyCode 的差异化放在中文体验、国产模型、教学友好、二次元角色包和个人深度定制上。

## 快速开始

```bash
pnpm install
pnpm run build
pnpm start
```

开发模式：

```bash
pnpm run dev
```

常用验证：

```bash
pnpm run build
pnpm test
```

## API 配置

RoxyCode 支持 Qwen、DeepSeek、GLM、OpenAI 和 OpenAI-compatible 接口。推荐把密钥放在环境变量或 `.roxycode/config.local.json`，不要提交到 Git。

PowerShell 示例：

```powershell
$env:ROXY_OPENAI_API_KEY="sk-..."
$env:ROXY_OPENAI_BASE_URL="https://your-openai-compatible-host/v1"
$env:ROXY_LLM_MODEL="gpt-4o"
$env:ROXY_LLM_PROVIDER="compatible"
pnpm start
```

也可以使用通用环境变量：

```powershell
$env:ROXY_LLM_API_KEY="sk-..."
$env:ROXY_LLM_BASE_URL="https://your-provider/v1"
$env:ROXY_LLM_MODEL="your-model"
$env:ROXY_LLM_PROVIDER="compatible"
```

支持的 provider id：

- `qwen` / `dashscope`
- `deepseek`
- `glm` / `bigmodel`
- `openai`
- `compatible`

配置优先级：

```text
default -> global -> project -> local -> env -> session
```

其中本地机器配置路径 `.roxycode/config.local.json` 会自动加入 `.gitignore`。

## 常用命令

| 命令 | 说明 |
|---|---|
| `/help` | 查看命令列表 |
| `/language zh` / `/language en` | 切换中英文 |
| `/model [provider] [model]` | 查看或切换模型配置 |
| `/mode [lite|economic|standard|ultimate]` | 切换 Agent Loop 推理模式 |
| `/status` | 查看当前运行状态 |
| `/diagnostics` | 查看 Claude Code 风格运行诊断 |
| `/context` / `/compact` | 查看和压缩上下文 |
| `/memory` | 管理长期记忆 |
| `/workflow` | 查看、运行、定位工作流 |
| `/mcp` | 管理 MCP 外部工具配置 |
| `/hooks` | 管理 command/prompt/http/agent hooks |
| `/plugin` | 管理本地插件 |
| `/profile init` | 初始化个人画像 |
| `/project init` | 生成 ROXY.md 和项目画像 |
| `/character` | 切换、创建、安装、打包、导出角色 |
| `/aesthetic minimal|balanced|immersive` | 切换审美强度 |

## Agent 与工具系统

RoxyCode 的工具调用遵循统一链路：

```text
ToolRegistry -> PermissionGuard -> Executor -> AuditLog
```

已实现内置工具：

- `read_file`
- `write_file`
- `edit_file`
- `list_directory`
- `grep_search`
- `execute_command`
- Git 工具

安全策略：

- 默认限制在当前项目内操作
- Shell 命令有白名单和确认机制
- 写文件前备份
- 高危操作二次确认
- 工具结果写入审计日志
- 流式工具进度会反馈给 UI/Agent

这部分对照 Claude Code 的核心经验：模型不能直接“裸奔”修改工作区，所有真实操作都必须经过权限和审计。

## Memory 系统

RoxyCode 的 Memory 面向中文学习型和工作流型使用场景，类型包括：

- `user`
- `project`
- `feedback`
- `reference`
- `learning`
- `workflow`

能力：

- `.roxycode/memory/MEMORY.md` 索引维护
- 200 行索引限制
- TF-IDF top-5 相关记忆召回
- `[[cross-link]]` 交叉引用
- 自动记忆提取策略
- `/memory add`、`/memory forget`、`/memory stats` 等命令

## Workflow / Skill

RoxyCode 支持 `.roxycode/workflows/*.yml`，并内置中文业务工作流：

- `spring-crud`
- `vue-page`
- `bug-fix`
- `test-generate`
- `code-review`

运行方式：

```text
/workflow list
/workflow show spring-crud
/workflow run spring-crud --name 用户管理
/wf:spring-crud --name 用户管理
```

项目 workflow 可以覆盖内置 workflow。当前角色包也可以贡献 workflow 文件，这些 workflow 会进入 `/workflow` 和动态命令系统。

## 角色与角色包

角色系统是 RoxyCode 的核心差异化能力。角色不仅改变外观，还会影响解释风格、审查重点、风险偏好、工作流建议和状态栏文案。

角色包支持：

- 标准目录包
- `.roxychar` 压缩包
- `manifest.json`
- `character.json`
- assets、sprites、splash art
- hooks、workflows、prompts 扩展
- i18n 多语言资源

常用命令：

```text
/character list
/character roxy
/character create my-character --package
/character validate .roxycode/characters/my-character
/character pack .roxycode/characters/my-character --out ./dist
/character install ./dist/my-character-1.0.0.roxychar
/character packages
/character export current --roxychar
```

角色包扩展能力已经接入运行时：

- `extensions.workflows` 进入 `WorkflowLoader`、`/workflow` 和 `/wf:<id>`
- `extensions.hooks` 进入 `HookLoader`
- `extensions.prompts` 通过 `CharacterPromptLoader` 注入 Agent runtime context

这些扩展只能影响风格、计划和验证关注点，不能覆盖权限、安全和事实核验规则。

## MCP / Hooks / Plugin

MCP：

- 支持 `stdio`
- 支持 `sse`
- 支持 `http`
- 支持 `streamable-http`
- 支持 `ws`
- 支持 `websocket`
- OAuth PKCE 和 TokenStore 已实现基础能力

Hooks：

- `command`
- `prompt`
- `http`
- `agent`

Plugin：

- `.roxycode/plugins`
- 本地插件 manifest 校验
- 插件命令加载
- 插件 hook 接入

RoxyCode 的处理方式和 Claude Code 一致：扩展可以进入命令、prompt、hook 和工具发现链路，但不能绕过核心权限路径。

## 目录结构

```text
src/
├── index.ts                    # CLI composition root
├── core/                       # 配置、常量、核心类型
├── i18n/                       # 中英文文案
├── commands/                   # Slash 命令、动态命令加载
├── ui/                         # Splash、REPL、状态栏、权限面板
├── aesthetic/                  # 角色、主题、角色包
├── engine/
│   ├── llm/                    # Provider 抽象与 OpenAI-compatible 实现
│   ├── agent/                  # Agent Loop、RuntimeContext、流式工具执行
│   └── multi-agent/            # Coordinator、文件锁、claim、依赖图
├── tool/                       # 工具注册、执行、权限、安全、审计
├── session/                    # 上下文、记忆、会话存储、prompt 优化
├── workflow/                   # Workflow loader、runner、executor
├── hooks/                      # Hook loader / manager
├── mcp/                        # MCP 配置、传输、OAuth、工具适配
├── plugin/                     # 插件加载与插件命令
├── profile/                    # 个人画像初始化
└── project/                    # 项目画像初始化
```

## 文档索引

- [角色包规范](docs/CHARACTER_PACKAGE_SPEC.md)
- [角色包 CLI](docs/CHARACTER_PACKAGE_CLI.md)
- [角色市场路线图](docs/CHARACTER_MARKETPLACE_ROADMAP.md)
- [角色与审美定制](docs/AESTHETIC_CHARACTER_CUSTOMIZATION.md)
- [Memory 系统](docs/MEMORY_SYSTEM.md)
- [Workflow 系统](docs/WORKFLOW_SYSTEM.md)
- [命令系统](docs/COMMAND_SYSTEM.md)
- [MCP / Hooks / Plugin](docs/MCP_HOOKS_PLUGIN_SYSTEM.md)
- [Ultimate 多 Agent](docs/MULTI_AGENT_ULTIMATE_MODE.md)
- [工程级 Agent 设计总结](docs/ENGINEERING_AGENT_DESIGN_SUMMARY.md)
- [工程路线图](docs/ENGINEERING_ROADMAP.md)

## 开发约定

- 默认中文体验，英文可切换。
- 不把 API key 写入 README、测试快照或提交历史。
- 文件修改必须经过工具权限和备份策略。
- 角色、审美、prompt 扩展不能覆盖安全规则。
- 新能力优先补测试，再更新文档。
