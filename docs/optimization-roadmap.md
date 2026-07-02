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

### P0.1 Memory Index and Graph

Claude Code reference:

- `memdir` keeps a `MEMORY.md` index and structured memory files.
- Memory recall avoids loading everything blindly and warns that old memories may be stale.

RoxyCode plan:

- Add `MemoryIndex` for `MEMORY.md` rendering/parsing.
- Add `MemoryGraph` for `[[cross-link]]` extraction and relation graph.
- Make `MemoryStore` maintain per-scope `MEMORY.md` automatically.
- Add `MemoryStore.recallRelevant(query, limit)` as the store-level retrieval entry.

Acceptance:

- `MEMORY.md` is automatically updated after add/archive/clear.
- Index rendering is capped at 200 entries.
- Query recall returns top relevant memories.
- `[[cross-link]]` syntax is parsed and test-covered.

### P0.2 Dynamic Command Sources

Claude Code reference:

- Builtin, skills, plugins, MCP prompts, and dynamic skills are aggregated into one command list.

RoxyCode plan:

- Add `CommandSource` interface.
- Add `WorkflowCommandSource`, `PluginCommandSource`, and `SkillCommandSource`.
- Add `CommandLoader` to aggregate source discovery.
- Keep REPL's existing builtin command wiring, but make extension command loading less ad hoc.

Acceptance:

- `.roxycode/workflows/*.yml` can become slash commands.
- Plugin-contributed commands go through the same loader path.
- Disabled/hidden commands are consistently respected.

### P0.3 Tool Progress Contract

Claude Code reference:

- Tools expose progress through async generator events and carry concurrency/destructive hints.

RoxyCode plan:

- Preserve the current `ToolExecutor` contract for compatibility.
- Add a typed progress event adapter around builtin tools.
- Ensure `read_file`, `grep_search`, and `execute_command` emit progress metadata usable by UI/diagnostics.

Acceptance:

- Builtin tool progress can be rendered without parsing plain output.
- Concurrency and destructive metadata remain available to multi-agent scheduling.
- MCP tools keep annotations mapped into the same metadata model.

## Phase P1: Expand Ecosystem and Stability

### P1.1 MCP Transports

Claude Code reference:

- stdio, SSE, HTTP, WebSocket, SDK, and in-process transports.

RoxyCode plan:

- Introduce a `Transport` abstraction.
- Keep stdio stable first.
- Add SSE and HTTP clients before WebSocket/OAuth.

Acceptance:

- Existing stdio MCP behavior is unchanged.
- SSE/HTTP transport config can be validated and listed.
- Tool annotations still map to read-only/destructive/open-world hints.

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

Claude Code reference:

- Settings have clear source precedence, validation, and managed policy support.

RoxyCode plan:

- Preserve current default/global/project/env/session precedence.
- Add local gitignored config and profile layer visibility.
- Defer enterprise policy until core UX is stable.

Acceptance:

- `/config sources` shows all effective layers.
- Validation errors show file/env source.
- Project-local overrides are gitignored by default.

## Execution Rule

Each completed subsection must be committed separately. When GitHub is reachable, push after each commit.
