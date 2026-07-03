import AdmZip from 'adm-zip';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CharacterPackageManager } from '../src/aesthetic/character/custom/CharacterPackageManager.js';
import { packCharacterPackage } from '../src/aesthetic/character/custom/CharacterPackagePacker.js';
import { verifyCharacterPackageIntegrity } from '../src/aesthetic/character/custom/CharacterPackageIntegrity.js';
import { writeCharacterPackageFixture } from './helpers/character-package-fixture.js';

test('character package packer applies roxycharignore and emits installable archives', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-packer-ignore-'));
  try {
    const packageDir = join(root, 'roxy-sensei');
    await writeCharacterPackageFixture(packageDir, { version: '2.3.4' });
    await mkdir(join(packageDir, 'dist'), { recursive: true });
    await writeFile(join(packageDir, 'dist', 'generated.txt'), 'ignore directory', 'utf8');
    await writeFile(join(packageDir, 'draft.secret'), 'ignore glob', 'utf8');
    await writeFile(join(packageDir, 'keep.txt'), 'keep', 'utf8');
    await writeFile(join(packageDir, '.roxycharignore'), 'dist/\n*.secret\n', 'utf8');

    const packed = await packCharacterPackage(packageDir, { outDir: join(root, 'out') });
    assert.match(packed.packagePath, /roxy-sensei-2\.3\.4\.roxychar$/);
    assert.equal(packed.files.includes('manifest.json'), true);
    assert.equal(packed.files.includes('character.json'), true);
    assert.equal(packed.files.includes('keep.txt'), true);
    assert.equal(packed.files.includes('dist/generated.txt'), false);
    assert.equal(packed.files.includes('draft.secret'), false);
    assert.equal(existsSync(packed.sha256Path), true);

    const archive = new AdmZip(packed.packagePath);
    assert.ok(archive.getEntry('manifest.json'));
    assert.equal(archive.getEntry('roxy-sensei/manifest.json'), null);
    assert.equal(archive.getEntry('dist/generated.txt'), null);

    const verified = await verifyCharacterPackageIntegrity(packed.packagePath);
    assert.equal(verified.verified, true);
    assert.equal(verified.expectedSha256, packed.sha256);

    const installed = await new CharacterPackageManager(join(root, 'consumer')).installPackage(packed.packagePath, {
      paths: {
        global: join(root, 'global', 'characters'),
        project: join(root, 'consumer', '.roxycode', 'characters'),
      },
    });
    assert.equal(installed.manifest.version, '2.3.4');
    assert.equal(installed.character.id, 'roxy-sensei');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character package packer refuses invalid packages before writing output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-packer-invalid-'));
  try {
    const packageDir = join(root, 'roxy-sensei');
    await writeCharacterPackageFixture(packageDir, {
      characterPatch: {
        assets: { icon: 'assets/missing-icon.png' },
      },
    });

    await assert.rejects(
      () => packCharacterPackage(packageDir, { outDir: join(root, 'out') }),
      /validation failed/i,
    );
    assert.equal(existsSync(join(root, 'out', 'roxy-sensei-1.0.0.roxychar')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
