import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  listCharacterMarketplacePackages,
  validateCharacterMarketplaceIndex,
} from '../src/aesthetic/character/marketplace/CharacterMarketplaceIndex.js';
import { CharacterManager } from '../src/aesthetic/character/CharacterManager.js';
import { handleCharacterCommand } from '../src/commands/builtin/character.js';
import { ConfigManager } from '../src/core/ConfigManager.js';
import { writeCharacterPackageFixture } from './helpers/character-package-fixture.js';

test('character marketplace validates local package entries and renders install hints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-marketplace-'));
  try {
    const packagesDir = join(root, 'packages');
    const packageDir = join(packagesDir, 'roxy-sensei');
    await writeCharacterPackageFixture(packageDir, { version: '1.2.0' });
    const marketplacePath = join(root, 'marketplace.json');
    await writeMarketplace(marketplacePath, {
      packages: [{
        name: 'roxy-sensei',
        version: '1.2.0',
        displayName: 'Roxy Sensei',
        description: 'A curated teacher character package for RoxyCode users.',
        source: './packages/roxy-sensei',
        categories: ['anime', 'teaching'],
        tags: ['beginner-friendly'],
      }],
    });

    const result = await validateCharacterMarketplaceIndex(marketplacePath);
    assert.equal(result.success, true);
    assert.equal(result.marketplace?.packages.length, 1);

    const items = listCharacterMarketplacePackages(result.marketplace!, marketplacePath);
    assert.equal(items[0]?.name, 'roxy-sensei');
    assert.match(items[0]!.installHint, /\/character install/);
    assert.match(items[0]!.installHint, /roxy-sensei/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character marketplace validation catches duplicate entries and manifest mismatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-marketplace-invalid-'));
  try {
    const packageDir = join(root, 'packages', 'roxy-sensei');
    await writeCharacterPackageFixture(packageDir, { version: '1.0.0' });
    const marketplacePath = join(root, 'marketplace.json');
    await writeMarketplace(marketplacePath, {
      packages: [
        {
          name: 'wrong-name',
          version: '1.0.0',
          displayName: 'Wrong',
          description: 'This entry intentionally mismatches the manifest name.',
          source: './packages/roxy-sensei',
        },
        {
          name: 'wrong-name',
          version: '1.0.0',
          displayName: 'Wrong Duplicate',
          description: 'This entry intentionally duplicates name and version.',
          source: './packages/roxy-sensei',
        },
      ],
    });

    const result = await validateCharacterMarketplaceIndex(marketplacePath);
    assert.equal(result.success, false);
    assert.match(result.errors.map(error => `${error.path}: ${error.message}`).join('\n'), /Duplicate package\/version/);
    assert.match(result.errors.map(error => `${error.path}: ${error.message}`).join('\n'), /does not match manifest/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character command lists marketplace packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-marketplace-command-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(root);
    const packageDir = join(root, 'packages', 'roxy-sensei');
    await writeCharacterPackageFixture(packageDir);
    const marketplacePath = join(root, 'marketplace.json');
    await writeMarketplace(marketplacePath, {
      packages: [{
        name: 'roxy-sensei',
        version: '1.0.0',
        displayName: 'Roxy Sensei',
        description: 'A curated teacher character package for RoxyCode users.',
        source: './packages/roxy-sensei',
      }],
    });

    const manager = new CharacterManager(new ConfigManager(root, root), root);
    await manager.loadCustomCharacters();
    const output = await captureConsole(() => handleCharacterCommand(['marketplace', 'list', marketplacePath], manager));

    assert.match(output, /角色包市场/);
    assert.match(output, /roxy-sensei/);
    assert.match(output, /安装: \/character install/);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

async function writeMarketplace(path: string, patch: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    schemaVersion: 1,
    name: 'personal-characters',
    displayName: 'Personal Characters',
    description: 'Local character marketplace for testing RoxyCode packages.',
    owner: { name: 'RoxyCode Team' },
    packages: [],
    ...patch,
  }), 'utf8');
}

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
