# 简历项目深入学习路线

这份路线面向当前简历中的 RoxyCode、RoxyStore 和宝信实习经历。目标不是继续堆功能，而是把简历上的每一条内容训练到以下标准：

```text
能运行 -> 能定位 -> 能解释 -> 能改造 -> 能排错 -> 能比较取舍
```

建议周期为 8 周，每周 10-15 小时。时间不足时，可以压缩为 4 周，但不要跳过动手任务和讲解验收。

## 学习规则

每个模块都按同一套方法学习：

1. 不看源码，先写出自己理解的输入、输出和调用流程。
2. 沿真实入口追踪源码，修正流程图。
3. 关闭 AI，独立完成一个小改动和对应测试。
4. 制造一个失败场景，通过日志和断点定位原因。
5. 用三分钟讲清背景、方案、风险、取舍和改进方向。

使用 AI 时遵守三个约束：

- 先独立思考和编码至少 20 分钟，再让 AI 提示。
- 不接受无法逐行解释的核心代码。
- AI 修改完成后，必须自己写一份调用链和一条额外测试。

## 第 0 周：建立项目基线

目标：两个项目都能独立启动和演示。

RoxyCode：

- 执行 `pnpm check`，理解类型检查、死代码检查、构建和测试各自解决的问题。
- 配置一个 OpenAI-compatible 模型，完成一次“读取文件 -> 修改 -> 运行测试 -> 总结”。
- 演示 `/plan`、`/diagnostics`、`/memory review`、`/character packages`。

RoxyStore：

- 启动 MySQL、Redis、后端和前端。
- 完成注册、登录、上传角色包、审核、下载和 CLI 安装。
- 保存一套不包含密钥的演示数据和操作脚本。

交付物：

- 两个项目各一份 3 分钟演示脚本。
- 一张 RoxyCode 总体架构图。
- 一张 RoxyStore 上传安装时序图。

验收：不依赖 AI，能在新终端从零启动并完成演示。

## 第 1 周：RoxyCode Agent Loop 与模型协议

对应简历：模型流式输出、工具调用、工具结果回传、分析执行验证总结闭环。

重点源码：

- `src/engine/agent/AgentLoop.ts`
- `src/engine/agent/RuntimeContext.ts`
- `src/engine/llm/BaseLLMProvider.ts`
- `src/engine/llm/OpenAIProvider.ts`
- `src/engine/llm/ToolResultPairing.ts`

必须理解：

- messages、system prompt、tool call、tool result 的关系。
- 流式文本和流式工具参数如何组装。
- 模型没有工具调用、工具调用失败、tool result 配对错误时如何继续。
- Lite、Economic、Standard、Ultimate 的能力边界。

动手任务：

- 独立增加一种可恢复的 Provider 错误分类，并补测试。
- 构造一次缺失 tool result 的请求，解释修复逻辑。
- 画出 `AgentLoop.run()` 到最终总结的时序图。

面试验收：能回答“Agent 与普通聊天接口的本质区别是什么”。

## 第 2 周：工具系统、权限与真实工作区编辑

对应简历：统一工具系统、权限确认、审计、备份和高危操作拦截。

重点源码：

- `src/tool/registry/ToolRegistry.ts`
- `src/tool/executor/ToolExecutor.ts`
- `src/tool/permission/PermissionGuard.ts`
- `src/tool/security/FileMutationGuard.ts`
- `src/tool/security/ShellSafety.ts`
- `src/tool/builtin/readFile.ts`
- `src/tool/builtin/editFile.ts`
- `src/tool/builtin/executeCommand.ts`

必须理解：

- 工具为什么不能由模型直接执行。
- read-only、concurrency-safe、destructive 三种属性如何影响调度。
- read-before-write、工作区边界、备份、diff 和审计分别防什么问题。
- Shell 白名单、二次确认和拒绝后的恢复路径。

动手任务：

- 不参考现有实现，新增 `count_lines` 工具并走完整执行链。
- 编写路径逃逸、文件过期修改和危险命令测试。
- 手动模拟 edit_file 匹配失败，并改进恢复提示。

面试验收：能从工具定义一直讲到 AuditLog，能解释为什么权限路径不可绕过。

## 第 3 周：Plan、Todo、Context、Memory 与 LSP

对应简历：计划审批、任务追踪、上下文压缩、长期记忆和诊断修复。

重点源码：

- `src/session/plan/PlanStore.ts`
- `src/tool/builtin/todoWrite.ts`
- `src/session/context/ContextManager.ts`
- `src/session/context/strategies/SummaryStrategy.ts`
- `src/session/memory/MemoryStore.ts`
- `src/session/memory/MemoryRetriever.ts`
- `src/session/memory/MemoryPolicy.ts`
- `src/lsp/LSPClient.ts`
- `src/lsp/CodeDiagnostics.ts`

必须理解：

- Plan Mode 如何保证拒绝计划时不修改工作区。
- 截断、摘要压缩和 Memory 召回解决的是不同问题。
- TF-IDF top-k 的计算思路、局限和向量召回升级条件。
- 自动记忆为什么必须经过敏感信息策略和用户审核。
- LSP initialize、文档同步和 publishDiagnostics 的基本流程。

动手任务：

- 新增一条敏感记忆拦截规则和测试。
- 手算一个三文档 TF-IDF 排序示例。
- 制造 TypeScript 类型错误，让 Agent 获取诊断并完成修复。

面试验收：能区分 session、context、memory，并解释为什么不能把聊天记录全部塞给模型。

## 第 4 周：角色系统、Workflow、MCP、Hooks 与多 Agent

对应简历：角色人格、解释风格、风险偏好、角色包以及扩展生态。

重点源码：

- `src/aesthetic/character/CharacterManager.ts`
- `src/aesthetic/character/CharacterPromptLoader.ts`
- `src/aesthetic/character/custom/CharacterPackageManager.ts`
- `src/workflow/WorkflowRunner.ts`
- `src/mcp/McpTransportFactory.ts`
- `src/hooks/HookManager.ts`
- `src/plugin/PluginSandbox.ts`
- `src/engine/multi-agent/MultiAgentRuntime.ts`
- `src/worktree/WorktreeManager.ts`

必须理解：

- 角色如何影响 prompt 和工作模式，同时不能覆盖安全规则。
- 角色包 manifest、schema、完整性校验和 ZIP 安全限制。
- MCP 的 JSON-RPC、stdio、HTTP/SSE/WebSocket 传输边界。
- Hook/Plugin 为什么需要沙箱和最小权限。
- 多 Agent 的任务图、原子 claim、文件锁和 Worktree 隔离。

动手任务：

- 创建一个最小 teacher 角色包，完成 validate、pack、install、switch。
- 编写一个只读 MCP 假服务并调用一个工具。
- 比较 FileLock 与 Git Worktree 分别能解决和不能解决的问题。

面试验收：能证明角色系统不是换皮，并能说出扩展生态的主要安全风险。

## 第 5 周：RoxyStore 鉴权、分层和数据库

对应简历：Spring Boot、Spring Security、Spring Data JPA、MySQL、Flyway、JWT。

重点源码：

- `backend/src/main/java/com/roxy/store/common/config/SecurityConfig.java`
- `backend/src/main/java/com/roxy/store/auth/filter/JwtAuthenticationFilter.java`
- `backend/src/main/java/com/roxy/store/auth/service/AuthService.java`
- `backend/src/main/java/com/roxy/store/character_package/domain/`
- `backend/src/main/resources/db/migration/`

必须理解：

- JWT 从登录生成到过滤器校验、SecurityContext 写入的完整路径。
- Controller、Service、Repository 的职责和事务边界。
- 用户、角色包、版本、收藏、评论、评分、审核之间的关系。
- JPA dirty checking、懒加载、N+1、联合主键和唯一约束。
- Flyway 如何保证不同环境数据库结构一致。

动手任务：

- 画核心 ER 图，并为三个主要查询说明索引选择。
- 用测试验证普通用户不能访问管理员审核接口。
- 制造一次 N+1 查询并用日志定位、修复。

面试验收：能白板讲完整 JWT 过滤器链和一个事务失效案例。

## 第 6 周：RoxyStore 上传、OSS、安全与 Redis

对应简历：角色包上传校验、SHA-256、OSS 预签名 URL、内容安全和缓存。

重点源码：

- `backend/src/main/java/com/roxy/store/character_package/service/PackageUploadService.java`
- `backend/src/main/java/com/roxy/store/character_package/service/PackageDownloadService.java`
- `backend/src/main/java/com/roxy/store/character_package/service/SecurityScanService.java`
- `backend/src/main/java/com/roxy/store/common/validator/JsonSchemaValidator.java`
- `backend/src/main/java/com/roxy/store/storage/AliyunOssStorageService.java`

必须理解：

- 文件大小、扩展名、Schema、ZIP 路径、SHA-256 各自解决什么风险。
- 预签名上传/下载与后端中转文件的取舍。
- 数据库事务无法自动回滚 OSS 时，如何使用补偿和幂等。
- Redis 适合放包详情缓存还是排行榜，以及缓存失效策略。

动手任务：

- 为上传链路写成功、重复 hash、非法 schema、超大文件四类测试。
- 设计“OSS 成功、数据库失败”的补偿方案。
- 用 Redis ZSet 实现或复盘排行榜，并说明数据库回源策略。

面试验收：能讲完整上传下载闭环，并回答数据一致性和安全追问。

## 第 7 周：企业实习经历与后端基础回扣

对应简历：合同管理、结算校验、QLExpress 规则和审批流联调。

学习重点：

- 合同上传、下载、PDF 预览的接口和异常边界。
- 结算单、合同、发票金额与重复发票校验如何组织。
- QLExpress 相比大量 if/else 的价值、风险和表达式安全。
- 业务状态与流程实例状态如何保持一致，如何防止重复送审。

同时回扣基础：

- Java 集合、异常、线程池、ThreadLocal、JMM、JVM 内存和 GC。
- Spring IOC、AOP、Bean 生命周期、事务传播和事务失效。
- MySQL 索引、MVCC、锁、日志和慢 SQL。
- Redis 数据结构、持久化、缓存问题和分布式锁。

动手任务：

- 为结算校验设计责任链或规则列表，不使用超长 if/else。
- 画审批状态机，标出失败、撤回和幂等处理。
- 每个基础技术点准备一个来自项目的使用场景，避免只背定义。

注意：复盘业务设计即可，不复制或展示公司敏感代码、表结构和数据。

## 第 8 周：面试输出与公开证据

为每个个人项目准备：

- 30 秒项目定位。
- 3 分钟完整介绍。
- 10 分钟核心链路深挖。
- 3 个真实问题及解决过程。
- 2 个方案取舍。
- 1 个失败案例和复盘。
- 1 个可稳定运行的演示。

最终验收采用“随机抽题”：

1. 随机选择简历中的一条描述。
2. 90 秒内定位对应源码。
3. 画出调用链。
4. 回答一个失败场景。
5. 提出一个不会破坏现有架构的改进方案。

能够连续完成五次，才算真正掌握该项目。

## 每周时间模板

```text
周一：读入口与画流程，2 小时
周二：追踪核心源码，2 小时
周三：独立改造，2 小时
周四：写测试和制造故障，2 小时
周五：整理文档与面试表达，2 小时
周末：完整演示和随机追问，2-4 小时
```

优先级始终是：先掌握调用链，再掌握局部源码；先能排错，再扩展新功能；先让简历已有描述可信，再增加新的技术名词。
