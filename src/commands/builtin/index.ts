import chalk from 'chalk';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import type { ConfigManager, ConfigScope } from '../../core/ConfigManager.js';
import { APP_VERSION } from '../../core/constants.js';
import type { LLMProvider } from '../../core/types/llm.js';
import { LLMFactory } from '../../engine/llm/LLMFactory.js';
import { getAgentModeSpec, isConfigurableAgentMode, normalizeAgentMode } from '../../engine/agent/index.js';
import type { ContextManager } from '../../session/context/ContextManager.js';
import type { I18nText, Language } from '../../i18n/index.js';
import { languageLabel, normalizeLanguage } from '../../i18n/index.js';
import type { EasterEggEngine } from '../../ui/easter-eggs/EasterEggEngine.js';
import type { DemonEyeMode } from '../../ui/easter-eggs/DemonEyeMode.js';
import type { TelepathyMode } from '../../ui/easter-eggs/TelepathyMode.js';
import type { CommandDefinition, SubcommandDefinition } from '../CommandRegistry.js';
import { handleAestheticCommand } from './aesthetic.js';
import { handleCharacterCommand } from './character.js';
import { handleContextCommand } from './context.js';
import { handleOptimizeCommand } from './optimize.js';
import { handleProfileCommand } from './profile.js';
import { handleProjectCommand } from './project.js';
import { handleMemoryCommand } from './memory.js';
import { handleWorkflowCommand } from './workflow.js';
import { handleHooksCommand, handleMcpCommand, handlePluginCommand } from './extensions.js';
import { handleAgentsCommand } from './agents.js';
import { renderDiagnosticsCommand } from './diagnostics.js';
import { formatQueryProfile, type RuntimeStateSnapshot } from '../../runtime/index.js';
import { redactConfigValue } from '../../core/configSchema.js';
import type { MemoryStats } from '../../session/memory/index.js';
import type { Tool } from '../../tool/index.js';

export interface BuiltinCommandFactoryOptions {
  text: I18nText['commands'];
  getText: () => I18nText['commands'];
  language: Language;
  characterManager: CharacterManager;
  configManager: ConfigManager;
  contextManager: ContextManager;
  llmProvider: LLMProvider;
  easterEggEngine: EasterEggEngine;
  demonEyeMode: DemonEyeMode;
  telepathyMode: TelepathyMode;
  getCharacterSubcommands: () => SubcommandDefinition[];
  getHelpSubcommands: () => SubcommandDefinition[];
  getConversationTurns: () => number;
  getSessionElapsedMs: () => number;
  getHistoryCount: () => number;
  getCommandCount: () => number;
  getTools?: () => Tool[];
  getRuntimeSnapshot?: () => RuntimeStateSnapshot;
  getMemoryStats?: () => Promise<MemoryStats>;
  showHelp: () => void;
  showCommandHelp: (cmdName: string) => void;
  showHistory: () => void;
  reloadCommands: () => void;
  requestShutdown: (exitCode?: number) => void;
  closeReader: () => void;
  resumeSession?: (query?: string) => Promise<void>;
  exportSession?: (target?: string, format?: 'text' | 'jsonl') => Promise<void>;
  rewindSession?: (count?: number) => Promise<void>;
  compactSession?: () => Promise<void>;
  getSessionInfo?: () => { sessionId: string; path: string };
  runAgentPrompt?: (prompt: string) => Promise<void>;
}

export function createBuiltinCommands(options: BuiltinCommandFactoryOptions): CommandDefinition[] {
  const text = options.text;
  const isZh = options.language === 'zh-CN';

  return [
    {
      name: 'help',
      description: text.help.description,
      aliases: ['h', '?'],
      category: 'basic',
      source: 'builtin',
      type: 'local',
      usage: text.help.usage,
      examples: ['/help', '/help context', '/help character'],
      subcommands: options.getHelpSubcommands(),
      handler: args => args.length > 0 ? options.showCommandHelp(args[0]) : options.showHelp(),
    },
    {
      name: 'clear',
      description: text.clear.description,
      category: 'basic',
      source: 'builtin',
      type: 'local',
      usage: '/clear',
      examples: ['/clear'],
      handler: () => console.log(chalk.dim(`\n  ${text.clear.done}\n`)),
    },
    {
      name: 'context',
      description: text.context.description,
      aliases: ['ctx'],
      category: 'context',
      source: 'builtin',
      type: 'local',
      usage: text.context.usage,
      examples: ['/context', '/context maxTokens 64000', '/context compress on', '/context threshold 0.9'],
      subcommands: [
        { name: '', description: text.context.status, label: isZh ? zh('statusLabel') : '(status)' },
        { name: 'maxTokens', description: text.context.maxTokens, needsInput: true },
        { name: 'compress', description: text.context.compress, hasChildren: true },
        { name: 'threshold', description: text.context.threshold, needsInput: true },
      ],
      handler: args => handleContextCommand(args, options.configManager, options.contextManager),
    },
    {
      name: 'compact',
      description: text.compact.description,
      category: 'context',
      source: 'builtin',
      type: 'local',
      usage: '/compact',
      examples: ['/compact'],
      handler: async () => renderCompactCommand(options),
    },
    {
      name: 'memory',
      description: isZh ? zh('memoryDescription') : 'Manage long-term RoxyCode memories',
      aliases: ['mem'],
      category: 'context',
      source: 'builtin',
      type: 'local',
      usage: '/memory [list|stats|types|policy|paths|add|forget|auto]',
      examples: ['/memory', '/memory stats', '/memory types', '/memory policy', '/memory auto off', '/memory add learning explain TypeScript with examples', '/memory add workflow --scope project run pnpm build before final'],
      subcommands: [
        { name: 'list', description: isZh ? zh('memoryList') : 'List memories' },
        { name: 'stats', description: isZh ? zh('memoryStats') : 'Show memory statistics' },
        { name: 'add', description: isZh ? zh('memoryAdd') : 'Add a memory', needsInput: true },
        { name: 'forget', description: isZh ? zh('memoryForget') : 'Archive a memory', needsInput: true },
        { name: 'types', description: isZh ? zh('memoryTypes') : 'Show memory types' },
        { name: 'policy', description: isZh ? zh('memoryPolicy') : 'Show what should and should not be remembered' },
        { name: 'auto', description: isZh ? zh('memoryAuto') : 'Toggle automatic memory extraction', needsInput: true },
        { name: 'paths', description: isZh ? zh('memoryPaths') : 'Show memory file paths' },
      ],
      handler: args => handleMemoryCommand(args, {
        configManager: options.configManager,
        characterManager: options.characterManager,
        sessionId: options.getSessionInfo?.().sessionId,
      }),
    },
    {
      name: 'workflow',
      description: isZh ? zh('workflowDescription') : 'Run process-oriented coding workflows',
      aliases: ['wf'],
      category: 'workflow',
      source: 'builtin',
      type: 'local',
      usage: '/workflow [list|show|run|paths]',
      examples: ['/workflow', '/workflow show spring-crud', '/workflow run spring-crud --entity User --fields "name, email"', '/workflow run code-review'],
      subcommands: [
        { name: 'list', description: isZh ? zh('workflowList') : 'List workflows' },
        { name: 'show', description: isZh ? zh('workflowShow') : 'Show workflow details', needsInput: true },
        { name: 'run', description: isZh ? zh('workflowRun') : 'Run a workflow through the Agent Loop', needsInput: true },
        { name: 'paths', description: isZh ? zh('workflowPaths') : 'Show workflow search paths' },
      ],
      handler: args => handleWorkflowCommand(args, {
        configManager: options.configManager,
        characterManager: options.characterManager,
        runAgentPrompt: options.runAgentPrompt,
        sessionId: options.getSessionInfo?.().sessionId,
      }),
    },
    {
      name: 'mcp',
      description: isZh ? zh('mcpDescription') : 'Manage MCP external tools',
      category: 'dev',
      source: 'builtin',
      type: 'local',
      usage: '/mcp [list|init|paths]',
      examples: ['/mcp', '/mcp init', '/mcp paths'],
      subcommands: [
        { name: 'list', description: isZh ? zh('extensionList') : 'List configured MCP servers and tools' },
        { name: 'init', description: isZh ? zh('extensionInit') : 'Create a configuration template' },
        { name: 'paths', description: isZh ? zh('extensionPaths') : 'Show configuration search paths' },
      ],
      handler: args => handleMcpCommand(args, { configManager: options.configManager, runAgentPrompt: options.runAgentPrompt }),
    },
    {
      name: 'hooks',
      description: isZh ? zh('hooksDescription') : 'Manage command, prompt, HTTP, and agent hooks',
      category: 'dev',
      source: 'builtin',
      type: 'local',
      usage: '/hooks [list|init|paths]',
      examples: ['/hooks', '/hooks init', '/hooks paths'],
      subcommands: [
        { name: 'list', description: isZh ? zh('extensionList') : 'List configured hooks' },
        { name: 'init', description: isZh ? zh('extensionInit') : 'Create a hook template' },
        { name: 'paths', description: isZh ? zh('extensionPaths') : 'Show hook search paths' },
      ],
      handler: args => handleHooksCommand(args, { configManager: options.configManager, runAgentPrompt: options.runAgentPrompt }),
    },
    {
      name: 'plugin',
      description: isZh ? zh('pluginDescription') : 'Manage local RoxyCode plugins',
      category: 'dev',
      source: 'builtin',
      type: 'local',
      usage: '/plugin [list|init|validate|paths]',
      examples: ['/plugin', '/plugin init my-roxy-plugin', '/plugin validate', '/plugin paths'],
      subcommands: [
        { name: 'list', description: isZh ? zh('extensionList') : 'List plugins' },
        { name: 'init', description: isZh ? zh('extensionInit') : 'Create a plugin template', needsInput: true },
        { name: 'validate', description: isZh ? zh('pluginValidate') : 'Validate plugin manifests' },
        { name: 'paths', description: isZh ? zh('extensionPaths') : 'Show plugin search paths' },
      ],
      handler: args => handlePluginCommand(args, { configManager: options.configManager, runAgentPrompt: options.runAgentPrompt }),
    },
    {
      name: 'resume',
      description: isZh ? zh('resumeDescription') : 'Resume the latest session or search by id/text',
      aliases: ['continue'],
      category: 'context',
      source: 'builtin',
      type: 'local',
      usage: '/resume [sessionId|searchText]',
      examples: ['/resume', '/resume 01H', '/resume permission-panel'],
      handler: async args => options.resumeSession?.(args.join(' ').trim() || undefined),
    },
    {
      name: 'export',
      description: isZh ? zh('exportDescription') : 'Export the current session as text or JSONL',
      category: 'context',
      source: 'builtin',
      type: 'local',
      usage: '/export [path] [--jsonl]',
      examples: ['/export', '/export notes.txt', '/export session.jsonl --jsonl'],
      handler: async args => {
        const format = args.includes('--jsonl') ? 'jsonl' : 'text';
        const target = args.filter(arg => arg !== '--jsonl').join(' ').trim() || undefined;
        await options.exportSession?.(target, format);
      },
    },
    {
      name: 'rewind',
      description: isZh ? zh('rewindDescription') : 'Rewind current session messages; defaults to one recent turn',
      category: 'context',
      source: 'builtin',
      type: 'local',
      usage: '/rewind [messageCountToKeep]',
      examples: ['/rewind', '/rewind 6'],
      handler: async args => {
        const raw = args[0];
        let count: number | undefined;
        if (raw !== undefined) {
          const parsed = Number(raw);
          if (!Number.isInteger(parsed) || parsed < 0) {
            console.log(chalk.red(isZh ? zh('rewindInteger') : '  /rewind expects a non-negative integer.'));
            return;
          }
          count = parsed;
        }
        await options.rewindSession?.(count);
      },
    },
    {
      name: 'agents',
      description: isZh ? zh('agentsDescription') : 'Inspect Ultimate multi-agent runs, claims, and file locks',
      aliases: ['team'],
      category: 'dev',
      source: 'builtin',
      type: 'local',
      usage: '/agents [status|list|locks|paths] [runId]',
      examples: ['/agents', '/agents locks', '/agents paths'],
      subcommands: [
        { name: 'status', description: isZh ? zh('agentsStatus') : 'Show recent multi-agent runs' },
        { name: 'locks', description: isZh ? zh('agentsLocks') : 'Show active file lock files' },
        { name: 'paths', description: isZh ? zh('agentsPaths') : 'Show multi-agent state path' },
      ],
      handler: args => handleAgentsCommand(args, options.language),
    },
    {
      name: 'mode',
      description: isZh ? zh('modeDescription') : 'Show or switch RoxyCode Agent Loop reasoning mode',
      aliases: ['reasoning'],
      category: 'dev',
      source: 'builtin',
      type: 'local',
      usage: '/mode [auto|lite|economic|standard|ultimate] [--project|--global]',
      examples: ['/mode', '/mode standard', '/mode ultimate --project', '/mode auto --global'],
      subcommands: [
        { name: 'auto', description: isZh ? zh('modeAuto') : 'Use the default Standard mode' },
        { name: 'lite', description: isZh ? zh('modeLite') : 'Single-turn answer without proactive tools' },
        { name: 'economic', description: isZh ? zh('modeEconomic') : 'Cost-controlled ReAct tool loop' },
        { name: 'standard', description: isZh ? zh('modeStandard') : 'Plan, execute, then verify' },
        { name: 'ultimate', description: isZh ? zh('modeUltimate') : 'Coordinator plus parallel sub-agent analysis' },
      ],
      handler: args => handleModeCommand(args, options),
    },
    {
      name: 'model',
      description: text.model.description,
      aliases: ['m'],
      category: 'dev',
      source: 'builtin',
      type: 'local',
      usage: '/model [provider] [model]',
      examples: ['/model', '/model qwen qwen-max', '/model deepseek deepseek-chat', '/model openai gpt-4o'],
      subcommands: LLMFactory.getAvailableProviders().map(id => ({
        name: id,
        description: isZh ? `${zh('switchTo')} ${id}` : `Switch to ${id}`,
        needsInput: true,
      })),
      handler: args => handleModelCommand(args, options),
    },
    {
      name: 'status',
      description: text.status.description,
      aliases: ['s'],
      category: 'dev',
      source: 'builtin',
      type: 'local',
      usage: '/status',
      examples: ['/status'],
      handler: async () => renderStatusCommand(options),
    },
    {
      name: 'perf',
      description: isZh ? '\u67e5\u770b Query Pipeline \u6027\u80fd\u5256\u6790' : 'Show query pipeline profiling details',
      aliases: ['prof'],
      category: 'dev',
      source: 'builtin',
      type: 'local',
      usage: '/perf query',
      examples: ['/perf query'],
      subcommands: [
        { name: 'query', description: isZh ? '\u67e5\u770b\u6700\u8fd1\u4e00\u6b21\u81ea\u7136\u8bed\u8a00\u4efb\u52a1\u7684\u6d41\u6c34\u7ebf\u8017\u65f6' : 'Show the latest natural-language query profile' },
      ],
      handler: args => renderPerfCommand(args, options),
    },
    {
      name: 'diagnostics',
      description: isZh ? zh('diagnosticsDescription') : 'Run a Claude Code style runtime diagnostic report',
      aliases: ['doctor', 'diag'],
      category: 'dev',
      source: 'builtin',
      type: 'local',
      usage: '/diagnostics',
      examples: ['/diagnostics', '/doctor'],
      handler: async () => renderDiagnosticsCommand(options),
    },
    {
      name: 'optimize',
      description: text.optimize.description,
      aliases: ['opt'],
      category: 'dev',
      source: 'builtin',
      type: 'local',
      usage: '/optimize [-s <strategy>] [--diff] <text>',
      examples: ['/optimize write a sort function', '/optimize -s cot analyze performance', '/optimize --diff refactor error handling', '/optimize strategies'],
      subcommands: [
        { name: 'strategies', description: text.optimize.strategies },
        { name: '', description: text.optimize.textInput, label: isZh ? zh('enterText') : '(enter text)' },
      ],
      handler: args => handleOptimizeCommand(args, options.llmProvider, options.characterManager),
    },
    {
      name: 'project',
      description: text.project.description,
      category: 'dev',
      source: 'project',
      type: 'local',
      usage: text.project.usage,
      examples: ['/project init', '/project init --force'],
      subcommands: [{ name: 'init', description: text.project.init }],
      handler: args => handleProjectCommand(args, options.configManager),
    },
    {
      name: 'profile',
      description: text.profile.description,
      category: 'character',
      source: 'profile',
      type: 'local',
      usage: text.profile.usage,
      examples: ['/profile init', '/profile init --language zh --tech typescript,node --depth teaching --role roxy --model auto'],
      subcommands: [{ name: 'init', description: text.profile.init }],
      handler: args => handleProfileCommand(args, options.configManager, options.characterManager),
    },
    {
      name: 'character',
      description: text.character.description,
      aliases: ['char'],
      category: 'character',
      source: 'builtin',
      type: 'local',
      usage: isZh ? '/character [role|info|list|create]' : '/character [name|info|list|create]',
      examples: ['/character', '/character roxy', '/character info', '/character create my-waifu-dev', '/character paths'],
      subcommands: [
        ...options.getCharacterSubcommands(),
        { name: 'create', description: isZh ? zh('characterCreate') : 'Create a custom character template', needsInput: true },
        { name: 'paths', description: isZh ? zh('characterPaths') : 'Show custom character directories' },
      ],
      handler: args => handleCharacterCommand(args, options.characterManager),
    },
    {
      name: 'aesthetic',
      description: isZh ? zh('aestheticDescription') : 'Switch RoxyCode aesthetic intensity',
      aliases: ['style'],
      category: 'character',
      source: 'builtin',
      type: 'local',
      usage: '/aesthetic [minimal|balanced|immersive]',
      examples: ['/aesthetic', '/aesthetic minimal', '/aesthetic immersive'],
      subcommands: [
        { name: 'minimal', description: isZh ? zh('aestheticMinimal') : 'Focused professional output' },
        { name: 'balanced', description: isZh ? zh('aestheticBalanced') : 'Balanced default experience' },
        { name: 'immersive', description: isZh ? zh('aestheticImmersive') : 'Anime workbench experience' },
      ],
      handler: args => handleAestheticCommand(args, options.configManager, options.characterManager),
    },
    {
      name: 'party',
      description: text.party.description,
      category: 'character',
      source: 'builtin',
      type: 'local',
      usage: '/party',
      examples: ['/party'],
      handler: () => console.log(options.easterEggEngine.renderParty()),
    },
    {
      name: 'demon-eye',
      description: text.demonEye.description,
      category: 'debug',
      source: 'builtin',
      type: 'local',
      usage: '/demon-eye',
      examples: ['/demon-eye'],
      handler: () => {
        const character = options.characterManager.getCurrentCharacter();
        options.demonEyeMode.toggle();
        console.log(options.demonEyeMode.renderToggleMessage(character));
      },
    },
    {
      name: 'telepathy',
      description: text.telepathy.description,
      category: 'debug',
      source: 'builtin',
      type: 'local',
      usage: '/telepathy',
      examples: ['/telepathy'],
      handler: () => {
        const character = options.characterManager.getCurrentCharacter();
        options.telepathyMode.toggle();
        console.log(options.telepathyMode.renderToggleMessage(character));
      },
    },
    {
      name: 'history',
      description: text.history.description,
      aliases: ['hist'],
      category: 'debug',
      source: 'builtin',
      type: 'local',
      usage: '/history',
      examples: ['/history'],
      handler: () => options.showHistory(),
    },
    {
      name: 'language',
      description: text.language.description,
      aliases: ['lang'],
      category: 'system',
      source: 'builtin',
      type: 'local',
      usage: text.language.usage,
      examples: ['/language', '/language zh', '/language en'],
      subcommands: [
        { name: 'zh', description: text.language.zh, label: 'zh' },
        { name: 'en', description: text.language.en, label: 'en' },
      ],
      handler: async args => handleLanguageCommand(args, options),
    },
    {
      name: 'config',
      description: text.config.description,
      aliases: ['cfg'],
      category: 'system',
      source: 'builtin',
      type: 'local',
      usage: text.config.usage,
      examples: ['/config', '/config sources', '/config validate', '/config get ui.language --source', '/config set character.current roxy --scope local'],
      subcommands: [
        { name: 'get', description: isZh ? zh('readConfig') : 'Read a config value', needsInput: true },
        { name: 'set', description: isZh ? zh('writeConfig') : 'Write a config value', needsInput: true },
        { name: 'paths', description: isZh ? zh('configPaths') : 'Show config file paths' },
        { name: 'sources', description: isZh ? '\u663e\u793a\u914d\u7f6e\u6765\u6e90' : 'Show config sources' },
        { name: 'validate', description: isZh ? '\u6821\u9a8c\u914d\u7f6e\u6587\u4ef6' : 'Validate configuration' },
        { name: 'reload', description: isZh ? '\u91cd\u65b0\u52a0\u8f7d\u914d\u7f6e' : 'Reload configuration' },
        { name: 'export', description: isZh ? '\u5bfc\u51fa\u8131\u654f\u540e\u7684\u751f\u6548\u914d\u7f6e' : 'Export redacted effective configuration' },
      ],
      handler: args => handleConfigCommand(args, options),
    },
    {
      name: 'version',
      description: text.version.description,
      aliases: ['v'],
      category: 'system',
      source: 'builtin',
      type: 'local',
      usage: '/version',
      examples: ['/version'],
      handler: () => renderVersionCommand(),
    },
    {
      name: 'exit',
      description: text.exit.description,
      aliases: ['quit', 'q'],
      category: 'system',
      source: 'builtin',
      type: 'local',
      usage: '/exit',
      examples: ['/exit'],
      handler: () => {
        console.log(chalk.dim(`\n  ${text.exit.goodbye}\n`));
        options.requestShutdown(0);
        options.closeReader();
      },
    },
  ];
}

async function renderCompactCommand(options: BuiltinCommandFactoryOptions): Promise<void> {
  const text = options.text;
  const character = options.characterManager.getCurrentCharacter();
  const border = chalk.hex(character.theme.primary);
  const accent = chalk.hex(character.theme.accent);
  console.log('');
  console.log(border('  +-- ') + accent(text.compact.title) + border(' --+'));
  try {
    if (options.compactSession) {
      await options.compactSession();
      console.log('');
      return;
    }
    const before = await options.contextManager.getStatus([]);
    const originalTokens = before.currentTokens;
    const result = await options.contextManager.compress([]);
    if (!result) console.log(chalk.yellow(`  ${text.compact.notNeeded}`));
    else {
      const saved = originalTokens > 0 ? ((1 - result.compressedTokens / originalTokens) * 100).toFixed(1) : '0.0';
      console.log(chalk.green(`  ${text.compact.done}`));
      console.log(`  ${text.compact.before}: ${originalTokens.toLocaleString()} tokens`);
      console.log(`  ${text.compact.after}: ${result.compressedTokens.toLocaleString()} tokens`);
      console.log(`  ${text.compact.saved}: ${saved}%`);
      console.log(chalk.dim(`  ${text.compact.strategy}: ${result.layerUsed}`));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : text.compact.unknownError;
    console.log(chalk.red(`  ${text.compact.failed}: ${message}`));
  }
  console.log('');
}

async function handleModeCommand(args: string[], options: BuiltinCommandFactoryOptions): Promise<void> {
  const scope: ConfigScope = args.includes('--global') ? 'global' : 'project';
  const raw = args.find(arg => !arg.startsWith('--'))?.toLowerCase();
  if (!raw) {
    renderModeCommand(options);
    return;
  }

  if (!isConfigurableAgentMode(raw)) {
    console.log(chalk.red(options.language === 'zh-CN' ? `  ${zh('modeInvalid')}: ${raw}` : `  Invalid mode: ${raw}`));
    console.log(chalk.dim('  auto, lite, economic, standard, ultimate'));
    return;
  }

  await options.configManager.set('mode', raw, { scope });
  const spec = getAgentModeSpec(normalizeAgentMode(raw));
  if (options.language === 'zh-CN') {
    console.log(chalk.green(`  ${zh('modeUpdated')}: ${raw}`));
    console.log(chalk.dim(`  ${zh('modeScope')}: ${scope}`));
    console.log(chalk.dim(`  ${zh('modeEffective')}: ${spec.label} - ${spec.description}`));
  } else {
    console.log(chalk.green(`  Mode updated: ${raw}`));
    console.log(chalk.dim(`  Scope: ${scope}`));
    console.log(chalk.dim(`  Effective mode: ${spec.label} - ${spec.description}`));
  }
}

function renderModeCommand(options: BuiltinCommandFactoryOptions): void {
  const configured = ((options.configManager.get('mode') as string) || 'auto').toLowerCase();
  const effective = normalizeAgentMode(configured);
  const current = isConfigurableAgentMode(configured) ? configured : 'auto';
  const spec = getAgentModeSpec(effective);
  const isZh = options.language === 'zh-CN';
  const modes = [
    ['auto', isZh ? zh('modeAuto') : 'Use the default Standard mode'],
    ['lite', isZh ? zh('modeLite') : 'Single-turn answer without proactive tools'],
    ['economic', isZh ? zh('modeEconomic') : 'Cost-controlled ReAct tool loop'],
    ['standard', isZh ? zh('modeStandard') : 'Plan, execute, then verify'],
    ['ultimate', isZh ? zh('modeUltimate') : 'Coordinator plus parallel sub-agent analysis'],
  ] as const;

  console.log('');
  console.log(chalk.bold(`  ${isZh ? zh('modeCurrent') : 'RoxyCode reasoning mode'}`));
  console.log(`  ${isZh ? zh('modeConfigured') : 'Configured'}: ${current}`);
  console.log(`  ${isZh ? zh('modeEffective') : 'Effective'}: ${spec.label} - ${spec.description}`);
  console.log(chalk.dim(`  ${isZh ? zh('modeAvailable') : 'Available modes'}:`));
  for (const [mode, description] of modes) {
    const marker = mode === current ? '*' : ' ';
    console.log(`  ${marker} ${mode.padEnd(9)} ${description}`);
  }
  console.log(chalk.dim('  /mode [auto|lite|economic|standard|ultimate] [--project|--global]'));
  console.log('');
}
async function handleModelCommand(args: string[], options: BuiltinCommandFactoryOptions): Promise<void> {
  const providerArg = args[0]?.toLowerCase();
  if (!providerArg) {
    renderModelCommand(options);
    return;
  }
  const available = LLMFactory.getAvailableProviders();
  if (!available.includes(providerArg)) {
    console.log(chalk.red(options.language === 'zh-CN' ? `  ${zh('unsupportedProvider')}: ${providerArg}` : `  Unsupported provider: ${providerArg}`));
    console.log(chalk.dim(`  ${available.join(', ')}`));
    return;
  }
  const modelArg = args[1] || LLMFactory.getDefaultModel(providerArg);
  await options.configManager.set('llm.provider', providerArg);
  if (modelArg) await options.configManager.set('llm.model', modelArg);
  console.log(chalk.green(options.language === 'zh-CN' ? `  ${zh('modelUpdated')}: ${providerArg} / ${modelArg}` : `  Model config updated: ${providerArg} / ${modelArg}`));
  console.log(chalk.dim(options.language === 'zh-CN' ? `  ${zh('restartForProvider')}` : '  Restart RoxyCode to use the new provider in this session.'));
}

function renderModelCommand(options: BuiltinCommandFactoryOptions): void {
  const text = options.text;
  const model = (options.configManager.get('llm.model') as string) || text.model.auto;
  const provider = (options.configManager.get('llm.provider') as string) || options.llmProvider.id;
  const apiKey = options.configManager.get('llm.apiKey') as string;
  console.log('');
  console.log(chalk.bold(`  ${text.model.title}`));
  console.log(`  Provider:       ${options.llmProvider.name} (${provider})`);
  console.log(`  ${text.model.model}:         ${model}`);
  console.log(`  ${text.model.contextWindow}: ${options.llmProvider.maxContextTokens.toLocaleString()} tokens`);
  console.log(`  ${text.model.tools}:         ${options.llmProvider.supportsTools ? text.model.supported : text.model.unsupported}`);
  console.log(`  API Key:        ${apiKey ? text.model.configured : text.model.notConfigured}`);
  console.log(chalk.dim(`  ${text.model.example}`));
  console.log('');
}

function renderPerfCommand(args: string[], options: BuiltinCommandFactoryOptions): void {
  const isZh = options.language === 'zh-CN';
  const action = (args[0] ?? 'query').toLowerCase();
  if (action !== 'query') {
    console.log(chalk.dim('  ' + (isZh ? '\u7528\u6cd5' : 'Usage') + ': /perf query'));
    return;
  }

  const profile = options.getRuntimeSnapshot?.().operations.queryProfiles.last;
  console.log('');
  if (!profile) {
    console.log(chalk.yellow('  ' + (isZh ? '\u8fd8\u6ca1\u6709 Query Pipeline \u8bb0\u5f55' : 'No query pipeline profile recorded yet.')));
    console.log(chalk.dim('  ' + (isZh ? '\u5148\u53d1\u9001\u4e00\u6b21\u81ea\u7136\u8bed\u8a00\u7f16\u7a0b\u4efb\u52a1\uff0c\u7136\u540e\u518d\u8fd0\u884c /perf query\u3002' : 'Send a natural-language coding request first, then run /perf query.')));
    console.log('');
    return;
  }

  for (const line of formatQueryProfile(profile, options.language)) {
    console.log(line.startsWith('  ') ? chalk.dim(line) : '  ' + line);
  }
  console.log(chalk.dim('  ' + (isZh ? '\u5bf9\u7167 Claude Code' : 'Claude Code reference') + ': queryProfiler checkpoints and phase breakdown.'));
  console.log('');
}
async function renderStatusCommand(options: BuiltinCommandFactoryOptions): Promise<void> {
  const text = options.text;
  const isZh = options.language === 'zh-CN';
  const character = options.characterManager.getCurrentCharacter();
  const runtime = options.getRuntimeSnapshot?.();
  const model = runtime?.model || (options.configManager.get('llm.model') as string) || text.model.auto;
  const configuredMode = ((options.configManager.get('mode') as string) || 'auto').toLowerCase();
  const modeSpec = getAgentModeSpec(normalizeAgentMode(configuredMode));
  const elapsed = runtime ? formatElapsed(Date.now() - runtime.startedAt) : formatElapsed(options.getSessionElapsedMs());
  const ctxStatus = await options.contextManager.getStatus([]);
  const ctxPercent = (ctxStatus.usageRatio * 100).toFixed(1);
  console.log('');
  console.log(chalk.bold(`  ${text.status.title}`));
  console.log(`  ${text.status.role}: ${character.name} - ${character.title}`);
  console.log(`  Aesthetic: ${options.configManager.get('ui.aestheticMode') || 'balanced'}`);
  if (character.behavior) {
    console.log(`  Behavior: ${character.behavior.explanationStyle} / ${character.behavior.riskPreference} / ${character.behavior.preferredMode}`);
  }
  if (character.companion) {
    console.log(`  Companion: ${character.companion.name} (${character.companion.kind})`);
  }
  console.log(`  ${isZh ? zh('modeConfigured') : 'Mode'}: ${configuredMode} (${modeSpec.label})`);
  console.log(chalk.dim(`  ${modeSpec.description}`));
  console.log(`  ${text.status.model}: ${options.llmProvider.name} / ${model}`);
  console.log(`  ${text.status.elapsed}: ${elapsed}`);
  console.log(`  ${text.status.turns}: ${runtime?.session.turns ?? options.getConversationTurns()}`);
  console.log(`  ${text.status.contextUsage}: ${ctxStatus.currentTokens.toLocaleString()} / ${ctxStatus.maxContextTokens.toLocaleString()} (${ctxPercent}%)`);
  console.log(`  ${text.status.autoCompression}: ${ctxStatus.compressionEnabled ? text.status.enabled : text.status.disabled}`);
  console.log(`  ${text.status.commandCount}: ${runtime?.extensions.commands.total ?? options.getCommandCount()}`);
  console.log(`  ${text.status.historyCount}: ${options.getHistoryCount()} ${text.status.items}`);

  const session = runtime ? { sessionId: runtime.session.sessionId, path: runtime.session.transcriptPath } : options.getSessionInfo?.();
  if (session) {
    console.log(`  Session: ${session.sessionId}`);
    if (runtime) console.log(`  ${isZh ? '\u4f1a\u8bdd\u6d88\u606f' : 'Session messages'}: ${runtime.session.messageCount}`);
    console.log(chalk.dim(`  Transcript: ${session.path}`));
  }

  if (runtime) {
    const agentState = runtime.agent.active ? (isZh ? '\u8fd0\u884c\u4e2d' : 'active') : (isZh ? '\u7a7a\u95f2' : 'idle');
    const extensionErrors = runtime.extensions.plugins.errors.length + runtime.extensions.hooks.errors.length + runtime.extensions.mcp.errors.length;
    const usage = runtime.usage.total;
    console.log(chalk.dim(`  ${isZh ? '\u8fd0\u884c\u6001' : 'Runtime'}: ${runtime.runtimeId.slice(0, 8)} / ${runtime.isInteractive ? (isZh ? '\u4ea4\u4e92\u5f0f' : 'interactive') : (isZh ? '\u975e\u4ea4\u4e92\u5f0f' : 'non-interactive')}`));
    console.log(chalk.dim(`  ${isZh ? '\u5de5\u4f5c\u533a' : 'Workspace'}: ${runtime.projectRoot}`));
    console.log(chalk.dim(`  ${isZh ? '\u6700\u8fd1\u4ea4\u4e92' : 'Last interaction'}: ${formatElapsed(Date.now() - runtime.lastInteractionAt)} ${isZh ? '\u524d' : 'ago'}`));
    console.log(`  Agent: ${agentState} / ${runtime.agent.mode}`);
    console.log(`  ${isZh ? '\u4e0a\u4e0b\u6587\u538b\u7f29' : 'Context compactions'}: ${runtime.agent.contextCompactions}`);
    console.log(`  ${isZh ? 'Token \u9884\u7b97\u7eed\u5199' : 'Token budget continuations'}: ${runtime.agent.tokenBudgetContinuations}`);
    if (runtime.agent.lastError) console.log(chalk.red(`  ${isZh ? '\u6700\u8fd1\u9519\u8bef' : 'Last error'}: ${runtime.agent.lastError}`));
    console.log(`  ${isZh ? '\u6269\u5c55' : 'Extensions'}: plugins ${runtime.extensions.plugins.enabled}/${runtime.extensions.plugins.disabled}, hooks ${runtime.extensions.hooks.count}, MCP ${runtime.extensions.mcp.servers} servers / ${runtime.extensions.mcp.tools} tools`);
    console.log(`  ${isZh ? '\u5de5\u5177' : 'Tools'}: builtin ${runtime.extensions.tools.builtin}, MCP ${runtime.extensions.tools.mcp}, total ${runtime.extensions.tools.total}`);
    console.log(`  ${isZh ? '\u5de5\u5177\u8c03\u7528' : 'Tool calls'}: ${runtime.operations.tools.totalCalls} total / ${runtime.operations.tools.failedCalls} failed / ${formatElapsed(runtime.operations.tools.totalDurationMs)} total`);
    const pairing = runtime.operations.toolResultPairing;
    if (pairing.totalRepairs > 0) {
      const duplicate = pairing.removedDuplicateToolUses + pairing.removedDuplicateToolResults;
      console.log(chalk.yellow(`  ${isZh ? '\u5de5\u5177\u6d88\u606f\u4fee\u590d' : 'Tool message repairs'}: ${pairing.totalRepairs} total / synthetic=${pairing.insertedSyntheticResults} / orphan=${pairing.removedOrphanResults} / duplicate=${duplicate}`));
    }
    if (runtime.operations.tools.turnCalls > 0) console.log(chalk.dim(`  ${isZh ? '\u672c\u8f6e\u5de5\u5177' : 'Turn tools'}: ${runtime.operations.tools.turnCalls} calls / ${formatElapsed(runtime.operations.tools.turnDurationMs)}`));
    if (runtime.operations.tools.last) console.log(chalk.dim(`  ${isZh ? '\u6700\u8fd1\u5de5\u5177' : 'Last tool'}: ${runtime.operations.tools.last.name} ${runtime.operations.tools.last.success ? 'OK' : 'ERR'} / ${formatElapsed(runtime.operations.tools.last.durationMs)}`));
    console.log(`  Hooks: ${runtime.operations.hooks.totalRuns} runs / ${runtime.operations.hooks.blockedRuns} blocked / ${runtime.operations.hooks.errorRuns} error / ${formatElapsed(runtime.operations.hooks.totalDurationMs)} total`);
    if (runtime.operations.hooks.turnRuns > 0) console.log(chalk.dim(`  ${isZh ? '\u672c\u8f6e Hooks' : 'Turn hooks'}: ${runtime.operations.hooks.turnRuns} runs / ${formatElapsed(runtime.operations.hooks.turnDurationMs)}`));
    if (runtime.operations.slowOperations.length > 0) {
      const slow = runtime.operations.slowOperations.at(-1)!;
      console.log(chalk.yellow(`  ${isZh ? '\u6162\u64cd\u4f5c' : 'Slow operation'}: ${slow.kind}:${slow.operation} / ${formatElapsed(slow.durationMs)}`));
    }
    if (runtime.operations.recentErrors.length > 0) {
      const last = runtime.operations.recentErrors.at(-1)!;
      console.log(chalk.red(`  ${isZh ? '\u6700\u8fd1\u8fd0\u884c\u9519\u8bef' : 'Recent runtime error'}: ${last.source} - ${last.message}`));
    }
    console.log(`  ${isZh ? 'Token \u7528\u91cf' : 'Token usage'}: requests=${runtime.usage.requests} input=${usage.inputTokens.toLocaleString()} output=${usage.outputTokens.toLocaleString()} total=${usage.totalTokens.toLocaleString()}`);
    if (options.getMemoryStats) {
      const memory = await options.getMemoryStats();
      const enabled = memory.enabled ? (isZh ? '\u5f00\u542f' : 'on') : (isZh ? '\u5173\u95ed' : 'off');
      const typeSummary = Object.entries(memory.byType)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => `${type}=${count}`)
        .join(', ');
      console.log(`  ${isZh ? '\u8bb0\u5fc6' : 'Memory'}: ${enabled} / total=${memory.total} / global=${memory.global} / project=${memory.project} / manual=${memory.manual} / auto=${memory.auto}`);
      if (typeSummary) console.log(chalk.dim(`  ${isZh ? '\u8bb0\u5fc6\u7c7b\u578b' : 'Memory types'}: ${typeSummary}`));
      if (memory.latestAge) console.log(chalk.dim(`  ${isZh ? '\u6700\u8fd1\u8bb0\u5fc6' : 'Latest memory'}: ${memory.latestAge}`));
    }
    if (runtime.operations.queryProfiles.last) {
      const profile = runtime.operations.queryProfiles.last;
      const ttft = profile.firstTokenMs !== undefined ? ' / TTFT=' + profile.firstTokenMs + 'ms' : '';
      const slowest = profile.slowestPhase ? ' / slowest=' + profile.slowestPhase.name + ':' + profile.slowestPhase.durationMs + 'ms' : '';
      console.log('  ' + (isZh ? '\u6700\u8fd1 Query' : 'Last query') + ': total=' + profile.totalMs + 'ms' + ttft + slowest);
    }
    if (runtime.telemetry) {
      console.log(`  Telemetry: ${runtime.telemetry.enabled ? 'on' : 'off'} / events=${runtime.telemetry.eventCount} / dropped=${runtime.telemetry.droppedEvents}`);
      console.log(chalk.dim(`  Telemetry file: ${runtime.telemetry.path}`));
      if (runtime.telemetry.lastError) console.log(chalk.yellow(`  Telemetry warning: ${runtime.telemetry.lastError}`));
    }
    if (extensionErrors > 0) console.log(chalk.yellow(`  ${isZh ? '\u6269\u5c55\u52a0\u8f7d\u8b66\u544a' : 'Extension warnings'}: ${extensionErrors}`));
  }
  console.log('');
}
async function handleLanguageCommand(args: string[], options: BuiltinCommandFactoryOptions): Promise<void> {
  const text = options.text;
  const arg = args[0]?.toLowerCase();
  if (!arg) {
    console.log(`  ${text.language.current}: ${languageLabel(options.language)}`);
    console.log(chalk.dim(`  ${text.language.available}`));
    return;
  }
  const isValid = ['zh', 'zh-cn', 'cn', 'chinese', 'en', 'en-us', 'english'].includes(arg);
  if (!isValid) {
    console.log(chalk.red(`  ${text.language.invalid}: ${arg}`));
    console.log(chalk.dim(`  ${text.language.available}`));
    return;
  }
  const next = normalizeLanguage(arg);
  if (next === options.language) {
    console.log(chalk.dim(`  ${text.language.unchanged} ${languageLabel(next)}`));
    return;
  }
  await options.configManager.set('ui.language', next);
  options.reloadCommands();
  console.log(chalk.green(`  ${options.getText().language.changed} ${languageLabel(next)}`));
}

async function handleConfigCommand(args: string[], options: BuiltinCommandFactoryOptions): Promise<void> {
  const configText = options.text.config;
  const action = args[0]?.toLowerCase();
  const isZh = options.language === 'zh-CN';

  if (!action) {
    const snapshot = options.configManager.snapshot();
    const paths = options.configManager.getPaths();
    const validation = options.configManager.validate();
    console.log('');
    console.log(chalk.bold(`  ${configText.title}`));
    renderConfigLine(options, 'ui.language', snapshot.ui.language);
    renderConfigLine(options, 'ui.aestheticMode', snapshot.ui.aestheticMode);
    renderConfigLine(options, 'character.current', snapshot.character.current);
    renderConfigLine(options, 'llm.provider', snapshot.llm.provider);
    renderConfigLine(options, 'llm.model', snapshot.llm.model);
    renderConfigLine(options, 'mode', snapshot.mode);
    console.log(chalk.dim(`  ${configLabel(isZh, 'precedence')}: default < global < project < local < env < session`));
    console.log(chalk.dim(`  ${configText.global}:  ${paths.global}`));
    console.log(chalk.dim(`  ${configText.project}: ${paths.project}`));
    console.log(chalk.dim(`  ${configLabel(isZh, 'localConfig')}:   ${paths.local}`));
    if (!validation.ok || validation.issues.length > 0) {
      const errors = validation.issues.filter(issue => issue.severity === 'error').length;
      const warnings = validation.issues.filter(issue => issue.severity === 'warning').length;
      console.log(chalk.yellow(`  ${configLabel(isZh, 'validation')}: ${errors} errors / ${warnings} warnings`));
      console.log(chalk.dim(`  ${configLabel(isZh, 'validateHint')}`));
    }
    console.log(chalk.dim(`  ${configText.examples}`));
    console.log('');
    return;
  }

  if (action === 'paths') {
    const paths = options.configManager.getPaths();
    console.log(`  ${configText.global}:  ${paths.global}`);
    console.log(`  ${configText.project}: ${paths.project}`);
    console.log(`  ${configLabel(isZh, 'localConfig')}:   ${paths.local}`);
    console.log(chalk.dim('  env: ROXY_* / OPENAI_* / DASHSCOPE_* / DEEPSEEK_* / GLM_*'));
    console.log(chalk.dim(`  session: ${configLabel(isZh, 'sessionScope')}`));
    return;
  }

  if (action === 'sources') {
    renderConfigSources(options);
    return;
  }

  if (action === 'validate') {
    renderConfigValidation(options);
    return;
  }

  if (action === 'reload') {
    await options.configManager.reload();
    options.reloadCommands();
    console.log(chalk.green(`  ${configLabel(isZh, 'reloaded')}`));
    renderConfigValidation(options, { compact: true });
    return;
  }

  if (action === 'export') {
    await exportConfig(args.slice(1), options);
    return;
  }

  if (action === 'get') {
    const path = args[1];
    if (!path) { console.log(chalk.red(`  ${configText.missingPath}`)); return; }
    const value = redactConfigValue(path, options.configManager.get(path));
    console.log(`  ${path}: ${formatConfigValue(value)}`);
    if (args.includes('--source') || args.includes('-s')) {
      const source = options.configManager.getSource(path);
      console.log(chalk.dim(`  ${configLabel(isZh, 'source')}: ${source ? formatConfigSource(source) : 'unknown'}`));
    }
    return;
  }

  if (action === 'set') {
    const parsed = parseConfigSetArgs(args.slice(1));
    if (!parsed.ok) {
      console.log(chalk.red(`  ${parsed.reason === 'scope' ? configText.invalidScope : configText.invalidUsage}`));
      console.log(chalk.dim(`  ${configText.examples}`));
      return;
    }
    let value: unknown;
    try {
      value = parseConfigValue(parsed.rawValue);
    } catch (err) {
      console.log(chalk.red(`  ${configText.parseFailed}: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }
    if (parsed.path === 'ui.language') {
      const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (!['zh', 'zh-cn', 'cn', 'chinese', 'en', 'en-us', 'english'].includes(raw)) {
        console.log(chalk.red(`  ${options.text.language.invalid}: ${formatConfigValue(value)}`));
        return;
      }
      value = normalizeLanguage(raw);
    }
    try {
      await options.configManager.set(parsed.path, value, { scope: parsed.scope });
    } catch (err) {
      console.log(chalk.red(`  ${configLabel(isZh, 'notSaved')}: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }
    if (parsed.path === 'ui.language') options.reloadCommands();
    console.log(chalk.green(`  ${configText.saved}: ${parsed.path}`));
    console.log(chalk.dim(`  ${configText.scope}: ${parsed.scope}`));
    console.log(chalk.dim(`  ${configLabel(isZh, 'source')}: ${formatConfigSource(options.configManager.getSource(parsed.path))}`));
    console.log(chalk.dim(`  ${configText.value}: ${formatConfigValue(redactConfigValue(parsed.path, options.configManager.get(parsed.path)))}`));
    return;
  }

  console.log(chalk.red(`  ${configText.invalidUsage}: /config ${action}`));
}

function renderConfigLine(options: BuiltinCommandFactoryOptions, path: string, value: unknown): void {
  const source = options.configManager.getSource(path);
  const sourceLabel = source ? ` [${source.source}${source.env ? `:${source.env}` : ''}]` : '';
  console.log(`  ${path.padEnd(20)} ${formatConfigValue(redactConfigValue(path, value))}${chalk.dim(sourceLabel)}`);
}

function renderConfigSources(options: BuiltinCommandFactoryOptions): void {
  const isZh = options.language === 'zh-CN';
  const snapshot = options.configManager.getSources();
  console.log('');
  console.log(chalk.bold(`  ${configLabel(isZh, 'sources')}`));
  console.log(chalk.dim(`  ${configLabel(isZh, 'precedence')}: ${snapshot.precedence.join(' < ')}`));
  console.log(chalk.dim(`  ${configLabel(isZh, 'claudeReference')}: user/project/local/flag/policy source tracking; RoxyCode uses global/project/local/env/session now.`));
  console.log('');
  for (const entry of snapshot.entries) {
    const detail = [entry.file, entry.env].filter(Boolean).join(' / ');
    const suffix = detail ? ` - ${detail}` : '';
    console.log(`  ${entry.path.padEnd(42)} ${entry.source}${chalk.dim(suffix)}`);
  }
  if (snapshot.issues.length > 0) {
    console.log('');
    console.log(chalk.yellow(`  ${configLabel(isZh, 'loadIssues')}: ${snapshot.issues.length}`));
    for (const issue of snapshot.issues.slice(0, 8)) renderConfigIssue(issue);
  }
  console.log('');
}

function renderConfigValidation(options: BuiltinCommandFactoryOptions, options2: { compact?: boolean } = {}): void {
  const isZh = options.language === 'zh-CN';
  const result = options.configManager.validate();
  const errors = result.issues.filter(issue => issue.severity === 'error').length;
  const warnings = result.issues.filter(issue => issue.severity === 'warning').length;
  if (!options2.compact) {
    console.log('');
    console.log(chalk.bold(`  ${configLabel(isZh, 'validation')}`));
    console.log(chalk.dim(`  ${configLabel(isZh, 'claudeReference')}: parse settings and keep structured validation errors.`));
  }
  if (result.ok && warnings === 0) {
    console.log(chalk.green(`  ${configLabel(isZh, 'valid')}`));
    if (!options2.compact) console.log('');
    return;
  }
  console.log(`${errors > 0 ? chalk.red('  [FAIL]') : chalk.yellow('  [WARN]')} ${errors} errors / ${warnings} warnings`);
  for (const issue of result.issues.slice(0, options2.compact ? 5 : 30)) renderConfigIssue(issue);
  if (result.issues.length > (options2.compact ? 5 : 30)) {
    console.log(chalk.dim(`  ... ${result.issues.length - (options2.compact ? 5 : 30)} more`));
  }
  if (!options2.compact) console.log('');
}

function renderConfigIssue(issue: { severity: 'error' | 'warning'; path: string; message: string; source?: string; file?: string; env?: string; expected?: string; actual?: string }): void {
  const label = issue.severity === 'error' ? chalk.red('[ERR]') : chalk.yellow('[WARN]');
  const where = [issue.source, issue.file, issue.env].filter(Boolean).join(' / ');
  const path = issue.path || '<root>';
  console.log(`  ${label} ${path}: ${issue.message}`);
  if (where) console.log(chalk.dim(`        ${where}`));
  if (issue.expected || issue.actual) console.log(chalk.dim(`        expected=${issue.expected ?? '-'} actual=${issue.actual ?? '-'}`));
}

async function exportConfig(args: string[], options: BuiltinCommandFactoryOptions): Promise<void> {
  const isZh = options.language === 'zh-CN';
  const target = args.find(arg => !arg.startsWith('--'));
  const json = `${JSON.stringify(options.configManager.exportEffectiveConfig(), null, 2)}\n`;
  if (!target) {
    console.log(json.trimEnd());
    return;
  }

  const outputPath = isAbsolute(target) ? target : resolve(process.cwd(), target);
  if (!isInsideWorkspace(outputPath)) {
    console.log(chalk.red(`  ${configLabel(isZh, 'exportInsideWorkspace')}`));
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, json, 'utf-8');
  console.log(chalk.green(`  ${configLabel(isZh, 'exported')}: ${outputPath}`));
}

function isInsideWorkspace(path: string): boolean {
  const rel = relative(process.cwd(), path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function formatConfigSource(source: ReturnType<ConfigManager['getSource']>): string {
  if (!source) return 'unknown';
  const detail = [source.file, source.env].filter(Boolean).join(' / ');
  return detail ? `${source.source} (${detail})` : source.source;
}

type ConfigLabelKey =
  | 'precedence'
  | 'validation'
  | 'validateHint'
  | 'sessionScope'
  | 'reloaded'
  | 'source'
  | 'notSaved'
  | 'sources'
  | 'claudeReference'
  | 'loadIssues'
  | 'valid'
  | 'exportInsideWorkspace'
  | 'exported'
  | 'localConfig';

const CONFIG_LABELS: Record<ConfigLabelKey, { zh: string; en: string }> = {
  precedence: { zh: '\u4f18\u5148\u7ea7', en: 'Precedence' },
  validation: { zh: '\u914d\u7f6e\u6821\u9a8c', en: 'Config validation' },
  validateHint: { zh: '\u8fd0\u884c /config validate \u67e5\u770b\u8be6\u60c5\u3002', en: 'Run /config validate for details.' },
  sessionScope: { zh: '\u5f53\u524d\u8fdb\u7a0b\u5185\u8986\u76d6\uff0c\u9884\u7559\u7ed9\u540e\u7eed\u4ea4\u4e92\u5f0f\u8bbe\u7f6e\u3002', en: 'Current process overrides, reserved for future interactive settings.' },
  reloaded: { zh: '\u914d\u7f6e\u5df2\u91cd\u65b0\u52a0\u8f7d\u3002', en: 'Configuration reloaded.' },
  source: { zh: '\u6765\u6e90', en: 'Source' },
  notSaved: { zh: '\u914d\u7f6e\u672a\u4fdd\u5b58', en: 'Config not saved' },
  sources: { zh: '\u914d\u7f6e\u6765\u6e90', en: 'Config sources' },
  claudeReference: { zh: '\u5bf9\u7167 Claude Code', en: 'Claude Code reference' },
  loadIssues: { zh: '\u52a0\u8f7d\u95ee\u9898', en: 'Load issues' },
  valid: { zh: '\u914d\u7f6e\u6709\u6548\uff0c\u6ca1\u6709\u53d1\u73b0\u95ee\u9898\u3002', en: 'Configuration is valid.' },
  exportInsideWorkspace: { zh: '\u5bfc\u51fa\u8def\u5f84\u5fc5\u987b\u4f4d\u4e8e\u5f53\u524d\u9879\u76ee\u5185\u3002', en: 'Export path must stay inside the current project.' },
  exported: { zh: '\u5df2\u5bfc\u51fa\u8131\u654f\u914d\u7f6e', en: 'Redacted config exported' },
  localConfig: { zh: '\u672c\u5730\u914d\u7f6e', en: 'Local config' },
};

function configLabel(isZh: boolean, key: ConfigLabelKey): string {
  const label = CONFIG_LABELS[key];
  return isZh ? label.zh : label.en;
}
function renderVersionCommand(): void {
  console.log('');
  console.log(chalk.bold(`  RoxyCode v${APP_VERSION}`));
  console.log(chalk.dim(`  Runtime: Node.js ${process.version}`));
  console.log(chalk.dim(`  Platform: ${process.platform} ${process.arch}`));
  console.log('');
}

interface ParsedConfigSetArgs { ok: true; path: string; rawValue: string; scope: ConfigScope }
interface FailedConfigSetArgs { ok: false; reason: 'usage' | 'scope' }

function parseConfigSetArgs(args: string[]): ParsedConfigSetArgs | FailedConfigSetArgs {
  const path = args[0];
  if (!path) return { ok: false, reason: 'usage' };
  let scope: ConfigScope = 'global';
  const valueParts: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const part = args[i];
    if (part === '--scope') {
      const next = args[i + 1];
      if (!isConfigScope(next)) return { ok: false, reason: 'scope' };
      scope = next;
      i++;
      continue;
    }
    if (part.startsWith('--scope=')) {
      const next = part.slice('--scope='.length);
      if (!isConfigScope(next)) return { ok: false, reason: 'scope' };
      scope = next;
      continue;
    }
    valueParts.push(part);
  }
  if (valueParts.length === 0) return { ok: false, reason: 'usage' };
  return { ok: true, path, rawValue: valueParts.join(' '), scope };
}

function isConfigScope(value: unknown): value is ConfigScope {
  return value === 'global' || value === 'project' || value === 'local';
}

function parseConfigValue(raw: string): unknown {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (lower === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  return raw;
}

function formatConfigValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  return JSON.stringify(value, null, 2);
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

type ZhKey =
  | 'statusLabel'
  | 'resumeDescription'
  | 'exportDescription'
  | 'rewindDescription'
  | 'rewindInteger'
  | 'switchTo'
  | 'enterText'
  | 'readConfig'
  | 'writeConfig'
  | 'configPaths'
  | 'unsupportedProvider'
  | 'modelUpdated'
  | 'restartForProvider'
  | 'modeDescription'
  | 'modeCurrent'
  | 'modeConfigured'
  | 'modeEffective'
  | 'modeAvailable'
  | 'modeScope'
  | 'modeUpdated'
  | 'modeInvalid'
  | 'modeAuto'
  | 'modeLite'
  | 'modeEconomic'
  | 'modeStandard'
  | 'modeUltimate'
  | 'diagnosticsDescription'
  | 'memoryDescription'
  | 'memoryList'
  | 'memoryStats'
  | 'memoryAdd'
  | 'memoryForget'
  | 'memoryTypes'
  | 'memoryPolicy'
  | 'memoryAuto'
  | 'memoryPaths'
  | 'workflowDescription'
  | 'workflowList'
  | 'workflowShow'
  | 'workflowRun'
  | 'workflowPaths'
  | 'characterCreate'
  | 'characterPaths'
  | 'aestheticDescription'
  | 'aestheticMinimal'
  | 'aestheticBalanced'
  | 'aestheticImmersive'
  | 'agentsDescription'
  | 'agentsStatus'
  | 'agentsLocks'
  | 'agentsPaths'
  | 'mcpDescription'
  | 'hooksDescription'
  | 'pluginDescription'
  | 'extensionInit'
  | 'extensionList'
  | 'extensionPaths'
  | 'pluginValidate';

const ZH: Record<ZhKey, string> = {
  statusLabel: '(\u67e5\u770b\u72b6\u6001)',
  resumeDescription: '\u6062\u590d\u6700\u8fd1\u4f1a\u8bdd\u6216\u6309 ID/\u5173\u952e\u8bcd\u6062\u590d\u4f1a\u8bdd',
  exportDescription: '\u5bfc\u51fa\u5f53\u524d\u4f1a\u8bdd\u4e3a\u6587\u672c\u6216 JSONL',
  rewindDescription: '\u56de\u9000\u5f53\u524d\u4f1a\u8bdd\u6d88\u606f\uff0c\u9ed8\u8ba4\u64a4\u9500\u6700\u8fd1\u4e00\u8f6e',
  rewindInteger: '  /rewind \u9700\u8981\u4e00\u4e2a\u975e\u8d1f\u6574\u6570\u3002',
  switchTo: '\u5207\u6362\u5230',
  enterText: '(\u76f4\u63a5\u8f93\u5165\u6587\u672c)',
  readConfig: '\u8bfb\u53d6\u914d\u7f6e\u9879',
  writeConfig: '\u5199\u5165\u914d\u7f6e\u9879',
  configPaths: '\u663e\u793a\u914d\u7f6e\u6587\u4ef6\u8def\u5f84',
  unsupportedProvider: '\u4e0d\u652f\u6301\u7684 Provider',
  modelUpdated: '\u6a21\u578b\u914d\u7f6e\u5df2\u66f4\u65b0',
  restartForProvider: '\u91cd\u542f RoxyCode \u540e\uff0c\u5f53\u524d\u4f1a\u8bdd\u5c06\u4f7f\u7528\u65b0\u7684 Provider\u3002',
  modeDescription: '\u67e5\u770b\u6216\u5207\u6362 RoxyCode Agent Loop \u63a8\u7406\u6a21\u5f0f',
  modeCurrent: 'RoxyCode \u63a8\u7406\u6a21\u5f0f',
  modeConfigured: '\u5f53\u524d\u6a21\u5f0f',
  modeEffective: '\u5b9e\u9645\u751f\u6548',
  modeAvailable: '\u53ef\u7528\u6a21\u5f0f',
  modeScope: '\u5199\u5165\u8303\u56f4',
  modeUpdated: '\u63a8\u7406\u6a21\u5f0f\u5df2\u66f4\u65b0',
  modeInvalid: '\u4e0d\u652f\u6301\u7684\u63a8\u7406\u6a21\u5f0f',
  modeAuto: '\u81ea\u52a8\uff1a\u9ed8\u8ba4\u4f7f\u7528 Standard \u7a33\u5b9a\u6a21\u5f0f',
  modeLite: 'Lite\uff1a\u5355\u8f6e\u95ee\u7b54\uff0c\u4e0d\u4e3b\u52a8\u8c03\u7528\u5de5\u5177',
  modeEconomic: 'Economic\uff1a\u63a7\u5236\u6210\u672c\u7684 ReAct \u5de5\u5177\u5faa\u73af',
  modeStandard: 'Standard\uff1a\u8ba1\u5212 -> \u6267\u884c -> \u9a8c\u8bc1',
  modeUltimate: 'Ultimate\uff1aCoordinator \u548c\u591a Agent \u5e76\u884c\u5206\u6790',
  diagnosticsDescription: '\u8fd0\u884c Claude Code \u98ce\u683c\u7684 RoxyCode \u8fd0\u884c\u8bca\u65ad\u62a5\u544a',
  memoryDescription: '\u7ba1\u7406 RoxyCode \u957f\u671f\u8bb0\u5fc6',
  memoryList: '\u5217\u51fa\u8bb0\u5fc6',
  memoryStats: '\u67e5\u770b\u8bb0\u5fc6\u7edf\u8ba1',
  memoryAdd: '\u6dfb\u52a0\u4e00\u6761\u8bb0\u5fc6',
  memoryForget: '\u5f52\u6863\u4e00\u6761\u8bb0\u5fc6',
  memoryTypes: '\u663e\u793a\u8bb0\u5fc6\u7c7b\u578b',
  memoryPolicy: '\u67e5\u770b\u8bb0\u5fc6\u4fdd\u5b58\u8fb9\u754c',
  memoryAuto: '\u5207\u6362\u81ea\u52a8\u8bb0\u5fc6\u63d0\u53d6',
  memoryPaths: '\u663e\u793a\u8bb0\u5fc6\u6587\u4ef6\u8def\u5f84',
  workflowDescription: '\u8fd0\u884c RoxyCode \u4e2d\u6587\u4e1a\u52a1\u5de5\u4f5c\u6d41',
  workflowList: '\u5217\u51fa\u5de5\u4f5c\u6d41',
  workflowShow: '\u67e5\u770b\u5de5\u4f5c\u6d41\u8be6\u60c5',
  workflowRun: '\u901a\u8fc7 Agent Loop \u6267\u884c\u5de5\u4f5c\u6d41',
  workflowPaths: '\u663e\u793a\u5de5\u4f5c\u6d41\u641c\u7d22\u8def\u5f84',
  characterCreate: '\u521b\u5efa\u81ea\u5b9a\u4e49\u89d2\u8272\u6a21\u677f',
  characterPaths: '\u663e\u793a\u81ea\u5b9a\u4e49\u89d2\u8272\u76ee\u5f55',
  aestheticDescription: '\u5207\u6362 RoxyCode \u5ba1\u7f8e\u6c89\u6d78\u5f3a\u5ea6',
  aestheticMinimal: '\u4e13\u6ce8\u4e13\u4e1a\u8f93\u51fa',
  aestheticBalanced: '\u9ed8\u8ba4\u5e73\u8861\u4f53\u9a8c',
  aestheticImmersive: '\u589e\u5f3a\u4e8c\u6b21\u5143\u5de5\u4f5c\u53f0\u4f53\u9a8c',
  agentsDescription: '\u67e5\u770b Ultimate \u591a Agent \u8fd0\u884c\u3001\u8ba4\u9886\u548c\u6587\u4ef6\u9501',
  agentsStatus: '\u67e5\u770b\u6700\u8fd1\u7684\u591a Agent \u8fd0\u884c',
  agentsLocks: '\u67e5\u770b\u6d3b\u52a8\u6587\u4ef6\u9501',
  agentsPaths: '\u663e\u793a\u591a Agent \u72b6\u6001\u8def\u5f84',
  mcpDescription: 'MCP \u5916\u90e8\u5de5\u5177\u7ba1\u7406',
  hooksDescription: 'Hooks \u547d\u4ee4\u3001\u63d0\u793a\u8bcd\u3001HTTP \u548c Agent \u6269\u5c55\u70b9\u7ba1\u7406',
  pluginDescription: 'RoxyCode \u672c\u5730\u63d2\u4ef6\u7ba1\u7406',
  extensionInit: '\u751f\u6210\u914d\u7f6e\u6a21\u677f',
  extensionList: '\u5217\u51fa\u5df2\u914d\u7f6e\u9879',
  extensionPaths: '\u663e\u793a\u641c\u7d22\u8def\u5f84',
  pluginValidate: '\u6821\u9a8c manifest',
};

function zh(key: ZhKey): string {
  return ZH[key];
}
