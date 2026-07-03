import AdmZip from 'adm-zip';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CharacterPackageManager } from '../src/aesthetic/character/custom/CharacterPackageManager.js';
import { writeCharacterPackageFixture } from './helpers/character-package-fixture.js';

test('character package manager installs, lists, updates, and uninstalls directory packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-manager-'));
  try {
    const cwd = join(root, 'project');
    const source = join(root, 'source', 'roxy-sensei');
    await writeCharacterPackageFixture(source, { version: '1.0.0', title: 'Teacher v1' });

    const manager = new CharacterPackageManager(cwd);
    const installed = await manager.installPackage(source, { paths: testPaths(root, cwd) });

    assert.equal(installed.scope, 'project');
    assert.equal(installed.manifest.name, 'roxy-sensei');
    assert.equal(installed.character.title, 'Teacher v1');
    assert.equal(existsSync(join(cwd, '.roxycode', 'characters', 'roxy-sensei', 'manifest.json')), true);

    const duplicate = await assert.rejects(
      () => manager.installPackage(source, { paths: testPaths(root, cwd) }),
      /already installed/i,
    );
    assert.equal(duplicate, undefined);

    const listed = await manager.listInstalledPackages({ paths: testPaths(root, cwd) });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.name, 'roxy-sensei');
    assert.equal(listed[0]!.version, '1.0.0');

    await writeCharacterPackageFixture(source, { version: '1.1.0', title: 'Teacher v2' });
    const updated = await manager.updatePackage(source, { paths: testPaths(root, cwd) });
    assert.equal(updated.previousVersion, '1.0.0');
    assert.equal(updated.manifest.version, '1.1.0');
    assert.equal(updated.character.title, 'Teacher v2');

    const metadata = JSON.parse(await readFile(join(updated.installPath, '.roxycode', 'install.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(metadata.packageName, 'roxy-sensei');
    assert.equal(metadata.version, '1.1.0');
    assert.equal(metadata.scope, 'project');

    const removed = await manager.uninstallPackage('roxy-sensei', { paths: testPaths(root, cwd) });
    assert.equal(removed.packageName, 'roxy-sensei');
    assert.equal(existsSync(removed.installPath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character package manager installs .roxychar archives with a single top-level directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-archive-'));
  try {
    const cwd = join(root, 'project');
    const source = join(root, 'source', 'roxy-sensei');
    const archive = join(root, 'roxy-sensei.roxychar');
    await writeCharacterPackageFixture(source, { version: '2.0.0', title: 'Archive Teacher' });
    writeZipArchive(archive, source, 'roxy-sensei');

    const manager = new CharacterPackageManager(cwd);
    const installed = await manager.installPackage(archive, { global: true, paths: testPaths(root, cwd) });

    assert.equal(installed.scope, 'global');
    assert.equal(installed.manifest.version, '2.0.0');
    assert.equal(installed.character.title, 'Archive Teacher');
    assert.equal(existsSync(join(root, 'project', '.roxycode', 'characters', 'roxy-sensei')), false);
    assert.equal(existsSync(join(root, 'global', 'characters', 'roxy-sensei')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character package manager rejects malformed archives without a package manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-malformed-'));
  try {
    const archive = join(root, 'missing-manifest.roxychar');
    const zip = new AdmZip();
    zip.addFile('readme.txt', Buffer.from('missing manifest'));
    zip.writeZip(archive);

    const manager = new CharacterPackageManager(join(root, 'project'));
    await assert.rejects(
      () => manager.installPackage(archive, { paths: testPaths(root, join(root, 'project')) }),
      /manifest\.json/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character package manager rejects package names that escape install roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-path-escape-'));
  try {
    const manager = new CharacterPackageManager(join(root, 'project'));
    await assert.rejects(
      () => manager.uninstallPackage('../escape', { paths: testPaths(root, join(root, 'project')) }),
      /escapes base|relative/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function testPaths(root: string, cwd: string): { global: string; project: string } {
  return {
    global: join(root, 'global', 'characters'),
    project: join(cwd, '.roxycode', 'characters'),
  };
}

function writeZipArchive(archivePath: string, sourceDir: string, rootName: string): void {
  const zip = new AdmZip();
  zip.addLocalFolder(sourceDir, rootName);
  zip.writeZip(archivePath);
}
