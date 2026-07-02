# RoxyCode 架构设计原则

> 本文档详细描述 RoxyCode 的核心架构原则。RoxyCode 参考 Claude Code 的成熟工程骨架，但把中文体验、国产模型和个人深度定制作为产品级架构目标。

---

## 当前实现校准（2026-06-29）

当前代码已经从早期设计里的 `src/agent` 迁移到 `src/engine/agent`。因此，工作区里旧 `src/agent/*`、旧 `src/tool/adapters/*`、旧 `src/tool/builtin/*/index.ts`、旧 `src/tool/executor/ToolExecutionPipeline.ts` 的删除是架构收口，不是缺失文件。

当前真实主干：
- Agent Loop：`src/engine/agent/AgentLoop.ts`、`RuntimeContext.ts`、`TokenBudget.ts`。
- 工具系统：`src/tool/registry/ToolRegistry.ts`、`src/tool/permission/PermissionGuard.ts`、`src/tool/executor/ToolExecutor.ts`、`src/tool/builtin/*.ts`。
- 命令系统：`src/commands/CommandRegistry.ts` 与 `src/commands/builtin/*`。
- 运行态观测：`src/runtime/RuntimeState.ts`，对照 Claude Code `src/bootstrap/state.ts`。
- 诊断入口：`/diagnostics`，对照 Claude Code `doctor` 与 runtime state，负责把模型、工具、权限、上下文、扩展和角色定制状态聚合成中文可读报告。

后续修改文档或继续开发时，应以以上目录为准；不要恢复旧 `src/agent` 或旧 `ToolExecutionPipeline`，否则会形成两套执行内核。
## 一、Async Generator 鱼动整个架构

Agent Loop、工具执行、流式输出，全部通过 `async function*` 串联。`yield` 事件给 UI 层，`return` 终止状态给调用方。

```typescript
// 统一事件类型
type AgentEvent =
  | { type: 'status'; status: StatusType; message: string; elapsed: number; tokens: number }
  | { type: 'text_chunk'; text: string }
  | { type: 'tool_start'; tool: string; args: Record<string, any> }
  | { type: 'tool_end'; tool: string; result: ToolResult; duration: number }
  | { type: 'plan_generated'; steps: PlanStep[] }
  | { type: 'step_start'; step: number; total: number; description: string }
  | { type: 'step_end'; step: number; success: boolean }
  | { type: 'question'; question: Question }
  | { type: 'error'; error: Error; recoverable: boolean }
  | { type: 'stats'; stats: ExecutionStats };

// EconomicLoop（Async Generator 版本）
async function* economicLoop(task: string, ctx: Context): AsyncGenerator<AgentEvent, AgentResult> {
  const tracker = new ExecutionTracker();
  ctx.messages.push({ role: 'user', content: task });

  while (true) {
    yield { type: 'status', status: 'thinking', message: '思考中', elapsed: tracker.elapsed(), tokens: tracker.totalTokens() };

    tracker.startLlmCall();
    const stream = llm.chatStream(ctx.messages, ctx.tools);

    let fullText = '';
    for await (const chunk of stream) {
      if (chunk.type === 'text') {
        fullText += chunk.text;
        yield { type: 'text_chunk', text: chunk.text };
      }
    }
    tracker.endLlmCall(stream.usage);

    if (stream.hasToolCalls()) {
      for (const toolCall of stream.toolCalls) {
        yield { type: 'tool_start', tool: toolCall.name, args: toolCall.arguments };
        tracker.startToolCall(toolCall.name);
        const result = await toolExecutor.execute(toolCall);
        tracker.endToolCall(result);
        yield { type: 'tool_end', tool: toolCall.name, result, duration: result.duration };
        ctx.messages.push(toolResultMessage(toolCall, result));
      }
    } else {
      yield { type: 'stats', stats: tracker.snapshot() };
      return { success: true, messages: ctx.messages, stats: tracker.snapshot() };
    }
  }
}

// StandardLoop 组合多个 generator
async function* standardLoop(task: string, ctx: Context): AsyncGenerator<AgentEvent, AgentResult> {
  yield { type: 'status', status: 'analyzing', message: '分析任务中' };
  const analysis = yield* economicLoop(`分析以下任务：${task}`, { ...ctx, tools: ctx.tools.filter(t => t.isReadOnly) });

  yield { type: 'status', status: 'planning', message: '生成执行计划' };
  const plan = await createPlan(task, analysis, ctx);
  yield { type: 'plan_generated', steps: plan.steps };

  for (let i = 0; i < plan.steps.length; i++) {
    yield { type: 'step_start', step: i + 1, total: plan.steps.length, description: plan.steps[i].description };
    const stepResult = yield* economicLoop(plan.steps[i].instruction, ctx);
    yield { type: 'step_end', step: i + 1, success: stepResult.success };
  }

  return { success: true, messages: ctx.messages };
}
```

---

## 二、流式工具执行

LLM 还在流式输出 token 时，已经开始并发执行已知的工具了。

```typescript
async function* streamingToolExecutor(
  stream: AsyncIterable<LLMChunk>,
  ctx: Context
): AsyncGenerator<AgentEvent> {
  const pendingTools: Map<string, Promise<ToolResult>> = new Map();

  for await (const chunk of stream) {
    if (chunk.type === 'text') {
      yield { type: 'text_chunk', text: chunk.text };
    } else if (chunk.type === 'tool_call_start') {
      const toolCall = chunk.toolCall;
      yield { type: 'tool_start', tool: toolCall.name, args: toolCall.arguments };
      // 异步执行，不等待完成
      const promise = toolExecutor.execute(toolCall).then(result => ({ toolCall, result }));
      pendingTools.set(toolCall.id, promise);
    }
  }

  // LLM 输出结束，等待所有工具执行完成
  for (const [id, promise] of pendingTools) {
    const { toolCall, result } = await promise;
    yield { type: 'tool_end', tool: toolCall.name, result, duration: result.duration };
  }
}
```

**兄弟中止机制：**
```typescript
class SiblingAbortManager {
  private batches: Map<string, AbortController> = new Map();

  createBatch(batchId: string): AbortController {
    const controller = new AbortController();
    this.batches.set(batchId, controller);
    return controller;
  }

  abortBatch(batchId: string, reason: string): void {
    const controller = this.batches.get(batchId);
    if (controller) controller.abort(reason);
  }
}
```

---

## 三、权限模型：硬编码的必经路径

权限检查不是可选的附加层，而是工具调用路径上不可绕过的节点。

```typescript
class PermissionGuard {
  // 硬编码的高危操作列表 — 不可配置，不可关闭
  private static readonly HIGH_RISK_PATTERNS = [
    { tool: 'execute_command', pattern: /\brm\b/, reason: '删除文件' },
    { tool: 'execute_command', pattern: /\bsudo\b/, reason: '提权操作' },
    { tool: 'execute_command', pattern: /\bdrop\b/i, reason: '删除数据库' },
    { tool: 'delete_file', pattern: /.*/, reason: '删除文件' },
    { tool: 'write_file', pattern: /\.env/, reason: '修改环境变量' },
  ];

  async check(toolCall: ToolCall, ctx: ExecutionContext): Promise<PermissionResult> {
    // 1. 路径安全检查
    if (this.isFileTool(toolCall.name)) {
      if (!this.pathValidator.isWithinProject(toolCall.arguments.path)) {
        return { allowed: false, reason: '路径越界' };
      }
    }
    // 2. 命令安全检查
    if (this.isShellTool(toolCall.name)) {
      if (this.commandValidator.isBlocked(toolCall.arguments.command)) {
        return { allowed: false, reason: '危险命令' };
      }
    }
    // 3. 高危操作确认（硬编码，不可关闭）
    // 4. 资源限制检查
    return { allowed: true };
  }
}

// 工具执行管道
class ToolExecutionPipeline {
  async execute(toolCall: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    // Step 1: Zod 参数校验（不可跳过）
    // Step 2: Tool 自检（不可跳过）
    // Step 3: Pre-Hooks
    // Step 4: canUseTool（硬编码，不可绕过）
    // Step 5: 执行工具
    // Step 6: Post-Hooks
  }
}
```

---

## 四、构建时特性隔离

实验性功能在构建时就被消除，对外版本不含相关代码。

```typescript
// feature-flags.ts
export const FEATURE_FLAGS = {
  EXPERIMENTAL_SWARM_MODE: process.env.ROXYCODE_EXPERIMENTAL_SWARM === 'true',
  EXPERIMENTAL_VECTOR_MEMORY: process.env.ROXYCODE_EXPERIMENTAL_VECTOR === 'true',
  DEBUG_LOGGING: process.env.ROXYCODE_DEBUG === 'true',
  ENABLE_PLUGIN_SYSTEM: true,
  ENABLE_MULTI_AGENT: true,
  ENABLE_MCP: true,
};

// tsup.config.ts
export default defineConfig({
  define: {
    'process.env.ROXYCODE_EXPERIMENTAL_SWARM': 'false',
    'process.env.ROXYCODE_DEBUG': 'false',
  },
  treeshake: true,
});
```

---

## 五、多 Agent 一等公民

### 文件锁机制

```typescript
class FileLockManager {
  private locks: Map<string, FileLock> = new Map();

  async acquire(filePath: string, agentId: string, mode: 'read' | 'write'): Promise<FileLock> {
    const existing = this.locks.get(filePath);
    if (existing && (mode === 'write' || existing.mode === 'write')) {
      // 写锁冲突 → 等待
      return new Promise((resolve) => {
        this.waitQueue.get(filePath)?.push({ resolve });
      });
    }
    const lock = { filePath, agentId, mode, acquiredAt: Date.now() };
    this.locks.set(filePath, lock);
    return lock;
  }

  release(filePath: string, agentId: string): void {
    // 释放锁 + 唤醒等待队列
  }
}
```

### 原子 Claim

```typescript
class TaskClaimer {
  private claimed: Map<string, string> = new Map();

  tryClaim(taskId: string, agentId: string): boolean {
    if (this.claimed.has(taskId)) return false;
    this.claimed.set(taskId, agentId);
    return true;
  }

  release(taskId: string): void {
    this.claimed.delete(taskId);
  }
}
```

### 依赖图

```typescript
class TaskDependencyGraph {
  addDependency(taskId: string, dependsOn: string): void;
  isReady(taskId: string, completedTasks: Set<string>): boolean;
  getReadyTasks(completedTasks: Set<string>): string[];
  getUnlockedTasks(completedTaskId: string): string[];
  hasCycle(): boolean;  // 循环依赖检测
}
```

### Coordinator

```typescript
class AgentCoordinator {
  async coordinate(task: string, ctx: Context): AsyncGenerator<AgentEvent> {
    // 1. 拆解任务
    const subtasks = await this.decompose(task, ctx);
    // 2. 构建依赖图
    // 3. 并行执行无依赖的任务（文件锁保证安全）
    // 4. 汇总结果
  }
}
```

---

## 六、扩展性贯穿始终

### MCP 协议

```typescript
class MCPClient {
  async connect(name: string, config: MCPServerConfig): Promise<void> {
    const server = new MCPServer(config);
    await server.connect();
    // 自动注册 MCP Server 提供的工具
    const tools = await server.listTools();
    for (const tool of tools) {
      this.toolRegistry.register({
        name: `${name}.${tool.name}`,
        execute: (params) => server.callTool(tool.name, params),
      });
    }
  }
}
```

### Hooks 系统

```typescript
interface HookSystem {
  onBeforeLlmCall?: (messages: Message[]) => Promise<Message[] | null>;
  onAfterLlmCall?: (response: LLMResponse) => Promise<LLMResponse | null>;
  onBeforeToolCall?: (call: ToolCall) => Promise<ToolCall | { blocked: boolean } | null>;
  onAfterToolCall?: (call: ToolCall, result: ToolResult) => Promise<ToolResult | null>;
  onSessionStart?: (session: Session) => Promise<void>;
  onSessionEnd?: (session: Session) => Promise<void>;
  onError?: (error: Error) => Promise<{ recovered: boolean } | null>;
}
```

### 扩展点全景

```
┌──────────────┬──────────────────────────────────────────────────┐
│  MCP         │  通过标准协议接入任意外部工具                       │
│  Hooks       │  覆盖所有关键生命周期                              │
│  Skills      │  YAML 定义，无需写代码                             │
│  Plugins     │  npm 包形式发布，代码级扩展                         │
│  Feature Flag│  构建时特性隔离                                    │
└──────────────┴──────────────────────────────────────────────────┘
```

---

## 七、个人深度定制与二次元审美架构（一等公民）

Claude Code 的成熟扩展主线包括：统一命令加载、Hooks schema、Memory 分类、Skills/Plugins 动态加载和集中运行态状态。它也有轻量的 `/theme` 与 buddy/companion 设计，用低成本方式提供外观和陪伴感。RoxyCode 参考这些主线，但把“每个人自己的二次元 Claude Code”作为产品目标，因此需要在架构层引入 Profile、Project Profile、Workflow、Character、Memory、Aesthetic Layer 的组合。

### 7.1 与 Claude Code 的架构对照

| 架构点 | Claude Code 参考 | RoxyCode 策略 |
|--------|------------------|---------------|
| 命令聚合 | `src/commands.ts` 聚合 builtin、skills、plugins、MCP、dynamic skills | 建立 `CommandSource`，把 builtin/workflow/skill/plugin/MCP 统一注册到命令面板 |
| Hooks | `src/schemas/hooks.ts` 定义 command/prompt/http/agent Hook | 使用 schema 化 Hook，但提供中文配置向导和项目级默认模板 |
| Memory | `src/memdir/memoryTypes.ts` 定义 user/feedback/project/reference | 采用四分类，并新增 learning/workflow，服务教学和个人习惯 |
| 运行态 | `src/bootstrap/state.ts` 集中保存插件、Agent、Hook、Skill、错误等状态 | 建立 `RuntimeState`，同时保存 profile/project/workflow/character 状态 |
| 扩展入口 | skills/plugins/commands/MCP 都可贡献能力 | RoxyCode 加入 workflow 和 custom character 作为特色扩展入口 |
| 主题 | `src/commands/theme/index.ts` 提供轻量主题入口 | 建立 `aesthetic/theme`，主题不仅影响颜色，也影响边框、状态栏和命令面板风格 |
| 小伙伴 | `src/buddy/companion.ts` / `src/buddy/sprites.ts` 使用 seeded companion 和 ASCII 多帧 sprite | 建立 `aesthetic/sprite`，保留确定性和轻量渲染，但允许用户自定义二次元 coding partner |

### 7.2 Profile 分层

```
配置优先级：
  CLI 参数
    > 项目配置 .roxycode/project.json
    > 项目指令 ROXY.md
    > 用户画像 ~/.roxycode/profile.json
    > 全局配置 ~/.roxycode/config.json
    > 默认配置
```

**用户画像 Profile：**
```json
{
  "language": "zh-CN",
  "level": "junior",
  "techStacks": ["Spring Boot", "Vue3", "MySQL"],
  "explainDepth": "teaching",
  "defaultCharacter": "roxy",
  "aestheticLevel": "balanced",
  "modelStrategy": "balanced",
  "workflowStyle": "ask-before-large-change"
}
```

**项目画像 Project Profile：**
```json
{
  "type": "springboot-vue-admin",
  "startCommands": ["pnpm dev", "mvn spring-boot:run"],
  "testCommands": ["pnpm test", "mvn test"],
  "conventions": ["Controller 返回 Result<T>", "分页统一使用 PageResult<T>"],
  "protectedPaths": [".env", "deploy/", "database/migrations/"],
  "preferredWorkflows": ["spring-crud", "write-test", "review"]
}
```

### 7.3 Workflow 作为中文场景扩展

Claude Code 的 Skill/Command 更偏通用扩展。RoxyCode 的 Workflow 面向中文工程场景，把常见业务动作产品化。

```yaml
name: spring-crud
title: Spring Boot CRUD 模块
description: 生成 Entity、Mapper、Service、Controller、测试和接口文档
inputs:
  moduleName:
    label: 模块名称
    required: true
steps:
  - analyze_project
  - design_schema
  - generate_backend
  - generate_tests
  - summarize_changes
mode: standard
```

### 7.4 Memory 分类

RoxyCode 参考 Claude Code 的 memory 分类，但增加教学和工作流记忆。

| 类型 | 来源 | 用途 |
|------|------|------|
| user | 参考 Claude Code | 用户角色、水平、偏好 |
| feedback | 参考 Claude Code | 用户对工作方式的纠正和确认 |
| project | 参考 Claude Code | 当前项目中不可从代码直接推导的背景 |
| reference | 参考 Claude Code | 外部系统、文档、看板、接口地址 |
| learning | RoxyCode 特色 | 用户学习阶段、薄弱点、解释方式 |
| workflow | RoxyCode 特色 | 用户反复使用的工程流程和模板偏好 |

**规则：**
- 能从当前代码、git、ROXY.md 推导出来的信息，不写入长期记忆。
- 记忆可能过期，使用前必须优先验证当前文件状态。
- 用户要求忽略记忆时，按空记忆处理，不引用、不对比、不暗示。

### 7.5 审美层 Aesthetic Layer

审美层是 RoxyCode 相比 Claude Code 的重要特色，但必须保持为工程层的可配置附加层，不能阻塞工具执行、权限确认和 Agent Loop。

```
src/aesthetic/
├── theme/        # 颜色、边框、状态栏、命令面板风格
├── character/    # 角色表现层适配
├── sprite/       # ASCII / Pixel 小伙伴，多帧 idle 动画
├── dialogue/     # 成功/失败/等待/危险操作台词
├── mood/         # 当前会话情绪状态，影响低频反馈
└── presets/      # minimal / balanced / immersive 预设
```

**审美配置：**

```json
{
  "ui": {
    "language": "zh-CN",
    "aestheticLevel": "balanced",
    "theme": "roxy-blue",
    "sprite": "roxy-mini",
    "dialogueFrequency": "normal"
  }
}
```

**档位约束：**

| 档位 | 工程影响 | UI 表现 |
|------|----------|---------|
| minimal | 不改变 Agent 策略，只改变颜色 | 低频提示，无 sprite |
| balanced | 角色可影响解释深度和提示频率 | 默认角色台词，轻量状态文案 |
| immersive | 角色完整参与交互，但仍不能绕过权限和测试 | sprite、世界观状态、完整台词 |

**与 Claude Code 对比：**
- Claude Code 的 buddy/companion 通过 seeded random 和小尺寸 ASCII sprite 保持性能稳定，这一点值得参考。
- RoxyCode 不应把二次元体验做成不可控噪音，而应通过 `aestheticLevel` 管理沉浸强度。
- Claude Code 的主题更偏终端外观；RoxyCode 的主题还会连接角色、状态文案、命令面板和工作流反馈。

### 7.6 自定义角色不是皮肤

角色应影响真实工作策略，而不只是颜色和台词。

```json
{
  "id": "my-architect",
  "name": "架构师助手",
  "modeBias": "standard",
  "explainDepth": "concise",
  "riskTolerance": "low",
  "alwaysGenerateTests": true,
  "reviewFocus": ["architecture", "security", "maintainability"]
}
```

角色影响：
- System Prompt
- 默认推理模式
- 是否主动提问
- 是否自动补测试
- Review 关注点
- 输出语气和解释深度

### 7.7 近期结构落点

```
src/
├── i18n/                 # 已有：双语资源
├── profile/              # 待实现：用户画像
├── project/              # 待实现：项目画像 + ROXY.md
├── workflow/             # 待实现：中文业务工作流
├── memory/               # 待实现：长期记忆分类与检索
├── aesthetic/            # 待实现：主题、sprite、台词、沉浸档位
├── character/loader/     # 待实现：自定义角色加载
├── agent/                # 待实现：Agent Loop
├── tool/                 # 待实现：工具注册、执行、权限
└── runtime/              # 待实现：运行态状态聚合
```

---

## 八、文件架构设计

### 8.1 与 Claude Code 的目录结构对照

Claude Code 的 `src/` 采用明显的功能域平铺结构，例如：

```text
src/
├── commands/       # Slash 命令
├── tools/          # 工具
├── query/          # 模型循环与请求执行
├── screens/        # REPL / Doctor 等终端界面
├── components/     # Ink UI 组件
├── services/       # 后台服务
├── plugins/        # 插件
├── skills/         # Skills
├── memdir/         # Memory
├── hooks/          # Hooks
├── buddy/          # companion / sprite
└── bootstrap/      # 全局运行态
```

**Claude Code 的优点：**
- 命令、工具、插件、Skills、Memory 等扩展点在顶层，查找成本低。
- 新能力可以作为独立功能域加入，不必先穿过严格 DDD 分层。
- 对大型 CLI 工具很实用：命令入口、UI、工具、运行态各自独立演进。

**Claude Code 的代价：**
- 功能域之间容易互相引用，长期需要靠约定和 review 维持边界。
- 产品特色层（例如 buddy/theme）更像附加能力，不是统一的体验层。

**RoxyCode 的选择：**
- 采用 Claude Code 的“功能域优先”优点，让 `commands/tool/agent/memory/workflow/aesthetic` 在顶层可见。
- 同时增加边界约束：`agent` 不直接操作文件，必须走 `tool`；`aesthetic` 不参与权限决策；`runtime` 只聚合运行态，不承载业务逻辑。
- 把二次元审美能力独立成 `aesthetic/`，避免混入 `ui/` 或 `character/` 后失控。

### 8.2 目标目录结构

```text
src/
├── index.ts                         # CLI Composition Root
│
├── core/                            # 稳定核心类型与配置
│   ├── ConfigManager.ts
│   ├── constants.ts
│   ├── types/                       # Message / LLM / Tool / Event / Config 类型
│   └── character/                   # 内置角色定义与角色管理
│
├── i18n/                            # 双语资源
│   ├── index.ts
│   └── locales/                     # 后续拆分 zh-CN / en-US
│
├── runtime/                         # 运行态聚合，参考 Claude Code bootstrap/state
│   ├── RuntimeState.ts              # 当前会话运行态
│   ├── RuntimeContext.ts            # 注入给 Agent/Command/Tool 的上下文
│   └── RuntimeRegistry.ts           # 命令、工具、Hook、Workflow 的运行期注册表
│
├── commands/                        # 顶层 Slash 命令系统（后续从 ui/commands 迁移）
│   ├── CommandRegistry.ts
│   ├── CommandLoader.ts             # builtin/workflow/skill/plugin/MCP 聚合加载
│   ├── sources/
│   │   ├── BuiltinCommandSource.ts
│   │   ├── WorkflowCommandSource.ts
│   │   ├── SkillCommandSource.ts
│   │   ├── PluginCommandSource.ts
│   │   └── MCPCommandSource.ts
│   └── builtin/
│       ├── help.ts
│       ├── language.ts
│       ├── character.ts
│       ├── profile.ts
│       ├── project.ts
│       ├── aesthetic.ts
│       ├── workflow.ts
│       └── model.ts
│
├── ui/                              # 终端交互与渲染，不承载业务决策
│   ├── repl/
│   ├── splash/
│   ├── renderers/
│   ├── screens/
│   └── components/
│
├── aesthetic/                       # 二次元审美层，RoxyCode 特色
│   ├── theme/
│   │   ├── ThemeRegistry.ts
│   │   └── ThemeLoader.ts
│   ├── sprite/
│   │   ├── SpriteRegistry.ts
│   │   ├── SpriteRenderer.ts
│   │   └── SeededSpriteFactory.ts    # 参考 CC buddy 的 seeded companion
│   ├── dialogue/
│   │   ├── DialogueRegistry.ts
│   │   └── DialogueSelector.ts
│   ├── presets/
│   │   ├── minimal.ts
│   │   ├── balanced.ts
│   │   └── immersive.ts
│   └── AestheticManager.ts
│
├── profile/                         # 用户画像
│   ├── ProfileManager.ts
│   ├── ProfileSchema.ts
│   └── ProfileOnboarding.ts
│
├── project/                         # 项目画像与 ROXY.md
│   ├── ProjectProfileManager.ts
│   ├── ProjectScanner.ts
│   ├── RoxyManifest.ts              # ROXY.md 读写与解析
│   └── ProjectProfileSchema.ts
│
├── workflow/                        # 中文业务工作流
│   ├── WorkflowRegistry.ts
│   ├── WorkflowLoader.ts
│   ├── WorkflowRunner.ts
│   ├── WorkflowSchema.ts
│   └── builtin/
│       ├── spring-crud.yml
│       ├── vue-page.yml
│       ├── fix-bug.yml
│       └── write-test.yml
│
├── agent/                           # Agent Loop 与模式路由
│   ├── AgentRuntime.ts
│   ├── ModeRouter.ts
│   ├── loops/
│   │   ├── LiteLoop.ts
│   │   ├── EconomicLoop.ts
│   │   ├── StandardLoop.ts
│   │   └── UltimateLoop.ts
│   ├── events/
│   │   ├── AgentEventBus.ts
│   │   └── AgentEventTypes.ts
│   ├── tracker/
│   │   └── ExecutionTracker.ts
│   └── coordinator/
│       ├── AgentCoordinator.ts
│       ├── FileLockManager.ts
│       ├── TaskClaimer.ts
│       └── DependencyGraph.ts
│
├── tool/                            # 工具系统与权限管道
│   ├── registry/
│   │   └── ToolRegistry.ts
│   ├── executor/
│   │   ├── ToolExecutor.ts
│   │   └── ToolExecutionPipeline.ts
│   ├── permission/
│   │   ├── PermissionGuard.ts
│   │   ├── PathValidator.ts
│   │   ├── CommandValidator.ts
│   │   └── ConfirmationPolicy.ts
│   ├── audit/
│   │   └── ToolAuditLog.ts
│   └── builtin/
│       ├── ReadFileTool.ts
│       ├── EditFileTool.ts
│       ├── WriteFileTool.ts
│       ├── ListDirectoryTool.ts
│       ├── GrepSearchTool.ts
│       ├── FileFindTool.ts
│       └── ExecuteCommandTool.ts
│
├── engine/                          # 模型引擎，保持专注于 LLM Provider
│   └── llm/
│       ├── BaseLLMProvider.ts
│       ├── LLMFactory.ts
│       ├── QwenProvider.ts
│       ├── GLMProvider.ts
│       ├── DeepSeekProvider.ts
│       └── OpenAIProvider.ts
│
├── session/                         # 会话、上下文、持久化
│   ├── context/
│   ├── prompt/
│   └── store/
│       ├── SessionStore.ts
│       └── JsonlSessionStore.ts
│
├── memory/                          # 长期记忆，参考 CC memdir 但扩展 learning/workflow
│   ├── MemoryTypes.ts
│   ├── MemoryStore.ts
│   ├── MemoryPolicy.ts
│   ├── MemoryRetriever.ts
│   └── vector/
│       ├── EmbeddingService.ts
│       └── VectorStore.ts
│
├── extension/                       # 外部扩展能力
│   ├── hooks/
│   │   ├── HookSchema.ts
│   │   ├── HookRegistry.ts
│   │   └── HookRunner.ts
│   ├── mcp/
│   │   ├── MCPClient.ts
│   │   └── MCPToolAdapter.ts
│   ├── skills/
│   │   ├── SkillLoader.ts
│   │   └── SkillRegistry.ts
│   └── plugins/
│       ├── PluginLoader.ts
│       └── PluginRegistry.ts
│
└── shared/                          # 跨模块纯工具，禁止依赖业务模块
    ├── fs/
    ├── path/
    ├── schema/
    └── text/
```

### 8.3 当前目录到目标目录的迁移映射

| 当前目录 | 目标目录 | 说明 |
|----------|----------|------|
| `src/ui/commands` | `src/commands` | 命令系统需要从 UI 中抽出，支持 workflow/skill/plugin/MCP 动态命令 |
| `src/ui/splash` | `src/ui/splash` + `src/aesthetic/theme` | Splash 继续归 UI；主题、台词、sprite 配置迁入审美层 |
| `src/core/character` | `src/core/character` + `src/aesthetic/character` | 角色基础定义留在 core；表现层和沉浸反馈进 aesthetic |
| `src/engine/llm` | `src/engine/llm` | 保持现状，LLM Provider 不参与 Agent 策略 |
| `src/session/context` | `src/session/context` | 保持现状，后续接入 memory 和 working set |
| `src/tool` | `src/tool` | 从空壳补齐 registry/executor/permission/builtin |
| 无 | `src/agent` | 新增 Agent Loop 主干 |
| 无 | `src/profile` | 新增用户画像 |
| 无 | `src/project` | 新增项目画像和 ROXY.md |
| 无 | `src/workflow` | 新增中文业务工作流 |
| 无 | `src/memory` | 新增长期记忆 |
| 无 | `src/aesthetic` | 新增二次元审美层 |
| 无 | `src/runtime` | 新增运行态聚合，避免全局状态散落 |

### 8.4 模块依赖规则

```text
ui ───────▶ commands ─────▶ agent ─────▶ tool ─────▶ shared
 │             │             │            │
 │             │             ▼            ▼
 │             │          session       extension
 │             │             │
 ▼             ▼             ▼
aesthetic    profile      memory
 │             │
 └────────────▶ core ◀──── engine/llm
```

**硬规则：**
- `ui` 只能渲染和收集输入，不直接读写文件、不直接调用 LLM。
- `agent` 只能通过 `tool` 执行文件和 shell 操作，不能绕过权限管道。
- `aesthetic` 只能影响展示、文案频率和角色体验，不能放行权限、不能改变工具结果。
- `engine/llm` 只处理模型协议，不知道命令、工具、角色和 UI。
- `memory` 使用前必须允许当前状态验证，不能把记忆当作事实来源。
- `commands` 是用户入口，不承载复杂业务逻辑，复杂流程应委托给 `agent/profile/project/workflow`。

### 8.5 文件命名与导出约定

| 类型 | 命名 | 示例 |
|------|------|------|
| Manager | 管理单个领域状态 | `ProfileManager.ts` |
| Registry | 注册和查询扩展项 | `ToolRegistry.ts` |
| Loader | 从磁盘/配置加载资源 | `WorkflowLoader.ts` |
| Runner | 执行一个流程 | `WorkflowRunner.ts` |
| Schema | Zod/类型校验 | `HookSchema.ts` |
| Tool | 单个工具实现 | `ReadFileTool.ts` |
| Loop | Agent 循环 | `EconomicLoop.ts` |
| Renderer | 纯展示 | `SpriteRenderer.ts` |

每个顶层功能域提供 `index.ts` barrel export，但内部模块之间优先使用明确路径导入，避免循环依赖。
