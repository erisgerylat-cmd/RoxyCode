import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { CharacterManager } from '../src/aesthetic/character/CharacterManager.js';
import { CommandRegistry, type CommandDefinition } from '../src/commands/CommandRegistry.js';
import { CommandLoader } from '../src/commands/CommandLoader.js';
import { CommandWatcher } from '../src/commands/CommandWatcher.js';
import { PluginCommandSource, SkillCommandSource, WorkflowCommandSource } from '../src/commands/sources/index.js';
import type { DynamicCommandSource } from '../src/commands/sources/index.js';
import type { ConfigManager } from '../src/core/ConfigManager.js';
import { DEFAULT_CONFIG, type RoxyCodeConfig } from '../src/core/types/config.js';
import { collectPluginContributions, PluginLoader } from '../src/plugin/index.js';

function createConfig(): RoxyCodeConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.plugins.enabled = true;
  config.plugins.directories = ['.roxycode/plugins'];
  config.workflows.builtin = false;
  config.workflows.directories = ['.roxycode/workflows'];
  config.ui.language = 'zh-CN';
  return config;
}

function createConfigManager(config: RoxyCodeConfig): ConfigManager {
  return {
    get(path: string): unknown {
      return path.split('.').filter(Boolean).reduce((obj: unknown, key) => {
        return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
      }, config);
    },
    snapshot(): RoxyCodeConfig {
      return structuredClone(config);
    },
  } as unknown as ConfigManager;
}

function createCharacterManager(): CharacterManager {
  return {
    getCurrentCharacter() {
      return { name: 'Roxy' };
    },
  } as unknown as CharacterManager;
}

async function writeFixtures(cwd: string): Promise<void> {
  await mkdir(join(cwd, '.roxycode', 'workflows'), { recursive: true });
  await mkdir(join(cwd, '.roxycode', 'plugins', 'demo'), { recursive: true });
  await mkdir(join(cwd, '.roxycode', 'plugins', 'disabled'), { recursive: true });
  await mkdir(join(cwd, '.roxycode', 'skills', 'review'), { recursive: true });

  await writeFile(join(cwd, '.roxycode', 'workflows', 'custom-page.yml'), [
    'id: custom-page',
    'name: Custom Page',
    'description: Build a custom Vue page',
    'mode: standard',
    'category: frontend',
    'tags: [vue, page]',
    'aliases: [page]',
    'inputs:',
    '  - name: module',
    '    label: Module',
    '    required: true',
    'prompt: |',
    '  Build a Vue page for the requested module.',
    'steps:',
    '  - Inspect existing pages',
    '  - Implement the page',
    'allowedTools:',
    '  - read_file',
    '  - grep_search',
    'verify:',
    '  - Run the project verification command',
  ].join('\n'), 'utf8');

  await writeFile(join(cwd, '.roxycode', 'plugins', 'demo', 'plugin.json'), JSON.stringify({
    id: 'demo',
    name: 'Demo Plugin',
    commands: [{ name: 'hello', description: 'Say hello through the agent', prompt: 'Plugin hello prompt' }],
    hooks: [{ id: 'audit', event: 'agent_done', kind: 'agent', prompt: 'plugin hook' }],
    mcpServers: { local: { type: 'stdio', command: 'node', args: ['mcp.js'], env: { ROXY_PLUGIN_ROOT: 'spoofed' } } },
    sandbox: { allowedPaths: ['assets'], allowNetworkAccess: true, allowedHosts: ['api.example.com'] },
  }, null, 2), 'utf8');

  await writeFile(join(cwd, '.roxycode', 'plugins', 'disabled', 'plugin.json'), JSON.stringify({
    id: 'disabled',
    name: 'Disabled Plugin',
    enabled: false,
    commands: [{ name: 'hidden', description: 'Should not load', prompt: 'Do not run' }],
  }, null, 2), 'utf8');

  await writeFile(join(cwd, '.roxycode', 'skills', 'review', 'SKILL.md'), [
    '# Code Review Skill',
    '',
    'Review code with a focus on correctness and testing.',
  ].join('\n'), 'utf8');
}

test('command loader aggregates workflow, plugin, and skill command sources', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-command-loader-'));
  try {
    await writeFixtures(cwd);
    const config = createConfig();
    const calls: string[] = [];

    const result = await new CommandLoader([
      new WorkflowCommandSource({ cwd, configManager: createConfigManager(config), characterManager: createCharacterManager(), sessionId: 'session-test' }),
      new PluginCommandSource({ cwd, config }),
      new SkillCommandSource({ cwd }),
    ]).load({ runAgentPrompt: async prompt => { calls.push(prompt); } });

    assert.deepEqual(result.errors, []);
    const commands = new Map(result.commands.map(command => [command.name, command]));
    assert.ok(commands.has('wf:custom-page'));
    assert.ok(commands.has('demo:hello'));
    assert.ok(commands.has('skill:review'));
    assert.equal(commands.has('disabled:hidden'), false);

    await commands.get('wf:custom-page')!.handler(['--module', 'orders'], {});
    await commands.get('demo:hello')!.handler([], {});
    await commands.get('skill:review')!.handler(['check', 'diff'], {});

    assert.equal(calls.length, 3);
    assert.match(calls[0], /Build a Vue page/);
    assert.match(calls[0], /orders/);
    assert.match(calls[1], /Plugin hello prompt/);
    assert.match(calls[2], /Code Review Skill/);
    assert.match(calls[2], /check diff/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('plugin contributions carry sandbox metadata across commands hooks and mcp servers', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-plugin-contributions-'));
  try {
    await writeFixtures(cwd);
    const config = createConfig();
    const loaded = await new PluginLoader({ cwd, config }).load();
    const contributions = collectPluginContributions(loaded.enabled);
    const pluginRoot = join(cwd, '.roxycode', 'plugins', 'demo');

    assert.equal(loaded.errors.length, 0);
    assert.equal(contributions.commands[0].pluginId, 'demo');
    assert.equal(contributions.commands[0].pluginRoot, pluginRoot);
    assert.equal(contributions.commands[0].pluginSandbox?.pluginRoot, pluginRoot);
    assert.ok(contributions.commands[0].pluginSandbox?.allowedPaths.includes(join(pluginRoot, 'assets')));

    assert.equal(contributions.hooks[0].pluginId, 'demo');
    assert.equal(contributions.hooks[0].pluginRoot, pluginRoot);
    assert.equal(contributions.hooks[0].pluginSandbox?.allowedHosts[0], 'api.example.com');

    const server = contributions.mcpServers.plugin_demo_local;
    assert.equal(server.pluginId, 'demo');
    assert.equal(server.pluginRoot, pluginRoot);
    assert.equal(server.pluginSandbox?.allowNetworkAccess, true);
    assert.equal(server.env?.ROXY_PLUGIN_ROOT, pluginRoot);
    assert.equal(server.env?.ROXY_PLUGIN_ID, 'demo');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('command loader reports duplicate dynamic commands without dropping earlier commands', async () => {
  const first: CommandDefinition = {
    name: 'skill:review',
    description: 'first',
    handler: () => undefined,
  };
  const second: CommandDefinition = {
    name: 'skill:review',
    description: 'second',
    handler: () => undefined,
  };
  const sources: DynamicCommandSource[] = [
    { name: 'first-source', discover: async () => ({ commands: [first], errors: [] }) },
    { name: 'second-source', discover: async () => ({ commands: [second], errors: [] }) },
  ];

  const result = await new CommandLoader(sources).load();

  assert.equal(result.commands.length, 1);
  assert.equal(result.commands[0].description, 'first');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].source, 'second-source');
  assert.match(result.errors[0].message, /conflicts/);
});

test('command loader rejects dynamic commands that conflict with reserved builtin names', async () => {
  const dynamic: CommandDefinition = {
    name: 'help',
    description: 'conflicting dynamic command',
    source: 'workflow',
    handler: () => undefined,
  };
  const result = await new CommandLoader([
    { name: 'workflow', discover: async () => ({ commands: [dynamic], errors: [] }) },
  ]).load({ reservedNames: ['help', 'h'] });

  assert.equal(result.commands.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /reserved/);
});

test('command registry can replace and unregister dynamic command sources without touching builtins', () => {
  const registry = new CommandRegistry();
  registry.register({ name: 'help', description: 'builtin help', source: 'builtin', handler: () => undefined });
  registry.register({ name: 'wf:old', description: 'old workflow', source: 'workflow', aliases: ['wf:o'], handler: () => undefined });

  const result = registry.replaceBySource('workflow', [
    { name: 'wf:new', description: 'new workflow', source: 'workflow', aliases: ['wf:n'], handler: () => undefined },
  ]);

  assert.deepEqual(result, { removed: 1, registered: 1 });
  assert.equal(registry.has('help'), true);
  assert.equal(registry.has('wf:old'), false);
  assert.equal(registry.has('wf:o'), false);
  assert.equal(registry.has('wf:new'), true);
  assert.equal(registry.has('wf:n'), true);

  assert.throws(() => registry.replaceBySource('workflow', [
    { name: 'help', description: 'bad workflow', source: 'workflow', handler: () => undefined },
  ]), /already registered/);
  assert.equal(registry.has('help'), true);
  assert.equal(registry.has('wf:new'), true);
});

test('command watcher reloads dynamic workflow commands after a debounced trigger', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-command-watcher-'));
  let watcher: CommandWatcher | null = null;
  try {
    await writeFixtures(cwd);
    const config = createConfig();
    const registry = new CommandRegistry();
    registry.register({ name: 'help', description: 'builtin help', source: 'builtin', handler: () => undefined });

    const loader = new CommandLoader([
      new WorkflowCommandSource({ cwd, configManager: createConfigManager(config), characterManager: createCharacterManager(), sessionId: 'session-test' }),
      new PluginCommandSource({ cwd, config }),
      new SkillCommandSource({ cwd }),
    ]);
    const initial = await loader.load({ reservedNames: ['help'] });
    registry.registerMany(initial.commands);
    assert.equal(registry.has('wf:custom-page'), true);

    const reloaded: string[][] = [];
    watcher = new CommandWatcher({
      cwd,
      loader,
      debounceMs: 10,
      paths: [join(cwd, '.roxycode', 'workflows')],
      context: { reservedNames: ['help'] },
      onReload: result => {
        registry.replaceBySource(['workflow', 'plugin', 'skill'], result.commands);
        reloaded.push(result.commands.map(command => command.name));
      },
    });
    const watched = await watcher.start();
    assert.equal(watched.length, 1);

    await writeFile(join(cwd, '.roxycode', 'workflows', 'custom-card.yml'), [
      'id: custom-card',
      'name: Custom Card',
      'description: Build a custom card',
      'mode: standard',
      'category: frontend',
      'prompt: |',
      '  Build a card component.',
    ].join('\n'), 'utf8');
    watcher.trigger(join(cwd, '.roxycode', 'workflows', 'custom-card.yml'));

    await waitFor(() => registry.has('wf:custom-card'));
    assert.equal(registry.has('help'), true);
    assert.ok(reloaded.some(commands => commands.includes('wf:custom-card')));
  } finally {
    watcher?.stop();
    await rm(cwd, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(predicate(), true);
}
