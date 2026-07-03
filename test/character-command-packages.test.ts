import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { handleCharacterCommand } from '../src/commands/builtin/character.js';
import { ConfigManager } from '../src/core/ConfigManager.js';
import { CharacterManager } from '../src/aesthetic/character/CharacterManager.js';
import { writeCharacterPackageFixture } from './helpers/character-package-fixture.js';

test('character command installs, lists, updates, validates, and uninstalls packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-command-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(root);
    const source = join(root, 'source', 'roxy-sensei');
    await writeCharacterPackageFixture(source, { version: '1.0.0', title: 'Teacher v1' });
    const characterManager = new CharacterManager(new ConfigManager(root), root);
    await characterManager.loadCustomCharacters();

    let output = await captureConsole(() => handleCharacterCommand(['packages'], characterManager));
    assert.match(output, /暂无已安装角色包|No installed/i);

    output = await captureConsole(() => handleCharacterCommand(['validate', source], characterManager));
    assert.match(output, /验证通过/);
    assert.match(output, /roxy-sensei/);

    output = await captureConsole(() => handleCharacterCommand(['install', source], characterManager));
    assert.match(output, /角色包安装成功/);
    assert.match(output, /下一步: \/character roxy-sensei/);
    assert.ok(characterManager.getCharacter('roxy-sensei'));

    output = await captureConsole(() => handleCharacterCommand(['install', source], characterManager));
    assert.match(output, /already installed/i);

    output = await captureConsole(() => handleCharacterCommand(['install', source, '--force'], characterManager));
    assert.match(output, /角色包安装成功/);

    output = await captureConsole(() => handleCharacterCommand(['packages', '--project'], characterManager));
    assert.match(output, /roxy-sensei/);
    assert.match(output, /project/);

    await writeCharacterPackageFixture(source, { version: '1.1.0', title: 'Teacher v2' });
    output = await captureConsole(() => handleCharacterCommand(['update', source], characterManager));
    assert.match(output, /角色包更新成功/);
    assert.match(output, /1\.0\.0 -> 1\.1\.0/);

    output = await captureConsole(() => handleCharacterCommand(['roxy-sensei'], characterManager));
    assert.match(output, /Roxy Sensei|roxy-sensei/);
    assert.equal(characterManager.getCurrentCharacter().id, 'roxy-sensei');

    output = await captureConsole(() => handleCharacterCommand(['uninstall', 'roxy-sensei'], characterManager));
    assert.match(output, /角色包已卸载/);
    assert.equal(characterManager.getCurrentCharacter().id, 'roxy');
    assert.equal(characterManager.getCharacter('roxy-sensei'), undefined);
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
