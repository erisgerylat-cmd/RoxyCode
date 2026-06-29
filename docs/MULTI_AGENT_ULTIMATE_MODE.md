# RoxyCode Multi-Agent Ultimate Mode

This document records phase 12: making Ultimate mode an explicit multi-agent product capability.

## Claude Code Reference

Claude Code has a mature agent runtime built around task state, subagents, coordinator mode, permission flow, and UI task visibility. The most relevant source areas are:

- `D:\Programing\cc\claude-code-main\src\tools\TaskCreateTool\TaskCreateTool.ts`
- `D:\Programing\cc\claude-code-main\src\tools\TaskListTool\TaskListTool.ts`
- `D:\Programing\cc\claude-code-main\src\tools\TaskUpdateTool\TaskUpdateTool.ts`
- `D:\Programing\cc\claude-code-main\src\tasks\InProcessTeammateTask\types.ts`
- `D:\Programing\cc\claude-code-main\src\utils\swarm\backends\InProcessBackend.ts`
- `D:\Programing\cc\claude-code-main\src\hooks\toolPermission\handlers\coordinatorHandler.ts`
- `D:\Programing\cc\claude-code-main\src\constants\tools.ts`

The key Claude Code ideas are:

1. Tasks are first-class runtime state, not just text in a prompt.
2. Subagents have identities, progress, and isolated execution state.
3. Coordinator mode separates task management from normal tool execution.
4. Permission decisions are still centralized and cannot be bypassed by subagents.
5. Atomic `claim()` style guards are used before async operations that race.

## RoxyCode Implementation

New implementation files:

- `src/engine/multi-agent/types.ts`
- `src/engine/multi-agent/Coordinator.ts`
- `src/engine/multi-agent/TaskGraph.ts`
- `src/engine/multi-agent/TaskClaimStore.ts`
- `src/engine/multi-agent/FileLockManager.ts`
- `src/engine/multi-agent/ConflictMerger.ts`
- `src/engine/multi-agent/MultiAgentRuntime.ts`
- `src/commands/builtin/agents.ts`

Integration points:

- `src/engine/agent/AgentLoop.ts`: Ultimate mode now runs `MultiAgentRuntime` before the normal plan/tool/verify loop.
- `src/engine/agent/types.ts`: `AgentLoopEvent` includes multi-agent events.
- `src/ui/repl/REPL.ts`: renders plan, claim, start, done, conflict, and merge events.
- `src/commands/builtin/index.ts`: registers `/agents` for status, locks, and paths.

## Runtime Flow

```text
Ultimate mode
  -> Coordinator creates a task plan
  -> TaskGraph validates dependencies
  -> TaskClaimStore initializes .roxycode/multi-agent/<runId>/state.json
  -> ready tasks are selected by dependency state
  -> each ready task atomically claims <taskId>.claim.json
  -> FileLockManager atomically locks file scopes
  -> sub-agent analyzes in parallel
  -> ConflictMerger creates one summary report
  -> report is injected into the main Agent Loop
  -> main Agent performs real tools through PermissionGuard and AuditLog
```

## Why Subagents Do Not Write Files Yet

Claude Code can run deeper in-process teammate loops because it has a larger AppState, permission queue, transcript, and worker isolation system.

RoxyCode already has the critical safety chain:

```text
ToolRegistry -> PermissionGuard -> Executor -> AuditLog
```

The first multi-agent version deliberately keeps subagents in analysis mode. They can inspect the goal, split responsibilities, find risks, and propose file scopes, but they do not directly write files or run shell commands. The main Agent receives their merged report and continues through the existing tool loop.

This has three advantages for the current RoxyCode stage:

1. It preserves the existing role system, context system, workflow system, memory system, hooks, MCP tools, and permission confirmation panel.
2. It prevents parallel writers from bypassing project path limits, write backups, shell confirmation, or high-risk second confirmation.
3. It still gives users the visible Ultimate product experience: coordinator, claims, locks, dependency graph, parallel analysis, conflict report, and audit files.

The tradeoff is that true parallel editing is not enabled yet. That can be added later by giving each subagent a scoped `ToolExecutor` context and enforcing file locks inside write tools.

## Atomic Claim

`TaskClaimStore.claim()` uses `fs.open(path, 'wx')` to create:

```text
.roxycode/multi-agent/<runId>/claims/<taskId>.claim.json
```

If the file already exists, the claim fails. This mirrors Claude Code's use of atomic claim guards before async permission or worker actions.

## File Locks

`FileLockManager.acquireMany()` creates lock files under:

```text
.roxycode/multi-agent/<runId>/locks/<sha256>.lock.json
```

Paths are normalized and sorted before lock acquisition. Sorting avoids deadlock when multiple tasks request multiple paths in different orders. The locks are advisory in this first version: they coordinate RoxyCode's multi-agent runtime, while real writes still go through the main permission chain.

## Dependency Graph

`TaskGraph` validates:

- missing dependencies
- cycles
- ready tasks whose dependencies are done

If a task has invalid dependencies, it becomes blocked and the user sees a Chinese conflict explanation in the REPL.

## Conflict Merge

`ConflictMerger` produces a single report with:

- Coordinator notes
- each subagent result
- conflicts or serialized file scopes
- explicit guidance that the main Agent must execute real tools safely

This report is appended as a user message to the main Agent Loop, so the model can use the subagent findings during normal planning and tool calls.

## User Commands

```text
/agents
/agents status
/agents locks
/agents paths
```

These commands are read-only. They inspect `.roxycode/multi-agent` and never modify files outside RoxyCode's state directory.

## Product Difference

Claude Code's multi-agent system is a mature runtime for general coding automation.

RoxyCode uses the same engineering ideas but makes Ultimate mode understandable for Chinese users:

- explicit Coordinator plan display
- Chinese task and conflict text
- visible claim and lock state
- safe-by-default subagent analysis
- future compatibility with character style, learning memory, workflow bias, and anime workbench customization

This makes Ultimate mode a visible RoxyCode product capability instead of a hidden prompt trick.