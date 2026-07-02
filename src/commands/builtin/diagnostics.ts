import chalk from 'chalk';
import { existsSync } from 'node:fs';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import type { ConfigManager } from '../../core/ConfigManager.js';
import type { LLMProvider } from '../../core/types/llm.js';
import type { Language } from '../../i18n/index.js';
import type { ContextManager } from '../../session/context/ContextManager.js';
import type { RuntimeStateSnapshot } from '../../runtime/index.js';
import type { MemoryStats } from '../../session/memory/index.js';
import type { Tool } from '../../tool/index.js';

type Severity = 'pass' | 'info' | 'warning' | 'critical';

interface DiagnosticCheck {
  severity: Severity;
  title: string;
  detail: string;
  action?: string;
}

export interface DiagnosticsCommandOptions {
  language: Language;
  configManager: ConfigManager;
  contextManager: ContextManager;
  llmProvider: LLMProvider;
  characterManager: CharacterManager;
  getRuntimeSnapshot?: () => RuntimeStateSnapshot;
  getMemoryStats?: () => Promise<MemoryStats>;
  getCommandCount: () => number;
  getTools?: () => Tool[];
  getSessionInfo?: () => { sessionId: string; path: string };
}

export async function renderDiagnosticsCommand(options: DiagnosticsCommandOptions): Promise<void> {
  const isZh = options.language === 'zh-CN';
  const config = options.configManager.snapshot();
  const runtime = options.getRuntimeSnapshot?.();
  const contextStatus = await options.contextManager.getStatus([]);
  const character = options.characterManager.getCurrentCharacter();
  const checks: DiagnosticCheck[] = [];

  checks.push(...diagnoseConfig(options));
  checks.push(...diagnoseModel(options, runtime));
  checks.push(...diagnoseWorkspaceExecution(options, runtime));
  checks.push(...diagnoseToolResultPairing(runtime, isZh));
  checks.push(...diagnoseToolScheduling(options));
  checks.push(...diagnoseQueryProfile(runtime, isZh));
  checks.push(...diagnoseSecurity(options));
  checks.push(...diagnoseContext(contextStatus, runtime, isZh));
  checks.push(...await diagnoseMemory(options, isZh));
  checks.push(...diagnoseSession(options, runtime));
  checks.push(...diagnoseExtensions(runtime));
  checks.push(...diagnoseTelemetry(runtime, isZh));
  checks.push(...diagnosePersonalization(options, character.name));

  const counts = countBySeverity(checks);
  const headline = counts.critical > 0
    ? (isZh ? '发现需要优先处理的问题' : 'Critical issues found')
    : counts.warning > 0
      ? (isZh ? '整体可用，但有优化建议' : 'Usable with warnings')
      : (isZh ? '运行底座状态良好' : 'Runtime foundation looks healthy');

  console.log('');
  console.log(chalk.bold(`  ${isZh ? 'RoxyCode 运行诊断' : 'RoxyCode diagnostics'}`));
  console.log(chalk.dim(`  ${headline}`));
  console.log(chalk.dim(`  ${isZh ? '对照 Claude Code: 类似 doctor/status/runtime state，把运行质量问题聚合到一个入口。' : 'Claude Code reference: doctor/status/runtime state style checks in one entry.'}`));
  console.log('');
  console.log(`  ${renderCount('critical', counts.critical)}  ${renderCount('warning', counts.warning)}  ${renderCount('info', counts.info)}  ${renderCount('pass', counts.pass)}`);
  console.log('');

  for (const check of checks) {
    console.log(`  ${renderSeverity(check.severity)} ${check.title}`);
    console.log(chalk.dim(`     ${check.detail}`));
    if (check.action) console.log(chalk.dim(`     ${isZh ? '建议' : 'Action'}: ${check.action}`));
  }

  const actions = checks.filter(check => (check.severity === 'critical' || check.severity === 'warning') && check.action);
  if (actions.length > 0) {
    console.log('');
    console.log(chalk.bold(`  ${isZh ? '优先处理' : 'Priority actions'}`));
    for (const check of actions.slice(0, 5)) {
      console.log(`  - ${check.action}`);
    }
  }

  console.log('');
  void config;
}

function diagnoseConfig(options: DiagnosticsCommandOptions): DiagnosticCheck[] {
  const isZh = options.language === 'zh-CN';
  const validation = options.configManager.validate();
  const errors = validation.issues.filter(issue => issue.severity === 'error');
  const warnings = validation.issues.filter(issue => issue.severity === 'warning');
  if (errors.length === 0 && warnings.length === 0) {
    return [{
      severity: 'pass',
      title: isZh ? '配置 schema 校验通过' : 'Config schema validation passed',
      detail: isZh
        ? '已按 default < global < project < env < session 合并并校验配置。'
        : 'Configuration was merged and validated as default < global < project < env < session.',
    }];
  }

  const first = errors[0] ?? warnings[0];
  return [{
    severity: errors.length > 0 ? 'critical' : 'warning',
    title: isZh ? '配置存在校验问题' : 'Config validation issues present',
    detail: `${errors.length} errors / ${warnings.length} warnings; ${first.path || '<root>'}: ${first.message}`,
    action: isZh ? '运行 /config validate 查看具体来源和修复位置。' : 'Run /config validate to inspect source and file location.',
  }];
}
function diagnoseModel(options: DiagnosticsCommandOptions, runtime?: RuntimeStateSnapshot): DiagnosticCheck[] {
  const isZh = options.language === 'zh-CN';
  const config = options.configManager.snapshot();
  const providerId = normalizeProviderId(runtime?.providerId ?? config.llm.provider);
  const model = runtime?.model ?? config.llm.model;
  const configuredApiKey = Boolean(config.llm.apiKey || readApiKeyFromEnv(providerId));
  const baseUrl = config.llm.baseUrl || readBaseUrlFromEnv(providerId);
  const checks: DiagnosticCheck[] = [];

  checks.push(configuredApiKey
    ? {
        severity: 'pass',
        title: isZh ? '模型 API Key 已配置' : 'Model API key configured',
        detail: `${providerId} / ${model}`,
      }
    : {
        severity: 'critical',
        title: isZh ? '模型 API Key 缺失' : 'Model API key missing',
        detail: isZh
          ? `当前 Provider 是 ${providerId}，但没有在配置或环境变量中发现 API Key。`
          : `Provider ${providerId} has no API key in config or environment variables.`,
        action: modelEnvHint(providerId, isZh),
      });

  if (providerId === 'compatible' && !baseUrl) {
    checks.push({
      severity: 'warning',
      title: isZh ? 'OpenAI-compatible 缺少 baseUrl' : 'OpenAI-compatible baseUrl missing',
      detail: isZh
        ? 'compatible Provider 需要明确的兼容接口地址，否则会回落到 OpenAI 默认地址。'
        : 'The compatible provider needs an explicit endpoint or it falls back to the OpenAI default.',
      action: isZh ? '设置 llm.baseUrl 或 ROXY_OPENAI_BASE_URL，例如 https://api.example.com/v1。' : 'Set llm.baseUrl or ROXY_OPENAI_BASE_URL, for example https://api.example.com/v1.',
    });
  } else if (baseUrl) {
    checks.push({
      severity: baseUrl.endsWith('/v1') ? 'pass' : 'info',
      title: isZh ? '模型 baseUrl 已配置' : 'Model baseUrl configured',
      detail: baseUrl.endsWith('/v1')
        ? baseUrl
        : (isZh ? `${baseUrl}。如果你的代理按 OpenAI 协议暴露 /v1，请确认这里是否需要带 /v1。` : `${baseUrl}. Confirm whether your OpenAI-compatible proxy expects a /v1 suffix.`),
    });
  }

  checks.push(options.llmProvider.supportsTools
    ? {
        severity: 'pass',
        title: isZh ? '当前 Provider 支持工具调用' : 'Provider supports tool calls',
        detail: isZh ? 'Agent Loop 可以进入 tool_use/tool_result 闭环。' : 'The Agent Loop can use the tool_use/tool_result loop.',
      }
    : {
        severity: 'warning',
        title: isZh ? '当前 Provider 不支持工具调用' : 'Provider does not support tool calls',
        detail: isZh ? '自然语言回答可用，但自动读写工作区会降级。' : 'Natural language answers work, but workspace automation is degraded.',
        action: isZh ? '切换到 OpenAI-compatible、Qwen、DeepSeek 或 GLM 的工具调用模型。' : 'Switch to a tool-capable OpenAI-compatible, Qwen, DeepSeek, or GLM model.',
      });

  if (runtime && runtime.usage.requests === 0) {
    checks.push({
      severity: 'info',
      title: isZh ? '本会话尚未记录模型请求' : 'No model requests recorded in this session',
      detail: isZh ? '如果你只运行了 Slash 命令，这是正常的；自然语言任务会触发 Agent Loop。' : 'This is normal if you only ran slash commands; natural language tasks trigger the Agent Loop.',
    });
  }

  return checks;
}

function diagnoseWorkspaceExecution(options: DiagnosticsCommandOptions, runtime?: RuntimeStateSnapshot): DiagnosticCheck[] {
  const isZh = options.language === 'zh-CN';
  if (!runtime) {
    return [{
      severity: 'warning',
      title: isZh ? 'RuntimeState 不可用' : 'RuntimeState unavailable',
      detail: isZh ? '无法读取工具、Hook、错误和慢操作统计。' : 'Tool, hook, error, and slow-operation stats cannot be read.',
      action: isZh ? '确认 REPL 使用 createRuntimeState 初始化，并把 getRuntimeSnapshot 注入命令系统。' : 'Ensure the REPL initializes createRuntimeState and injects getRuntimeSnapshot.',
    }];
  }

  const checks: DiagnosticCheck[] = [];
  const toolCount = runtime.extensions.tools.total;
  checks.push(toolCount > 0
    ? {
        severity: 'pass',
        title: isZh ? '工具注册表已加载' : 'Tool registry loaded',
        detail: `builtin=${runtime.extensions.tools.builtin}, MCP=${runtime.extensions.tools.mcp}, total=${toolCount}`,
      }
    : {
        severity: 'critical',
        title: isZh ? '没有可用工具' : 'No tools available',
        detail: isZh ? 'Agent 无法读写文件、搜索代码或执行命令。' : 'The agent cannot read/write files, search code, or execute commands.',
        action: isZh ? '检查 ToolRegistry 初始化和 MCP 工具加载。' : 'Check ToolRegistry initialization and MCP tool loading.',
      });

  const commandCount = runtime.extensions.commands.total || options.getCommandCount();
  checks.push(commandCount > 0
    ? {
        severity: 'pass',
        title: isZh ? 'Slash 命令已注册' : 'Slash commands registered',
        detail: `${commandCount} ${isZh ? '个命令可用' : 'commands available'}`,
      }
    : {
        severity: 'critical',
        title: isZh ? 'Slash 命令注册为空' : 'Slash command registry is empty',
        detail: isZh ? '基础交互入口不可用。' : 'The basic interaction entry points are unavailable.',
        action: isZh ? '检查 CommandRegistry.registerMany 和 builtin command factory。' : 'Check CommandRegistry.registerMany and the builtin command factory.',
      });

  const toolStats = runtime.operations.tools;
  const lastTool = toolStats.last;
  if (toolStats.totalCalls === 0) {
    checks.push({
      severity: 'info',
      title: isZh ? '本会话尚未调用工作区工具' : 'No workspace tool calls in this session',
      detail: isZh ? '如果你希望它生成或修改项目文件，请使用自然语言提出具体改动，并保持 mode 为 economic/standard/ultimate。' : 'For file generation or edits, send a concrete natural-language task and use economic/standard/ultimate mode.',
    });
  } else if (toolStats.failedCalls > 0) {
    const ratio = toolStats.failedCalls / toolStats.totalCalls;
    const lastDetail = lastTool ? `; ${isZh ? '最近工具' : 'last tool'} ${formatLastTool(lastTool, isZh)}` : '';
    checks.push({
      severity: ratio >= 0.25 ? 'warning' : 'info',
      title: isZh ? '工具调用存在失败记录' : 'Tool calls have failures',
      detail: isZh
        ? `${toolStats.failedCalls}/${toolStats.totalCalls} 次失败，总耗时 ${formatElapsed(toolStats.totalDurationMs)}${lastDetail}`
        : `${toolStats.failedCalls}/${toolStats.totalCalls} failed, total duration ${formatElapsed(toolStats.totalDurationMs)}${lastDetail}`,
      action: lastTool?.success === false && lastTool.error
        ? (isZh ? `先处理最近失败工具 ${lastTool.name}: ${truncate(lastTool.error, 100)}` : `Fix the latest failed tool first: ${lastTool.name}: ${truncate(lastTool.error, 100)}`)
        : (isZh ? '查看 /status 的最近工具和最近运行错误，优先修复权限、路径或 shell 白名单问题。' : 'Check /status for the last tool/runtime error and fix permissions, paths, or shell whitelist issues first.'),
    });
  } else {
    checks.push({
      severity: 'pass',
      title: isZh ? '工具调用未记录失败' : 'No recorded tool failures',
      detail: isZh
        ? `${toolStats.totalCalls} 次调用，总耗时 ${formatElapsed(toolStats.totalDurationMs)}`
        : `${toolStats.totalCalls} calls, total duration ${formatElapsed(toolStats.totalDurationMs)}`,
    });
  }

  if (lastTool) {
    checks.push({
      severity: lastTool.success ? 'pass' : 'warning',
      title: isZh ? '最近工具调用' : 'Last tool call',
      detail: formatLastTool(lastTool, isZh),
      action: !lastTool.success && lastTool.error
        ? (isZh ? '先根据最近工具错误处理权限、路径、命令白名单或外部工具返回。' : 'Handle the latest tool error first: permissions, paths, command whitelist, or external tool output.')
        : undefined,
    });
  }

  const slowTools = runtime.operations.slowOperations.filter(operation => operation.kind === 'tool');
  if (slowTools.length > 0) {
    const slow = slowTools.at(-1)!;
    checks.push({
      severity: slow.durationMs >= 10_000 ? 'warning' : 'info',
      title: isZh ? '检测到慢工具调用' : 'Slow tool call detected',
      detail: isZh
        ? `${slow.operation} 耗时 ${formatElapsed(slow.durationMs)}（${formatAge(Date.now() - slow.timestamp)}前）`
        : `${slow.operation} took ${formatElapsed(slow.durationMs)} (${formatAge(Date.now() - slow.timestamp)} ago)`,
      action: slow.durationMs >= 10_000
        ? (isZh ? '优先检查该工具的输入范围、命令超时、MCP server 响应或文件搜索范围。' : 'Check this tool input scope, command timeout, MCP server response, or file search range first.')
        : undefined,
    });
  }

  const slowNonTools = runtime.operations.slowOperations.filter(operation => operation.kind !== 'tool');
  if (slowNonTools.length > 0) {
    const slow = slowNonTools.at(-1)!;
    checks.push({
      severity: slow.durationMs >= 10_000 ? 'warning' : 'info',
      title: isZh ? '检测到慢操作' : 'Slow operation detected',
      detail: isZh
        ? `${slow.kind}:${slow.operation} 耗时 ${formatElapsed(slow.durationMs)}（${formatAge(Date.now() - slow.timestamp)}前）`
        : `${slow.kind}:${slow.operation} took ${formatElapsed(slow.durationMs)} (${formatAge(Date.now() - slow.timestamp)} ago)`,
      action: slow.durationMs >= 10_000
        ? (isZh ? '优先检查对应 Hook、MCP server、命令或 Agent 阶段的超时设置。' : 'Check the corresponding hook, MCP server, command, or agent phase timeout first.')
        : undefined,
    });
  }

  if (runtime.operations.recentErrors.length > 0) {
    const last = runtime.operations.recentErrors.at(-1)!;
    const providerAdvice = buildProviderErrorAdvice(last, isZh, runtime.providerDiagnostics);
    checks.push({
      severity: runtime.agent.lastError || providerAdvice ? 'critical' : 'warning',
      title: providerAdvice
        ? (isZh ? '最近模型 Provider 调用失败' : 'Recent model provider failure')
        : (isZh ? '存在最近运行错误' : 'Recent runtime errors present'),
      detail: providerAdvice?.detail ?? `${last.source}: ${last.message}`,
      action: providerAdvice?.action ?? (isZh ? '先复现最近一次自然语言任务，再用 /status 和审计日志定位失败的工具链路。' : 'Reproduce the latest natural-language task, then use /status and audit logs to locate the failing tool path.'),
    });
  }

  return checks;
}

function diagnoseToolResultPairing(runtime: RuntimeStateSnapshot | undefined, isZh: boolean): DiagnosticCheck[] {
  if (!runtime) return [];
  const pairing = runtime.operations.toolResultPairing;
  if (!pairing || pairing.totalRepairs === 0) {
    return [{
      severity: 'pass',
      title: isZh ? '\u5de5\u5177\u6d88\u606f\u914d\u5bf9\u6ca1\u6709\u81ea\u52a8\u4fee\u590d' : 'Tool message pairing had no repairs',
      detail: isZh
        ? '\u672c\u4f1a\u8bdd\u7684 Provider \u8bf7\u6c42\u524d\u6ca1\u6709\u68c0\u6d4b\u5230 tool_use/tool_result \u4e0d\u914d\u5bf9\u3002'
        : 'No tool_use/tool_result pairing repairs were needed before provider requests.',
    }];
  }

  const duplicate = pairing.removedDuplicateToolUses + pairing.removedDuplicateToolResults;
  const last = pairing.last
    ? `last=${pairing.last.originalMessageCount}->${pairing.last.repairedMessageCount} messages`
    : 'last=unknown';
  return [{
    severity: pairing.insertedSyntheticResults > 0 ? 'warning' : 'info',
    title: isZh ? '\u5de5\u5177\u6d88\u606f\u914d\u5bf9\u53d1\u751f\u8fc7\u81ea\u52a8\u4fee\u590d' : 'Tool message pairing was automatically repaired',
    detail: `repairs=${pairing.totalRepairs}, synthetic=${pairing.insertedSyntheticResults}, orphan=${pairing.removedOrphanResults}, duplicate=${duplicate}, ${last}`,
    action: pairing.insertedSyntheticResults > 0
      ? (isZh
          ? '\u5982\u679c\u4e0b\u4e00\u6b21\u56de\u7b54\u4e0d\u8fde\u8d2f\uff0c\u5148\u7528 /rewind \u56de\u9000\u6700\u8fd1\u4e00\u8f6e\uff0c\u518d\u7528 /resume \u6216\u91cd\u65b0\u53d1\u9001\u4efb\u52a1\uff1b\u540c\u65f6\u68c0\u67e5\u4f1a\u8bdd\u6062\u590d\u548c\u4e0a\u4e0b\u6587\u538b\u7f29\u8def\u5f84\u3002'
          : 'If the next answer looks inconsistent, use /rewind for the latest turn, then /resume or resend the task; inspect session resume and context compaction paths.')
      : (isZh
          ? '\u8fd9\u7c7b\u4fee\u590d\u901a\u5e38\u662f\u6e05\u7406\u5b64\u7acb\u6216\u91cd\u590d\u5de5\u5177\u6d88\u606f\uff1b\u5982\u679c\u9891\u7e41\u51fa\u73b0\uff0c\u68c0\u67e5\u81ea\u5b9a\u4e49\u5de5\u5177\u3001MCP \u6216\u4f1a\u8bdd\u5bfc\u5165\u903b\u8f91\u3002'
          : 'This usually cleans orphan or duplicate tool messages. If frequent, inspect custom tools, MCP adapters, or session import logic.'),
  }];
}
function buildProviderErrorAdvice(
  error: RuntimeStateSnapshot['operations']['recentErrors'][number],
  isZh: boolean,
  runtimeProvider?: RuntimeStateSnapshot['providerDiagnostics'],
): { detail: string; action: string } | null {
  const descriptor = readDescriptor(error.metadata);
  const provider = readProviderContext(error.metadata, descriptor, runtimeProvider);
  const code = descriptor?.code ?? provider.code;
  const category = descriptor?.category;
  const statusCode = provider.statusCode ?? readStatusCode(descriptor);
  const looksLikeProvider = error.source === 'agent'
    && (typeof code === 'string'
      || category === 'llm'
      || category === 'network'
      || category === 'config'
      || provider.providerId !== undefined
      || provider.requestId !== undefined
      || /provider|api key|rate limit|stream|sse|json|model|llm/i.test(error.message));
  if (!looksLikeProvider) return null;

  const detail = formatProviderErrorDetail(error, provider, statusCode);

  switch (code) {
    case 'INVALID_CONFIG':
      return {
        detail,
        action: isZh
          ? '\u68c0\u67e5 /config validate\u3001ROXY_OPENAI_API_KEY\u3001ROXY_OPENAI_BASE_URL \u662f\u5426\u6b63\u786e\uff1bOpenAI-compatible \u7f51\u5173\u5730\u5740\u901a\u5e38\u9700\u8981\u4ee5 /v1 \u7ed3\u5c3e\u3002' + fallbackAdvice(provider, isZh)
          : 'Check /config validate, ROXY_OPENAI_API_KEY, and ROXY_OPENAI_BASE_URL. OpenAI-compatible gateways usually need a /v1 suffix.' + fallbackAdvice(provider, isZh),
      };
    case 'RATE_LIMIT':
      return {
        detail,
        action: isZh
          ? '\u8fd9\u662f\u9650\u6d41\u6216\u989d\u5ea6\u95ee\u9898\u3002' + (provider.retryAfterMs !== undefined ? '\u5efa\u8bae\u7b49\u5f85 ' + formatElapsed(provider.retryAfterMs) + ' \u540e\u518d\u8bd5\uff1b' : '') + '\u964d\u4f4e\u5e76\u53d1\u3001\u5207\u6362\u6a21\u578b\uff0c\u7a0d\u540e\u91cd\u8bd5\uff1b\u5982\u679c\u662f\u4e2d\u8f6c\u7f51\u5173\uff0c\u68c0\u67e5\u6e20\u9053\u4f59\u989d\u548c RPM/TPM \u9650\u5236\u3002' + fallbackAdvice(provider, isZh)
          : 'This is rate limiting or quota pressure. ' + (provider.retryAfterMs !== undefined ? 'Wait about ' + formatElapsed(provider.retryAfterMs) + ' before retrying. ' : '') + 'Reduce concurrency, switch models, retry later, and check gateway balance/RPM/TPM limits.' + fallbackAdvice(provider, isZh),
      };
    case 'SERVER_ERROR':
    case 'NETWORK_ERROR':
      return {
        detail,
        action: isZh
          ? '\u68c0\u67e5\u7f51\u7edc\u3001\u4ee3\u7406\u548c\u517c\u5bb9\u7f51\u5173\u72b6\u6001\uff1b\u5982\u679c\u8fde\u7eed\u5931\u8d25\uff0c\u5148\u7528 /model \u786e\u8ba4\u6a21\u578b\uff0c\u518d\u7528\u4e00\u4e2a\u77ed\u63d0\u793a\u505a\u771f\u5b9e Provider smoke\u3002' + fallbackAdvice(provider, isZh)
          : 'Check network, proxy, and gateway health. If it repeats, confirm the model with /model, then run a short real provider smoke prompt.' + fallbackAdvice(provider, isZh),
      };
    case 'API_ERROR':
      return {
        detail,
        action: isZh
          ? 'Provider \u8fd4\u56de\u683c\u5f0f\u4e0d\u7b26\u5408 OpenAI-compatible \u534f\u8bae\uff0c\u91cd\u70b9\u68c0\u67e5\u6a21\u578b\u662f\u5426\u652f\u6301 chat/completions\u3001stream \u548c tool_calls\u3002' + fallbackAdvice(provider, isZh)
          : 'The provider response does not match OpenAI-compatible protocol. Check chat/completions, stream, and tool_calls support.' + fallbackAdvice(provider, isZh),
      };
    case 'ABORTED':
      return {
        detail,
        action: isZh ? '\u8bf7\u6c42\u88ab\u4e2d\u65ad\uff1b\u5982\u679c\u4e0d\u662f\u624b\u52a8\u53d6\u6d88\uff0c\u68c0\u67e5\u8d85\u65f6\u3001Hook \u6216\u7ec8\u7aef\u4e2d\u65ad\u6765\u6e90\u3002' : 'The request was aborted. If it was not manual, inspect timeout, hooks, or terminal interrupts.',
      };
    default:
      return {
        detail,
        action: isZh
          ? '\u5148\u8fd0\u884c /diagnostics \u548c /config validate\uff1b\u5982\u679c\u662f\u6a21\u578b\u517c\u5bb9\u95ee\u9898\uff0c\u5207\u6362\u5230 OpenAI-compatible \u5de5\u5177\u8c03\u7528\u6a21\u578b\u518d\u8bd5\u3002' + fallbackAdvice(provider, isZh)
          : 'Run /diagnostics and /config validate first. If this is compatibility-related, switch to an OpenAI-compatible tool-capable model.' + fallbackAdvice(provider, isZh),
      };
  }
}

interface ProviderDiagnosticContext {
  providerId?: string;
  model?: string;
  requestId?: string;
  statusCode?: number;
  retryAfterMs?: number;
  fallbackModel?: string;
  fallbackModels?: string[];
  code?: string;
}

function formatProviderErrorDetail(
  error: RuntimeStateSnapshot['operations']['recentErrors'][number],
  provider: ProviderDiagnosticContext,
  statusCode: number | undefined,
): string {
  const parts = [error.source + ': ' + truncate(error.message, 180)];
  if (statusCode !== undefined) parts.push('HTTP ' + statusCode);
  if (provider.providerId || provider.model) parts.push('model=' + [provider.providerId, provider.model].filter(Boolean).join('/'));
  if (provider.requestId) parts.push('request_id=' + provider.requestId);
  if (provider.retryAfterMs !== undefined) parts.push('retry_after=' + formatElapsed(provider.retryAfterMs));
  if (provider.fallbackModel) parts.push('fallback=' + provider.fallbackModel);
  return parts.join(' / ');
}

function fallbackAdvice(provider: ProviderDiagnosticContext, isZh: boolean): string {
  const fallback = provider.fallbackModel ?? provider.fallbackModels?.[0];
  if (!fallback) return '';
  return isZh
    ? ' \u5982\u679c\u5f53\u524d\u6a21\u578b\u6301\u7eed\u5931\u8d25\uff0c\u53ef\u7528 /model \u5207\u6362\u5230\u5907\u7528\u6a21\u578b ' + fallback + '\u3002'
    : ' If the current model keeps failing, use /model to switch to fallback model ' + fallback + '.';
}

function readProviderContext(
  metadata: Record<string, unknown> | undefined,
  descriptor: Record<string, unknown> | undefined,
  runtimeProvider?: RuntimeStateSnapshot['providerDiagnostics'],
): ProviderDiagnosticContext {
  const details = readRecord(descriptor?.details);
  const provider = readRecord(metadata?.provider);
  return {
    providerId: readString(provider?.providerId) ?? readString(details?.providerId) ?? runtimeProvider?.providerId,
    model: readString(provider?.model) ?? readString(details?.model) ?? runtimeProvider?.model,
    requestId: readString(provider?.requestId) ?? readString(details?.requestId) ?? runtimeProvider?.requestId,
    statusCode: readNumber(provider?.statusCode) ?? readNumber(details?.statusCode) ?? runtimeProvider?.statusCode,
    retryAfterMs: readNumber(provider?.retryAfterMs) ?? readNumber(details?.retryAfterMs) ?? runtimeProvider?.retryAfterMs,
    fallbackModel: readString(provider?.fallbackModel) ?? readString(details?.fallbackModel) ?? runtimeProvider?.fallbackModel,
    fallbackModels: readStringArray(provider?.fallbackModels) ?? readStringArray(details?.fallbackModels) ?? runtimeProvider?.fallbackModels,
    code: readString(provider?.code) ?? readString(descriptor?.code) ?? runtimeProvider?.code,
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
  return items.length > 0 ? items : undefined;
}

function readDescriptor(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const descriptor = metadata?.descriptor;
  return descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor)
    ? descriptor as Record<string, unknown>
    : undefined;
}

function readStatusCode(descriptor: Record<string, unknown> | undefined): number | undefined {
  const direct = descriptor?.statusCode;
  if (typeof direct === 'number') return direct;
  const details = descriptor?.details;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const nested = (details as Record<string, unknown>).statusCode;
    if (typeof nested === 'number') return nested;
  }
  return undefined;
}
function formatLastTool(last: NonNullable<RuntimeStateSnapshot['operations']['tools']['last']>, isZh: boolean): string {
  const status = last.success ? (isZh ? '成功' : 'ok') : (isZh ? '失败' : 'failed');
  const error = last.error ? ` / ${isZh ? '错误' : 'error'}=${truncate(last.error, 120)}` : '';
  return isZh
    ? `${last.name} / ${status} / ${formatElapsed(last.durationMs)} / ${formatAge(Date.now() - last.at)}前${error}`
    : `${last.name} / ${status} / ${formatElapsed(last.durationMs)} / ${formatAge(Date.now() - last.at)} ago${error}`;
}
function diagnoseToolScheduling(options: DiagnosticsCommandOptions): DiagnosticCheck[] {
  const isZh = options.language === 'zh-CN';
  const tools = options.getTools?.() ?? [];
  if (tools.length === 0) return [];

  const safe = tools.filter(tool => tool.concurrency === 'safe').length;
  const exclusive = tools.filter(tool => tool.concurrency === 'exclusive').length;
  const cancel = tools.filter(tool => tool.interruptBehavior === 'cancel').length;
  const block = tools.filter(tool => tool.interruptBehavior === 'block').length;
  const dynamic = tools.filter(tool => typeof tool.isConcurrencySafe === 'function').length;
  const missingDynamic = tools
    .filter(tool => dynamicSchedulingWouldHelp(tool.definition.name))
    .filter(tool => typeof tool.isConcurrencySafe !== 'function')
    .map(tool => tool.definition.name);
  const highRisk = tools.filter(tool => tool.riskLevel === 'high').map(tool => tool.definition.name);

  const checks: DiagnosticCheck[] = [{
    severity: tools.every(tool => tool.concurrency && tool.interruptBehavior) ? 'pass' : 'warning',
    title: isZh ? '\u5de5\u5177\u8c03\u5ea6\u5143\u6570\u636e' : 'Tool scheduling metadata',
    detail: isZh
      ? 'total=' + tools.length + ', \u53ef\u5e76\u53d1=' + safe + ', \u72ec\u5360=' + exclusive + ', \u53ef\u4e2d\u65ad=' + cancel + ', \u963b\u585e\u5b8c\u6210=' + block + ', \u8f93\u5165\u7ea7\u5224\u5b9a=' + dynamic
      : 'total=' + tools.length + ', concurrent=' + safe + ', exclusive=' + exclusive + ', interruptible=' + cancel + ', blocking=' + block + ', input-aware=' + dynamic,
    action: tools.some(tool => !tool.concurrency || !tool.interruptBehavior)
      ? (isZh ? '\u4e3a\u6240\u6709\u5de5\u5177\u8865\u9f50 concurrency \u4e0e interruptBehavior\uff0c\u907f\u514d\u8c03\u5ea6\u5668\u53ea\u80fd\u9760\u63a8\u65ad\u3002' : 'Add concurrency and interruptBehavior to every tool so the scheduler does not rely on inference.')
      : undefined,
  }];

  if (dynamic === 0) {
    checks.push({
      severity: 'info',
      title: isZh ? '\u5de5\u5177\u5c1a\u672a\u4f7f\u7528\u8f93\u5165\u7ea7\u5e76\u53d1\u5224\u5b9a' : 'No input-aware tool concurrency checks',
      detail: isZh
        ? 'Claude Code \u7684 isConcurrencySafe(input) \u4f1a\u6309\u53c2\u6570\u5224\u65ad\u5b89\u5168\u6027\uff1bRoxyCode \u5df2\u652f\u6301\u8be5\u63a5\u53e3\uff0c\u5efa\u8bae\u4f18\u5148\u7ed9 Git/Shell \u7c7b\u5de5\u5177\u8865\u5145\u3002'
        : 'Claude Code uses isConcurrencySafe(input). RoxyCode now supports that hook; Git/Shell-style tools should adopt it first.',
    });
  } else {
    checks.push({
      severity: 'pass',
      title: isZh ? '\u8f93\u5165\u7ea7\u5de5\u5177\u5e76\u53d1\u5224\u5b9a\u5df2\u542f\u7528' : 'Input-aware tool concurrency enabled',
      detail: isZh ? String(dynamic) + ' \u4e2a\u5de5\u5177\u53ef\u6309\u53c2\u6570\u5224\u65ad\u5e76\u53d1\u5b89\u5168\u3002' : String(dynamic) + ' tools can judge concurrency safety from arguments.',
    });
  }

  if (missingDynamic.length > 0) {
    checks.push({
      severity: 'info',
      title: isZh ? '\u5de5\u5177\u52a8\u6001\u5224\u5b9a\u5efa\u8bae' : 'Tool dynamic scheduling suggestions',
      detail: missingDynamic.join(', '),
      action: isZh
        ? '\u4f18\u5148\u4e3a Shell\u3001MCP \u548c\u672a\u6765 Git \u5199\u64cd\u4f5c\u8865\u5145\u8f93\u5165\u7ea7\u5e76\u53d1/\u98ce\u9669\u5224\u5b9a\u3002'
        : 'Prioritize input-aware concurrency/risk checks for Shell, MCP, and future write-capable Git operations.',
    });
  }

  if (highRisk.length > 0) {
    checks.push({
      severity: highRisk.every(name => tools.find(tool => tool.definition.name === name)?.interruptBehavior === 'block') ? 'pass' : 'warning',
      title: isZh ? '\u9ad8\u98ce\u9669\u5de5\u5177\u4e2d\u65ad\u7b56\u7565' : 'High-risk tool interrupt policy',
      detail: highRisk.join(', '),
      action: highRisk.every(name => tools.find(tool => tool.definition.name === name)?.interruptBehavior === 'block')
        ? undefined
        : (isZh ? '\u9ad8\u98ce\u9669\u5199\u5165/Shell \u5de5\u5177\u5e94\u9ed8\u8ba4 block\uff0c\u907f\u514d\u534a\u5199\u5165\u6216\u526f\u4f5c\u7528\u72b6\u6001\u4e0d\u660e\u3002' : 'High-risk write/shell tools should default to block to avoid partial writes or unclear side effects.'),
    });
  }

  return checks;
}

function dynamicSchedulingWouldHelp(toolName: string): boolean {
  return toolName === 'execute_command' || toolName === 'git' || toolName.startsWith('mcp__');
}
function diagnoseQueryProfile(runtime: RuntimeStateSnapshot | undefined, isZh: boolean): DiagnosticCheck[] {
  if (!runtime) return [];
  const profile = runtime.operations.queryProfiles.last;
  if (!profile) {
    return [{
      severity: 'info',
      title: isZh ? 'Query Pipeline 尚未记录' : 'Query pipeline has no profile yet',
      detail: isZh
        ? '本会话还没有完成自然语言 Agent 任务。发送一次编程请求后，/perf query 会显示从输入到首 token、工具执行和上下文压缩的耗时。'
        : 'No natural-language agent task has completed in this session. After one request, /perf query shows input-to-first-token, tool execution, and context compaction timing.',
      action: isZh ? '发送一次自然语言编程任务后运行 /perf query。' : 'Send a natural-language coding request, then run /perf query.',
    }];
  }

  const checks: DiagnosticCheck[] = [];
  const firstToken = profile.firstTokenMs !== undefined ? ` / TTFT=${formatElapsed(profile.firstTokenMs)}` : '';
  const slowest = profile.slowestPhase ? ` / slowest=${profile.slowestPhase.name}:${formatElapsed(profile.slowestPhase.durationMs)}` : '';
  checks.push({
    severity: profile.totalMs >= 15_000 ? 'warning' : profile.totalMs >= 5_000 ? 'info' : 'pass',
    title: isZh ? 'Query Pipeline 性能画像' : 'Query pipeline profile',
    detail: `mode=${profile.mode} / total=${formatElapsed(profile.totalMs)}${firstToken}${slowest} / modelRequests=${profile.modelRequestCount} / toolExecutions=${profile.toolExecutionCount}`,
    action: profile.totalMs >= 15_000
      ? (isZh ? '运行 /perf query 查看阶段拆解，优先定位最慢阶段。' : 'Run /perf query and inspect the slowest phase first.')
      : undefined,
  });

  if (profile.firstTokenMs !== undefined && profile.firstTokenMs >= 8_000) {
    checks.push({
      severity: 'warning',
      title: isZh ? '首 token 延迟偏高' : 'First-token latency is high',
      detail: isZh
        ? `TTFT=${formatElapsed(profile.firstTokenMs)}，请求前开销=${formatElapsed(profile.preFirstTokenMs ?? 0)}。Claude Code 会把 pre-request 和 network wait 分开看，RoxyCode 也按这个方向定位。`
        : `TTFT=${formatElapsed(profile.firstTokenMs)}, pre-request=${formatElapsed(profile.preFirstTokenMs ?? 0)}. Claude Code separates pre-request overhead from network wait; RoxyCode follows the same diagnostic model.`,
      action: isZh ? '如果请求前开销高，检查上下文/Hook/工具 schema；如果等待高，检查模型网关或模型选择。' : 'If pre-request is high, inspect context/hooks/tool schema; if wait is high, inspect the model gateway or model choice.',
    });
  }

  if (profile.slowestPhase && profile.slowestPhase.durationMs >= 5_000) {
    checks.push({
      severity: 'warning',
      title: isZh ? '存在明显慢阶段' : 'Slow query phase detected',
      detail: `${profile.slowestPhase.name} took ${formatElapsed(profile.slowestPhase.durationMs)}`,
      action: queryPhaseAction(profile.slowestPhase.name, isZh),
    });
  }

  if (runtime.operations.queryProfiles.slowProfiles.length > 0) {
    checks.push({
      severity: 'info',
      title: isZh ? '慢 Query 留存' : 'Slow query retention',
      detail: `${runtime.operations.queryProfiles.slowProfiles.length} ${isZh ? '条超过 5s 的 Query 已保存在 RuntimeState。' : 'queries over 5s retained in RuntimeState.'}`,
    });
  }

  return checks;
}

function queryPhaseAction(phase: string, isZh: boolean): string {
  if (phase === 'Context loading' || phase === 'Context compaction') {
    return isZh ? '检查 ROXY.md、Memory 注入、压缩策略和上下文上限。' : 'Check ROXY.md, memory injection, compaction strategy, and context limits.';
  }
  if (phase === 'Hooks') {
    return isZh ? '运行 /hooks list，检查阻塞型或慢速 command/http/prompt/agent hook。' : 'Run /hooks list and inspect blocking or slow command/http/prompt/agent hooks.';
  }
  if (phase === 'Model request' || phase === 'First token latency') {
    return isZh ? '检查 baseUrl、模型网关、当前模型和网络延迟。' : 'Check baseUrl, model gateway, selected model, and network latency.';
  }
  if (phase === 'Tool execution') {
    return isZh ? '查看 /status 的最近工具、审计日志和权限确认耗时。' : 'Check /status last tool, audit logs, and permission confirmation latency.';
  }
  return isZh ? '运行 /perf query 查看完整检查点。' : 'Run /perf query for the full checkpoint timeline.';
}
function diagnoseSecurity(options: DiagnosticsCommandOptions): DiagnosticCheck[] {
  const isZh = options.language === 'zh-CN';
  const security = options.configManager.snapshot().security;
  const checks: DiagnosticCheck[] = [];

  checks.push(security.fileAccess.mode === 'project-only'
    ? {
        severity: 'pass',
        title: isZh ? '文件路径限制为当前项目' : 'File access is project-scoped',
        detail: isZh ? '默认不会越过当前工作区修改文件。' : 'By default, edits stay inside the current workspace.',
      }
    : {
        severity: 'warning',
        title: isZh ? '文件访问处于 unrestricted' : 'File access is unrestricted',
        detail: isZh ? '这会扩大误改范围，不适合默认开发体验。' : 'This expands the blast radius of accidental edits.',
        action: isZh ? '设置 security.fileAccess.mode 为 project-only。' : 'Set security.fileAccess.mode to project-only.',
      });

  checks.push(security.fileAccess.backupBeforeWrite
    ? {
        severity: 'pass',
        title: isZh ? '写文件前备份已开启' : 'Backup before write enabled',
        detail: isZh ? '写入类工具会保留回滚基础。' : 'Write tools have a rollback foundation.',
      }
    : {
        severity: 'warning',
        title: isZh ? '写文件前备份未开启' : 'Backup before write disabled',
        detail: isZh ? '工具写错文件时恢复成本会变高。' : 'Recovery is harder if a tool writes the wrong content.',
        action: isZh ? '设置 security.fileAccess.backupBeforeWrite 为 true。' : 'Set security.fileAccess.backupBeforeWrite to true.',
      });

  checks.push(security.shell.mode === 'whitelist' && security.shell.requireConfirmation
    ? {
        severity: 'pass',
        title: isZh ? 'Shell 白名单与确认机制已开启' : 'Shell whitelist and confirmation enabled',
        detail: `${security.shell.whitelist.length} ${isZh ? '条白名单命令' : 'whitelisted command patterns'}`,
      }
    : {
        severity: 'warning',
        title: isZh ? 'Shell 安全策略偏宽' : 'Shell safety policy is broad',
        detail: isZh ? 'Claude Code 的成熟路径是高风险命令必须经过确认；RoxyCode 也应保持这个默认。' : 'Claude Code keeps risky shell actions on a confirmation path; RoxyCode should keep that default too.',
        action: isZh ? '使用 whitelist 模式并保持 requireConfirmation=true。' : 'Use whitelist mode and keep requireConfirmation=true.',
      });

  checks.push(security.highRisk.requireSecondConfirmation
    ? {
        severity: 'pass',
        title: isZh ? '高危操作二次确认已开启' : 'Second confirmation for high-risk operations enabled',
        detail: isZh ? '删除、覆盖、危险 shell 等操作不会被静默执行。' : 'Delete, overwrite, and dangerous shell actions are not silent.',
      }
    : {
        severity: 'critical',
        title: isZh ? '高危操作二次确认未开启' : 'Second confirmation for high-risk operations disabled',
        detail: isZh ? '这会破坏 Agent 工具执行的安全底线。' : 'This weakens the safety boundary for agent tool execution.',
        action: isZh ? '设置 security.highRisk.requireSecondConfirmation 为 true。' : 'Set security.highRisk.requireSecondConfirmation to true.',
      });

  return checks;
}

function diagnoseContext(
  contextStatus: Awaited<ReturnType<ContextManager['getStatus']>>,
  runtime: RuntimeStateSnapshot | undefined,
  isZh: boolean,
): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  checks.push(contextStatus.compressionEnabled
    ? {
        severity: 'pass',
        title: isZh ? '上下文自动压缩已开启' : 'Context auto-compaction enabled',
        detail: `${contextStatus.registeredStrategies.join(', ') || 'no strategies'} / threshold ${(contextStatus.compressThreshold * 100).toFixed(0)}%`,
      }
    : {
        severity: 'warning',
        title: isZh ? '上下文自动压缩关闭' : 'Context auto-compaction disabled',
        detail: isZh ? '长任务更容易因为上下文膨胀失去连续性。' : 'Long tasks are more likely to lose continuity as context grows.',
        action: isZh ? '设置 context.enableCompression 为 true。' : 'Set context.enableCompression to true.',
      });

  if (contextStatus.registeredStrategies.length === 0) {
    checks.push({
      severity: 'warning',
      title: isZh ? '没有注册压缩策略' : 'No context compression strategies registered',
      detail: isZh ? '只靠截断会丢失任务意图，建议至少注册摘要和截断兜底。' : 'Truncation alone loses intent; register summary plus truncation fallback.',
      action: isZh ? '确认 ContextManager 注册 SummaryStrategy 和 TruncationStrategy。' : 'Ensure ContextManager registers SummaryStrategy and TruncationStrategy.',
    });
  }

  if (runtime && runtime.agent.contextCompactions > 0) {
    checks.push({
      severity: 'info',
      title: isZh ? '本会话发生过上下文压缩' : 'Context compaction happened in this session',
      detail: `${runtime.agent.contextCompactions} ${isZh ? '次压缩' : 'compactions'}`,
    });
  }

  return checks;
}

async function diagnoseMemory(options: DiagnosticsCommandOptions, isZh: boolean): Promise<DiagnosticCheck[]> {
  if (!options.getMemoryStats) {
    return [{
      severity: 'warning',
      title: isZh ? 'Memory state unavailable' : 'Memory state unavailable',
      detail: isZh
        ? 'Command layer cannot read MemoryStore statistics, so memory recall/auto-save visibility is incomplete.'
        : 'Command layer cannot read MemoryStore statistics, so memory recall/auto-save visibility is incomplete.',
      action: isZh ? 'Ensure REPL injects getMemoryStats into builtin commands.' : 'Ensure REPL injects getMemoryStats into builtin commands.',
    }];
  }

  const stats = await options.getMemoryStats();
  const checks: DiagnosticCheck[] = [];
  checks.push({
    severity: stats.enabled ? 'pass' : 'info',
    title: isZh ? 'Memory auto extraction' : 'Memory auto extraction',
    detail: `${stats.enabled ? 'enabled' : 'disabled'} / total=${stats.total} / manual=${stats.manual} / auto=${stats.auto}`,
    action: stats.enabled ? undefined : (isZh ? 'Use /memory auto on to enable automatic long-term memory extraction.' : 'Use /memory auto on to enable automatic long-term memory extraction.'),
  });

  checks.push(stats.total > 0
    ? {
        severity: 'pass',
        title: isZh ? 'Memory recall corpus available' : 'Memory recall corpus available',
        detail: `global=${stats.global}, project=${stats.project}, latest=${stats.latestAge ?? 'unknown'}`,
      }
    : {
        severity: 'info',
        title: isZh ? 'No long-term memories yet' : 'No long-term memories yet',
        detail: isZh
          ? 'RuntimeContext can inject memories into Agent prompts once /memory add or auto extraction creates records.'
          : 'RuntimeContext can inject memories into Agent prompts once /memory add or auto extraction creates records.',
        action: isZh ? 'Use /memory add or keep memory.auto enabled during real coding sessions.' : 'Use /memory add or keep memory.auto enabled during real coding sessions.',
      });

  const populatedTypes = Object.entries(stats.byType).filter(([, count]) => count > 0).map(([type, count]) => `${type}=${count}`);
  checks.push({
    severity: 'info',
    title: isZh ? 'Memory type distribution' : 'Memory type distribution',
    detail: populatedTypes.length ? populatedTypes.join(', ') : 'empty',
  });

  return checks;
}
function diagnoseSession(options: DiagnosticsCommandOptions, runtime?: RuntimeStateSnapshot): DiagnosticCheck[] {
  const isZh = options.language === 'zh-CN';
  const session = runtime ? { sessionId: runtime.session.sessionId, path: runtime.session.transcriptPath } : options.getSessionInfo?.();
  if (!session) {
    return [{
      severity: 'warning',
      title: isZh ? '无法读取会话信息' : 'Session info unavailable',
      detail: isZh ? '无法确认 JSONL transcript 是否正常写入。' : 'Cannot confirm whether the JSONL transcript is being written.',
      action: isZh ? '检查 SessionStore 初始化和 getSessionInfo 注入。' : 'Check SessionStore initialization and getSessionInfo injection.',
    }];
  }
  return [{
    severity: existsSync(session.path) ? 'pass' : 'warning',
    title: isZh ? '会话 transcript 路径' : 'Session transcript path',
    detail: existsSync(session.path)
      ? `${session.sessionId} -> ${session.path}`
      : (isZh ? `${session.path} 尚不存在，可能还没有写入消息。` : `${session.path} does not exist yet; no message may have been written.`),
    action: existsSync(session.path) ? undefined : (isZh ? '发送一次自然语言任务后再运行 /diagnostics。' : 'Send one natural-language task, then run /diagnostics again.'),
  }];
}

function diagnoseExtensions(runtime?: RuntimeStateSnapshot): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  if (!runtime) return checks;
  const extensionErrors = [
    ...runtime.extensions.plugins.errors.map(error => `plugin ${error.path}: ${error.message}`),
    ...runtime.extensions.hooks.errors.map(error => `hook ${error.path}: ${error.message}`),
    ...runtime.extensions.mcp.errors.map(error => `${error.source}: ${error.message}`),
  ];

  checks.push(extensionErrors.length === 0
    ? {
        severity: 'pass',
        title: 'MCP / Hooks / Plugin load path',
        detail: `plugins=${runtime.extensions.plugins.enabled}/${runtime.extensions.plugins.disabled}, hooks=${runtime.extensions.hooks.count}, mcp=${runtime.extensions.mcp.servers}/${runtime.extensions.mcp.tools}`,
      }
    : {
        severity: 'warning',
        title: 'MCP / Hooks / Plugin load warnings',
        detail: truncate(extensionErrors[0], 160),
        action: 'Run /mcp list, /hooks list, or /plugin validate to inspect extension configuration.',
      });

  if (runtime.operations.hooks.blockedRuns > 0 || runtime.operations.hooks.errorRuns > 0) {
    checks.push({
      severity: 'warning',
      title: 'Hook runtime warnings',
      detail: `${runtime.operations.hooks.blockedRuns} blocked, ${runtime.operations.hooks.errorRuns} error`,
      action: 'Check blocking hooks first; they can stop prompts, commands, or tool execution.',
    });
  }

  return checks;
}

function diagnoseTelemetry(runtime: RuntimeStateSnapshot | undefined, isZh: boolean): DiagnosticCheck[] {
  if (!runtime?.telemetry) {
    return [{
      severity: 'warning',
      title: isZh ? '遥测状态不可用' : 'Telemetry state unavailable',
      detail: isZh ? '无法读取本地 telemetry 摘要，/status 将缺少事件落盘信息。' : 'Local telemetry summary is not available, so /status cannot show event persistence info.',
      action: isZh ? '确认 REPL 创建 TelemetryLogger，并把 snapshot 写入 RuntimeState。' : 'Ensure the REPL creates TelemetryLogger and records its snapshot into RuntimeState.',
    }];
  }

  const telemetry = runtime.telemetry;
  const checks: DiagnosticCheck[] = [{
    severity: telemetry.enabled ? 'pass' : 'info',
    title: isZh ? '本地遥测文件' : 'Local telemetry file',
    detail: `${telemetry.enabled ? (isZh ? '已启用' : 'enabled') : (isZh ? '已关闭' : 'disabled')} / events=${telemetry.eventCount} / dropped=${telemetry.droppedEvents} / ${telemetry.path}`,
    action: telemetry.enabled ? undefined : (isZh ? '如需排障，请不要设置 ROXY_TELEMETRY_DISABLED=1。' : 'For diagnostics, do not set ROXY_TELEMETRY_DISABLED=1.'),
  }];

  if (telemetry.lastError) {
    checks.push({
      severity: 'warning',
      title: isZh ? '遥测写入存在错误' : 'Telemetry write warning',
      detail: telemetry.lastError,
      action: isZh ? '检查 .roxycode/telemetry 目录权限和磁盘空间。' : 'Check .roxycode/telemetry permissions and disk space.',
    });
  }

  return checks;
}
function diagnosePersonalization(options: DiagnosticsCommandOptions, characterName: string): DiagnosticCheck[] {
  const isZh = options.language === 'zh-CN';
  const config = options.configManager.snapshot();
  const character = options.characterManager.getCurrentCharacter();
  const behavior = character.behavior;
  const lastHook = options.getRuntimeSnapshot?.().operations.hooks.last;
  const checks: DiagnosticCheck[] = [
    {
      severity: 'pass',
      title: isZh ? '角色系统已加载' : 'Character system loaded',
      detail: `${characterName} / ${config.character.current}`,
    },
    {
      severity: config.ui.language === 'zh-CN' ? 'pass' : 'info',
      title: isZh ? '语言体验' : 'Language experience',
      detail: config.ui.language === 'zh-CN'
        ? (isZh ? '当前为中文优先体验。' : 'Chinese-first experience is active.')
        : (isZh ? '当前为英文界面，可用 /language zh 切回中文。' : 'English UI is active; use /language zh for Chinese.'),
    },
    {
      severity: 'pass',
      title: isZh ? '审美档位' : 'Aesthetic mode',
      detail: String(config.ui.aestheticMode),
    },
  ];

  checks.push(behavior
    ? {
        severity: 'pass',
        title: isZh ? '角色行为画像' : 'Character behavior profile',
        detail: `style=${behavior.explanationStyle}, focus=${behavior.reviewFocus.join(',')}, risk=${behavior.riskPreference}, mode=${behavior.preferredMode}`,
      }
    : {
        severity: 'info',
        title: isZh ? '角色行为画像' : 'Character behavior profile',
        detail: isZh ? '当前角色未声明 behavior，只有外观和基础 persona 生效。' : 'Current character has no behavior profile; only appearance and base persona are active.',
        action: isZh ? '可通过 /character create 或 character hook 补充解释风格、审查重点和风险偏好。' : 'Use /character create or a character hook to add explanation style, review focus, and risk preference.',
      });

  if (lastHook?.characterOverlays?.length) {
    checks.push({
      severity: 'pass',
      title: isZh ? '角色 Hook 叠加最近已生效' : 'Recent character hook overlay',
      detail: `${lastHook.characterOverlays.join(', ')} / kinds=${lastHook.kinds?.join(',') ?? 'character'}`,
    });
  }

  return checks;
}
function countBySeverity(checks: DiagnosticCheck[]): Record<Severity, number> {
  return checks.reduce<Record<Severity, number>>((acc, check) => {
    acc[check.severity] += 1;
    return acc;
  }, { pass: 0, info: 0, warning: 0, critical: 0 });
}

function renderSeverity(severity: Severity): string {
  switch (severity) {
    case 'pass': return chalk.green('[OK]');
    case 'info': return chalk.cyan('[INFO]');
    case 'warning': return chalk.yellow('[WARN]');
    case 'critical': return chalk.red('[FAIL]');
  }
}

function renderCount(severity: Severity, value: number): string {
  return `${renderSeverity(severity)} ${value}`;
}

function normalizeProviderId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'aliyun' || normalized === 'tongyi') return 'qwen';
  if (normalized === 'zhipu' || normalized === 'bigmodel') return 'glm';
  if (normalized === 'openai-compatible' || normalized === 'openai_compatible') return 'compatible';
  return normalized;
}

function readApiKeyFromEnv(providerId: string): string | undefined {
  const env = process.env;
  if (providerId === 'qwen' || providerId === 'dashscope') return env.ROXY_QWEN_API_KEY || env.DASHSCOPE_API_KEY || env.QWEN_API_KEY;
  if (providerId === 'deepseek') return env.ROXY_DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY;
  if (providerId === 'glm' || providerId === 'bigmodel') return env.ROXY_GLM_API_KEY || env.BIGMODEL_API_KEY || env.GLM_API_KEY;
  if (providerId === 'openai' || providerId === 'compatible') return env.ROXY_OPENAI_API_KEY || env.OPENAI_API_KEY;
  return env.ROXY_API_KEY;
}

function readBaseUrlFromEnv(providerId: string): string | undefined {
  const env = process.env;
  if (providerId === 'qwen' || providerId === 'dashscope') return env.ROXY_QWEN_BASE_URL || env.DASHSCOPE_BASE_URL;
  if (providerId === 'deepseek') return env.ROXY_DEEPSEEK_BASE_URL || env.DEEPSEEK_BASE_URL;
  if (providerId === 'glm' || providerId === 'bigmodel') return env.ROXY_GLM_BASE_URL || env.BIGMODEL_BASE_URL;
  if (providerId === 'openai' || providerId === 'compatible') return env.ROXY_OPENAI_BASE_URL || env.OPENAI_BASE_URL;
  return env.ROXY_BASE_URL;
}

function modelEnvHint(providerId: string, isZh: boolean): string {
  if (providerId === 'qwen' || providerId === 'dashscope') return isZh ? '设置 ROXY_QWEN_API_KEY 或 DASHSCOPE_API_KEY。' : 'Set ROXY_QWEN_API_KEY or DASHSCOPE_API_KEY.';
  if (providerId === 'deepseek') return isZh ? '设置 ROXY_DEEPSEEK_API_KEY。' : 'Set ROXY_DEEPSEEK_API_KEY.';
  if (providerId === 'glm' || providerId === 'bigmodel') return isZh ? '设置 ROXY_GLM_API_KEY 或 BIGMODEL_API_KEY。' : 'Set ROXY_GLM_API_KEY or BIGMODEL_API_KEY.';
  if (providerId === 'openai' || providerId === 'compatible') return isZh ? '设置 ROXY_OPENAI_API_KEY；兼容接口还要设置 ROXY_OPENAI_BASE_URL。' : 'Set ROXY_OPENAI_API_KEY; compatible endpoints also need ROXY_OPENAI_BASE_URL.';
  return isZh ? '设置 ROXY_API_KEY。' : 'Set ROXY_API_KEY.';
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatAge(ms: number): string {
  return formatElapsed(Math.max(0, ms));
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
