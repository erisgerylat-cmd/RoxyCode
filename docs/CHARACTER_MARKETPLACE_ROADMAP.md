# RoxyCode 角色包 Marketplace 路线图

本文档说明 RoxyCode 角色包 marketplace 的当前能力、安全边界和后续演进计划。它不是功能承诺表，而是后续实现时的工程约束和验收方向。

对照 Claude Code：Claude Code 的插件生态包含 marketplace、安装缓存、installed metadata、插件校验、自动更新、blocklist 和插件来源信任等模块。RoxyCode 会参考这些成熟边界，但优先服务“中文/二次元/个人 Claude Code 定制化”的产品方向。

## 1. 当前状态

已实现：

- 标准角色包格式：`manifest.json` + `character.json` + assets/extensions/i18n。
- `.roxychar` 打包格式。
- 包校验：schema、引用文件、路径安全、推荐元数据 warning。
- 安装、卸载、更新、列表。
- `.roxycode/install.json` 安装元数据。
- `engines.roxycode` 兼容性检查。
- `.roxycharignore` 打包忽略。
- SHA-256 sidecar 生成和校验。
- 本地 `marketplace.json` 校验和列表。

当前 marketplace 命令：

```text
/character marketplace validate ./marketplace.json
/character marketplace list ./marketplace.json
```

当前限制：

- 不直接从远程 URL 安装。
- 不自动更新角色包。
- 不执行 marketplace 依赖解析。
- 不把 SHA-256 当作作者身份验证。
- 不允许角色包绕过 RoxyCode 工具权限。

## 2. Marketplace 索引模型

`marketplace.json` 用于声明可发现角色包：

```json
{
  "schemaVersion": 1,
  "name": "personal-characters",
  "displayName": "个人角色包市场",
  "description": "面向中文开发者的 RoxyCode 角色包合集。",
  "owner": {
    "name": "tanghao"
  },
  "packages": [
    {
      "name": "roxy-sensei",
      "version": "1.2.0",
      "displayName": "洛琪希老师",
      "description": "温柔耐心的中文编程导师角色包。",
      "source": "./packages/roxy-sensei",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "categories": ["anime", "teaching"],
      "tags": ["beginner-friendly", "chinese-first"]
    }
  ]
}
```

本地 source 会被解析并运行 `/character validate` 同等校验。远程 URL 当前只用于展示和安全提示。

## 3. 安全基线

Marketplace 可安装能力进入下一阶段前，必须满足以下基线：

- 每个远程包必须提供 SHA-256。
- 下载后必须先写入临时缓存，不直接进入安装目录。
- 缓存包必须通过完整性校验。
- 缓存包必须通过角色包 schema 和路径安全校验。
- 解压必须限制总大小、单文件大小、文件数量。
- 禁止 symlink、路径逃逸、绝对路径、控制字符路径、重复 entry 覆盖。
- 安装必须写入安装元数据。
- 安装、更新和卸载必须保留审计信息。
- 角色包贡献 hooks/workflows/prompts 后仍必须进入 RoxyCode 既有权限链路。

## 4. 阶段路线

### M1：本地市场完善

目标：把本地 marketplace 作为角色包作者的开发入口。

任务：

- `/character marketplace validate` 输出更明确的错误分组。
- `/character marketplace list` 支持分类和标签过滤。
- marketplace entry 支持本地 `.roxychar` 与目录包混合。
- 校验 entry 与 `manifest.json` 的 name/version/displayName 是否一致。
- 对缺少 SHA-256 的可分发包给出 warning。

验收：

- 本地角色包合集可以作为团队内分享索引。
- CI 可以运行 marketplace validate。

### M2：远程只读发现

目标：能读取远程 marketplace，但不直接安装。

任务：

- 支持 HTTPS marketplace URL。
- 下载 marketplace 到缓存。
- 校验 marketplace schema。
- 列出远程包元信息。
- 对远程 URL 包只显示下载和 verify 指引。

验收：

- 用户能浏览远程角色包列表。
- RoxyCode 不会在没有完整安全链路时自动安装远程包。

### M3：远程下载和缓存

目标：允许下载 `.roxychar` 到本地缓存，但安装仍需显式确认。

任务：

- 引入 marketplace cache 目录。
- 下载 `.roxychar` 后计算 SHA-256。
- 与 marketplace entry 的 SHA-256 比对。
- 通过校验后提示用户执行安装。
- 缓存按 `marketplace/name/version` 隔离。

验收：

- 网络中断不会破坏已有安装。
- SHA-256 不匹配时拒绝安装。
- 缓存不会越权写入项目文件。

### M4：可信安装

目标：支持从 marketplace 直接安装，但必须有明确用户确认和信任边界。

任务：

- `/character marketplace install <name>`。
- 安装前展示来源、版本、作者、权限贡献、SHA-256、风险提示。
- 支持 project/global scope。
- 安装后写入 `install.json`，记录 marketplace 来源。
- 支持 blocklist 或撤回列表。

验收：

- 用户知道正在安装哪个来源的哪个包。
- 未通过完整性和 schema 校验的包不能安装。
- 安装后的角色包可以被 `/character packages` 追踪。

### M5：签名和作者身份

目标：从“文件未篡改”升级到“来源可信”。

任务：

- 支持 marketplace 公钥。
- 支持 `.roxychar.sig` 或 manifest 签名。
- 校验作者身份和发布者身份。
- 支持信任策略：official、verified、community、local。
- 支持撤销签名或吊销 key。

验收：

- SHA-256 继续负责完整性。
- 签名负责来源身份。
- 用户可以区分官方包、验证作者包和社区包。

### M6：自动更新和依赖

目标：建立更接近 Claude Code 插件生态的更新能力。

任务：

- 检查已安装角色包的新版本。
- 自动更新默认关闭。
- 支持更新前 diff 摘要。
- 支持角色包依赖声明和冲突检查。
- 支持跨 marketplace 依赖 allowlist。

验收：

- 更新不会无提示改变当前角色体验。
- 依赖不能绕过安全校验。
- 角色包更新保留原始 `installedAt` 并刷新 `updatedAt`。

## 5. 与 Claude Code 的设计对照

Claude Code 参考点：

- `src/utils/plugins/schemas.ts`：插件、marketplace、installed metadata 的 schema。
- `src/utils/plugins/validatePlugin.ts`：开发者可运行的校验工具。
- `src/cli/handlers/plugins.ts`：插件 CLI 入口。
- `src/utils/plugins/installedPluginsManager.ts`：安装状态和 enabled state 分离。
- `src/utils/plugins/pluginInstallationHelpers.ts`：安装、缓存、元数据的共享逻辑。
- `src/utils/plugins/pluginAutoupdate.ts`：自动更新通知和应用边界。
- `src/utils/plugins/pluginBlocklist.ts`：有问题插件的安全兜底。

RoxyCode 取舍：

- 先做本地包和本地 marketplace，降低创作者门槛。
- 暂不开放远程一键安装，避免在签名、缓存、撤回机制未完善时扩大风险。
- 安装状态跟随角色包目录保存 `.roxycode/install.json`，比全局单文件状态更容易被用户理解和迁移。
- 保留 project/global 双作用域，满足“每个项目一个自己的 Claude Code”的产品定位。
- 角色包不仅是 UI 主题，也影响解释风格、审查重点、风险偏好和工作流偏置。

## 6. Marketplace 前置安全规范

进入公开分发前，角色包作者必须遵守：

- 不包含密钥、token、`.env`、私有证书。
- 不包含可执行二进制，除非未来有签名和沙箱策略。
- 不引用角色包根目录外文件。
- 不在 hooks 中默认执行危险命令。
- 不伪装官方来源。
- 对二创角色素材提供版权和授权说明。
- README 说明角色行为、适用用户、风险偏好和贡献内容。
- LICENSE 明确代码、文案、图片、ASCII art 的授权边界。

平台侧必须提供：

- schema 校验。
- 路径安全校验。
- 包体积和 entry 数限制。
- 完整性校验。
- 安装前权限贡献摘要。
- 举报和撤回机制。
- 官方推荐和社区包明确区分。

## 7. 产品方向

RoxyCode marketplace 的目标不是复制通用插件市场，而是服务以下场景：

- 中文业务开发者快速获得适合 Spring、Vue、测试、代码审查的工作流角色。
- 二次元程序员把自己的终端 agent 定制成长期陪伴的编程工作台。
- 教学型用户选择更耐心、更会解释风险和原理的角色。
- 团队共享符合内部规范的角色包、工作流和审查偏好。

最终形态应该是“可审计、可验证、可个性化”的角色生态：有 Claude Code 式的工程可靠性，也有 RoxyCode 自己的审美和教学友好体验。
