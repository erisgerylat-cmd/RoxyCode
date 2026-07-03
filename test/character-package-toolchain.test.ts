import AdmZip from 'adm-zip';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CharacterManager } from '../src/aesthetic/character/CharacterManager.js';
import { CharacterPackageManager } from '../src/aesthetic/character/custom/CharacterPackageManager.js';
import { packCharacterPackage } from '../src/aesthetic/character/custom/CharacterPackagePacker.js';
import { verifyCharacterPackageIntegrity } from '../src/aesthetic/character/custom/CharacterPackageIntegrity.js';
import { createCharacterPackageTemplate } from '../src/aesthetic/character/custom/CharacterPackageTemplate.js';
import { exportCharacterPackage } from '../src/aesthetic/character/custom/CharacterPackageExporter.js';
import { loadCharacterFromDirectory } from '../src/aesthetic/character/custom/CustomCharacterLoader.js';
import { validateCharacterPackage } from '../src/aesthetic/character/custom/CharacterPackageValidator.js';
import { handleCharacterCommand } from '../src/commands/builtin/character.js';
import { ConfigManager } from '../src/core/ConfigManager.js';

test('character package template creates a loadable and valid standard package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-template-'));
  try {
    const cwd = join(root, 'project');
    const manager = new CharacterManager(new ConfigManager(cwd), cwd);
    await manager.loadCustomCharacters();
    await manager.switchCharacter('roxy');

    const packageDir = join(cwd, '.roxycode', 'characters', 'roxy-sensei');
    const result = await createCharacterPackageTemplate({
      id: 'roxy-sensei',
      directory: packageDir,
      character: manager.getCurrentCharacter(),
    });

    assert.equal(result.character.id, 'roxy-sensei');
    assert.equal(existsSync(join(packageDir, 'manifest.json')), true);
    assert.equal(existsSync(join(packageDir, 'character.json')), true);
    assert.equal(existsSync(join(packageDir, 'assets', 'splash-art.txt')), true);
    assert.equal(existsSync(join(packageDir, 'behaviors', 'prompts', 'system-prompt.md')), true);
    assert.equal(existsSync(join(packageDir, 'i18n', 'zh-CN.json')), true);

    const validation = await validateCharacterPackage(packageDir);
    assert.equal(validation.success, true);
    const loaded = await loadCharacterFromDirectory(packageDir, 'project');
    assert.equal(loaded.id, 'roxy-sensei');
    assert.deepEqual(loaded.theme, manager.getCurrentCharacter().theme);
    assert.equal(loaded.behavior?.preferredMode, manager.getCurrentCharacter().behavior?.preferredMode);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character package packer creates installable roxychar archives with manifest at archive root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-packer-'));
  try {
    const packageDir = join(root, 'roxy-sensei');
    await createCharacterPackageTemplate({ id: 'roxy-sensei', directory: packageDir });
    await writeFile(join(packageDir, 'debug.log'), 'ignored', 'utf-8');

    const packed = await packCharacterPackage(packageDir, { outDir: join(root, 'dist') });
    assert.equal(packed.packageName, 'roxy-sensei');
    assert.match(packed.packagePath, /roxy-sensei-0\.1\.0\.roxychar$/);
    assert.equal(existsSync(packed.packagePath), true);
    assert.match(packed.sha256, /^[a-f0-9]{64}$/);
    assert.equal(existsSync(packed.sha256Path), true);
    assert.equal(packed.files.includes('manifest.json'), true);
    assert.equal(packed.files.includes('debug.log'), false);

    const zip = new AdmZip(packed.packagePath);
    assert.ok(zip.getEntry('manifest.json'));
    assert.ok(zip.getEntry('character.json'));
    assert.equal(zip.getEntry('roxy-sensei/manifest.json'), null);

    const installCwd = join(root, 'install-project');
    const verified = await verifyCharacterPackageIntegrity(packed.packagePath);
    assert.equal(verified.verified, true);
    assert.equal(verified.expectedSha256, packed.sha256);
    const mismatch = await verifyCharacterPackageIntegrity(packed.packagePath, {
      sha256: '0'.repeat(64),
    });
    assert.equal(mismatch.verified, false);

    const installed = await new CharacterPackageManager(installCwd).installPackage(packed.packagePath, {
      paths: {
        global: join(root, 'global', 'characters'),
        project: join(installCwd, '.roxycode', 'characters'),
      },
    });
    assert.equal(installed.character.id, 'roxy-sensei');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character exporter exports built-in metadata and optional roxychar archives', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-exporter-'));
  try {
    const manager = new CharacterManager(new ConfigManager(root), root);
    await manager.loadCustomCharacters();
    const roxy = manager.getCharacter('roxy');
    assert.ok(roxy);

    const result = await exportCharacterPackage(roxy, {
      outDir: join(root, 'packages'),
      roxychar: true,
    });
    assert.ok(result.archivePath);
    assert.match(result.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(existsSync(result.sha256Path!), true);

    const validation = await validateCharacterPackage(result.packageDir);
    assert.equal(validation.success, true);
    assert.equal(validation.character?.metadata?.source, 'Mushoku Tensei');
    assert.equal(validation.character?.metadata?.characterType, 'teacher');
    assert.equal(validation.character?.metadata?.ageRating, 'everyone');
    assert.ok(validation.character?.metadata?.tags?.includes('builtin'));

    const installed = await new CharacterPackageManager(join(root, 'consumer')).installPackage(result.archivePath, {
      paths: {
        global: join(root, 'global', 'characters'),
        project: join(root, 'consumer', '.roxycode', 'characters'),
      },
    });
    assert.equal(installed.character.id, 'roxy');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character command supports create --package, pack, and export --roxychar', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-command-toolchain-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(root);
    const manager = new CharacterManager(new ConfigManager(root), root);
    await manager.loadCustomCharacters();

    let output = await captureConsole(() => handleCharacterCommand(['create', 'my-sensei', '--package'], manager));
    assert.match(output, /标准角色包模板已生成/);
    assert.ok(manager.getCharacter('my-sensei'));
    assert.equal(manager.getCurrentCharacter().id, 'roxy');

    const packageDir = join(root, '.roxycode', 'characters', 'my-sensei');
    output = await captureConsole(() => handleCharacterCommand(['pack', '--out', join(root, 'dist'), packageDir], manager));
    assert.match(output, /角色包打包成功/);
    assert.match(output, /SHA-256/);
    assert.equal(existsSync(join(root, 'dist', 'my-sensei-0.1.0.roxychar')), true);

    output = await captureConsole(() => handleCharacterCommand(['verify', join(root, 'dist', 'my-sensei-0.1.0.roxychar')], manager));
    assert.match(output, /完整性校验通过/);

    output = await captureConsole(() => handleCharacterCommand(['export', 'current', '--out', join(root, 'exports'), '--roxychar'], manager));
    assert.match(output, /角色导出成功/);
    assert.match(output, /SHA-256/);
    assert.equal(existsSync(join(root, 'exports', 'roxy-0.1.0.roxychar')), true);
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
