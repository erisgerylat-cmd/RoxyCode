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

RoxyCode 支持 `.roxycode/mcp.json`：

```json
{
  "mcpServers": {
    "example": {
      "type": "stdio",
      "command": "node",
      "args": ["path/to/server.js"],
      "env": {},
      "enabled": true,
      "timeoutMs": 30000
    }
  }
}
```

加载流程：

```text
.roxycode/mcp.json / config.mcp.servers / plugin.mcpServers
  -> McpConfigLoader
  -> McpStdioClient initialize + tools/list
  -> McpToolAdapter
  -> ToolRegistry
  -> PermissionGuard
  -> ToolExecutor
  -> AuditLog
```

MCP tool 会被命名为 `mcp__server__tool`。这样做参考 Claude Code 的 MCP tool 序列化设计，但 RoxyCode 用更显式的名称暴露来源，便于中文用户理解“这个工具来自哪个外部服务”。

当前取舍：

- 优势：无新增依赖、项目本地配置可读、MCP 工具复用现有权限确认和审计。
- 劣势：当前只实现 stdio 最小路径，尚未支持 HTTP/SSE/WS/OAuth、资源订阅和复杂 MCP channel policy。

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

- Slash command：注册为 `/pluginId:command`
- Hook：注入 HookManager
- MCP server：注入 McpConfigLoader，并带上 `ROXY_PLUGIN_ROOT`

对照 Claude Code：Claude Code 插件支持 marketplace、缓存、依赖、commands/agents/hooks/MCP/settings/output styles。RoxyCode 当前先支持本地 manifest，这是“个人 Claude Code”产品化的第一步，后续可以自然扩展到插件市场、角色包、主题包、国产模型预设包。

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

- MCP HTTP/SSE/WS 与 OAuth。
- Hooks allowlist、环境变量白名单、HTTP 域名策略。
- Plugin marketplace、版本缓存、依赖校验、签名或可信源。
- 插件贡献角色包、主题包、状态栏术语包。
- `/reload-plugins` 热重载与插件开发模式。