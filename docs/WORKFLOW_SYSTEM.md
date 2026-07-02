# RoxyCode Workflow / Skill System

RoxyCode workflow is the process layer for Chinese business development. It turns repeatable work such as Spring CRUD, Vue pages, bug fixing, test generation, and code review into project-customizable prompts that still run through the normal Agent Loop, ToolRegistry, PermissionGuard, Executor, and AuditLog.

## Claude Code Reference

Claude Code's related design is split across these files:

- `src/commands.ts`: aggregates built-in commands, skill directory commands, plugin commands, bundled skills, and workflow commands.
- `src/types/command.ts`: separates `local` commands from `prompt` commands. Skills/workflows are prompt-style commands with metadata such as `allowedTools`, `whenToUse`, `argumentHint`, `source`, and `kind?: 'workflow'`.
- `src/skills/loadSkillsDir.ts`: loads disk skills, parses frontmatter, and creates prompt commands through `createSkillCommand`.
- `src/skills/bundledSkills.ts`: registers built-in skills programmatically and exposes them through the same command contract.
- `src/utils/processUserInput/processSlashCommand.tsx`: expands prompt slash commands into model-visible messages, then lets the model/tool loop continue.

RoxyCode follows the same core idea: workflow files do not directly edit code or execute shell commands. They compile into structured prompts and enter the existing Agent Loop.

## RoxyCode Design

Implemented modules:

- `src/workflow/types.ts`: workflow schema, source/category/mode/tool types.
- `src/workflow/builtin.ts`: built-in Chinese workflows.
- `src/workflow/yaml.ts`: small YAML subset parser for `.roxycode/workflows/*.yml`.
- `src/workflow/WorkflowLoader.ts`: loads built-in and project workflows, with project workflows overriding same-id built-ins.
- `src/workflow/WorkflowPrompt.ts`: renders a workflow plus arguments into a structured prompt.
- `src/commands/builtin/workflow.ts`: `/workflow` command.
- `src/commands/sources/WorkflowCommandSource.ts`: exposes each workflow as a dynamic prompt command named `/wf:<id>`, with aliases and argument hints.
- `src/commands/CommandLoader.ts`: aggregates workflow commands with plugin and skill commands.
- `src/commands/CommandWatcher.ts`: reloads workflow commands in development mode when workflow files change.
- `src/engine/agent/RuntimeContext.ts`: injects an available workflow summary into runtime context.

## Built-In Workflows

- `spring-crud`: Spring Boot CRUD module generation or modification.
- `vue-page`: Vue business page implementation.
- `bug-fix`: evidence-first debugging and minimal fix.
- `test-generate`: test generation aligned to the existing framework.
- `code-review`: issue-first code review with file/line references.

## Commands

```text
/workflow
/workflow list
/workflow show spring-crud
/workflow run spring-crud --entity User --fields "name, email, status"
/workflow run vue-page --page 采购组织查询 --requirements "弹窗选择后回填字段"
/workflow run bug-fix --symptom "选择角色返回未知命令"
/workflow run test-generate --target src/workflow
/workflow run code-review
/workflow paths
/wf:spring-crud --entity User --fields "name, email, status"
/wf:vue-page --page 采购组织查询 --requirements "弹窗选择后回填字段"
```

`/workflow run` and dynamic `/wf:<id>` commands both render a workflow prompt, write it into the JSONL session, and call the existing Agent Loop. File changes and shell commands still require the normal RoxyCode permission confirmation.

Development hot reload is opt-in. Set one of these before starting RoxyCode: `ROXY_COMMAND_WATCH=1`, `ROXY_DEV=1`, or `NODE_ENV=development`.

## Custom Workflow YAML

Place project workflows under `.roxycode/workflows/*.yml`.

Supported YAML subset:

- top-level `key: value`
- block strings with `|`
- string arrays:

```yaml
tags:
  - spring
  - crud
```

- simple object arrays:

```yaml
inputs:
  - name: entity
    label: 实体名称
    required: true
```

Example:

```yaml
id: erp-dialog-field
name: ERP 弹窗回填字段
description: 为 ERP 页面字段添加弹窗选择与回填逻辑
mode: standard
category: frontend
tags:
  - vue
  - erp
inputs:
  - name: page
    label: 页面名称
    required: true
  - name: fields
    label: 回填字段
    required: true
prompt: |
  先查找页面相似弹窗实现，再按现有 er-window / erPropFormName / popFormHelper 约定实现。
  获取数据后必须回填用户指定字段，并保持页面现有校验和保存逻辑不变。
steps:
  - 查找相似字段弹窗实现。
  - 定位目标页面和字段定义。
  - 添加弹窗组件、ref、ok handler 和回填逻辑。
  - 运行项目已有类型检查或构建命令。
allowedTools:
  - read_file
  - edit_file
  - grep_search
  - execute_command
verify:
  - 检查字段是否正确回填。
  - 确认没有破坏已有保存和校验流程。
```

## RoxyCode Advantage

Claude Code's Skill system is general and powerful. RoxyCode keeps that command/prompt separation, but adds a more explicit Chinese business workflow layer:

- workflow schema is readable for Chinese enterprise developers;
- built-in flows target Spring/Vue/Bug/Test/Review instead of only generic coding;
- prompts include Chinese execution steps and verification requirements;
- role customization remains available, but safety rules still override style;
- project workflows can override built-ins, making every user's RoxyCode closer to a personalized Claude Code.
