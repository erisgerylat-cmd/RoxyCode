# RoxyCode 角色包规范 v1.0

本文档定义 RoxyCode 可安装角色包（`.roxychar`）的标准目录、清单文件、角色定义、打包格式与最佳实践。

对照 Claude Code：Claude Code 的插件体系把 `plugin.json` 元信息、installed plugin metadata、commands/hooks/skills/MCP 等贡献内容分层管理，并要求插件路径使用相对路径。RoxyCode 角色包采用同样的工程边界：`manifest.json` 只描述包与贡献入口，`character.json` 承载角色定义，资源与扩展能力通过相对路径引用，最终仍进入 RoxyCode 既有的角色、Hooks、Workflow、权限和审计流程。

## 1. 文件结构

```text
my-character/                        # 角色包根目录
├── manifest.json                    # 包元信息（必需）
├── character.json                   # 角色定义（必需）
├── README.md                        # 说明文档（推荐）
├── LICENSE                          # 许可证（推荐）
├── .roxycharignore                  # 打包忽略规则（可选）
├── assets/                          # 资源文件目录
│   ├── icon.png                     # 图标 256x256（推荐）
│   ├── avatar.png                   # 头像 512x512（可选）
│   ├── splash-art.txt               # 启动画面 ASCII art（可选）
│   └── sprites/                     # 小伙伴精灵图（可选）
│       ├── idle-1.txt
│       ├── idle-2.txt
│       ├── thinking.txt
│       ├── success.txt
│       └── error.txt
├── behaviors/                       # 行为扩展（可选）
│   ├── hooks.json                   # Hooks 定义
│   ├── workflows/                   # 预置工作流
│   │   ├── explain-code.yml
│   │   └── code-review.yml
│   └── prompts/                     # 自定义提示模板
│       ├── system-prompt.md
│       └── plan-prompt.md
├── themes/                          # 主题扩展（可选）
│   └── terminal-colors.json         # 终端配色方案
└── i18n/                            # 多语言（可选）
    ├── zh-CN.json
    ├── en-US.json
    └── ja-JP.json
```

设计原则：

- `manifest.json` 是角色包入口，负责包名、版本、作者、兼容性、贡献入口和商城元数据。
- `character.json` 完全遵循 `Character` 接口定义，是运行时加载角色的核心文件。
- `assets/` 只放展示资源，不应包含脚本或可执行文件。
- `behaviors/` 中的 hooks、workflows、prompts 只能声明扩展能力，不能绕过 RoxyCode 的权限确认、安全检查和审计日志。
- 所有路径均相对于角色包根目录，禁止使用绝对路径、`..`、驱动器路径或 URL 路径来引用本地文件。

## 2. manifest.json 规范

正式 `manifest.json` 必须是标准 JSON，不允许注释。下面示例使用 JSONC 注释仅用于解释字段含义。

```jsonc
{
  "$schema": "https://roxycode.dev/schemas/manifest.v1.json",

  "name": "roxy-sensei",             // 包名（必需，全局唯一，kebab-case）
  "version": "1.2.0",                // 版本号（必需，SemVer）
  "displayName": "洛琪希老师",        // 显示名称（必需）
  "description": "来自《无职转生》的蓝发魔法师，温柔耐心的编程导师",

  "author": {                        // 作者信息（必需）
    "name": "tanghao",
    "email": "tanghao@example.com",
    "url": "https://github.com/tanghao"
  },

  "license": "MIT",                  // 许可证（推荐）
  "repository": {                    // 仓库信息（可选）
    "type": "git",
    "url": "https://github.com/roxycode/character-roxy-sensei"
  },

  "keywords": [                      // 关键词（推荐，用于搜索）
    "mushoku-tensei",
    "anime",
    "magic",
    "teacher",
    "beginner-friendly"
  ],

  "categories": ["anime", "teaching"],

  "engines": {                       // 兼容性要求（推荐）
    "roxycode": ">=0.2.0"
  },

  "main": "character.json",          // 入口文件（必需）

  "contributes": {                   // 贡献内容（可选）
    "character": "character.json",
    "workflows": ["behaviors/workflows/*.yml"],
    "hooks": "behaviors/hooks.json",
    "themes": ["themes/*.json"]
  },

  "dependencies": {                  // 依赖（可选）
    "@roxycode/workflow-base": "^1.0.0"
  },

  "metadata": {                      // 元数据（商城用）
    "source": "Mushoku Tensei",
    "characterType": "teacher",
    "tags": ["blue-hair", "magic", "water-element"],
    "ageRating": "everyone",
    "preview": "https://example.com/preview.gif"
  }
}
```

字段要求：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `$schema` | 推荐 | JSON Schema 地址，用于编辑器提示和后续 `/character validate`。 |
| `name` | 是 | 全局唯一包名，必须是 kebab-case，如 `roxy-sensei`。 |
| `version` | 是 | SemVer 版本，如 `1.2.0`。 |
| `displayName` | 是 | 面向用户展示的名称，可使用中文。 |
| `description` | 是 | 一句话说明角色定位和使用场景。 |
| `author` | 是 | 作者信息，至少包含 `name`。 |
| `license` | 推荐 | SPDX 许可证标识，如 `MIT`、`Apache-2.0`、`CC-BY-4.0`。 |
| `repository` | 可选 | 源码仓库信息。 |
| `keywords` | 推荐 | 搜索关键词。 |
| `categories` | 推荐 | 商城分类。 |
| `engines.roxycode` | 推荐 | RoxyCode 兼容版本范围。 |
| `main` | 是 | 角色定义入口，v1 必须指向 `character.json` 或等价相对路径。 |
| `contributes` | 可选 | 声明角色包贡献的角色、workflow、hook、theme 等内容。 |
| `dependencies` | 可选 | 角色包依赖，后续用于商城安装依赖解析。 |
| `metadata` | 可选 | 商城展示、审核、搜索和分级使用的补充信息。 |

## 3. character.json 规范

`character.json` 完全遵循 TypeScript `Character` 接口定义，所有资源路径为相对于角色包根目录的相对路径。

关键字段分组：

- 核心字段：`id`、`name`、`nameEn`、`title`、`description`、`personality`
- 主题配色：`theme`
- 行为定义：`behavior`
- UI 文案：`statusText`、`splash`、`easterEggs`、`errorMessages`
- AI 行为：`systemPromptPersona`
- 小伙伴：`companion`
- 包信息：`packageInfo`
- 资源文件：`assets`
- 扩展能力：`extensions`
- 多语言：`i18n`
- 元数据：`metadata`

示例片段：

```json
{
  "id": "roxy-sensei",
  "name": "洛琪希老师",
  "nameEn": "Roxy Sensei",
  "title": "温柔耐心的编程导师",
  "description": "适合初学者和希望获得清晰解释的中文开发者。",
  "personality": "耐心、严谨、善于拆解复杂问题。",
  "theme": {
    "primary": "#5B9BD5",
    "secondary": "#7EC8E3",
    "accent": "#FFD166",
    "tagline": "#98D8C8",
    "dim": "#888888",
    "error": "#E85D75",
    "success": "#4ECDC4"
  },
  "behavior": {
    "explanationStyle": "teaching",
    "reviewFocus": ["correctness", "testing", "learning"],
    "riskPreference": "conservative",
    "preferredMode": "standard",
    "workflowBias": ["explain before editing", "verify after changes"],
    "responseRules": ["use clear Chinese", "state risks before dangerous operations"]
  },
  "assets": {
    "icon": "assets/icon.png",
    "avatar": "assets/avatar.png",
    "splashArt": ["assets/splash-art.txt"],
    "sprites": {
      "idle": ["assets/sprites/idle-1.txt", "assets/sprites/idle-2.txt"],
      "thinking": ["assets/sprites/thinking.txt"],
      "success": ["assets/sprites/success.txt"],
      "error": ["assets/sprites/error.txt"]
    }
  },
  "extensions": {
    "hooks": "behaviors/hooks.json",
    "workflows": ["behaviors/workflows/explain-code.yml"],
    "prompts": {
      "systemPrompt": "behaviors/prompts/system-prompt.md",
      "planPrompt": "behaviors/prompts/plan-prompt.md"
    }
  },
  "metadata": {
    "source": "Mushoku Tensei",
    "characterType": "teacher",
    "tags": ["blue-hair", "magic", "teacher"],
    "ageRating": "everyone"
  }
}
```

注意：JSON 无法表达函数。角色包里的 `statusText.reading`、`errorMessages.toolFailed` 等函数型字段应使用字符串模板形式保存，例如 `"Reading {file}"`、`"{tool} failed"`，由 RoxyCode loader 归一化为运行时函数。

## 4. 打包格式

- 文件扩展名：`.roxychar`
- 实际格式：ZIP 压缩包
- 压缩算法：DEFLATE
- 最大大小：50MB
- 推荐大小：小于 10MB
- 根目录要求：压缩包根目录必须直接包含 `manifest.json` 与 `character.json`，不应多包一层无意义目录。

打包时应应用 `.roxycharignore`，语法参考 `.gitignore` 的常见子集：

```gitignore
node_modules/
dist/
*.log
.DS_Store
Thumbs.db
.env
*.key
```

## 5. 命名约定

- 包名：kebab-case，如 `roxy-sensei`
- 文件名：kebab-case，如 `system-prompt.md`
- 目录名：kebab-case，如 `splash-art/`
- 资源文件：kebab-case.ext，如 `idle-1.txt`
- 角色 ID：推荐与包名一致，或使用包名前缀，如 `roxy-sensei`
- Workflow ID：推荐带角色名前缀，如 `roxy-sensei-code-review`

## 6. 最佳实践

### 6.1 图标设计

- 使用 PNG 格式。
- 推荐尺寸：256x256 或 512x512。
- 使用透明背景。
- 保持简洁、识别性强，避免过细线条。

### 6.2 ASCII Art

- 使用 UTF-8 编码。
- 避免特殊控制字符和 ANSI 转义序列。
- 宽度建议小于 80 字符。
- 高度建议小于 20 行。
- 保留纯文本降级效果，确保不依赖特定字体也能识别角色主题。

### 6.3 版本管理

- 遵循语义化版本（SemVer）。
- 主版本号：不兼容的角色包结构或行为 API 变更。
- 次版本号：向下兼容的功能新增，如新增 workflow、语言包、资源。
- 修订号：向下兼容的 bug 修复，如文案修正、资源路径修正。

### 6.4 README.md

推荐包含：

- 角色介绍。
- 截图或预览 GIF。
- 安装方法。
- 使用说明。
- 贡献内容列表。
- 兼容的 RoxyCode 版本。
- 变更日志。
- 版权与二创声明。

### 6.5 许可证选择

- `MIT`：最宽松，适合代码和配置模板。
- `Apache-2.0`：商业友好，带专利授权条款。
- `CC-BY-4.0`：创作共享，允许商用但需署名。
- `CC-BY-NC-4.0`：非商业用途，适合多数同人资源。

## 7. Schema、市场索引与完整性

### 7.1 JSON Schema

RoxyCode 维护两份静态 JSON Schema：

- `schemas/manifest.v1.json`：对应 `manifest.json`。
- `schemas/character.v1.json`：对应角色包里的 `character.json`。

生成命令：

```bash
pnpm run schema:characters
```

这两份 schema 从 `src/aesthetic/character/CharacterSchema.ts` 中的 Zod schema 生成。运行时 `CharacterSchema` 仍允许内置角色使用函数型 renderer；角色包文件使用 `CharacterPackageJsonSchema`，只允许字符串模板。这样既保留 RoxyCode 内置角色的动态能力，又让外部角色包保持纯 JSON、可校验、可被编辑器提示。

### 7.2 marketplace.json

角色包市场索引用 `marketplace.json` 描述一组可发现角色包。当前阶段支持本地文件和本地目录索引，远程 URL 只做元数据展示与完整性提示。

示例：

```json
{
  "schemaVersion": 1,
  "name": "personal-characters",
  "displayName": "个人角色包市场",
  "description": "适合中文开发者的 RoxyCode 二次元角色包合集。",
  "owner": {
    "name": "tanghao"
  },
  "packages": [
    {
      "name": "roxy-sensei",
      "version": "1.2.0",
      "displayName": "洛琪希老师",
      "description": "温柔耐心的编程导师角色包。",
      "source": "./packages/roxy-sensei",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "categories": ["anime", "teaching"],
      "tags": ["beginner-friendly", "chinese-first"]
    }
  ]
}
```

命令：

```text
/character marketplace validate ./marketplace.json
/character marketplace list ./marketplace.json
```

校验内容：

- `marketplace.json` schema。
- 包名、版本、展示信息。
- 重复 `name@version`。
- 本地 source 是否存在。
- 本地 source 的角色包是否能通过 `/character validate`。
- entry 中 `name/version/displayName` 与包内 `manifest.json` 是否一致。
- 远程 URL 是否提供 SHA-256。

### 7.3 SHA-256 完整性校验

`.roxychar` 打包时会自动计算 SHA-256，并输出同名 `.sha256` 文件：

```text
/character pack .roxycode/characters/roxy-sensei --out ./dist
```

输出：

- `dist/roxy-sensei-1.2.0.roxychar`
- `dist/roxy-sensei-1.2.0.roxychar.sha256`

安装前可执行：

```text
/character verify ./dist/roxy-sensei-1.2.0.roxychar
/character verify ./dist/roxy-sensei-1.2.0.roxychar --sha256 <hash>
```

RoxyCode 当前只做完整性校验，不把 SHA-256 当作“作者可信”的证明。它能证明文件未被意外篡改，但不能证明发布者身份。后续远程 marketplace 和公钥签名会在这个基础上继续扩展。

## 8. 安全与权限边界

角色包不能直接获得额外工具权限。即使角色包贡献 hooks、workflows、prompts 或未来 tools，也必须进入 RoxyCode 已有链路：

```text
Character Package
  -> manifest validation
  -> character/workflow/hook loading
  -> CommandRegistry / HookManager / ToolRegistry
  -> PermissionGuard
  -> ToolExecutor
  -> AuditLog
```

必须拒绝或警告的内容：

- 绝对路径，如 `/etc/passwd`、`C:\Users\...`。
- 路径逃逸，如 `../secret.txt`。
- 隐藏密钥文件，如 `.env`、`*.key`、`id_rsa`。
- 可执行二进制文件，除非未来明确引入签名与信任策略。
- 远程脚本自动执行。

## 9. 与 Claude Code 的对照

Claude Code 参考点：

- `src/utils/plugins/schemas.ts`：用 schema 定义插件 manifest、作者、相对路径、marketplace entry、installed plugin metadata。
- `src/utils/plugins/validatePlugin.ts`：提供开发者可运行的 manifest 校验，并对 marketplace-only 字段、kebab-case、缺失版本/作者等给出警告。
- `src/cli/handlers/plugins.ts`：提供 `plugin validate/list/marketplace` 等命令入口。
- `src/buddy/companion.ts` 与 `src/buddy/CompanionSprite.tsx`：把 companion 展示状态与运行逻辑分离。
- `src/utils/theme.ts`：主题只影响呈现层，不直接影响工具权限。

RoxyCode 选择：

- 保留 Claude Code 的 manifest 分层思想。
- 将插件生态中的“可安装能力”收敛成中文用户更容易理解的“角色包”。
- 角色包可以影响审美、解释风格、审查重点、风险偏好和工作流默认倾向。
- 角色包不能绕过工具权限、路径限制、高危二次确认和审计日志。
- RoxyCode 额外提供静态 JSON Schema、中文 marketplace 校验命令和 SHA-256 sidecar，优先降低中文角色包作者的打包与发布门槛。

## 10. 后续版本计划

v1.1 可扩展内容：

- 资源尺寸、编码、路径安全的自动校验。
- 远程 marketplace 注册、缓存、刷新与移除。
- 从 marketplace 直接安装角色包。
- 公钥签名、作者身份校验与可信来源策略。
- marketplace 依赖解析和跨市场依赖 allowlist。
