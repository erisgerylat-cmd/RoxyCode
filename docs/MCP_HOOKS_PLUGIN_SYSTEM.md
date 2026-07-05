# RoxyCode MCP / Hooks / Plugin 系统设计

## 目标

第 11 阶段把 RoxyCode 从“内置能力集合”推进到“可扩展编程工作台”。这一阶段实现三类生态接口：MCP 外部工具、Hooks 自动化扩展点、Plugin 本地插件。所有外部能力都不能绕开已有安全底座，仍然进入 RoxyCode 的命令、工具、权限、审计和 Agent Loop 主流程。

## 对照 Claude Code

Claude Code 的生态能力主要由这些模块组成：

- MCP：`src/services/mcp/client.ts`、`src/services/mcp/config.ts`、`src/services/mcp/types.ts`、`src/commands/mcp/*`
- Hooks：`src/types/hooks.ts`、`src/utils/hooks.ts`、`src/utils/hooks/execPromptHook.ts`、`src/utils/hooks/execHttpHook.ts`、`src/utils/hooks/execAgentHook.ts`
- Plugin：`src/types/plugin.ts`、`src/utils/plugins/pluginLoader.ts`、`src/utils/plugins/loadPluginCommands.ts`、`src/utils/plugins/loadPluginHooks.ts`、`src/utils/plugins/mcpPluginIntegration.ts`

Claude Code 的设计重点是生态规模：多来源 settings、marketplace、缓存、插件依赖、MCP 多传输协议、HTTP Hook allowlist、插件贡献 commands/hooks/agents/MCP。RoxyCode 当前阶段选择先实现项目本地可读配置，重点降低中文用户上手门槛，并为后续 marketplace 和远程信任策略留接口。

## RoxyCode 实现结构

```text
src/mcp/
  McpConfigLoader.ts      读取 .roxycode/mcp.json 与 config.mcp.servers
  McpStdioClient.ts       最小 stdio JSON-RPC 客户端
  McpToolAdapter.ts       将 MCP tools 适配为 RoxyCode Tool
  types.ts

src/hooks/
  HookLoader.ts           读取 .roxycode/hooks/*.json|yml 与插件 hooks
  HookManager.ts          执行 command/prompt/http/agent 四类 hook
  types.ts

src/plugin/
  PluginLoader.ts         扫描 .roxycode/plugins/<id>/plugin.json
  PluginCommands.ts       将插件 prompt command 注册为 slash command
  types.ts

src/commands/builtin/extensions.ts
  /mcp /hooks /plugin 中文向导命令
```

## MCP 设计

RoxyCode 支持 `.roxycode/mcp.json` 和 `config.mcp.servers` 中的六类传输配置：

- `stdio`：本地进程 MCP server，保留最稳定的离线/本地工具链路径。
- `http`：普通 JSON-RPC POST，适合远程 MCP 网关。
- `streamable-http`：使用 HTTP transport，但默认声明 `application/json, text/event-stream`，对齐 MCP Streamable HTTP 思路。
- `sse`：GET 打开事件流，收到 endpoint 后 POST JSON-RPC 消息。
- `ws`：WebSocket 传输，使用 `mcp` 子协议。
- `websocket`：面向中文用户更直观的别名，内部仍走 WebSocket transport。

示例：

```json
{
  "mcpServers": {
    "localExample": {
      "type": "stdio",
      "command": "node",
      "args": ["path/to/server.js"],
      "enabled": false,
      "timeoutMs": 30000
    },
    "remoteHttp": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {},
      "enabled": false
    },
    "remoteSse": {
      "type": "sse",
      "url": "https://example.com/sse",
      "enabled": false
    },
    "remoteWs": {
      "type": "ws",
      "url": "wss://example.com/mcp",
      "enabled": false
    },
    "oauthRemote": {
      "type": "websocket",
      "url": "https://example.com/mcp",
      "oauth": {
        "clientId": "your-client-id",
        "authorizationUrl": "https://auth.example.com/authorize",
        "tokenUrl": "https://auth.example.com/token",
        "callbackPort": 39111,
        "scope": "tools.read tools.call"
      },
      "enabled": false
    }
  }
}
```

加载流程：

```text
.roxycode/mcp.json / config.mcp.servers / plugin.mcpServers
  -> McpConfigLoader
  -> McpTransportFactory
  -> JsonRpcMcpClient
  -> Transport(stdio/http/streamable-http/sse/ws/websocket)
  -> initialize + notifications/initialized + tools/list + tools/call
  -> McpToolAdapter
  -> ToolRegistry
  -> PermissionGuard
  -> ToolExecutor
  -> AuditLog
```

MCP tool 会被命名为 `mcp__server__tool`。这样做参考 Claude Code 的 MCP tool 序列化设计，但 RoxyCode 用更显式的名称暴露来源，便于中文用户理解“这个工具来自哪个外部服务”。

对照 Claude Code：Claude Code 在 `services/mcp/client.ts` 中直接使用 MCP SDK 的 `StdioClientTransport`、`SSEClientTransport`、`StreamableHTTPClientTransport` 和自定义 WebSocket transport，并在 `services/mcp/auth.ts` 中实现完整 OAuth/PKCE 与安全凭据存储。RoxyCode 本阶段选择轻量实现：不新增 SDK/WS 依赖，先用统一 `Transport` 接口和内置 `fetch`/运行时 WebSocket 跑通协议闭环。

当前取舍：

- 优势：无新增依赖、项目本地配置可读、中文 `/mcp init` 模板覆盖六类配置，MCP 工具继续复用现有权限确认和审计。
- 劣势：TokenStore 目前是本地 JSON 文件，不如 Claude Code 的系统级安全存储；WebSocket 依赖运行时提供 `globalThis.WebSocket`，后续应补 keychain 后端和可选 `ws` 适配器。
## Hooks 设计

支持事件：

- `session_start`
- `before_prompt`
- `after_response`
- `before_tool`
- `after_tool`
- `command`
- `agent_start`
- `agent_done`

支持类型：

- `command`：运行本地命令，适合本地检查脚本。
- `prompt`：调用 LLM 生成补充上下文；没有 LLM 时退化为上下文注入。
- `http`：POST 到外部服务，默认只允许 HTTPS，localhost 调试需显式打开。
- `agent`：把 Hook 任务作为 Agent 上下文注入，适合轻量审查/提醒。

示例：

```json
{
  "hooks": [
    {
      "id": "project-note",
      "event": "before_prompt",
      "kind": "agent",
      "enabled": true,
      "prompt": "请在回答前注意这个项目的约定：$ARGUMENTS"
    }
  ]
}
```

接入点：

- `REPL.runCommand()` 触发 `command`
- `AgentLoop.run()` 触发 `agent_start`、`before_prompt`、`after_response`、`agent_done`
- `ToolExecutor.execute()` 触发 `before_tool`、`after_tool`

对照 Claude Code：Claude Code 的 Hook 能返回 `continue`、`decision`、`additionalContext`、`updatedInput` 等复杂结构。RoxyCode 当前保留最核心的“阻断 + 追加上下文”，实现简单但足以支持中文业务开发中的自动检查、风格提醒、审查补充。

## Plugin 设计

插件目录：

```text
.roxycode/plugins/my-plugin/
  plugin.json
```

Manifest 示例：

```json
{
  "id": "spring-helper",
  "name": "Spring Helper",
  "version": "0.1.0",
  "description": "中文 Spring 业务开发插件",
  "enabled": true,
  "commands": [
    {
      "name": "service-review",
      "description": "审查 Spring Service 实现",
      "prompt": "请按当前项目规范审查 Spring Service。",
      "category": "workflow"
    }
  ],
  "hooks": [],
  "mcpServers": {}
}
```

插件贡献会被合并为：

- Slash command：通过 `PluginCommandSource -> CommandLoader -> CommandRegistry` 注册为 `/pluginId:command`
- Hook：注入 HookManager
- MCP server：注入 McpConfigLoader，并带上 `ROXY_PLUGIN_ROOT`

对照 Claude Code：Claude Code 插件支持 marketplace、缓存、依赖、commands/agents/hooks/MCP/settings/output styles，并通过 `/reload-plugins` 统一刷新运行态。RoxyCode 当前先支持本地 manifest，并把插件命令接入统一 `CommandLoader`；开发态可通过 `ROXY_COMMAND_WATCH=1` 热重载插件命令。这是“个人 Claude Code”产品化的第一步，后续可以自然扩展到插件市场、角色包、主题包、国产模型预设包。

## 插件沙箱执行链

本轮优化把插件沙箱从“加载 metadata”推进到“执行链实际生效”。对照 Claude Code：

- Claude Code 的 `loadPluginCommands.ts` 在插件命令 prompt 进入模型前替换 `${CLAUDE_PLUGIN_ROOT}` 等变量，并避免把敏感用户配置直接暴露给模型。
- Claude Code 的 `loadPluginHooks.ts` 把插件 Hook 注册为携带 `pluginRoot/pluginId` 的内部 matcher，并用原子 clear + register 避免刷新窗口期。
- Claude Code 的 `mcpPluginIntegration.ts` 在插件 MCP server 合并进运行态前解析插件变量和用户配置。

RoxyCode 当前实现：

- `src/plugin/PluginVariables.ts`：统一渲染 `${ROXY_PLUGIN_ROOT}`、`${ROXY_PLUGIN_ID}`，并在替换前校验 `${ROXY_PLUGIN_ROOT}/../...` 这类路径逃逸。
- `src/plugin/PluginCommands.ts`：插件 slash command 在调用 Agent 前先走变量渲染和路径校验。
- `src/hooks/HookManager.ts`：插件 command hook 默认以插件根目录作为 cwd，并注入 `ROXY_PLUGIN_ROOT/ROXY_PLUGIN_ID`；prompt、agent、character、http hook 统一支持插件变量；http hook 额外校验 `allowNetworkAccess/allowedHosts`。
- `src/mcp/McpPluginSandbox.ts`：插件 MCP server 在 loader 和 transport factory 两层都做变量解析与沙箱守门；stdio 绝对可执行路径必须在插件允许路径内，远程 MCP 必须符合插件网络权限。

设计取舍：

- 优势：插件贡献命令、Hooks、MCP 时不会天然获得项目 cwd、任意本地路径或任意网络权限；即使绕过 loader 直接构造 MCP transport，运行态也会再次检查。
- 劣势：相比 Claude Code 的成熟插件生态，RoxyCode 目前还没有 marketplace 信任策略、签名、依赖解析、插件热刷新总线和更细粒度的 per-command 权限声明。
- RoxyCode 特色：错误边界更适合中文用户解释，后续可以结合角色系统把“为什么危险”用角色语气讲清楚，但角色不能提升权限或绕过 `PermissionGuard`。

## 中文向导命令

新增命令：

- `/mcp list|init|paths`
- `/hooks list|init|paths`
- `/plugin list|init|validate|paths`

RoxyCode 优化点是把配置入口产品化：用户先用 `/mcp init`、`/hooks init`、`/plugin init <id>` 生成中文模板，再逐步打开能力，而不是直接要求用户理解 Claude Code 的完整生态配置模型。

## 安全边界

本阶段坚持三条规则：

1. MCP tool 必须注册为普通 Tool，不能绕开 `ToolRegistry -> PermissionGuard -> ToolExecutor -> AuditLog`。
2. Hook 可以阻断或追加上下文，但默认不直接替用户执行高危工具。
3. Plugin 当前默认 project-local，配置字段 `plugins.trust` 预留后续 trust policy。

## 后续演进

下一步可以继续补：

- MCP 资源订阅、断线重连、keychain TokenStore 后端和 MCP SDK 兼容测试。
- Hooks allowlist、环境变量白名单、HTTP 域名策略。
- Plugin marketplace、版本缓存、依赖校验、签名或可信源。
- 插件贡献角色包、主题包、状态栏术语包。
- `/reload-plugins` 热重载与插件开发模式。
