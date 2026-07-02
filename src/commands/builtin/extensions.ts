import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ConfigManager } from '../../core/ConfigManager.js';
import { normalizeLanguage } from '../../i18n/index.js';
import { HookLoader } from '../../hooks/index.js';
import { describeMcpEndpoint, McpConfigLoader, McpToolAdapter } from '../../mcp/index.js';
import { collectPluginContributions, PluginLoader } from '../../plugin/index.js';

export interface ExtensionCommandOptions {
  configManager: ConfigManager;
  runAgentPrompt?: (prompt: string) => Promise<void>;
}

type Lang = 'zh-CN' | 'en-US';

export async function handleMcpCommand(args: string[], options: ExtensionCommandOptions): Promise<void> {
  const language = normalizeLanguage(options.configManager.get('ui.language'));
  const action = (args[0] ?? 'list').toLowerCase();
  if (action === 'init') return initMcp(language, args.slice(1));
  if (action === 'list' || action === 'ls') return listMcp(options, language);
  if (action === 'paths') return printMcpPaths(options, language);
  printMcpUsage(language);
}

export async function handleHooksCommand(args: string[], options: ExtensionCommandOptions): Promise<void> {
  const language = normalizeLanguage(options.configManager.get('ui.language'));
  const action = (args[0] ?? 'list').toLowerCase();
  if (action === 'init') return initHooks(language, args.slice(1));
  if (action === 'list' || action === 'ls') return listHooks(options, language);
  if (action === 'paths') return printHookPaths(options, language);
  printHooksUsage(language);
}

export async function handlePluginCommand(args: string[], options: ExtensionCommandOptions): Promise<void> {
  const language = normalizeLanguage(options.configManager.get('ui.language'));
  const action = (args[0] ?? 'list').toLowerCase();
  if (action === 'init') return initPlugin(language, args.slice(1));
  if (action === 'list' || action === 'ls') return listPlugins(options, language);
  if (action === 'paths') return printPluginPaths(options, language);
  if (action === 'validate') return validatePlugins(options, language);
  printPluginUsage(language);
}

async function initMcp(language: Lang, args: string[]): Promise<void> {
  const force = args.includes('--force');
  const target = resolve(process.cwd(), '.roxycode', 'mcp.json');
  if (existsSync(target) && !force) {
    console.log(chalk.yellow(`  ${zh(language, 'MCP 配置已存在', 'MCP config already exists')}: ${target}`));
    console.log(chalk.dim(zh(language, '  如需覆盖，请使用 /mcp init --force', '  Use /mcp init --force to overwrite.')));
    return;
  }

  await mkdir(resolve(process.cwd(), '.roxycode'), { recursive: true });
  await writeJson(target, {
    mcpServers: {
      localExample: {
        type: 'stdio',
        command: 'node',
        args: ['path/to/your-mcp-server.js'],
        env: {},
        enabled: false,
        timeoutMs: 30000,
      },
      httpExample: {
        type: 'http',
        url: 'https://example.com/mcp',
        headers: {},
        enabled: false,
        timeoutMs: 30000,
      },
      sseExample: {
        type: 'sse',
        url: 'https://example.com/sse',
        headers: {},
        enabled: false,
        timeoutMs: 30000,
      },
    },
  });
  console.log(chalk.green(`  ${zh(language, '已生成 MCP 配置模板', 'MCP config template created')}: ${target}`));
  console.log(chalk.dim(zh(
    language,
    '  将 enabled 改为 true 后，stdio 工具会注册为 mcp__server__tool；HTTP/SSE 当前先支持配置校验和列表展示。',
    '  Set enabled=true to register stdio tools as mcp__server__tool. HTTP/SSE configs are validated and listed first.',
  )));
}

async function listMcp(options: ExtensionCommandOptions, language: Lang): Promise<void> {
  const config = options.configManager.snapshot();
  const pluginResult = await new PluginLoader({ cwd: process.cwd(), config }).load();
  const contributions = collectPluginContributions(pluginResult.enabled);
  const loadResult = await new McpConfigLoader({ cwd: process.cwd(), config, pluginServers: contributions.mcpServers }).load();
  const adapter = new McpToolAdapter(process.cwd());
  const tools = await adapter.discoverTools(loadResult.servers);
  await adapter.close();

  console.log('');
  console.log(chalk.bold(zh(language, '  MCP 外部工具', '  MCP external tools')));
  if (loadResult.servers.length === 0) console.log(chalk.dim(zh(language, '  暂无 MCP server。', '  No MCP servers configured.')));
  for (const server of loadResult.servers) {
    const marker = server.enabled === false ? chalk.dim('-') : chalk.green('*');
    const transport = server.type ?? 'stdio';
    const headerCount = server.headers ? Object.keys(server.headers).length : 0;
    const headerInfo = headerCount > 0 ? ` headers=${headerCount}` : '';
    console.log(`  ${marker} ${server.name} [${transport}] (${server.source}) ${describeMcpEndpoint(server)}${headerInfo}`);
  }
  for (const tool of tools.tools) console.log(chalk.dim(`    tool: ${tool.definition.name}`));
  printErrors([...loadResult.errors.map(e => `${e.source}: ${e.message}`), ...tools.errors.map(e => `${e.server}: ${e.message}`)]);
  console.log('');
}

function printMcpPaths(options: ExtensionCommandOptions, language: Lang): void {
  const dirs = options.configManager.snapshot().mcp.directories;
  console.log('');
  console.log(chalk.bold(zh(language, '  MCP 配置路径', '  MCP config paths')));
  for (const dir of dirs) console.log(`  ${dir}: ${resolve(process.cwd(), dir)}`);
  console.log(chalk.dim(`  ${resolve(process.cwd(), '.roxycode', 'mcp.json')}`));
  console.log('');
}

async function initHooks(language: Lang, args: string[]): Promise<void> {
  const force = args.includes('--force');
  const dir = resolve(process.cwd(), '.roxycode', 'hooks');
  const target = join(dir, 'example.json');
  if (existsSync(target) && !force) {
    console.log(chalk.yellow(`  ${zh(language, 'Hooks 示例已存在', 'Hooks example already exists')}: ${target}`));
    console.log(chalk.dim(zh(language, '  如需覆盖，请使用 /hooks init --force', '  Use /hooks init --force to overwrite.')));
    return;
  }

  await mkdir(dir, { recursive: true });
  await writeJson(target, {
    hooks: [
      {
        id: 'inject-project-note',
        event: 'before_prompt',
        kind: 'prompt',
        enabled: false,
        blocking: false,
        prompt: '请根据以下输入补充项目注意事项：$ARGUMENTS',
      },
      {
        id: 'block-danger-command',
        event: 'command',
        kind: 'command',
        enabled: false,
        blocking: true,
        matcher: 'danger',
        command: 'node',
        args: ['scripts/check-command.js'],
        timeoutMs: 10000,
        statusMessage: '运行本地命令安全检查',
      },
      {
        id: 'tool-input-rewriter',
        event: 'before_tool',
        kind: 'command',
        enabled: false,
        blocking: false,
        matcher: 'write_file',
        command: 'node',
        args: ['scripts/rewrite-tool-input.js'],
        timeoutMs: 10000,
        description: '脚本 stdout 可返回 JSON：{ "updatedInput": { ... }, "additionalContext": "..." }。修改后的输入仍会重新走参数校验和权限确认。',
      },
      {
        id: 'local-webhook',
        event: 'after_response',
        kind: 'http',
        enabled: false,
        blocking: false,
        url: 'http://localhost:3000/roxy-hook',
        allowInsecureHttp: true,
        allowedEnvVars: [],
      },
      {
        id: 'review-agent-note',
        event: 'agent_done',
        kind: 'agent',
        enabled: false,
        prompt: '请作为审查小助手复核本次回答：$ARGUMENTS',
      },
    ],
  });
  console.log(chalk.green(`  ${zh(language, '已生成 Hooks 示例', 'Hooks example created')}: ${target}`));
}

async function listHooks(options: ExtensionCommandOptions, language: Lang): Promise<void> {
  const config = options.configManager.snapshot();
  const pluginResult = await new PluginLoader({ cwd: process.cwd(), config }).load();
  const contributions = collectPluginContributions(pluginResult.enabled);
  const result = await new HookLoader({ cwd: process.cwd(), config, pluginHooks: contributions.hooks }).load();

  console.log('');
  console.log(chalk.bold(zh(language, '  Hooks 扩展点', '  Hooks')));
  if (result.hooks.length === 0) console.log(chalk.dim(zh(language, '  暂无 Hooks。', '  No hooks configured.')));
  for (const hook of result.hooks) {
    const marker = hook.enabled === false ? chalk.dim('-') : chalk.green('*');
    console.log(`  ${marker} ${hook.id.padEnd(24)} ${hook.event}/${hook.kind}${hook.blocking ? ' blocking' : ''}`);
    if (hook.description) console.log(chalk.dim(`      ${hook.description}`));
    if (hook.statusMessage) console.log(chalk.dim(`      status: ${hook.statusMessage}`));
    if (hook.source) console.log(chalk.dim(`      ${hook.source}`));
  }
  printErrors(result.errors.map(error => `${error.path}: ${error.message}`));
  console.log('');
}

function printHookPaths(options: ExtensionCommandOptions, language: Lang): void {
  const dirs = options.configManager.snapshot().hooks.directories;
  console.log('');
  console.log(chalk.bold(zh(language, '  Hooks 路径', '  Hook paths')));
  for (const dir of dirs) console.log(`  ${dir}: ${resolve(process.cwd(), dir)}`);
  console.log('');
}

async function initPlugin(language: Lang, args: string[]): Promise<void> {
  const id = normalizeId(args.find(arg => !arg.startsWith('--')) ?? 'my-roxy-plugin');
  const force = args.includes('--force');
  const dir = resolve(process.cwd(), '.roxycode', 'plugins', id);
  const target = join(dir, 'plugin.json');
  if (existsSync(target) && !force) {
    console.log(chalk.yellow(`  ${zh(language, '插件已存在', 'Plugin already exists')}: ${target}`));
    console.log(chalk.dim(zh(language, '  如需覆盖，请使用 /plugin init <id> --force', '  Use /plugin init <id> --force to overwrite.')));
    return;
  }

  await mkdir(dir, { recursive: true });
  await writeJson(target, {
    id,
    name: id,
    version: '0.1.0',
    description: '一个 RoxyCode 本地插件模板。',
    enabled: true,
    commands: [
      {
        name: 'review-style',
        description: '按我的二次元编程台风格审查当前任务。',
        prompt: '请使用我的 RoxyCode 角色风格，对当前任务做一次结构化代码审查。',
        category: 'workflow',
      },
    ],
    hooks: [],
    mcpServers: {},
    workflows: [],
    characters: [],
  });
  console.log(chalk.green(`  ${zh(language, '已生成插件模板', 'Plugin template created')}: ${target}`));
  console.log(chalk.dim(zh(language, `  命令会注册为 /${id}:review-style`, `  Command will be registered as /${id}:review-style`)));
}

async function listPlugins(options: ExtensionCommandOptions, language: Lang): Promise<void> {
  const result = await new PluginLoader({ cwd: process.cwd(), config: options.configManager.snapshot() }).load();
  console.log('');
  console.log(chalk.bold(zh(language, '  RoxyCode 插件', '  RoxyCode plugins')));
  for (const plugin of result.enabled) console.log(`  ${chalk.green('*')} ${plugin.id} ${plugin.version} - ${plugin.description ?? plugin.name}`);
  for (const plugin of result.disabled) console.log(`  ${chalk.dim('-')} ${plugin.id} ${plugin.version} - ${plugin.description ?? plugin.name}`);
  if (result.enabled.length + result.disabled.length === 0) console.log(chalk.dim(zh(language, '  暂无插件。', '  No plugins found.')));
  printErrors(result.errors.map(error => `${error.path}: ${error.message}`));
  console.log('');
}

function printPluginPaths(options: ExtensionCommandOptions, language: Lang): void {
  const dirs = options.configManager.snapshot().plugins.directories;
  console.log('');
  console.log(chalk.bold(zh(language, '  插件路径', '  Plugin paths')));
  for (const dir of dirs) console.log(`  ${dir}: ${resolve(process.cwd(), dir)}`);
  console.log('');
}

async function validatePlugins(options: ExtensionCommandOptions, language: Lang): Promise<void> {
  const result = await new PluginLoader({ cwd: process.cwd(), config: options.configManager.snapshot() }).load();
  if (result.errors.length === 0) {
    console.log(chalk.green(zh(language, '  插件校验通过。', '  Plugin validation passed.')));
    return;
  }
  console.log(chalk.yellow(zh(language, '  插件校验发现问题：', '  Plugin validation warnings:')));
  printErrors(result.errors.map(error => `${error.path}: ${error.message}`));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function printErrors(errors: string[]): void {
  if (errors.length === 0) return;
  console.log(chalk.yellow('  warnings:'));
  for (const error of errors) console.log(chalk.dim(`    ${error}`));
}

function printMcpUsage(language: Lang): void {
  console.log(chalk.dim(zh(language, '  用法: /mcp [list|init|paths]', '  Usage: /mcp [list|init|paths]')));
}

function printHooksUsage(language: Lang): void {
  console.log(chalk.dim(zh(language, '  用法: /hooks [list|init|paths]', '  Usage: /hooks [list|init|paths]')));
}

function printPluginUsage(language: Lang): void {
  console.log(chalk.dim(zh(language, '  用法: /plugin [list|init|validate|paths]', '  Usage: /plugin [list|init|validate|paths]')));
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-roxy-plugin';
}

function zh(language: Lang, zhText: string, enText: string): string {
  return language === 'zh-CN' ? zhText : enText;
}
