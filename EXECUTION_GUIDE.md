# RoxyCode 优化项目 - 最终执行指南

## 📊 项目完成状态

### 已完成工作 ✅

**1. 深度分析与规划**
- ✅ 对比分析 Claude Code (1884 文件) vs RoxyCode (142 文件)
- ✅ 识别核心差距和优化方向
- ✅ 制定 11 周实施计划
- ✅ 创建 3 份详细文档

**2. Agent Loop 执行内核**
- ✅ 实现 LiteLoop（单轮问答）
- ✅ 实现 EconomicLoop（ReAct 循环）
- ✅ 实现 ModeRouter（自动模式选择）
- ✅ 实现 ExecutionTracker（Token 追踪）
- ✅ 定义完整的事件流系统

**3. 工具执行管道**
- ✅ 实现 ToolExecutor
- ✅ 实现 ToolExecutionPipeline（不可绕过的安全检查）
- ✅ 更新 PermissionGuard（路径检查、Shell 安全）
- ✅ 实现 AuditLog 基础

**4. 核心工具实现**
- ✅ read_file - 读取文件
- ✅ write_file - 写入文件
- ✅ execute_command - 执行命令
- ✅ list_directory - 列出目录
- ✅ grep_search - 搜索内容

**5. 国际化增强**
- ✅ 创建 I18n 接口
- ✅ 实现 createI18n 工厂
- ✅ 支持参数化文本

**新增文件统计：21 个文件**

---

## 🎯 关键发现（基于 Claude Code 完整源码）

### Claude Code 的实际情况

**规模：**
- 1884 个 TypeScript 文件
- 512,000+ 行代码
- 43 个工具目录
- query 模块只有 652 行（4 个文件）

**架构洞察：**

1. **query 模块极度精简**
   ```
   query/
   ├── config.ts (46 行)
   ├── deps.ts (40 行) - 只有 4 个核心依赖！
   ├── stopHooks.ts (473 行)
   └── tokenBudget.ts (93 行)
   ```

2. **依赖注入只有 4 个核心依赖**
   ```typescript
   type QueryDeps = {
     callModel: typeof queryModelWithStreaming
     microcompact: typeof microcompactMessages
     autocompact: typeof autoCompactIfNeeded
     uuid: () => string
   }
   ```

3. **工具系统非常复杂**
   - 43 个工具目录
   - BashTool 有 19 个文件
   - 每个工具包含：权限、安全、验证、UI、解析器等

4. **主要逻辑在 services 层**
   - services/api/ - 模型调用
   - services/compact/ - 上下文压缩
   - services/tools/ - 工具执行
   - query 只是薄薄的协调层

### RoxyCode vs Claude Code

| 维度 | RoxyCode（优化后） | Claude Code | 差距 |
|------|-------------------|-------------|------|
| 总文件数 | 163 | 1884 | 11.6x |
| Agent Loop | ✅ 基础实现 | ✅ 完整实现 | 可用 |
| 工具数量 | 5 个 | 43 个 | 8.6x |
| 工具复杂度 | 1 文件/工具 | 15 文件/工具 | 15x |
| query 模块 | Agent Loop 内联 | 独立 services 层 | 架构不同 |
| UI 系统 | ANSI + chalk | React + Ink | 复杂度 10x |

---

## 🚀 下一步行动（优先级排序）

### P0: 让 Agent Loop 真正工作（本周必须完成）

#### 任务 1: 创建类型适配器 ⚠️ 阻塞

**问题：**
- 新工具使用简化接口：`{ name, description, riskLevel, execute }`
- 旧代码期望完整接口：`{ definition, isReadOnly, riskLevel, execute }`

**解决方案：**
创建 `src/tool/adapters/ToolAdapter.ts`：

```typescript
import type { Tool as LegacyTool } from '../types.js';
import type { Tool as SimpleTool } from '../../core/types/tool.js';

export class ToolAdapter {
  static toLegacy(simple: SimpleTool): LegacyTool {
    return {
      definition: {
        name: simple.name,
        description: simple.description,
        parameters: {
          type: 'object',
          properties: simple.schema?.properties || {},
          required: simple.schema?.required || []
        }
      },
      isReadOnly: simple.riskLevel === 'safe',
      riskLevel: simple.riskLevel === 'safe' ? 'low' : simple.riskLevel,
      
      async execute(args, ctx) {
        const result = await simple.execute(args, ctx);
        return {
          success: result.success,
          output: JSON.stringify(result.data),
          error: result.error,
          duration: result.duration || 0
        };
      }
    };
  }
}
```

**估计时间：** 1-2 小时

---

#### 任务 2: 实现 LLM 工具调用适配器 ⚠️ 阻塞

**问题：**
- EconomicLoop 需要 `chatWithTools()` 方法
- BaseLLMProvider 只有 `chatStream()`

**解决方案：**
创建 `src/agent/adapters/LLMAdapter.ts`：

```typescript
import type { BaseLLMProvider } from '../../engine/llm/BaseLLMProvider.js';
import type { Message, ToolCall } from '../../core/types/message.js';
import type { Tool } from '../../core/types/tool.js';

export async function chatWithTools(
  provider: BaseLLMProvider,
  messages: Message[],
  tools: Tool[]
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const toolCalls: ToolCall[] = [];
  let content = '';
  
  const toolDefs = tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.schema || { type: 'object', properties: {} }
  }));
  
  for await (const chunk of provider.chatStream({ 
    messages, 
    tools: toolDefs 
  })) {
    if (chunk.type === 'text') {
      content += chunk.text;
    }
    if (chunk.type === 'done' && chunk.toolCalls) {
      toolCalls.push(...chunk.toolCalls);
    }
  }
  
  return { content, toolCalls };
}
```

**估计时间：** 2-3 小时

---

#### 任务 3: 集成 Agent Loop 到 REPL ⚠️ 阻塞

**问题：**
- 自然语言输入无法进入 Agent Loop
- 缺少事件渲染逻辑

**解决方案：**
更新 `src/ui/repl/REPL.ts`：

```typescript
import { autoSelectMode, route } from '../../agent/index.js';
import { chatWithTools } from '../../agent/adapters/LLMAdapter.js';
import type { AgentEvent } from '../../agent/types.js';
import chalk from 'chalk';

// 在 handleInput 方法中添加：
async handleInput(input: string) {
  // 命令处理
  if (input.startsWith('/')) {
    await this.handleCommand(input);
    return;
  }
  
  // 自然语言 → Agent Loop
  const mode = autoSelectMode(input, this.runtimeContext);
  console.log(chalk.dim(`[${mode} mode]`));
  
  try {
    for await (const event of route(mode, input, this.runtimeContext)) {
      this.renderAgentEvent(event);
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${error.message}`));
  }
  
  console.log(); // 换行
}

private renderAgentEvent(event: AgentEvent) {
  switch (event.type) {
    case 'status':
      process.stdout.write(`\r${chalk.cyan('●')} ${event.message}...`);
      break;
    
    case 'text_chunk':
      process.stdout.write(event.text);
      break;
    
    case 'tool_start':
      process.stdout.write(`\r${chalk.yellow('⚙')} Running ${event.tool}...`);
      break;
    
    case 'tool_end':
      if (!event.result.success) {
        console.log(chalk.red(`\n✗ ${event.tool}: ${event.result.error}`));
      }
      break;
    
    case 'stats':
      const { elapsed, totalTokens } = event.stats;
      console.log(chalk.dim(
        `\n✓ Done (${elapsed}ms · ↓${totalTokens.input} ↑${totalTokens.output} tokens)`
      ));
      break;
    
    case 'error':
      console.error(chalk.red(`\n✗ Error: ${event.error.message}`));
      break;
  }
}
```

**估计时间：** 3-4 小时

---

#### 任务 4: 工具注册和发现 ⚠️ 阻塞

**问题：**
- 内置工具未注册到 RuntimeContext
- Agent Loop 找不到可用工具

**解决方案：**
更新 `src/index.ts`：

```typescript
import { getBuiltinTools } from './tool/builtin/index.js';
import { ToolExecutor } from './tool/executor/ToolExecutor.js';
import { createRuntimeContext } from './agent/RuntimeContext.js';
import { createI18n } from './i18n/index.js';

async function main() {
  const configManager = new ConfigManager();
  await configManager.load();
  const language = normalizeLanguage(configManager.get('ui.language'));
  
  const characterManager = new CharacterManager(configManager);
  await characterManager.loadCustomCharacters();
  const character = characterManager.getCurrentCharacter();
  
  const llmProvider = LLMFactory.create(configManager);
  
  const contextManager = new ContextManager({ configManager, llmProvider });
  contextManager.registerStrategy(new SummaryStrategy({ llmProvider, language }));
  contextManager.registerStrategy(new TruncationStrategy());
  
  // ✨ 注册工具
  const tools = getBuiltinTools();
  const toolExecutor = new ToolExecutor();
  const i18n = createI18n(language);
  
  // ✨ 创建运行时上下文
  const runtimeContext = createRuntimeContext({
    llm: llmProvider,
    toolExecutor,
    config: configManager,
    i18n,
    tools,
    messages: [],
    cwd: process.cwd(),
    projectRoot: process.cwd(),
  });
  
  showSplash({
    version: '0.1.0',
    model: `${llmProvider.name} / ${configManager.get('llm.model') || llmProvider.id}`,
    provider: llmProvider.name,
    character,
    startupQuote: language === 'zh-CN' ? startupQuote : undefined,
    language,
  });
  
  // ✨ 传入 runtimeContext
  const repl = new REPL({ 
    characterManager, 
    configManager, 
    contextManager, 
    llmProvider,
    runtimeContext  // 新增
  });
  await repl.start();
}
```

**估计时间：** 2 小时

---

#### 任务 5: 端到端测试 🎯

**测试场景 1: 简单问答（LiteLoop）**
```bash
$ roxycode
> 什么是 TypeScript？
[LiteLoop 单轮回答]
✓ Done (2s · ↓1.2k ↑450 tokens)
```

**测试场景 2: 读取文件（EconomicLoop）**
```bash
$ roxycode
> 读取 package.json 并告诉我项目名称
[EconomicLoop: 调用 read_file → 解析 JSON → 返回 "roxycode"]
✓ Done (4s · ↓2.3k ↑180 tokens)
```

**测试场景 3: 搜索内容（EconomicLoop）**
```bash
$ roxycode
> 搜索 src 目录中包含 "Agent" 的文件
[EconomicLoop: 调用 grep_search → 返回匹配列表]
✓ Done (3s · ↓1.8k ↑320 tokens)
```

**测试场景 4: 执行命令（EconomicLoop）**
```bash
$ roxycode
> 执行 ls 命令查看当前目录
[EconomicLoop: 调用 execute_command → 返回目录列表]
✓ Done (2s · ↓1.5k ↑200 tokens)
```

**估计时间：** 2-3 小时

---

### 本周时间估算

| 任务 | 估计时间 | 优先级 |
|------|---------|--------|
| 类型适配器 | 1-2 小时 | P0 |
| LLM 适配器 | 2-3 小时 | P0 |
| REPL 集成 | 3-4 小时 | P0 |
| 工具注册 | 2 小时 | P0 |
| 端到端测试 | 2-3 小时 | P0 |
| **总计** | **10-14 小时** | **本周内完成** |

---

## 📚 创建的文档清单

### 1. `.claude/plan/roxycode-optimization-plan.md`
- 完整优化计划
- 10x 差距分析
- 11 周实施路线图

### 2. `.claude/plan/implementation-summary.md`
- Phase 0 实施总结
- 技术债务记录
- 下一步行动指南

### 3. `.claude/plan/supplementary-optimization.md`
- 基于 Claude Code 完整源码的深度分析
- 具体代码实现指导
- 类型适配器和 LLM 适配器示例

### 4. `OPTIMIZATION_REPORT.md`
- 执行报告
- 成果总结
- 参考资料

---

## 🎓 关键学习点

### 从 Claude Code 学到的

1. **精简的依赖注入** ✅
   - query 模块只有 4 个核心依赖
   - RoxyCode 已实现 RuntimeContext

2. **服务层架构** 🔄
   - query 只是薄协调层
   - 主要逻辑在 services/
   - RoxyCode 可以保持简单架构

3. **工具系统的复杂度** ⚠️
   - 每个工具 15+ 个文件
   - RoxyCode 保持 1-2 文件/工具即可

4. **不需要的复杂度** ❌
   - Ink UI 系统（React 组件）
   - 远程架构（bridge/remote）
   - 企业特性（teams/oauth）

### RoxyCode 的核心优势

1. **Workflow 系统** ✅
   - 面向中文工程场景
   - YAML 配置简单

2. **角色系统** ✅
   - 二次元审美定制
   - 主题色和台词

3. **中文优先** ✅
   - 默认中文界面
   - 双语切换

4. **简单架构** ✅
   - 无 React/Ink
   - 无远程架构
   - 专注本地 CLI

---

## 🎯 验收标准

### 最小可用版本（本周完成）

**必须能运行：**
```bash
$ roxycode
> 读取 src/index.ts 并告诉我入口逻辑
[Agent 调用 read_file → 分析代码 → 返回说明]
✓ Done (5s · ↓ 2.3k · ↑ 800 tokens)
```

### 完整版本（11 周后）

- ✅ Agent Loop（Lite/Economic/Standard/Ultimate）
- ✅ 完整工具系统（20+ 工具）
- ✅ Memory 系统（4 分类 + 召回）
- ✅ Hook 系统（command/prompt/http/agent）
- ✅ Profile + Project 深度定制
- ✅ 审美层产品化（sprite/主题/台词）

---

## 📞 下一步

**立即开始：**
1. 创建 `src/tool/adapters/ToolAdapter.ts`
2. 创建 `src/agent/adapters/LLMAdapter.ts`
3. 更新 `src/ui/repl/REPL.ts`
4. 更新 `src/index.ts`
5. 运行端到端测试

**本周目标：**
让一句自然语言能真正执行工具并返回结果。

---

**文档更新时间：** 2026-06-29  
**作者：** Claude Opus 4.8  
**基于：** Claude Code 完整源码（1884 文件，512K+ 行）  
**状态：** ✅ 分析完成，📝 执行指南就绪，🚀 准备实施

---

## 附录：快速命令参考

```bash
# 查看新增文件
find src/agent src/tool/builtin src/tool/executor -name "*.ts"

# 统计代码行数
find src -name "*.ts" | xargs wc -l

# 运行 RoxyCode
pnpm dev

# 构建项目
pnpm build

# 查看优化文档
cat .claude/plan/*.md
cat OPTIMIZATION_REPORT.md
```
