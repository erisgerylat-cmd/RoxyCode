# RoxyCode 角色包 CLI 手册

本文档说明如何在 RoxyCode 内创建、校验、打包、安装、卸载、更新和导出角色包。

对照 Claude Code：Claude Code 将插件生态拆成 `plugin validate`、`plugin install`、`plugin list`、marketplace 和 installed metadata 等入口。RoxyCode 采用同样的工程边界，但把能力收敛到中文用户更容易理解的 `/character` 命令族，并围绕二次元角色定制、中文工作流和安全安装体验组织输出。

## 1. 快速流程

```text
/character create roxy-sensei --package
/character validate ./.roxycode/characters/roxy-sensei
/character pack ./.roxycode/characters/roxy-sensei --out ./dist
/character verify ./dist/roxy-sensei-0.1.0.roxychar
/character install ./dist/roxy-sensei-0.1.0.roxychar
/character roxy-sensei
```

从当前角色复制主题、状态文案、行为策略和角色语气：

```text
/character create my-sensei --package --from-current
```

## 2. 创建

### `/character create <id> --package`

生成标准角色包目录：

```text
.roxycode/characters/<id>/
├── manifest.json
├── character.json
├── README.md
├── LICENSE
├── assets/
│   └── splash-art.txt
├── behaviors/
│   ├── workflows/
│   └── prompts/
└── i18n/
    └── zh-CN.json
```

常用参数：

- `--package`：生成标准目录包，而不是旧版单文件 JSON。
- `--from-current`：从当前角色复制主题、文案和行为策略。
- `--force`：覆盖已有目录。

准备分享、安装、导出或进入 marketplace 的角色应使用标准包。个人实验角色可以继续使用旧版单文件 JSON。

## 3. 校验

### `/character validate <path>`

支持目录和 `.roxychar`：

```text
/character validate ./my-character
/character validate ./dist/roxy-sensei.roxychar
```

校验内容：

- `manifest.json` 是否存在并符合 schema。
- `character.json` 是否符合角色包 JSON schema。
- `assets`、`extensions`、`i18n` 引用的文件是否存在。
- `contributes.workflows`、`contributes.hooks`、`contributes.themes` 是否能解析。
- 路径是否逃逸角色包根目录。
- 是否缺少 README、LICENSE、icon、`engines.roxycode` 等推荐信息。
- `.roxychar` 是否能安全解压后继续校验。

`error` 表示不能安装或打包，必须修复。`warning` 表示可以继续使用，但建议发布前补齐。

Claude Code 对照：这对应 `src/utils/plugins/validatePlugin.ts` 的思路。Claude Code 对插件 manifest、hooks、commands、skills 等贡献内容做 schema 与路径检查；RoxyCode 对角色包的 manifest、角色定义、资源、扩展和 i18n 做同类检查。

## 4. 打包

### `/character pack <package-dir>`

```text
/character pack ./.roxycode/characters/roxy-sensei
/character pack ./.roxycode/characters/roxy-sensei --out ./dist
/character pack ./.roxycode/characters/roxy-sensei --out ./dist --force
```

输出：

```text
dist/<name>-<version>.roxychar
dist/<name>-<version>.roxychar.sha256
```

规则：

- 打包前会先运行角色包校验。
- 压缩包根目录直接包含 `manifest.json` 和 `character.json`。
- 默认忽略 `.git/`、`node_modules/`、`.DS_Store`、`Thumbs.db`、`*.tmp`、`*.log`、`*.bak`。
- 会读取 `.roxycharignore` 追加忽略规则。
- 超过 50MB 的包会被拒绝。
- 同名输出文件已存在时需要 `--force`。

`.roxycharignore` 示例：

```gitignore
dist/
coverage/
*.log
*.secret
.env
```

## 5. 完整性校验

### `/character verify <file.roxychar>`

```text
/character verify ./dist/roxy-sensei-1.2.0.roxychar
/character verify ./dist/roxy-sensei-1.2.0.roxychar --sha256 <hash>
/character verify ./dist/roxy-sensei-1.2.0.roxychar --sidecar ./dist/roxy-sensei-1.2.0.roxychar.sha256
```

说明：

- `pack` 会自动生成 `.sha256` sidecar。
- `verify` 优先使用显式 `--sha256`，其次使用 `--sidecar`，再尝试同名 `.sha256`。
- SHA-256 只能证明文件内容未变化，不能证明作者身份可信。
- 远程 marketplace 进入可安装阶段前，必须引入签名或可信来源策略。

## 6. 安装

### `/character install <path>`

```text
/character install ./my-character
/character install ./roxy-sensei.roxychar
/character install ./roxy-sensei.roxychar --global
/character install ./roxy-sensei.roxychar --force
```

安装范围：

- 默认安装到项目：`.roxycode/characters/<package-name>`。
- `--global` 安装到全局：`~/.roxycode/characters/<package-name>`。
- 项目角色优先级高于全局角色，全局角色优先级高于内置角色。

安装行为：

- 安装前读取 `manifest.json`。
- 检查 `engines.roxycode`。
- 不兼容时默认拒绝，`--force` 可以覆盖并输出 warning。
- 写入 `.roxycode/install.json` 安装元数据。
- 安装后刷新自定义角色列表，可立即执行 `/character <id>` 切换。

重复安装时，未加 `--force` 会拒绝覆盖，加 `--force` 会覆盖已有包。

## 7. 列表

### `/character packages`

```text
/character packages
/character packages --project
/character packages --global
```

显示字段：

- package name
- version
- displayName
- scope
- installPath
- description

只有标准角色包会出现在列表中。旧版单文件 `.json` 自定义角色不会进入 package manager 列表。

## 8. 更新

### `/character update <path>`

```text
/character update ./roxy-sensei
/character update ./roxy-sensei.roxychar
/character update ./roxy-sensei.roxychar --global
```

行为：

- 根据新包的 `manifest.name` 查找已安装包。
- 未安装时给出明确错误，并提示先使用 `/character install`。
- 已安装时覆盖原包。
- 保留原始 `installedAt`。
- 刷新 `updatedAt`。
- 输出 `previousVersion -> newVersion`。

## 9. 卸载

### `/character uninstall <name>`

```text
/character uninstall roxy-sensei
/character uninstall roxy-sensei --global
```

行为：

- 删除项目或全局安装目录。
- 如果当前角色来自被卸载的包，会自动切回 `roxy`。
- 卸载不会删除原始源包或 `.roxychar` 文件。

## 10. 导出

### `/character export <id|current>`

```text
/character export roxy
/character export roxy --out ./packages
/character export current --package
/character export current --roxychar
```

用途：

- 把内置角色导出成可编辑标准包。
- 把当前自定义角色导出为可分享包。
- 为后续 marketplace 审核和发布准备资产。

内置角色导出时会补充 `metadata.source`、`metadata.characterType`、`metadata.tags` 和 `metadata.ageRating`。

## 11. Marketplace 辅助命令

当前支持本地 marketplace 索引校验和列表：

```text
/character marketplace validate ./marketplace.json
/character marketplace list ./marketplace.json
```

当前阶段只生成安装提示，不直接从远程 URL 安装。远程安装必须等待完整的下载缓存、SHA-256 校验、签名验证和可信来源策略。

## 12. 排障

| 问题 | 原因 | 处理 |
| --- | --- | --- |
| `Missing manifest.json` | 目录不是标准角色包 | 检查路径，或先运行 `/character create <id> --package` |
| `already installed` | 已安装同名包 | 使用 `--force` 覆盖，或先卸载 |
| `requires RoxyCode >=...` | `engines.roxycode` 不兼容 | 升级 RoxyCode，或确认风险后使用 `--force` |
| `Referenced file does not exist` | assets/extensions/i18n 引用了不存在的文件 | 修正路径或补齐文件 |
| `Path must not contain ..` | 角色包尝试引用根目录外文件 | 改成包内相对路径 |
| `too large` | 包体积或单文件超过限制 | 删除大文件，添加 `.roxycharignore` |
| `symlinks` | 压缩包包含符号链接 | 删除 symlink，改用普通文件 |

## 13. 工程边界

角色包可以影响：

- 角色主题和状态栏术语。
- Splash、ASCII art、Pixel companion。
- 解释深度、审查重点、风险偏好、默认工作模式。
- 角色包声明的 workflows、hooks、prompts。

角色包不能绕过：

- 项目路径限制。
- Shell 白名单和确认机制。
- 写文件前备份。
- 高危操作二次确认。
- ToolRegistry -> PermissionGuard -> Executor -> AuditLog 链路。

这点与 Claude Code 的插件体系一致：扩展可以贡献能力，但不能直接绕过工具权限和信任边界。RoxyCode 的差异是把这套机制包装成中文优先、角色定制优先的个人编程工作台体验。
