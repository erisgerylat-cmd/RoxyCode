import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CharacterManager } from '../src/aesthetic/character/CharacterManager.js';
import { handleCharacterCommand } from '../src/commands/builtin/character.js';
import { ConfigManager } from '../src/core/ConfigManager.js';
import { writeCharacterPackageFixture } from './helpers/character-package-fixture.js';

test('character package command lists package installs but ignores legacy single-file characters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-command-package-list-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(root);
    await mkdir(join(root, '.roxycode', 'characters'), { recursive: true });
    await writeFile(join(root, '.roxycode', 'characters', 'legacy.json'), JSON.stringify({
      id: 'legacy-sensei',
      name: 'Legacy Sensei',
    }), 'utf8');

    const source = join(root, 'source', 'roxy-sensei');
    await writeCharacterPackageFixture(source);
    const characterManager = new CharacterManager(new ConfigManager(root, root), root);
    await characterManager.loadCustomCharacters();

    let output = await captureConsole(() => handleCharacterCommand(['install', source], characterManager));
    assert.match(output, /roxy-sensei/);

    output = await captureConsole(() => handleCharacterCommand(['packages', '--project'], characterManager));
    assert.match(output, /roxy-sensei/);
    assert.match(output, /project/);
    assert.doesNotMatch(output, /legacy-sensei/);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test('character package command reports incompatible engines without installing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-command-package-engines-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(root);
    const source = join(root, 'source', 'roxy-sensei');
    await writeCharacterPackageFixture(source, {
      manifestPatch: { engines: { roxycode: '>=999.0.0' } },
    });
    const characterManager = new CharacterManager(new ConfigManager(root, root), root);
    await characterManager.loadCustomCharacters();

    const output = await captureConsole(() => handleCharacterCommand(['install', source], characterManager));
    assert.match(output, /requires RoxyCode >=999\.0\.0/i);
    assert.match(output, /--force/);
    assert.equal(existsSync(join(root, '.roxycode', 'characters', 'roxy-sensei')), false);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test('character package command surfaces validate errors and update install guidance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-command-package-errors-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(root);
    const source = join(root, 'source', 'roxy-sensei');
    await writeCharacterPackageFixture(source, {
      characterPatch: {
        extensions: { hooks: 'behaviors/hooks.json' },
      },
    });
    const characterManager = new CharacterManager(new ConfigManager(root, root), root);
    await characterManager.loadCustomCharacters();

    let output = await captureConsole(() => handleCharacterCommand(['validate', source], characterManager));
    assert.match(output, /error behaviors\/hooks\.json/);
    assert.match(output, /Referenced file does not exist/);

    await writeCharacterPackageFixture(source, { version: '1.1.0' });
    output = await captureConsole(() => handleCharacterCommand(['update', source], characterManager));
    assert.match(output, /not installed/i);
    assert.match(output, /\/character install <path>/);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return lines.join('\n');
}
