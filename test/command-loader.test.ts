import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { CharacterManager } from '../src/aesthetic/character/CharacterManager.js';
import type { CommandDefinition } from '../src/commands/CommandRegistry.js';
import { CommandLoader } from '../src/commands/CommandLoader.js';
import { PluginCommandSource, SkillCommandSource, WorkflowCommandSource } from '../src/commands/sources/index.js';
import type { DynamicCommandSource } from '../src/commands/sources/index.js';
import type { ConfigManager } from '../src/core/ConfigManager.js';
import { DEFAULT_CONFIG, type RoxyCodeConfig } from '../src/core/types/config.js';

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