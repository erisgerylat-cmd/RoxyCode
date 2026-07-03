# RoxyCode 工程能力提升计划
> 对标 Claude Code，达到 80-90% 工程成熟度

## 📊 当前状态评估

### 整体完成度：87% → 目标：90%+

| 维度 | Claude Code | RoxyCode 当前 | 目标 | 差距分析 |
|---|---|---|---|---|
| **核心引擎** | 100% | 98% | 100% | ✅ 接近完成，补齐细节 |
| **工具系统** | 100% | 92% | 95% | ⚠️ 缺流式进度、并发标记 |
| **命令系统** | 100% | 90% | 95% | ⚠️ 缺动态加载、热重载 |
| **Hook系统** | 100% | 98% | 100% | ✅ 基本完备 |
| **Memory系统** | 100% | 30% | 85% | 🔴 最大缺口 |
| **MCP支持** | 100% | 90% | 95% | ⚠️ 缺多协议、OAuth |
| **配置管理** | 100% | 70% | 85% | ⚠️ 缺多层级、热重载 |
| **Profile系统** | 100% | 30% | 80% | 🔴 核心缺失 |
| **Workflow引擎** | 100% | 60% | 85% | 🔴 缺执行器 |
| **Character系统** | 0% | 88% | 95% | ✅ RoxyCode特色 |
| **测试覆盖** | 80%+ | 50% | 75% | ⚠️ 不均衡 |

---

## 🎯 三阶段优化路线

### Phase 1: 补齐核心缺口（P0，2-3周）

**目标**：Memory、Profile、Workflow 从占位符变为可用实现

#### 1.1 Memory 系统实现 ✅ 核心完成

**当前状态**：85% 完成度
- ✅ 类型定义完整
- ✅ MemoryStore 完整存储接口
- ✅ 自动提取 agent 已实现
- ✅ 智能召回已实现（TF-IDF top-5）
- ✅ MEMORY.md 索引机制已实现（200 行限制）
- ✅ 交叉引用 [[link]] 已实现
- ✅ `loadIndex/saveMemory/listMemories/deleteMemory` 兼容接口已补齐

**实施任务**：

```typescript
// Task 1: 实现 Memory Store (2天)
src/session/memory/MemoryStore.ts
  - loadIndex(): 解析 MEMORY.md
  - saveMemory(): 保存单条记忆 + 更新索引
  - listMemories(): 列出所有记忆
  - deleteMemory(): 删除记忆

src/session/memory/MemoryIndex.ts
  - parseIndex(): 解析 MEMORY.md 格式
  - updateIndex(): 维护 200 行限制
  - buildIndexLine(): 生成索引行

// Task 2: 智能召回 (2天)
src/session/memory/MemoryRetriever.ts
  - recallRelevant(query, limit): TF-IDF 相关性排序
  - 后期升级：向量召回（可选）

src/session/memory/MemoryGraph.ts
  - parseCrossLinks(): 解析 [[name]] 语法
  - getRelated(): 获取关联记忆

// Task 3: 自动提取 (3天)
src/session/memory/AutoMemoryExtractor.ts
  - shouldExtract(): 判断是否需要提取（每 N 轮）
  - extract(): Fork 子 agent，限制工具权限
  - 只能写 .roxycode/memory/**
  - 不能访问其他文件

src/session/memory/MemoryPrompts.ts
  - buildExtractionPrompt(): 提取指令模板

// Task 4: 集成到 AgentLoop (1天)
src/engine/agent/AgentLoop.ts
  - 在 prepareSystemPrompt 中召回相关记忆
  - 注入到 system prompt
  - 标注新鲜度（>1天 → 可能过期）
```

**验收标准**：
- [x] MEMORY.md 自动维护，200 行限制生效
- [x] 根据 query 召回 top-5 相关记忆
- [x] 每 10 轮触发自动提取
- [x] 支持 [[cross-link]] 语法
- [x] 6 种类型完整支持

**完成度**：30% → 85%

---

#### 1.2 Profile 系统实现 ✅ 核心完成

**当前状态**：80% 完成度
- ✅ 类型定义存在
- ✅ ProfileManager 已实现
- ✅ ProfileOnboarding 已实现
- ✅ ProjectProfileManager 已实现
- ✅ RoxyManifest 解析已实现
- ✅ ProjectScanner 已实现
- ✅ 首次启动引导已接入交互式 UI 启动流程

**实施任务**：

```typescript
// Task 1: ProfileManager (2天)
src/session/profile/ProfileManager.ts
  - load(): 加载 .roxycode/profile.json
  - save(): 保存用户画像
  - update(): 增量更新
  - getTechStack(): 技术栈偏好
  - getWorkflowPreferences(): 工作流偏好

src/session/profile/ProfileOnboarding.ts
  - runOnboarding(): 引导用户完成画像
  - detectTechStack(): 从项目自动识别
  - suggestCharacter(): 推荐合适角色

// Task 2: ProjectProfileManager (2天)
src/session/project/ProjectProfileManager.ts
  - load(): 加载 .roxycode/project.json
  - scanProject(): 扫描项目类型
  - getProjectType(): 识别框架（React/Vue/Next.js/...）
  - getTestFramework(): 识别测试框架
  - getLintConfig(): 识别 lint 配置

src/session/project/RoxyManifest.ts
  - parseRoxyMd(): 解析 ROXY.md
  - extractInstructions(): 提取项目特定指令
  - extractWorkflows(): 提取推荐工作流

src/session/project/ProjectScanner.ts
  - scanDependencies(): package.json 扫描
  - detectFramework(): 框架识别
  - detectLanguages(): 语言占比
```

**验收标准**：
- [x] 首次启动触发 onboarding
- [x] .roxycode/profile.json 正确保存
- [x] .roxycode/project.json 自动生成
- [x] ROXY.md 解析生效
- [x] 项目类型自动识别

**完成度**：30% → 80%

---

#### 1.3 Workflow 执行引擎 ✅ 已完成

**当前状态**：85% 完成度
- ✅ WorkflowLoader 完整
- ✅ Workflow 定义完备
- ✅ WorkflowRunner 已实现
- ✅ 独立执行引擎已实现
- ✅ `/workflow run <name>` 已接入 WorkflowRunner
- ✅ 支持变量、条件、循环、验证步骤和错误收集

**实施任务**：

```typescript
// Task 1: WorkflowRunner (3天)
src/workflow/WorkflowRunner.ts
  - run(workflow): 执行完整工作流
  - executeStep(step): 执行单步
  - handleCondition(condition): 条件判断
  - handleLoop(loop): 循环逻辑

src/workflow/WorkflowExecutor.ts
  - executePromptStep(): 执行 prompt 步骤
  - executeToolStep(): 执行工具步骤
  - executeAgentStep(): 启动子 agent

src/workflow/WorkflowContext.ts
  - variables: 变量存储
  - state: 执行状态
  - results: 步骤结果
```

**验收标准**：
- [x] `/workflow run <name>` 可执行
- [x] 支持条件、循环
- [x] 支持变量传递
- [x] 错误处理完善

**完成度**：60% → 85%

---

### Phase 2: 工具与命令系统增强（P1，1-2周）

#### 2.1 工具系统流式化

**实施任务**：

```typescript
// 升级工具接口
src/tool/types.ts
  interface Tool {
    name: string
    concurrencySafe: boolean          // 新增
    destructive: boolean              // 新增
    execute: (args, context) => AsyncGenerator<ToolProgress, ToolResult>
  }

  type ToolProgress =
    | { type: 'status'; message: string }
    | { type: 'file_read'; path: string; size: number }
    | { type: 'command_start'; cmd: string }
    | { type: 'output_chunk'; text: string }

// 升级内置工具
src/tool/builtin/readFile.ts
  - 改为 async generator
  - yield { type: 'status', message: '读取文件...' }
  - yield { type: 'file_read', path, size }

src/tool/builtin/executeCommand.ts
  - 改为 async generator
  - yield { type: 'command_start', cmd }
  - yield { type: 'output_chunk', text } for stdout

src/tool/builtin/grepSearch.ts
  - 改为 async generator
  - yield 每个匹配结果
```

**验收标准**：
- [ ] 所有内置工具支持流式进度
- [ ] concurrencySafe 标记用于多 Agent
- [ ] destructive 影响权限判断

---

#### 2.2 命令系统动态加载

**实施任务**：

```typescript
// 命令源抽象
src/commands/sources/CommandSource.ts
  interface CommandSource {
    name: string
    discover(): Promise<CommandDefinition[]>
    watch?(): AsyncIterable<CommandDefinition[]>
  }

src/commands/sources/WorkflowCommandSource.ts
  - 从 .roxycode/workflows/*.yml 生成命令
  - /workflow-<name> → 执行对应工作流

src/commands/sources/PluginCommandSource.ts
  - 从插件注册表加载命令
  - 动态注册/注销

src/commands/sources/SkillCommandSource.ts
  - 从 .roxycode/skills/*.md 加载
  - 解析 frontmatter 生成命令

src/commands/CommandLoader.ts
  - 聚合所有 CommandSource
  - 统一加载入口

src/commands/CommandWatcher.ts
  - 监听文件变化
  - 热重载命令
```

**验收标准**：
- [ ] Workflow/Plugin/Skill 命令自动生成
- [ ] 热重载生效（开发模式）
- [ ] `/help` 显示所有来源命令

---

### Phase 3: 扩展性与稳定性（P1-P2，1-2周）

#### 3.1 MCP 协议扩展

```typescript
// 传输层抽象
src/mcp/transports/Transport.ts
src/mcp/transports/StdioTransport.ts    // 重构现有
src/mcp/transports/SSETransport.ts      // 新增
src/mcp/transports/HTTPTransport.ts     // 新增
src/mcp/transports/WebSocketTransport.ts // 新增

// OAuth 支持
src/mcp/auth/OAuthFlow.ts
  - startPKCE(): 启动 PKCE 流程
  - handleCallback(): 处理回调
  - refreshToken(): 刷新 token

src/mcp/auth/TokenStore.ts
  - 系统 keychain 存储
  - 跨平台支持
```

**验收标准**：
- [ ] 支持 6 种传输协议
- [ ] OAuth 流程完整
- [ ] Token 安全存储

---

#### 3.2 配置管理增强

```typescript
// 多层级配置
src/core/ConfigManager.ts
  type ConfigLayer =
    | 'defaults'
    | 'global'         // ~/.roxycode/config.json
    | 'profile'        // ~/.roxycode/profile.json
    | 'project'        // .roxycode/config.json
    | 'local'          // .roxycode/config.local.json (gitignored)
    | 'cli'            // --config flag

  class ConfigManager {
    private layers: Map<ConfigLayer, Config>
    private schema: ZodSchema
    private watcher: FSWatcher

    async load(): Promise<Config>
    validate(config: unknown): Config
    watch(): void  // 热重载
  }

// Zod Schema
src/core/ConfigSchema.ts
  - 完整配置 schema
  - 验证所有字段
```

**验收标准**：
- [ ] 7 层配置优先级生效
- [ ] Zod schema 验证
- [ ] 配置文件变化自动热重载

---

#### 3.3 Character 系统补齐

```typescript
// 角色包 CLI 集成
src/commands/builtin/character.ts
  - /character packages          // 列出已安装包
  - /character install <path>    // 安装包
  - /character uninstall <name>  // 卸载包
  - /character update <path>     // 更新包
  - /character validate <path>   // 校验包
  - /character pack <dir>        // 打包
  - /character export <id>       // 导出

// 角色包工具链
src/aesthetic/character/custom/CharacterPackageValidator.ts
src/aesthetic/character/custom/CharacterPackagePacker.ts
src/aesthetic/character/custom/CharacterPackageTemplate.ts

// 扩展能力接入运行时
src/workflow/sources/CharacterWorkflowSource.ts
  - 从角色包加载 workflows
  - 注册到 workflow registry

src/hooks/sources/CharacterHookSource.ts
  - 从角色包加载 hooks
  - 只启用当前角色的 hooks

src/aesthetic/character/CharacterPromptLoader.ts
  - 加载角色包自定义 prompts
  - 合并到 system prompt
```

**验收标准**：
- [ ] CLI 命令完整可用
- [ ] 角色包扩展能力生效
- [ ] 打包/导出工具链可用

---

## 📈 完成度提升路径

```text
当前状态 (87%)
    ↓
Phase 1 完成 (90%)
  - Memory: 30% → 85%
  - Profile: 30% → 80%
  - Workflow: 60% → 85%
    ↓
Phase 2 完成 (92%)
  - 工具系统: 92% → 95%
  - 命令系统: 90% → 95%
    ↓
Phase 3 完成 (93%)
  - MCP: 90% → 95%
  - 配置: 70% → 85%
  - Character: 88% → 95%
    ↓
测试补齐 (95%)
  - 测试覆盖: 50% → 75%
```

---

## 🎯 关键成功指标

### 功能完整性

| 模块 | 当前 | 目标 | 验收标准 |
|---|---|---|---|
| Memory | 30% | 85% | 自动提取、智能召回、交叉引用 |
| Profile | 30% | 80% | Onboarding、项目扫描、ROXY.md |
| Workflow | 60% | 85% | 独立执行引擎、条件循环 |
| 工具流式 | 0% | 95% | 所有工具支持进度反馈 |
| 命令动态 | 50% | 95% | Workflow/Plugin/Skill 自动加载 |
| MCP 协议 | 50% | 95% | 6 种传输 + OAuth |
| Character CLI | 60% | 95% | 完整包管理命令 |

### 工程质量

| 维度 | 当前 | 目标 |
|---|---|---|
| 测试覆盖率 | 50% | 75% |
| 核心模块测试 | 60% | 90% |
| 端到端测试 | 30% | 60% |
| 文档完整性 | 70% | 85% |

---

## ⏱️ 时间安排

### Week 1-2: Phase 1 核心缺口
- Day 1-2: Memory Store + Index
- Day 3-4: Memory Retriever + Graph
- Day 5-7: Auto Extractor
- Day 8-9: ProfileManager
- Day 10-11: ProjectProfileManager
- Day 12-14: WorkflowRunner

### Week 3: Phase 2 工具命令
- Day 15-16: 工具流式化
- Day 17-18: 命令动态加载
- Day 19-21: 测试补齐

### Week 4: Phase 3 扩展稳定
- Day 22-23: MCP 协议扩展
- Day 24-25: 配置管理增强
- Day 26-28: Character 系统补齐

---

## 🚀 下一步行动

### 立即开始（本周）

1. **Memory 系统**
   - [x] 实现 MemoryStore.loadIndex()
   - [x] 实现 MemoryIndex.parseIndex()
   - [x] 集成到 AgentLoop

2. **Profile 系统**
   - [x] 实现 ProfileManager.load()
   - [x] 实现 ProfileOnboarding
   - [x] 首次启动引导

3. **Workflow 引擎**
   - [x] 实现 WorkflowRunner.run()
   - [x] 实现 WorkflowExecutor
   - [x] `/workflow run` 命令

### 短期目标（2周内）

- Memory、Profile、Workflow 从占位符变为可用
- 测试覆盖率提升到 60%+
- 完成 Phase 1 核心缺口补齐

### 中期目标（4周内）

- 工具系统流式化完成
- 命令系统动态加载完成
- Character 系统完整闭环
- 整体完成度达到 93%+

---

## 📝 总结

**当前优势**：
- ✅ Agent Loop 架构完整（98%）
- ✅ Hook 系统成熟（98%）
- ✅ 会话管理完善（95%）
- ✅ Character 系统特色鲜明（88%）

**核心缺口**：
- 🔴 Memory 系统（30% → 85%）
- 🔴 Profile 系统（30% → 80%）
- 🔴 Workflow 引擎（60% → 85%）

**实施路径**：
1. **Phase 1**：补齐 Memory/Profile/Workflow（P0）
2. **Phase 2**：增强工具/命令系统（P1）
3. **Phase 3**：扩展 MCP/配置/Character（P1-P2）

**预期结果**：
- 4 周后整体完成度：**93%+**
- 达到 Claude Code **80-90%** 工程能力
- RoxyCode 特色（Character）保持并增强
