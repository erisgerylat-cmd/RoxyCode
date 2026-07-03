import AdmZip from 'adm-zip';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { validateCharacterPackage } from '../src/aesthetic/character/custom/CharacterPackageValidator.js';
import { writeCharacterPackageFixture } from './helpers/character-package-fixture.js';

test('character package validator reports warnings for recommended metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-validator-'));
  try {
    const packageDir = join(root, 'roxy-sensei');
    await writeCharacterPackageFixture(packageDir, {
      includeIcon: false,
      manifestPatch: { engines: undefined },
      writeReadme: false,
      writeLicense: false,
    });

    const result = await validateCharacterPackage(packageDir);
    const warningPaths = new Set(result.warnings.map(warning => warning.path));

    assert.equal(result.success, true);
    assert.equal(warningPaths.has('README.md'), true);
    assert.equal(warningPaths.has('LICENSE'), true);
    assert.equal(warningPaths.has('assets.icon'), true);
    assert.equal(warningPaths.has('manifest.json#engines.roxycode'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character package validator reports missing referenced files as errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-validator-missing-'));
  try {
    const packageDir = join(root, 'roxy-sensei');
    await writeCharacterPackageFixture(packageDir, {
      characterPatch: {
        assets: { icon: 'assets/missing-icon.png' },
        extensions: { hooks: 'behaviors/hooks.json' },
      },
    });

    const result = await validateCharacterPackage(packageDir);
    assert.equal(result.success, false);
    assert.match(result.errors.map(error => error.path).join('\n'), /assets\/missing-icon\.png/);
    assert.match(result.errors.map(error => error.path).join('\n'), /behaviors\/hooks\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character package validator validates roxychar archives', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-validator-archive-'));
  try {
    const packageDir = join(root, 'roxy-sensei');
    const archivePath = join(root, 'roxy-sensei.roxychar');
    await writeCharacterPackageFixture(packageDir);
    const zip = new AdmZip();
    zip.addLocalFolder(packageDir, 'roxy-sensei');
    zip.writeZip(archivePath);

    const result = await validateCharacterPackage(archivePath);
    assert.equal(result.success, true);
    assert.equal(result.manifest?.name, 'roxy-sensei');
    assert.equal(result.character?.id, 'roxy-sensei');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
