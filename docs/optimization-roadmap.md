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
