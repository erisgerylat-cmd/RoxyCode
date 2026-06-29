# RoxyCode Aesthetic And Character Customization

This document describes phase 10: anime-style aesthetics and deep character customization.

## Goal

RoxyCode is not only a Claude Code-like coding agent with a different skin. The product direction is a personal anime coding workbench for Chinese users who care about both engineering efficiency and aesthetic customization.

The design keeps Claude Code's professional interaction baseline: clear status, reliable command metadata, safe tool permissions, streaming output, and project-local configuration. On top of that, RoxyCode makes character customization a first-class product layer.

## Claude Code Reference

Reference source:

- `D:\Programing\cc\claude-code-main\src\utils\theme.ts`
- `D:\Programing\cc\claude-code-main\src\commands\theme\index.ts`
- `D:\Programing\cc\claude-code-main\src\buddy\companion.ts`
- `D:\Programing\cc\claude-code-main\src\buddy\prompt.ts`
- `D:\Programing\cc\claude-code-main\src\buddy\types.ts`

Claude Code design points:

- Theme is a semantic terminal color system. It optimizes accessibility, terminal compatibility, and consistent UI meaning.
- `/theme` is a local command that changes UI presentation without changing agent behavior.
- Buddy/companion is a separate watcher beside the input box. It is not Claude itself.
- Companion bones are deterministically generated from user identity, while the stored soul contains only editable personality data.

RoxyCode choices:

- Keep the same safety boundary: character style never bypasses permissions, high-risk confirmation, or factual verification.
- Expand the character layer beyond UI theme: character behavior influences explanation style, review focus, risk preference, and preferred work mode.
- Let project-local `.roxycode/characters/*.json` override global characters so a user can make each project feel like their own personalized Claude Code.

## New Commands

### `/aesthetic`

Show current aesthetic mode and the current character's companion/behavior summary.

### `/aesthetic minimal`

Focused professional mode. It keeps RoxyCode clean and practical for long coding sessions, bug fixing, and reviews.

### `/aesthetic balanced`

Default mode. It keeps character theme, status terms, moderate flavor lines, and professional output.

### `/aesthetic immersive`

Anime workbench mode. It emphasizes splash art, character lines, companion hints, and learning-friendly explanations.

Implementation:

- Command file: `src/commands/builtin/aesthetic.ts`
- Config path: `ui.aestheticMode`
- Type: `AestheticMode = 'minimal' | 'balanced' | 'immersive'`

Claude Code comparison:

- Similar to `/theme`, this is a local command that writes config.
- RoxyCode differs by treating aesthetic intensity as a coordination setting across splash, character, companion, status words, and prompt behavior.

### `/character create <id>`

Create a project-local custom character template at:

```text
.roxycode/characters/<id>.json
```

Options:

- `--force`: overwrite an existing template.
- `--from-current`: start from the active character instead of the default custom template.

Other related commands:

- `/character list`
- `/character info [id]`
- `/character paths`
- `/character <id>`

## Loading Priority

Character loading order:

1. Built-in characters from `src/aesthetic/character/characters`.
2. Global custom characters from `~/.roxycode/characters/*.json`.
3. Project custom characters from `.roxycode/characters/*.json`.

When ids collide, later sources override earlier sources:

```text
project > global > builtin
```

This mirrors Claude Code's layered configuration idea, but applies it to the aesthetic and personal workbench layer.

## Character Template

A custom character JSON contains these main sections:

```json
{
  "schemaVersion": 1,
  "id": "my-waifu-dev",
  "name": "我的编程搭子",
  "nameEn": "My Coding Partner",
  "title": "二次元全栈术师",
  "description": "擅长把复杂工程问题拆成清晰步骤的中文 AI 编程伙伴。",
  "personality": "温柔、细致、有审美追求，喜欢先讲清楚原因再动手。",
  "theme": {
    "primary": "#5B9BD5",
    "secondary": "#7EC8E3",
    "accent": "#FFD166",
    "tagline": "#98D8C8",
    "dim": "#888888",
    "error": "#E85D75",
    "success": "#4ECDC4"
  },
  "statusText": {
    "thinking": "整理思路",
    "analyzing": "解析线索",
    "planning": "编排行动",
    "executing": "执行术式",
    "reading": "翻阅 {file}",
    "writing": "铭刻 {file}",
    "running": "运行 {cmd}",
    "searching": "搜索线索",
    "waiting": "等待回应",
    "done": "任务完成",
    "error": "术式偏移",
    "step": "第 {current}/{total} 步：{desc}"
  },
  "splash": {
    "asciiArt": ["  RRR    OOO   X   X  Y   Y"],
    "tagline": "Personal Anime Coding Workbench",
    "welcome": "欢迎回来，今天也一起写出漂亮又可靠的代码吧。",
    "tips": ["输入 /aesthetic minimal|balanced|immersive 切换审美强度。"]
  },
  "companion": {
    "name": "小像素",
    "kind": "pixel familiar",
    "art": ["  /\\_/\\", " ( o.o )", "  > ^ < "],
    "idleLines": ["我在旁边看着，有需要就叫我。"],
    "thinkingLines": ["正在把线索排成队。"],
    "successLines": ["完成了，收尾也很漂亮。"],
    "warningLines": ["这个操作有风险，先确认一下。"]
  },
  "behavior": {
    "explanationStyle": "teaching",
    "reviewFocus": ["correctness", "testing", "learning"],
    "riskPreference": "conservative",
    "preferredMode": "standard",
    "workflowBias": ["修改前先说明计划", "完成后给出验证结果"],
    "responseRules": ["先给结论，再解释原因", "复杂概念用中文拆解"]
  },
  "systemPromptPersona": "你是一个二次元风格的中文编程伙伴，但事实核验、工具权限、安全规则永远优先。"
}
```

JSON cannot store functions, so dynamic strings use placeholders:

- `{file}` in `reading` and `writing`
- `{cmd}` in `running`
- `{tool}` in `errorMessages.toolFailed`
- `{current}`, `{total}`, `{desc}` in `step`

The loader converts these strings into runtime functions.

## Behavior Strategy

`behavior` is the key RoxyCode difference.

Fields:

- `explanationStyle`: `concise`, `structured`, `teaching`, `deep`, `playful`
- `reviewFocus`: `correctness`, `security`, `performance`, `maintainability`, `testing`, `ux`, `learning`
- `riskPreference`: `conservative`, `balanced`, `bold`
- `preferredMode`: `lite`, `economic`, `standard`, `ultimate`
- `workflowBias`: custom process preferences
- `responseRules`: custom answer rules

This behavior is injected into `buildAgentSystemPrompt()` in `src/engine/agent/prompts.ts`.

Important boundary:

- Character behavior can change wording, explanation depth, review emphasis, and workflow suggestions.
- Character behavior cannot disable permission confirmation, file backup, path restrictions, or high-risk second confirmation.

## Implementation Files

Core types:

- `src/aesthetic/character/types.ts`
- `src/core/types/config.ts`

Custom character loading:

- `src/aesthetic/character/custom/CharacterTemplate.ts`
- `src/aesthetic/character/custom/CustomCharacterLoader.ts`
- `src/aesthetic/character/CharacterManager.ts`

Commands:

- `src/commands/builtin/aesthetic.ts`
- `src/commands/builtin/character.ts`
- `src/commands/builtin/index.ts`

Rendering and prompt injection:

- `src/ui/renderers/CharacterArt.ts`
- `src/engine/agent/prompts.ts`

Startup integration:

- `src/index.ts`

## Product Template For Users

When designing your own RoxyCode workbench, fill in these decisions first:

```text
1. Character identity
   - id:
   - Chinese name:
   - English name:
   - title:
   - personality:

2. Visual identity
   - primary color:
   - secondary color:
   - accent color:
   - splash ascii/pixel art:

3. Status vocabulary
   - thinking:
   - planning:
   - executing:
   - reading file:
   - writing file:
   - running command:
   - success:
   - error:

4. Pixel companion
   - name:
   - kind:
   - 3-8 line ASCII art:
   - idle line:
   - thinking line:
   - success line:
   - warning line:

5. Agent behavior
   - explanation style:
   - review focus:
   - risk preference:
   - preferred mode:
   - workflow bias:
   - response rules:

6. Safety identity
   - How should this character explain risk in Chinese?
   - What operations should it be extra cautious about?
   - What should it always verify before final answers?
```

Recommended presets:

- Learning partner: `teaching`, `learning/testing`, `conservative`, `standard`.
- Review specialist: `structured`, `correctness/security/maintainability`, `conservative`, `ultimate`.
- Fast coding buddy: `concise`, `correctness/performance`, `balanced`, `economic`.
- Vibe coding workbench: `playful`, `ux/learning/testing`, `balanced`, `standard`.

## Current Tradeoffs

Advantages over Claude Code for this product goal:

- Character customization affects the user's learning and coding workflow, not only colors.
- Project-level characters make each project feel like a distinct personal workbench.
- Chinese-first templates make customization understandable for the target audience.

Advantages retained from Claude Code:

- Theme/config is command-driven and persisted.
- Companion remains conceptually separate from the agent itself.
- Safety and permission systems are not controlled by character personality.

Known limitations:

- Custom character changes require restart; hot reload can be added later.
- Aesthetic mode currently stores intensity and is surfaced in commands/status; deeper renderer-specific behavior can be expanded gradually.
- Global character writes are intentionally not used by `/character create`; project-local templates are safer and easier to review.
