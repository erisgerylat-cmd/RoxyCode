import chalk from 'chalk';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import type { Character } from '../../aesthetic/character/types.js';
import type { ConfigManager } from '../../core/ConfigManager.js';
import type { ContextManager } from '../../session/context/ContextManager.js';
import type { LLMProvider } from '../../core/types/llm.js';
import { userMessage, type Message } from '../../core/types/message.js';
import { AgentLoop, normalizeAgentMode, type AgentLoopEvent } from '../../engine/agent/index.js';
import { createDefaultToolRuntime, getBuiltinTools, type ToolExecutor, type ToolRegistry, type ToolPermissionPrompt } from '../../tool/index.js';
import { CommandRegistry, getCategoryMeta, type CommandCategory, type SubcommandDefinition } from '../../commands/CommandRegistry.js';
import { parseCommand } from '../../commands/CommandParser.js';
import { createBuiltinCommands } from '../../commands/builtin/index.js';
import { ALL_CHARACTERS, CHARACTER_ORDER } from '../../aesthetic/character/characters/index.js';
import { EasterEggEngine } from '../easter-eggs/EasterEggEngine.js';
import { DemonEyeMode } from '../easter-eggs/DemonEyeMode.js';
import { TelepathyMode } from '../easter-eggs/TelepathyMode.js';
import { processInput, InputHistory, MultiLineCollector, isEmpty } from './InputHandler.js';
import { RawLineReader, type KeyEvent } from './RawLineReader.js';
import { CommandPalette, type PaletteItem } from './CommandPalette.js';
import { requestPermissionConfirmation } from './PermissionConfirmPanel.js';
import { APP_VERSION } from '../../core/constants.js';
import { normalizeLanguage, t, type Language } from '../../i18n/index.js';
import { InteractionRenderer } from '../renderers/InteractionRenderer.js';
import { StatusBar, type StatusState } from '../renderers/StatusBar.js';
import { ToolActivityRenderer } from '../renderers/ToolActivityRenderer.js';
import { SessionStore } from '../../session/store/SessionStore.js';
import { AutoMemoryExtractor, MemoryPolicyError, MemoryStore } from '../../session/memory/index.js';
import { ProfileOnboarding, ProfileManager, ProjectProfileManager } from '../../session/index.js';
import { HookLoader, HookManager } from '../../hooks/index.js';
import { McpConfigLoader, McpToolAdapter } from '../../mcp/index.js';
import { PluginLoader, collectPluginContributions, type PluginLoadResult } from '../../plugin/index.js';
import { CommandLoader } from '../../commands/CommandLoader.js';
import { CommandWatcher } from '../../commands/CommandWatcher.js';
import { PluginCommandSource, SkillCommandSource, WorkflowCommandSource } from '../../commands/sources/index.js';
import type { CommandDefinition } from '../../commands/CommandRegistry.js';
import { createRuntimeState, type QueryProfileSummary, type RuntimeExtensionSnapshot, type RuntimeState } from '../../runtime/index.js';
import { formatErrorForDisplay, getRoxyErrorDescriptor, toError } from '../../core/errors.js';
import { TelemetryLogger } from '../../telemetry/index.js';

export interface REPLOptions {
  characterManager: CharacterManager;
  configManager: ConfigManager;
  contextManager: ContextManager;
  llmProvider: LLMProvider;
}

interface LineSubmitOptions { fromPalette?: boolean }
interface PaletteSelectionOptions { lineAlreadySubmitted?: boolean }

export class REPL {
  private readonly characterManager: CharacterManager;
  private readonly configManager: ConfigManager;
  private readonly contextManager: ContextManager;
  private readonly llmProvider: LLMProvider;
  private readonly toolRegistry: ToolRegistry;
  private readonly toolExecutor: ToolExecutor;
  private readonly easterEggEngine: EasterEggEngine;
  private readonly demonEyeMode: DemonEyeMode;
  private readonly telepathyMode: TelepathyMode;
  private readonly inputHistory = new InputHistory(500);
  private readonly multiLineCollector = new MultiLineCollector();
  private readonly palette = new CommandPalette({ maxVisible: 10 });
  private readonly interactionRenderer: InteractionRenderer;
  private readonly statusBar: StatusBar;
  private readonly toolActivityRenderer: ToolActivityRenderer;
  private readonly hookManager: HookManager;
  private readonly mcpToolAdapter: McpToolAdapter;
  private readonly runtimeState: RuntimeState;
  private readonly telemetryLogger: TelemetryLogger;
  private readonly sessionStartTime = Date.now();
  private sessionStore = new SessionStore(process.cwd());
  private readonly memoryStore = new MemoryStore({ cwd: process.cwd() });

  private commandRegistry = new CommandRegistry();
  private extensionCommands: CommandDefinition[] = [];
  private extensionsLoaded = false;
  private commandWatcher: CommandWatcher | null = null;
  private agentLoop: AgentLoop;
  private agentMessages: Message[] = [];
  private reader: RawLineReader | null = null;
  private conversationTurns = 0;
  private paletteActive = false;
  private processing = false;
  private shutdownRequested = false;

  constructor(options: REPLOptions) {
    this.characterManager = options.characterManager;
    this.configManager = options.configManager;
    this.contextManager = options.contextManager;
    this.llmProvider = options.llmProvider;
    const toolRuntime = createDefaultToolRuntime(process.cwd());
    this.toolRegistry = toolRuntime.registry;
    this.toolExecutor = toolRuntime.executor;
    this.runtimeState = createRuntimeState({
      cwd: process.cwd(),
      language: this.getLanguage(),
      characterId: this.characterManager.getCurrentCharacter().id,
      providerId: this.llmProvider.id,
      model: String(this.configManager.get('llm.model') || this.llmProvider.id),
      isInteractive: process.stdin.isTTY,
      sessionId: this.sessionStore.sessionId,
      transcriptPath: this.sessionStore.path,
    });
    this.telemetryLogger = new TelemetryLogger({
      cwd: process.cwd(),
      sessionId: this.sessionStore.sessionId,
      runtimeId: this.runtimeState.getRuntimeId(),
    });
    this.runtimeState.recordTelemetry(this.telemetryLogger.snapshot());
    this.hookManager = new HookManager({
      hooks: [],
      llmProvider: this.llmProvider,
      onRun: record => {
        this.runtimeState.recordHookRun(record);
        void this.recordHookTelemetry(record);
      },
    });
    this.mcpToolAdapter = new McpToolAdapter(process.cwd());
    this.agentLoop = this.createAgentLoop();
    this.easterEggEngine = new EasterEggEngine(options.characterManager);
    this.demonEyeMode = new DemonEyeMode();
    this.telepathyMode = new TelepathyMode();
    this.interactionRenderer = new InteractionRenderer(options.characterManager.getCurrentCharacter());
    this.statusBar = new StatusBar(options.characterManager.getCurrentCharacter());
    this.toolActivityRenderer = new ToolActivityRenderer({
      character: options.characterManager.getCurrentCharacter(),
      language: this.getLanguage(),
    });
    this.toolActivityRenderer.setTools(this.toolRegistry.list());
    this.registerBuiltinCommands();
    this.syncPaletteItems();
  }

  async start(): Promise<void> {
    this.runtimeState.setInteractive(process.stdin.isTTY);
    await this.initializeSession();
    await this.loadExtensions();
    if (!process.stdin.isTTY) return this.startFallback({ initialized: true });
    await this.showStartupOnboardingIfNeeded();
    const character = this.characterManager.getCurrentCharacter();
    this.reader = new RawLineReader({ prompt: this.getPromptString(character), historyLimit: 500 });
    this.reader.on('change', (buffer: string) => this.onInputChange(buffer));
    this.reader.on('key', (event: KeyEvent) => this.onKeyEvent(event));
    this.reader.on('line', (line: string) => {
      void this.onLineSubmit(line).catch(err => this.handleLineSubmitError(line, err));
    });
    this.reader.on('close', () => this.requestShutdown(0));
    this.showPrompt();
    this.reader.start();
  }

  private async startFallback(options: { initialized?: boolean } = {}): Promise<void> {
    if (!options.initialized) {
      await this.initializeSession();
      await this.loadExtensions();
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const input = Buffer.concat(chunks).toString('utf8').trim();
    if (!input) return;

    const lines = input.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every(line => line.startsWith('/') && !line.startsWith('//'))) {
      for (const line of lines) await this.onLineSubmit(line);
      await this.telemetryLogger.flush();
      return;
    }

    await this.onLineSubmit(input);
    await this.telemetryLogger.flush();
  }

  private registerBuiltinCommands(): void {
    const commands = createBuiltinCommands({
      text: this.getText(),
      getText: () => this.getText(),
      language: this.getLanguage(),
      characterManager: this.characterManager,
      configManager: this.configManager,
      contextManager: this.contextManager,
      llmProvider: this.llmProvider,
      easterEggEngine: this.easterEggEngine,
      demonEyeMode: this.demonEyeMode,
      telepathyMode: this.telepathyMode,
      getCharacterSubcommands: () => this.getCharacterSubcommands(),
      getHelpSubcommands: () => [],
      getConversationTurns: () => this.conversationTurns,
      getSessionElapsedMs: () => Date.now() - this.sessionStartTime,
      getHistoryCount: () => this.inputHistory.getHistory().length,
      getCommandCount: () => this.commandRegistry.list().length,
      getTools: () => this.toolRegistry.list(),
      getRuntimeSnapshot: () => this.runtimeState.snapshot(),
      getMemoryStats: () => this.memoryStore.getStats({ enabled: this.configManager.get('memory.auto') !== false, language: this.getLanguage() }),
      showHelp: () => this.showHelp(),
      showCommandHelp: name => this.showCommandHelp(name),
      showHistory: () => this.showHistory(),
      reloadCommands: () => this.reloadCommands(),
      requestShutdown: code => this.requestShutdown(code),
      closeReader: () => this.reader?.close(),
      resumeSession: query => this.resumeSession(query),
      exportSession: (target, format) => this.exportSession(target, format),
      rewindSession: count => this.rewindSession(count),
      compactSession: () => this.compactSession(),
      getSessionInfo: () => ({ sessionId: this.sessionStore.sessionId, path: this.sessionStore.path }),
      runAgentPrompt: prompt => this.submitAgentPrompt(prompt),
    });
    this.commandRegistry.registerMany(commands);
  }

  private registerExtensionCommands(): void {
    if (this.extensionCommands.length === 0) return;
    this.commandRegistry.registerMany(this.extensionCommands);
  }

  private syncPaletteItems(): void {
    this.palette.setItems(this.commandRegistry.list().map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      aliases: cmd.aliases ?? [],
      category: cmd.category ?? 'basic',
      hasChildren: !!cmd.subcommands?.length,
    })));
  }

  private rebuildCommandRegistry(): void {
    this.commandRegistry.clear();
    this.registerBuiltinCommands();
    this.registerExtensionCommands();
    this.syncPaletteItems();
  }

  private async reloadCommands(): Promise<void> {
    await this.refreshExtensions({ note: 'extensions reloaded', restartWatcher: true });
  }

  private async loadExtensions(): Promise<void> {
    if (this.extensionsLoaded) return;
    this.extensionsLoaded = true;
    await this.refreshExtensions({ note: 'extensions loaded', restartWatcher: process.stdin.isTTY });
  }

  private async showStartupOnboardingIfNeeded(): Promise<void> {
    const language = this.getLanguage();
    const isZh = language === 'zh-CN';
    const profileManager = new ProfileManager(process.cwd());
    const projectManager = new ProjectProfileManager(process.cwd());
    const [hasProfile, hasProject] = await Promise.all([
      profileManager.exists(),
      projectManager.exists(),
    ]);
    if (hasProfile && hasProject) return;

    const suggestion = hasProfile
      ? null
      : await new ProfileOnboarding(process.cwd()).suggestProfile({ configManager: this.configManager }).catch(() => null);
    const profileCommand = `/profile init --language ${language === 'en-US' ? 'en' : 'zh'} --role ${suggestion?.defaultCharacter ?? this.characterManager.getCurrentCharacter().id}`;

    console.log('');
    console.log(chalk.cyan(isZh ? '  ┌── 首次启动引导 ──┐' : '  ┌── First Run Setup ──┐'));
    if (!hasProfile) {
      console.log(chalk.cyan('  │') + chalk.white(isZh ? '  未检测到个人画像 .roxycode/profile.json' : '  Missing personal profile .roxycode/profile.json'));
      console.log(chalk.cyan('  │') + chalk.dim(`  ${profileCommand}`));
    }
    if (!hasProject) {
      console.log(chalk.cyan('  │') + chalk.white(isZh ? '  未检测到项目画像 .roxycode/project.json' : '  Missing project profile .roxycode/project.json'));
      console.log(chalk.cyan('  │') + chalk.dim('  /project init'));
    }
    console.log(chalk.cyan('  │') + chalk.dim(isZh
      ? '  对照 Claude Code 的 /init：RoxyCode 将个人偏好和项目规则拆开保存。'
      : '  Like Claude Code /init, RoxyCode keeps personal preferences separate from project rules.'));
    console.log(chalk.cyan('  └────────────────────┘'));
    console.log('');
  }

  private async refreshExtensions(options: { note?: string; restartWatcher?: boolean } = {}): Promise<void> {
    const config = this.configManager.snapshot();
    const pluginResult = await new PluginLoader({ cwd: process.cwd(), config }).load();
    const contributions = collectPluginContributions(pluginResult.enabled);

    const dynamicCommands = await this.createDynamicCommandLoader(config, pluginResult).load({
      runAgentPrompt: prompt => this.submitAgentPrompt(prompt),
      reservedNames: this.getBuiltinCommandNames(),
    });

    this.extensionCommands = dynamicCommands.commands;
    this.rebuildCommandRegistry();

    const characterHookFile = this.characterManager.getCurrentCharacter().extensions?.hooks;
    const hookResult = await new HookLoader({
      cwd: process.cwd(),
      config,
      pluginHooks: contributions.hooks,
      files: characterHookFile ? [characterHookFile] : [],
    }).load();
    this.hookManager.setHooks(hookResult.hooks);

    this.toolRegistry.clear();
    this.toolRegistry.registerMany(getBuiltinTools());
    const mcpResult = await new McpConfigLoader({
      cwd: process.cwd(),
      config,
      pluginServers: contributions.mcpServers,
    }).load();
    const mcpTools = await this.mcpToolAdapter.discoverTools(mcpResult.servers);
    for (const tool of mcpTools.tools) {
      if (!this.toolRegistry.has(tool.definition.name)) this.toolRegistry.register(tool);
    }

    const registeredCommands = this.commandRegistry.list({ includeHidden: true });
    const extensionSnapshot: RuntimeExtensionSnapshot = {
      plugins: { enabled: pluginResult.enabled.length, disabled: pluginResult.disabled.length, errors: pluginResult.errors },
      hooks: { count: hookResult.hooks.length, errors: hookResult.errors },
      mcp: {
        servers: mcpResult.servers.length,
        tools: mcpTools.tools.length,
        errors: [
          ...mcpResult.errors,
          ...mcpTools.errors.map(error => ({ source: `mcp:${error.server}`, message: error.message })),
        ],
      },
      commands: {
        builtin: registeredCommands.filter(command => (command.source ?? 'builtin') === 'builtin').length,
        extension: this.extensionCommands.length,
        total: registeredCommands.length,
      },
      tools: {
        builtin: getBuiltinTools().length,
        mcp: mcpTools.tools.length,
        total: this.toolRegistry.list().length,
      },
    };
    this.runtimeState.recordExtensions(extensionSnapshot);
    this.toolActivityRenderer.setTools(this.toolRegistry.list());

    if (options.restartWatcher) await this.startCommandWatcher();

    await this.sessionStore.append({
      type: 'note',
      note: options.note ?? 'extensions refreshed',
      metadata: {
        commands: { count: this.extensionCommands.length, errors: dynamicCommands.errors },
        plugins: { enabled: pluginResult.enabled.length, disabled: pluginResult.disabled.length, errors: pluginResult.errors },
        hooks: { count: hookResult.hooks.length, errors: hookResult.errors },
        mcp: {
          servers: mcpResult.servers.length,
          tools: mcpTools.tools.length,
          errors: [
            ...mcpResult.errors,
            ...mcpTools.errors.map(error => ({ source: `mcp:${error.server}`, message: error.message })),
          ],
        },
      },
    }).catch(() => undefined);
  }

  private createDynamicCommandLoader(config: ReturnType<ConfigManager['snapshot']>, pluginResult?: PluginLoadResult): CommandLoader {
    return new CommandLoader([
      new WorkflowCommandSource({ cwd: process.cwd(), configManager: this.configManager, characterManager: this.characterManager, sessionId: this.sessionStore.sessionId }),
      new PluginCommandSource({ cwd: process.cwd(), config, loadResult: pluginResult }),
      new SkillCommandSource({ cwd: process.cwd(), directories: config.skills.directories }),
    ]);
  }

  private getBuiltinCommandNames(): string[] {
    return this.commandRegistry.list({ includeHidden: true })
      .filter(command => (command.source ?? 'builtin') === 'builtin')
      .flatMap(command => [command.name, ...(command.aliases ?? [])]);
  }

  private async startCommandWatcher(): Promise<void> {
    this.commandWatcher?.stop();
    this.commandWatcher = null;
    if (!this.shouldEnableCommandWatcher()) return;

    const config = this.configManager.snapshot();
    const watcher = new CommandWatcher({
      cwd: process.cwd(),
      loader: this.createDynamicCommandLoader(config),
      context: {
        runAgentPrompt: prompt => this.submitAgentPrompt(prompt),
        reservedNames: this.getBuiltinCommandNames(),
      },
      onReload: async result => {
        try {
          this.extensionCommands = result.commands;
          this.commandRegistry.replaceBySource(['workflow', 'plugin', 'skill'], this.extensionCommands);
          this.syncPaletteItems();
          await this.sessionStore.append({
            type: 'note',
            note: 'dynamic commands hot reloaded',
            metadata: { commands: result.commands.length, errors: result.errors },
          });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.runtimeState.recordError('command-watcher', err.message);
        }
      },
      onError: error => this.runtimeState.recordError('command-watcher', error.message),
    });
    const watched = await watcher.start();
    this.commandWatcher = watcher.isRunning ? watcher : null;
    if (watched.length > 0) {
      await this.sessionStore.append({ type: 'note', note: 'command watcher started', metadata: { watched } }).catch(() => undefined);
    }
  }

  private shouldEnableCommandWatcher(): boolean {
    return process.env.ROXY_COMMAND_WATCH === '1'
      || process.env.ROXY_DEV === '1'
      || process.env.NODE_ENV === 'development';
  }

  private getLanguage(): Language {
    return normalizeLanguage(this.configManager.get('ui.language'));
  }

  private getText() {
    return t(this.getLanguage()).commands;
  }

  private syncRuntimeConfig(): void {
    this.runtimeState.updateConfig({
      language: this.getLanguage(),
      characterId: this.characterManager.getCurrentCharacter().id,
      providerId: this.llmProvider.id,
      model: String(this.configManager.get('llm.model') || this.llmProvider.id),
    });
  }

  private getCharacterSubcommands(): SubcommandDefinition[] {
    const subs: SubcommandDefinition[] = [];
    for (const id of CHARACTER_ORDER) {
      const character = ALL_CHARACTERS.get(id);
      if (character) subs.push({ name: id, description: `${character.title} - ${character.description}`, label: character.name });
    }
    subs.push(
      { name: 'info', description: this.getLanguage() === 'zh-CN' ? zhText('characterInfo') : 'Show current character details' },
      { name: 'random', description: this.getLanguage() === 'zh-CN' ? zhText('characterRandom') : 'Choose a random character' },
    );
    return subs;
  }

  private toSubPaletteItems(subs: SubcommandDefinition[]): PaletteItem[] {
    return subs.map(s => ({
      name: s.name,
      description: s.description,
      aliases: [],
      category: 'basic' as CommandCategory,
      hasChildren: s.hasChildren,
      needsInput: s.needsInput,
      label: s.label || s.name,
      icon: s.icon,
    }));
  }

  private getHelpPaletteItems(): PaletteItem[] {
    return this.commandRegistry.list().map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      aliases: cmd.aliases ?? [],
      category: cmd.category ?? 'basic',
      label: `/${cmd.name}`,
    }));
  }

  private getCompressSubItems(): PaletteItem[] {
    const isZh = this.getLanguage() === 'zh-CN';
    return [
      { name: 'on', description: isZh ? zhText('compressOn') : 'Enable automatic context compression', aliases: [], category: 'basic', label: 'on', icon: '+' },
      { name: 'off', description: isZh ? zhText('compressOff') : 'Disable automatic context compression', aliases: [], category: 'basic', label: 'off', icon: '-' },
    ];
  }

  private async onLineSubmit(line: string, options: LineSubmitOptions = {}): Promise<void> {
    if (!options.fromPalette && this.paletteActive && this.palette.visible && this.palette.selected) {
      this.selectPaletteItem({ lineAlreadySubmitted: true });
      return;
    }

    this.closePalette();
    const input = processInput(line);
    if (isEmpty(input)) {
      if (!this.shutdownRequested) this.showPrompt();
      return;
    }

    this.inputHistory.add(input);
    this.conversationTurns++;
    this.syncRuntimeConfig();
    this.runtimeState.updateSession({ turns: this.conversationTurns, messageCount: this.agentMessages.length });
    const easterEgg = this.easterEggEngine.checkOnInput(input);
    if (easterEgg) console.log(chalk.hex(this.characterManager.getCurrentCharacter().theme.accent)(`  "${easterEgg}"`));

    const cmd = parseCommand(input);
    this.interactionRenderer.updateCharacter(this.characterManager.getCurrentCharacter());
    this.interactionRenderer.renderUserInput(input, cmd ? 'command' : 'message');

    if (!cmd && this.renderShellConfigurationHint(input)) {
      await this.sessionStore.append({ type: 'note', note: 'shell configuration hint', metadata: { input } });
      if (!this.shutdownRequested) this.showPrompt();
      return;
    }

    if (cmd) {
      await this.sessionStore.append({ type: 'command', command: { name: cmd.name, args: cmd.args, raw: input } });
      await this.runCommand(cmd.name, cmd.args);
      this.syncRuntimeConfig();
      this.runtimeState.updateSession({ turns: this.conversationTurns, messageCount: this.agentMessages.length });
    } else {
      await this.sessionStore.appendMessage(userMessage(input), 'user');
      await this.runAgentInput(input);
    }

    if (!this.shutdownRequested) this.showPrompt();
  }

  private renderShellConfigurationHint(input: string): boolean {
    const trimmed = input.trim();
    const isShellConfig = /^\$env:ROXY_[A-Z0-9_]+\s*=/.test(trimmed)
      || /^\$env:(OPENAI|QWEN|DASHSCOPE|DEEPSEEK|GLM|BIGMODEL)_[A-Z0-9_]+\s*=/.test(trimmed)
      || /^pnpm\s+start\b/.test(trimmed)
      || /^npm\s+run\s+start\b/.test(trimmed);
    if (!isShellConfig) return false;

    const isZh = this.getLanguage() === 'zh-CN';
    if (isZh) {
      console.log(chalk.yellow('  \u8fd9\u770b\u8d77\u6765\u662f PowerShell/\u7ec8\u7aef\u547d\u4ee4\uff0c\u4e0d\u662f RoxyCode \u5bf9\u8bdd\u547d\u4ee4\u3002'));
      console.log(chalk.dim('  \u8bf7\u5148\u9000\u51fa RoxyCode\uff0c\u56de\u5230 IDEA \u5916\u5c42\u7ec8\u7aef\u6267\u884c\u8fd9\u4e9b\u547d\u4ee4\uff0c\u7136\u540e\u518d\u542f\u52a8 RoxyCode\u3002'));
      console.log(chalk.dim('  \u793a\u4f8b:'));
      console.log(chalk.dim('    $env:ROXY_OPENAI_API_KEY="sk-..."'));
      console.log(chalk.dim('    $env:ROXY_OPENAI_BASE_URL="https://api.example.com/v1"'));
      console.log(chalk.dim('    pnpm start'));
    } else {
      console.log(chalk.yellow('  This looks like a PowerShell/shell command, not a RoxyCode chat command.'));
      console.log(chalk.dim('  Exit RoxyCode, run it in the outer IDEA terminal, then start RoxyCode again.'));
    }
    return true;
  }

  private async runCommand(name: string, args: string[]): Promise<void> {
    this.processing = true;
    const startedAt = Date.now();
    let handled = false;
    let failed = false;
    await this.telemetryLogger.log({
      name: 'command.execute.start',
      category: 'command',
      attributes: { commandName: name, argCount: args.length },
    }).then(() => this.runtimeState.recordTelemetry(this.telemetryLogger.snapshot()));
    try {
      const hook = await this.hookManager.run('command', {
        cwd: process.cwd(),
        sessionId: this.sessionStore.sessionId,
        language: this.getLanguage(),
        characterId: this.characterManager.getCurrentCharacter().id,
        commandName: name,
        commandArgs: args,
      });
      if (hook.blocked) {
        console.log(chalk.red(`  ${hook.reason ?? 'Command blocked by hook.'}`));
        handled = true;
      } else {
        handled = await this.commandRegistry.execute(name, args, { characterManager: this.characterManager });
      }
      this.interactionRenderer.renderCommandResult(name, Date.now() - startedAt, handled);
    } catch (error) {
      failed = true;
      this.interactionRenderer.renderCommandError(name, Date.now() - startedAt, error);
    } finally {
      this.processing = false;
    }

    await this.telemetryLogger.log({
      name: failed ? 'command.execute.error' : 'command.execute.done',
      category: 'command',
      durationMs: Date.now() - startedAt,
      success: handled && !failed,
      attributes: { commandName: name, argCount: args.length, handled },
    }).then(() => this.runtimeState.recordTelemetry(this.telemetryLogger.snapshot()));

    if (!handled && !failed) {
      const text = this.getText();
      console.log(chalk.red(`  ${text.unknownCommand}: /${name}`));
      console.log(chalk.dim(`  ${text.typeHelp}`));
    }
  }

  private createAgentLoop(): AgentLoop {
    return new AgentLoop({
      llmProvider: this.llmProvider,
      contextManager: this.contextManager,
      toolExecutor: this.toolExecutor,
      tools: this.toolRegistry.definitions(),
      toolRuntimeTools: this.toolRegistry.list(),
      config: this.configManager.snapshot(),
      cwd: process.cwd(),
      sessionId: this.sessionStore.sessionId,
      character: this.characterManager.getCurrentCharacter(),
      language: this.getLanguage(),
      confirm: prompt => this.confirmToolPrompt(prompt, false),
      confirmSecond: prompt => this.confirmToolPrompt(prompt, true),
      hooks: this.hookManager,
      telemetry: this.telemetryLogger,
    });
  }

  private async submitAgentPrompt(input: string): Promise<void> {
    await this.sessionStore.appendMessage(userMessage(input), 'user');
    await this.runAgentInput(input);
  }
  private async runAgentInput(input: string): Promise<void> {
    this.processing = true;
    this.agentLoop = this.createAgentLoop();
    const mode = normalizeAgentMode(this.configManager.get('mode') as string | undefined);
    const beforeCount = this.agentMessages.length;
    this.runtimeState.recordAgentStart({ mode, userInput: input });
    this.toolActivityRenderer.resetTurn();
    this.toolActivityRenderer.updateCharacter(this.characterManager.getCurrentCharacter());
    this.toolActivityRenderer.setLanguage(this.getLanguage());
    void this.telemetryLogger.log({
      name: 'agent.run.start',
      category: 'agent',
      attributes: { mode, inputChars: input.length, historyMessages: this.agentMessages.length },
    }).then(() => this.runtimeState.recordTelemetry(this.telemetryLogger.snapshot()));
    try {
      for await (const event of this.agentLoop.run({ userInput: input, history: this.agentMessages, mode })) {
        this.runtimeState.recordAgentEvent(event);
        void this.recordAgentTelemetry(event);
        await this.recordSessionAgentEvent(event).catch(() => undefined);
        this.renderAgentEvent(event);
        if (event.type === 'done') {
          const nextMessages = event.messages.filter(message => message.role !== 'system');
          const additions = nextMessages.slice(Math.min(nextMessages.length, beforeCount + 1));
          for (const message of additions) await this.sessionStore.appendMessage(message);
          this.agentMessages = nextMessages;
          this.runtimeState.updateSession({ messageCount: this.agentMessages.length, turns: this.conversationTurns });
          void this.extractAutoMemories(nextMessages).catch(() => undefined);
        }
      }
    } catch (error) {
      const err = toError(error);
      this.runtimeState.recordAgentEvent({ type: 'error', error: err });
      throw err;
    } finally {
      if (this.statusBar.isActive()) this.statusBar.clear();
      this.processing = false;
    }
  }

  private startStatusBar(state: StatusState, label?: string): void {
    if (!process.stdin.isTTY) return;
    this.statusBar.updateCharacter(this.characterManager.getCurrentCharacter());
    if (!this.statusBar.isActive()) this.statusBar.start();
    this.statusBar.setState(state);
    if (label) this.statusBar.setLabel(label);
  }

  private updateStatusBar(state: StatusState, label?: string): void {
    if (!process.stdin.isTTY || !this.statusBar.isActive()) return;
    this.statusBar.setState(state);
    this.statusBar.setLabel(label ?? '');
  }

  private clearStatusBar(): void {
    if (this.statusBar.isActive()) this.statusBar.clear();
  }

  private recordAgentTelemetry(event: AgentLoopEvent): void {
    let name: string | null = null;
    let category: 'agent' | 'llm' | 'tool' | 'runtime' = 'agent';
    let success: boolean | undefined;
    const attributes: Record<string, unknown> = {};

    switch (event.type) {
      case 'mode_start':
        name = 'agent.mode_start';
        attributes.mode = event.mode;
        attributes.label = event.label;
        break;
      case 'model_request_start':
        name = 'llm.request_start';
        category = 'llm';
        attributes.phase = event.phase;
        attributes.iteration = event.iteration;
        break;
      case 'tool_result_pairing_repaired':
        name = 'llm.tool_result_pairing_repaired';
        category = 'llm';
        success = true;
        Object.assign(attributes, event.report);
        break;
      case 'tool_call_start':
        name = 'tool.call_start';
        category = 'tool';
        attributes.toolName = event.toolCall.name;
        attributes.argumentKeys = Object.keys(event.toolCall.arguments);
        break;
      case 'tool_execution_start':
        name = 'tool.execution_start';
        category = 'tool';
        attributes.toolName = event.toolCall.name;
        attributes.argumentKeys = Object.keys(event.toolCall.arguments);
        break;
      case 'tool_progress':
        name = 'tool.progress';
        category = 'tool';
        attributes.toolName = event.toolCall.name;
        attributes.progressType = event.progress.type;
        break;
      case 'tool_result':
        name = 'tool.result_seen';
        category = 'tool';
        success = event.result.success;
        attributes.toolName = event.toolCall.name;
        attributes.durationMs = event.result.duration;
        attributes.outputChars = event.result.output.length;
        attributes.error = event.result.error;
        break;
      case 'context_compacted':
        name = 'runtime.context_compacted';
        category = 'runtime';
        attributes.layer = event.layer;
        attributes.beforeTokens = event.beforeTokens;
        attributes.afterTokens = event.afterTokens;
        break;
      case 'token_budget_continue':
        name = 'agent.token_budget_continue';
        attributes.continuationCount = event.continuationCount;
        attributes.pct = event.pct;
        attributes.turnTokens = event.turnTokens;
        attributes.budget = event.budget;
        break;
      case 'token_budget_done':
        name = 'agent.token_budget_done';
        attributes.continuationCount = event.continuationCount;
        attributes.pct = event.pct;
        attributes.turnTokens = event.turnTokens;
        attributes.budget = event.budget;
        attributes.diminishingReturns = event.diminishingReturns;
        attributes.durationMs = event.durationMs;
        break;
      case 'usage':
        name = 'llm.usage';
        category = 'llm';
        success = true;
        attributes.inputTokens = event.usage.inputTokens;
        attributes.outputTokens = event.usage.outputTokens;
        attributes.totalTokens = event.usage.totalTokens;
        attributes.cost = event.usage.cost;
        break;
      case 'done':
        name = 'agent.done';
        success = true;
        attributes.messageCount = event.messages.length;
        attributes.totalTokens = event.usage.totalTokens;
        if (event.profile) addQueryProfileTelemetryAttributes(attributes, event.profile);
        break;
      case 'error':
        name = 'agent.error';
        success = false;
        attributes.error = event.error.message;
        attributes.errorName = event.error.name;
        if (event.profile) addQueryProfileTelemetryAttributes(attributes, event.profile);
        break;
    }

    if (!name) return;
    void this.telemetryLogger.log({ name, category, success, attributes }).then(() => {
      this.runtimeState.recordTelemetry(this.telemetryLogger.snapshot());
    });
  }

  private recordHookTelemetry(record: Parameters<RuntimeState['recordHookRun']>[0]): void {
    const errors = record.executions.filter(execution => execution.outcome === 'error').length;
    void this.telemetryLogger.log({
      name: record.blocked ? 'hook.run.blocked' : errors > 0 ? 'hook.run.error' : 'hook.run.done',
      category: 'hook',
      durationMs: record.duration,
      success: !record.blocked && errors === 0,
      attributes: {
        event: record.event,
        matched: record.matched,
        blocked: record.blocked,
        errors,
        reason: record.reason,
        hookIds: record.executions.map(execution => execution.hookId),
        outcomes: record.executions.map(execution => execution.outcome),
      },
    }).then(() => {
      this.runtimeState.recordTelemetry(this.telemetryLogger.snapshot());
    });
  }

  private renderAgentEvent(event: AgentLoopEvent): void {
    const character = this.characterManager.getCurrentCharacter();
    const primary = chalk.hex(character.theme.primary);
    const secondary = chalk.hex(character.theme.secondary);
    const accent = chalk.hex(character.theme.accent);
    const success = chalk.hex(character.theme.success);
    const error = chalk.hex(character.theme.error);
    const dim = chalk.dim;
    const zh = this.getLanguage() === 'zh-CN';

    switch (event.type) {
      case 'mode_start':
        console.log(primary(`  ${event.label} - ${event.description}`));
        this.startStatusBar('thinking', zh ? '\u6b63\u5728\u51c6\u5907\u4e0a\u4e0b\u6587\u4e0e\u5de5\u5177...' : 'Preparing context and tools...');
        break;
      case 'model_request_start':
        this.startStatusBar(modelPhaseToStatus(event.phase), modelPhaseLabel(event.phase, event.iteration, zh));
        break;
      case 'planning':
        this.clearStatusBar();
        console.log(accent(`\n  ${zh ? zhText('plan') : 'Plan'}`));
        console.log(indentBlock(event.text));
        break;
      case 'text_delta':
        if (this.statusBar.isActive()) this.statusBar.onStreamChunk(event.text);
        this.clearStatusBar();
        process.stdout.write(event.text);
        break;
      case 'assistant_message':
        if (event.text.trim() && !event.text.endsWith('\n')) process.stdout.write('\n');
        break;
      case 'tool_call_start':
        this.clearStatusBar();
        this.toolActivityRenderer.beginToolCall(event.toolCall);
        this.startStatusBar('analyzing', `${zh ? '\u6a21\u578b\u8bf7\u6c42\u5de5\u5177' : 'Model requested tool'}: ${event.toolCall.name}`);
        break;
      case 'tool_call_delta': {
        this.toolActivityRenderer.appendToolCallDelta(event.id, event.argsDelta);
        const progress = this.toolActivityRenderer.getArgumentProgress(event.id);
        if (progress) this.updateStatusBar('analyzing', progress);
        break;
      }
      case 'tool_execution_start':
        this.clearStatusBar();
        this.toolActivityRenderer.markToolExecuting(event.toolCall);
        this.startStatusBar('tool');
        this.statusBar.onToolStart(event.toolCall.name, event.toolCall.arguments);
        break;
      case 'tool_progress': {
        const label = this.toolActivityRenderer.markToolProgress(event.toolCall, event.progress);
        this.updateStatusBar('tool', label);
        break;
      }
      case 'tool_result':
        this.clearStatusBar();
        this.toolActivityRenderer.markToolResult(event.toolCall, event.result);
        this.statusBar.onToolEnd();
        break;
      case 'verification':
        this.clearStatusBar();
        console.log(accent(`\n  ${zh ? zhText('verification') : 'Verification'}`));
        console.log(indentBlock(event.text));
        break;
      case 'tool_result_pairing_repaired': {
        this.clearStatusBar();
        const duplicate = event.report.removedDuplicateToolUses + event.report.removedDuplicateToolResults;
        const label = zh ? '\u5de5\u5177\u6d88\u606f\u914d\u5bf9\u5df2\u81ea\u52a8\u4fee\u590d' : 'Tool message pairing repaired';
        console.log(dim(`  ${label}: synthetic=${event.report.insertedSyntheticResults}, orphan=${event.report.removedOrphanResults}, duplicate=${duplicate}`));
        this.startStatusBar('analyzing', zh ? '\u5de5\u5177\u6d88\u606f\u914d\u5bf9\u5df2\u4fee\u590d' : 'Tool pairing repaired');
        break;
      }
      case 'context_compacted':
        this.clearStatusBar();
        console.log(dim(`  ${zh ? '\u4e0a\u4e0b\u6587\u5df2\u81ea\u52a8\u538b\u7f29' : 'Context compacted'}: ${event.beforeTokens.toLocaleString()} -> ${event.afterTokens.toLocaleString()} tokens (${event.layer})`));
        this.startStatusBar('analyzing', zh ? '\u4e0a\u4e0b\u6587\u81ea\u52a8\u538b\u7f29\u5b8c\u6210' : 'Context compacted');
        break;
      case 'token_budget_continue':
        console.log(dim(`  ${zh ? 'Token \u9884\u7b97\u7eed\u5199' : 'Token budget continue'} #${event.continuationCount}: ${event.pct}% (${event.turnTokens.toLocaleString()} / ${event.budget.toLocaleString()})`));
        break;
      case 'token_budget_done':
        console.log(dim(`  ${zh ? 'Token \u9884\u7b97\u7ed3\u675f' : 'Token budget done'}: ${event.pct}% (${event.turnTokens.toLocaleString()} / ${event.budget.toLocaleString()})`));
        break;
      case 'agent_start':
        this.clearStatusBar();
        console.log(secondary(`  ${event.name}: ${event.focus}`));
        this.startStatusBar('executing', `${event.name}: ${event.focus}`);
        break;
      case 'agent_done':
        console.log(success(`  ${event.name} ${zh ? zhText('done') : 'done'}`));
        console.log(indentBlock(event.text));
        break;
      case 'multi_agent_plan':
        console.log(accent(`\n  ${zh ? '\u591a Agent \u8ba1\u5212' : 'Multi-agent plan'} (${event.plan.source})`));
        for (const task of event.plan.tasks) {
          const deps = task.dependsOn.length > 0 ? ` <- ${task.dependsOn.join(', ')}` : '';
          console.log(dim(`  - ${task.id} [${task.role}] ${task.title}${deps}`));
        }
        break;
      case 'multi_agent_task_claimed':
        console.log(secondary(`  ${zh ? '\u8ba4\u9886' : 'claimed'} ${event.agentId}: ${event.task.title}`));
        break;
      case 'multi_agent_task_start':
        console.log(secondary(`  ${zh ? '\u542f\u52a8' : 'started'} ${event.agentId}: ${event.task.title}`));
        break;
      case 'multi_agent_task_done':
        console.log(success(`  ${event.result.agentId} ${zh ? zhText('done') : 'done'} - ${event.result.duration}ms`));
        break;
      case 'multi_agent_conflict':
        console.log(error(`  ${zh ? '\u591a Agent \u51b2\u7a81' : 'Multi-agent conflict'}: ${event.conflict.message}`));
        break;
      case 'multi_agent_merge':
        console.log(accent(`\n  ${zh ? '\u591a Agent \u6c47\u603b' : 'Multi-agent merge'}`));
        console.log(indentBlock(event.text));
        console.log(dim(`  ${zh ? '\u72b6\u6001\u76ee\u5f55' : 'State directory'}: ${event.result.stateDir}`));
        break;
      case 'multi_agent_done':
        break;
      case 'usage':
        this.statusBar.updateTokens(event.usage.inputTokens, event.usage.outputTokens);
        if (event.usage.cost !== undefined) this.statusBar.setCost(event.usage.cost);
        if (!process.stdin.isTTY || !this.statusBar.isActive()) console.log(dim(`  tokens input=${event.usage.inputTokens} output=${event.usage.outputTokens} total=${event.usage.totalTokens}`));
        break;
      case 'done':
        if (this.statusBar.isActive()) this.statusBar.end(event.usage.cost !== undefined ? `$${event.usage.cost.toFixed(4)}` : undefined);
        this.toolActivityRenderer.renderTurnSummary();
        break;
      case 'error': {
        const display = formatErrorForDisplay(event.error, this.getLanguage());
        if (this.statusBar.isActive()) this.statusBar.showError(event.error.message);
        console.log(error(`  Agent Loop ${zh ? zhText('failed') : 'failed'}: ${display}`));
        break;
      }
    }
  }
  private async recordSessionAgentEvent(event: AgentLoopEvent): Promise<void> {
    switch (event.type) {
      case 'mode_start':
        await this.sessionStore.append({ type: 'note', note: 'agent mode start', metadata: { mode: event.mode, label: event.label } });
        break;
      case 'model_request_start':
        await this.sessionStore.append({ type: 'note', note: 'model request start', metadata: { phase: event.phase, iteration: event.iteration } });
        break;
      case 'tool_execution_start':
        await this.sessionStore.append({ type: 'note', note: 'tool execution start', metadata: { tool: event.toolCall.name, args: sanitizeSessionMetadata(event.toolCall.arguments) } });
        break;
      case 'tool_progress':
        await this.sessionStore.append({ type: 'note', note: 'tool progress', metadata: { tool: event.toolCall.name, progress: sanitizeSessionMetadata(event.progress as unknown as Record<string, unknown>) } });
        break;
      case 'tool_result':
        await this.sessionStore.append({
          type: 'note',
          note: 'tool execution result',
          metadata: {
            tool: event.toolCall.name,
            success: event.result.success,
            duration: event.result.duration,
            error: event.result.error,
          },
        });
        break;
      case 'tool_result_pairing_repaired':
        await this.sessionStore.append({ type: 'note', note: 'tool result pairing repaired', metadata: { ...event.report } });
        break;
      case 'context_compacted':
        await this.sessionStore.append({ type: 'note', note: 'context compacted', metadata: { layer: event.layer, beforeTokens: event.beforeTokens, afterTokens: event.afterTokens } });
        break;
      case 'token_budget_continue':
        await this.sessionStore.append({ type: 'note', note: 'token budget continue', metadata: { continuationCount: event.continuationCount, pct: event.pct, turnTokens: event.turnTokens, budget: event.budget } });
        break;
      case 'token_budget_done':
        await this.sessionStore.append({ type: 'note', note: 'token budget done', metadata: { continuationCount: event.continuationCount, pct: event.pct, turnTokens: event.turnTokens, budget: event.budget, diminishingReturns: event.diminishingReturns, durationMs: event.durationMs } });
        break;
      case 'usage':
        await this.sessionStore.append({ type: 'note', note: 'model usage', metadata: { usage: event.usage } });
        break;
      case 'error':
        await this.sessionStore.append({ type: 'note', note: 'agent error', metadata: { message: event.error.message, descriptor: getRoxyErrorDescriptor(event.error) } });
        break;
    }
  }
  private async extractAutoMemories(messages: Message[]): Promise<void> {
    const enabled = this.configManager.get('memory.auto') !== false;
    if (!enabled) return;
    const extractor = new AutoMemoryExtractor({
      llmProvider: this.llmProvider,
      language: this.getLanguage(),
      characterId: this.characterManager.getCurrentCharacter().id,
      sessionId: this.sessionStore.sessionId,
      intervalTurns: 10,
    });
    const candidates = await extractor.extract(messages);
    for (const candidate of candidates.slice(0, 5)) {
      try {
        await this.memoryStore.add(candidate);
      } catch (error) {
        if (error instanceof MemoryPolicyError) continue;
        throw error;
      }
    }
  }
  private async initializeSession(): Promise<void> {
    await this.sessionStore.init({
      provider: this.llmProvider.id,
      model: this.configManager.get('llm.model'),
      character: this.characterManager.getCurrentCharacter().id,
      language: this.getLanguage(),
    });
    this.runtimeState.switchSession({
      sessionId: this.sessionStore.sessionId,
      transcriptPath: this.sessionStore.path,
      messageCount: this.agentMessages.length,
      turns: this.conversationTurns,
    });
    this.telemetryLogger.setSession(this.sessionStore.sessionId);
    this.runtimeState.recordTelemetry(this.telemetryLogger.snapshot());
  }

  private async resumeSession(query?: string): Promise<void> {
    const found = await this.sessionStore.find(query);
    const zh = this.getLanguage() === 'zh-CN';
    if (!found) {
      console.log(chalk.yellow(`  ${zh ? zhText('noSession') : 'No resumable session found.'}`));
      return;
    }

    this.sessionStore = new SessionStore(process.cwd(), found.sessionId);
    this.agentMessages = (await this.sessionStore.readMessages()).filter(message => message.role !== 'system');
    this.conversationTurns = this.agentMessages.filter(message => message.role === 'user').length;
    this.agentLoop = this.createAgentLoop();
    this.runtimeState.switchSession({
      sessionId: this.sessionStore.sessionId,
      transcriptPath: this.sessionStore.path,
      messageCount: this.agentMessages.length,
      turns: this.conversationTurns,
    });
    this.telemetryLogger.setSession(this.sessionStore.sessionId);
    this.runtimeState.recordTelemetry(this.telemetryLogger.snapshot());

    console.log(chalk.green(`  ${zh ? zhText('sessionResumed') : 'Session resumed'}: ${found.sessionId}`));
    console.log(chalk.dim(`  ${found.path}`));
    console.log(chalk.dim(`  ${zh ? zhText('messages') : 'Messages'}: ${this.agentMessages.length}`));
  }

  private async exportSession(target?: string, format: 'text' | 'jsonl' = 'text'): Promise<void> {
    const zh = this.getLanguage() === 'zh-CN';
    const content = await this.sessionStore.export({ format });
    const extension = format === 'jsonl' ? 'jsonl' : 'txt';
    const outputPath = resolve(process.cwd(), target || `.roxycode/exports/session-${this.sessionStore.sessionId}.${extension}`);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, 'utf8');
    this.runtimeState.updateSession({ messageCount: this.agentMessages.length, turns: this.conversationTurns });
    console.log(chalk.green(`  ${zh ? zhText('sessionExported') : 'Session exported'}: ${outputPath}`));
  }

  private async rewindSession(count?: number): Promise<void> {
    const zh = this.getLanguage() === 'zh-CN';
    const targetCount = count ?? Math.max(0, this.agentMessages.length - 2);
    const result = await this.sessionStore.rewind(targetCount);
    this.agentMessages = result.messages.filter(message => message.role !== 'system');
    this.conversationTurns = this.agentMessages.filter(message => message.role === 'user').length;
    this.agentLoop = this.createAgentLoop();
    this.runtimeState.updateSession({ messageCount: this.agentMessages.length, turns: this.conversationTurns });
    console.log(chalk.green(`  ${zh ? zhText('sessionRewound') : 'Session rewound'}: ${this.agentMessages.length} ${zh ? zhText('messagesLower') : 'messages'}`));
    console.log(chalk.dim(`  ${zh ? zhText('removed') : 'Removed'}: ${result.removed}`));
  }

  private async compactSession(): Promise<void> {
    const zh = this.getLanguage() === 'zh-CN';
    const before = await this.contextManager.getStatus(this.agentMessages);
    const result = await this.contextManager.compress(this.agentMessages);
    if (!result) {
      console.log(chalk.yellow(`  ${zh ? zhText('compactNotNeeded') : 'Current context does not need compaction.'}`));
      return;
    }

    this.agentMessages = result.messages.filter(message => message.role !== 'system');
    this.runtimeState.recordAgentEvent({ type: 'context_compacted' });
    this.runtimeState.updateSession({ messageCount: this.agentMessages.length, turns: this.conversationTurns });
    await this.sessionStore.append({
      type: 'compact',
      summary: result.summary,
      metadata: {
        layerUsed: result.layerUsed,
        beforeTokens: before.currentTokens,
        afterTokens: result.compressedTokens,
        removedCount: result.removedCount,
      },
    });

    console.log(chalk.green(`  ${zh ? zhText('contextCompacted') : 'Context compacted'}: ${result.layerUsed}`));
    console.log(chalk.dim(`  ${before.currentTokens.toLocaleString()} -> ${result.compressedTokens.toLocaleString()} tokens`));
  }

  private async confirmToolPrompt(prompt: ToolPermissionPrompt, second: boolean): Promise<boolean> {
    const character = this.characterManager.getCurrentCharacter();
    const language = this.getLanguage();
    if (!process.stdin.isTTY) {
      const warning = language === 'en-US'
        ? 'Permission confirmation requires an interactive terminal. Denied by default.'
        : zhText('permissionNonInteractiveDenied');
      console.log(chalk.hex(character.theme.error)(`  ${warning}`));
      return false;
    }

    const readerWasActive = this.reader?.isActive === true;
    this.clearStatusBar();
    this.toolActivityRenderer.updateCharacter(character);
    this.toolActivityRenderer.setLanguage(language);
    this.toolActivityRenderer.markPermissionWaiting(prompt, second);
    this.startStatusBar('waiting', language === 'en-US' ? 'Waiting for permission confirmation...' : '\u7b49\u5f85\u4f60\u786e\u8ba4\u5de5\u5177\u6743\u9650...');
    if (readerWasActive) this.reader?.pause();
    try {
      return await requestPermissionConfirmation({ prompt, second, character, language });
    } finally {
      this.clearStatusBar();
      if (readerWasActive && !this.shutdownRequested) this.reader?.resume({ redraw: false });
    }
  }

  private onInputChange(buffer: string): void {
    if (!buffer.startsWith('/')) {
      this.closePalette();
      return;
    }
    this.paletteActive = true;
    const query = this.palette.isSubLevel ? buffer.trimStart().split(/\s+/).at(-1) ?? '' : buffer.slice(1);
    this.palette.filter(query);
    this.renderPalette();
  }

  private onKeyEvent(event: KeyEvent): void {
    switch (event.type) {
      case 'up':
        if (this.paletteActive && this.palette.visible) { this.palette.moveUp(); this.renderPalette(); }
        break;
      case 'down':
        if (this.paletteActive && this.palette.visible) { this.palette.moveDown(); this.renderPalette(); }
        break;
      case 'escape':
        if (this.paletteActive) {
          if (this.palette.isSubLevel) this.popMenuLevel();
          else { this.closePalette(); this.reader?.clearLine(); }
        }
        break;
      case 'tab':
        if (this.paletteActive && this.palette.visible) this.selectPaletteItem();
        else this.handleTabComplete();
        break;
    }
  }

  private selectPaletteItem(options: PaletteSelectionOptions = {}): void {
    const selected = this.palette.selected;
    if (!selected) return;
    if (selected.hasChildren) { this.enterSubMenu(selected, options); return; }
    if (selected.needsInput) {
      const commandText = `${this.buildCommandPath(selected.name)} `;
      this.closePalette();
      this.reader?.setLine(commandText, { emitChange: false });
      return;
    }
    this.submitPaletteCommand(this.buildCommandPath(selected.name), options);
  }

  private enterSubMenu(selected: PaletteItem, options: PaletteSelectionOptions = {}): void {
    let subItems: PaletteItem[];
    let levelLabel: string;
    if (selected.name === 'help' && !this.palette.isSubLevel) {
      subItems = this.getHelpPaletteItems();
      levelLabel = 'help';
    } else if (selected.name === 'compress' && this.palette.isSubLevel) {
      subItems = this.getCompressSubItems();
      levelLabel = 'compress';
    } else {
      const cmd = this.commandRegistry.get(selected.name);
      if (!cmd?.subcommands?.length) {
        this.submitPaletteCommand(this.buildCommandPath(selected.name), options);
        return;
      }
      subItems = this.toSubPaletteItems(cmd.subcommands);
      levelLabel = selected.name;
    }

    const currentLine = (this.reader?.line ?? '').trimEnd();
    const bufferText = this.palette.isSubLevel ? `${currentLine} ${selected.name} ` : `/${selected.name} `;
    this.palette.pushLevel(levelLabel, subItems, bufferText);
    this.reader?.setLine(bufferText, { emitChange: false });
    this.renderPalette();
  }

  private popMenuLevel(): void {
    const parentBuffer = this.palette.popLevel();
    if (parentBuffer === null) {
      this.closePalette();
      this.reader?.setLine('/');
      return;
    }
    this.reader?.setLine(parentBuffer);
    this.palette.filter(parentBuffer.trimStart().split(/\s+/).at(-1) ?? '');
    this.renderPalette();
  }

  private buildCommandPath(leafName: string): string {
    if (!this.palette.isSubLevel) return `/${leafName}`;
    const parts = [this.palette.breadcrumbs[0], ...this.palette.breadcrumbs.slice(1), leafName].filter(Boolean);
    return `/${parts.join(' ')}`;
  }

  private submitPaletteCommand(commandText: string, options: PaletteSelectionOptions = {}): void {
    this.closePalette();
    this.reader?.setLine(commandText, { emitChange: false });
    this.reader?.clearCurrentLine();
    if (!options.lineAlreadySubmitted) process.stdout.write('\n');
    void this.onLineSubmit(commandText, { fromPalette: true }).catch(err => this.handleLineSubmitError(commandText, err));
  }

  private renderPalette(): void {
    if (!this.reader) return;
    const theme = this.characterManager.getCurrentCharacter().theme;
    this.reader.clearCurrentLine();
    this.palette.render({ primary: theme.primary, secondary: theme.secondary, accent: theme.accent, dim: theme.dim });
    this.reader.redraw();
  }

  private closePalette(): void {
    if (!this.paletteActive) return;
    this.paletteActive = false;
    if (this.palette.isRendered) {
      this.reader?.clearCurrentLine();
      this.palette.clear();
      this.reader?.redraw();
    } else {
      this.palette.clear();
    }
    this.palette.reset();
  }

  private handleTabComplete(): void {
    if (!this.reader) return;
    const line = this.reader.line;
    if (!line.startsWith('/')) return;
    const names = this.commandRegistry.list().flatMap(cmd => [`/${cmd.name}`, ...(cmd.aliases ?? []).map(alias => `/${alias}`)]);
    const hits = names.filter(name => name.startsWith(line));
    if (hits.length === 1) this.reader.setLine(hits[0]);
    else if (hits.length > 1) { this.paletteActive = true; this.palette.filter(line.slice(1)); this.renderPalette(); }
  }

  private showPrompt(): void {
    console.log();
    this.renderPromptStatus();
    this.reader?.prompt_();
  }

  private getPromptString(character: Character): string {
    return chalk.hex(character.theme.primary)('  > ');
  }

  private renderPromptStatus(): void {
    const character = this.characterManager.getCurrentCharacter();
    const model = (this.configManager.get('llm.model') as string) || 'auto';
    const { value: contextWindow } = this.contextManager.getEffectiveMaxTokens();
    this.interactionRenderer.updateCharacter(character);
    this.interactionRenderer.renderPromptStatus({
      character,
      language: this.getLanguage(),
      providerName: this.llmProvider.name,
      providerId: this.llmProvider.id,
      model,
      mode: ((this.configManager.get('mode') as string) || 'auto').toLowerCase(),
      contextWindow,
      turns: this.conversationTurns,
      commandCount: this.commandRegistry.list().length,
      historyCount: this.inputHistory.getHistory().length,
      elapsedMs: Date.now() - this.sessionStartTime,
      cwd: process.cwd(),
    });
  }

  private showHelp(): void {
    const character = this.characterManager.getCurrentCharacter();
    const text = this.getText();
    const meta = getCategoryMeta(text.categories as Partial<Record<CommandCategory, string>>);
    const grouped = this.commandRegistry.listByCategory();
    const border = chalk.hex(character.theme.primary);
    const accent = chalk.hex(character.theme.accent);
    console.log('');
    console.log(border(`  +-- RoxyCode v${APP_VERSION} ${text.help.header} --+`));
    for (const [category, commands] of grouped) {
      const categoryMeta = meta[category];
      console.log(accent(`  ${categoryMeta.icon} ${categoryMeta.label}`));
      for (const cmd of commands) console.log(`    /${cmd.name.padEnd(14)} ${cmd.description}`);
    }
    console.log('');
  }

  private showCommandHelp(cmdName: string): void {
    const name = cmdName.startsWith('/') ? cmdName.slice(1) : cmdName;
    const cmd = this.commandRegistry.get(name);
    const text = this.getText();
    if (!cmd) {
      console.log(chalk.red(`  ${text.help.notFound}: /${name}`));
      return;
    }
    console.log(chalk.bold(`\n  /${cmd.name}`));
    console.log(`  ${text.help.descriptionLabel}: ${cmd.description}`);
    if (cmd.usage) console.log(`  ${text.help.usageLabel}: ${cmd.usage}`);
    if (cmd.examples?.length) console.log(cmd.examples.map(example => `  $ ${example}`).join('\n'));
    console.log('');
  }

  private showHistory(): void {
    const history = this.inputHistory.getHistory().slice(-20);
    const text = this.getText();
    console.log(chalk.bold(`\n  ${text.history.title}`));
    if (history.length === 0) console.log(chalk.dim(`  ${text.history.empty}`));
    history.forEach((item, index) => console.log(`  ${String(index + 1).padStart(2)} ${item}`));
    console.log('');
  }

  private requestShutdown(exitCode = 0): void {
    if (this.shutdownRequested) { process.exitCode = exitCode; return; }
    this.shutdownRequested = true;
    this.palette.clear();
    this.commandWatcher?.stop();
    this.reader?.pause();
    process.exitCode = exitCode;
  }

  private handleLineSubmitError(line: string, error: unknown): void {
    this.processing = false;
    this.closePalette();
    const err = toError(error);
    const message = formatErrorForDisplay(err, this.getLanguage());
    this.runtimeState.recordError('repl', err.message, { line: line.trim(), descriptor: getRoxyErrorDescriptor(err) });
    console.log(chalk.hex(this.characterManager.getCurrentCharacter().theme.error)(`  ERR ${line.trim()}: ${message}`));
    if (!this.shutdownRequested && this.reader?.isActive) this.showPrompt();
  }
}

type ModelRequestPhase = 'planning' | 'response' | 'tool_loop' | 'verification';

function addQueryProfileTelemetryAttributes(attributes: Record<string, unknown>, profile: QueryProfileSummary): void {
  attributes.queryProfileId = profile.id;
  attributes.queryTotalMs = profile.totalMs;
  attributes.queryFirstTokenMs = profile.firstTokenMs;
  attributes.queryModelRequestCount = profile.modelRequestCount;
  attributes.queryToolExecutionCount = profile.toolExecutionCount;
  attributes.queryContextCompactionCount = profile.contextCompactionCount;
  attributes.querySlowestPhase = profile.slowestPhase?.name;
  attributes.querySlowestPhaseMs = profile.slowestPhase?.durationMs;
}
function modelPhaseToStatus(phase: ModelRequestPhase): StatusState {
  switch (phase) {
    case 'planning': return 'planning';
    case 'verification': return 'analyzing';
    case 'tool_loop': return 'thinking';
    case 'response':
    default: return 'thinking';
  }
}

function modelPhaseLabel(phase: ModelRequestPhase, iteration: number | undefined, zh: boolean): string {
  const suffix = iteration ? ` #${iteration}` : '';
  if (!zh) {
    switch (phase) {
      case 'planning': return `Planning with model${suffix}`;
      case 'verification': return `Verifying result${suffix}`;
      case 'tool_loop': return `Thinking with tools${suffix}`;
      case 'response': return `Thinking${suffix}`;
    }
  }
  switch (phase) {
    case 'planning': return `\u6b63\u5728\u751f\u6210\u8ba1\u5212${suffix}`;
    case 'verification': return `\u6b63\u5728\u9a8c\u8bc1\u7ed3\u679c${suffix}`;
    case 'tool_loop': return `\u6b63\u5728\u601d\u8003\u662f\u5426\u8c03\u7528\u5de5\u5177${suffix}`;
    case 'response': return `\u6b63\u5728\u751f\u6210\u56de\u590d${suffix}`;
  }
}
function sanitizeSessionMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower.includes('key') || lower.includes('token') || lower.includes('secret') || lower.includes('password')) {
      out[key] = '[redacted]';
    } else if (typeof item === 'string' && item.length > 300) {
      out[key] = `${item.slice(0, 300)}... [${item.length} chars]`;
    } else {
      out[key] = item;
    }
  }
  return out;
}


function indentBlock(text: string): string {
  return text.split('\n').map(line => `  ${line}`).join('\n');
}

type ZhKey =
  | 'characterInfo'
  | 'characterRandom'
  | 'compressOn'
  | 'compressOff'
  | 'plan'
  | 'tool'
  | 'toolResult'
  | 'verification'
  | 'done'
  | 'failed'
  | 'noSession'
  | 'sessionResumed'
  | 'messages'
  | 'messagesLower'
  | 'sessionExported'
  | 'sessionRewound'
  | 'removed'
  | 'compactNotNeeded'
  | 'contextCompacted'
  | 'permissionNonInteractiveDenied';

const ZH: Record<ZhKey, string> = {
  characterInfo: '\u663e\u793a\u5f53\u524d\u89d2\u8272\u8be6\u7ec6\u4fe1\u606f',
  characterRandom: '\u968f\u673a\u5207\u6362\u4e00\u4e2a\u89d2\u8272',
  compressOn: '\u542f\u7528\u81ea\u52a8\u4e0a\u4e0b\u6587\u538b\u7f29',
  compressOff: '\u5173\u95ed\u81ea\u52a8\u4e0a\u4e0b\u6587\u538b\u7f29',
  plan: '\u8ba1\u5212',
  tool: '\u5de5\u5177',
  toolResult: '\u5de5\u5177\u7ed3\u679c',
  verification: '\u9a8c\u8bc1',
  done: '\u5b8c\u6210',
  failed: '\u5931\u8d25',
  noSession: '\u6ca1\u6709\u627e\u5230\u53ef\u6062\u590d\u7684\u4f1a\u8bdd\u3002',
  sessionResumed: '\u4f1a\u8bdd\u5df2\u6062\u590d',
  messages: '\u6d88\u606f',
  messagesLower: '\u6761\u6d88\u606f',
  sessionExported: '\u4f1a\u8bdd\u5df2\u5bfc\u51fa',
  sessionRewound: '\u4f1a\u8bdd\u5df2\u56de\u9000',
  removed: '\u5df2\u79fb\u9664',
  compactNotNeeded: '\u5f53\u524d\u4e0a\u4e0b\u6587\u8fd8\u4e0d\u9700\u8981\u538b\u7f29\u3002',
  contextCompacted: '\u4e0a\u4e0b\u6587\u5df2\u538b\u7f29',
  permissionNonInteractiveDenied: '\u6743\u9650\u786e\u8ba4\u9700\u8981\u4ea4\u4e92\u5f0f\u7ec8\u7aef\uff0c\u5df2\u9ed8\u8ba4\u62d2\u7edd\u8be5\u64cd\u4f5c\u3002',
};

function zhText(key: ZhKey): string {
  return ZH[key];
}





