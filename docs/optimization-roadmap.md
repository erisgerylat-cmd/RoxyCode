# RoxyCode vs Claude Code Optimization Roadmap

Updated: 2026-07-02

This roadmap replaces the earlier linear optimization list with a status-aware plan based on the current RoxyCode implementation.

## Current Position

RoxyCode should keep its existing layered architecture:

- `core/`, `engine/`, `tool/`, `commands/`, `session/`, `aesthetic/`, `workflow/`
- Chinese-first UX, role behavior, aesthetic customization, and teaching-friendly memory are product differentiators.
- Claude Code is the engineering reference for command aggregation, tool runtime, memory, MCP, hooks, configuration, and terminal interaction polish.

Compared with the attached Claude Code analysis, some RoxyCode items are already implemented:

- Agent Loop modes: Lite, Economic, Standard, Ultimate.
- StreamingToolExecutor and tool lifecycle events.
- PermissionGuard, audit log, backup-before-write, read-before-write guard, high-risk confirmation.
- Runtime diagnostics, telemetry, query profiling, provider error metadata.
- Tool result pairing repair and observability.
- Basic MemoryStore, AutoMemoryExtractor, MemoryPolicy, and relevance recall.
- MCP stdio loading and MCP tool adapter basics.
- Hooks, plugins, workflows, and Chinese commands.

## Phase P0: Complete Core Infrastructure

### P0.1 Memory Index, Retrieval, and Graph

Status: Done. Expanded in Memory 1.1 with `MemoryRetriever` and `MemoryPrompts`.

Claude Code reference:

- `memdir` keeps a `MEMORY.md` index and structured memory files.
- `findRelevantMemories.ts` asks a side-query model to select up to 5 relevant memory files from a manifest.
- `memoryAge.ts` warns that old memories may be stale.

RoxyCode implementation:

- `MemoryStore` keeps JSONL event logs as source of truth and maintains generated per-scope `MEMORY.md` indexes.
- `MemoryIndex` renders/parses `MEMORY.md` and caps index output at 200 lines.
- `MemoryRetriever` provides deterministic TF-IDF top-k recall, ready to be replaced or reranked by vectors later.
- `MemoryPrompts` centralizes auto-extraction prompts and the save/do-not-save taxonomy.
- `AutoMemoryExtractor` runs as a restricted child-agent call with `tools: []` and `toolChoice: none`.
- `MemoryGraph` parses `[[cross-link]]` and marks resolved/unresolved edges.
- `RuntimeContext` injects `MemoryStore.recallRelevant(query, { limit: 5 })` into the Agent system prompt.

Acceptance:

- `MEMORY.md` is automatically updated after add/archive/clear.
- Index rendering is capped at 200 lines.
- Query recall returns top-5 relevant memories.
- Auto extraction supports user/feedback/project/reference plus RoxyCode learning/workflow.
- `[[cross-link]]` syntax is parsed and test-covered.

### P0.2 Dynamic Command Sources

Status: Done. Implemented in Command System 1.2 with dynamic source loading and dev hot reload.

Claude Code reference:

- `src/commands.ts` aggregates builtin commands, skill commands, plugin commands, MCP prompts, workflow commands, and dynamic skills through `getCommands(cwd)`.
- `src/utils/plugins/loadPluginCommands.ts` turns plugin command files into prompt commands with source metadata.
- `src/skills/loadSkillsDir.ts` loads disk skills into the same command contract.
- `src/utils/skills/skillChangeDetector.ts` watches skill files, debounces changes, clears caches, and notifies the REPL.
- `src/commands/reload-plugins/reload-plugins.ts` provides an explicit mid-session plugin refresh path.

RoxyCode implementation:

- `CommandSourceLoadContext` now carries `reservedNames` so dynamic commands cannot shadow builtins such as `/help`.
- `WorkflowCommandSource` converts loaded workflows into prompt slash commands named `/wf:<id>`, with aliases, argument hints, Chinese workflow rendering, and watch paths for `.roxycode/workflows`.
- `PluginCommandSource` loads enabled plugin manifest commands through `PluginLoader -> collectPluginContributions -> createPluginCommands`.
- `SkillCommandSource` scans skill directories for `SKILL.md` and exposes `/skill:<dir> [task]` prompt commands.
- `CommandLoader` aggregates workflow/plugin/skill sources, reports conflicts without crashing the REPL, and exposes source watch paths.
- `CommandRegistry` supports `unregister`, `unregisterBySource`, and atomic `replaceBySource` so dynamic refresh does not rebuild unrelated builtins.
- `CommandWatcher` provides development hot reload with native `fs.watch`, debounce, manual trigger support, and registry replacement callbacks.
- REPL refresh now reloads dynamic commands, hooks, plugins, and MCP extension state through one async path; `/config reload` and language changes await this refresh.

Acceptance:

- `.roxycode/workflows/*.yml` automatically becomes `/wf:<id>` commands.
- Plugin-contributed commands go through the same loader path.
- Skill directories with `SKILL.md` become prompt commands.
- Builtin-name conflicts are rejected before registration.
- Development hot reload is available with `ROXY_COMMAND_WATCH=1`, `ROXY_DEV=1`, or `NODE_ENV=development`.

### P0.3 Tool Progress Contract

Status: Done. Implemented with streaming tool contracts, builtin progress events, and MCP streaming adapters.

Claude Code reference:

- `Tool.ts` defines per-tool `isConcurrencySafe(input)`, `isReadOnly(input)`, optional `isDestructive(input)`, and interrupt behavior.
- `BashTool/BashTool.tsx` and `PowerShellTool/PowerShellTool.tsx` consume async command generators and forward progress via `onProgress` before returning the final tool result.
- MCP tools keep a dedicated progress renderer and preserve read-only/destructive/open-world metadata from server annotations.

RoxyCode implementation:

- `src/tool/types.ts` now defines `ToolStreamEvent`, `ToolStream`, static `concurrencySafe`, static `destructive`, and optional `stream()` on `Tool`.
- `src/tool/builder/ToolBuilder.ts` bridges `stream()` tools into the existing `execute()` contract, forwarding progress to `ctx.onProgress` and preserving the existing `ToolExecutor -> PermissionGuard -> AuditLog` path.
- `read_file`, `grep_search`, and `execute_command` now implement async generator streams and yield structured progress before returning `ToolResult`.
- `write_file`, `edit_file`, `list_directory`, and `git` emit structured progress too, so every builtin tool has observable execution state.
- `McpToolAdapter` wraps MCP calls as streaming tools and maps `readOnlyHint`, `destructiveHint`, and `openWorldHint` into scheduling and permission metadata.
- Chinese progress copy was cleaned so status bar/tool activity output no longer displays mojibake.

Acceptance:

- Builtin tool progress can be rendered without parsing plain output.
- Concurrency and destructive metadata are available as static hints and input-aware functions for multi-agent scheduling.
- MCP tools are adapted as streaming tools and keep annotation-derived read-only/destructive/open-world metadata.

## Phase P1: Expand Ecosystem and Stability

### P1.1 MCP Transports

Status: Done. Implemented in MCP Transport 2.1 with six configured protocols and OAuth PKCE support.

Claude Code reference:

- `src/services/mcp/types.ts` models MCP transport variants and remote server metadata.
- `src/services/mcp/client.ts` selects stdio, SSE, streamable HTTP, and WebSocket transports, then drives the same JSON-RPC initialize/tools/list/tools/call loop.
- `src/services/mcp/auth.ts` handles OAuth/PKCE and secure token persistence for authenticated remote MCP servers.
- `src/utils/mcpWebSocketTransport.ts` wraps JSON-RPC messages over WebSocket callbacks.

RoxyCode implementation:

- `src/mcp/transports/Transport.ts` defines the shared JSON-RPC transport contract and normalizes six config values: `stdio`, `sse`, `http`, `streamable-http`, `ws`, `websocket`.
- `JsonRpcMcpClient` centralizes initialize, initialized notification, tools/list, tools/call, timeouts, and pending request handling.
- `StdioTransport` preserves the original process-based MCP path.
- `HTTPTransport` supports JSON-RPC POST and streamable HTTP responses with `application/json, text/event-stream` accept headers.
- `SSETransport` opens a server event stream, handles endpoint events, and posts client JSON-RPC messages back to the discovered endpoint.
- `WebSocketTransport` maps HTTP(S) URLs to WS(S), sends JSON-RPC over the `mcp` subprotocol, and fails clearly when the runtime has no global WebSocket.
- `OAuthFlow` implements PKCE request creation, authorization-code exchange, refresh, and token injection through remote transport headers.
- `TokenStore` stores tokens in a local JSON file with atomic write semantics; this is lighter than Claude Code keychain integration and can be swapped later.
- `/mcp init` now generates examples for stdio, HTTP, streamable HTTP, SSE, WS, WebSocket alias, and OAuth.

Tradeoff:

- Claude Code benefits from mature MCP SDK transports and secure OS credential storage.
- RoxyCode keeps dependencies minimal and user-visible configuration simpler, which is better for the current Chinese-first teaching/product stage, but future hardening should replace local token JSON with a keychain backend and add MCP SDK compatibility tests.

Acceptance:

- Existing stdio MCP behavior is unchanged.
- Six transport config values are validated, loaded, and factory-created.
- HTTP JSON-RPC initialize/tools/list/tools/call is test-covered.
- OAuth PKCE authorization URL, token exchange, refresh-ready storage, and authorization header injection are implemented.
- Tool annotations still map to read-only/destructive/open-world hints through the existing MCP tool adapter.
### P1.2 Hook and Character Behavior Extensions

Claude Code reference:

- Hook events are broad and can block or inject context.

RoxyCode plan:

- Keep command/prompt/http/agent hooks.
- Add character behavior overlays as a RoxyCode-specific hook type.
- Allow roles to bias review focus, explanation style, and risk preference without bypassing permissions.

Acceptance:

- Character hooks cannot directly grant tool permissions.
- Role behavior changes are visible in diagnostics.
- Existing hooks remain backward compatible.

### P1.3 Configuration Layers

Status: Done in `feat: add local config layer`.

Claude Code reference:

- Settings have clear source precedence, validation, and managed policy support.
- `userSettings -> projectSettings -> localSettings -> flagSettings -> policySettings` separates shared project settings from gitignored local overrides.

RoxyCode implementation:

- Effective precedence is now `default < global < project < local < env < session`.
- Added `.roxycode/config.local.json` for machine-local project overrides.
- `/config sources`, `/config paths`, and `/config validate` expose source, file, and env metadata.
- `/config set <path> <value> --scope local` writes local config and ensures `.roxycode/config.local.json` is gitignored when needed.
- Enterprise policy remains deferred until core UX and trust rules stabilize.

Acceptance:

- `/config sources` shows all effective layers.
- Validation errors show file/env source.
- Project-local overrides are gitignored by default.

## Execution Rule

Each completed subsection must be committed separately. When GitHub is reachable, push after each commit.
