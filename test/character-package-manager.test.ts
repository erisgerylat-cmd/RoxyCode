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
    assert.equal(updated.character.packageInfo?.installedAt, installed.character.packageInfo?.installedAt);
    assert.equal(updated.character.packageInfo?.updatedAt, metadata.updatedAt);
    assert.notEqual(metadata.installedAt, metadata.updatedAt);

    const removed = await manager.uninstallPackage('roxy-sensei', { paths: testPaths(root, cwd) });
    assert.equal(removed.packageName, 'roxy-sensei');
    assert.equal(existsSync(removed.installPath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character package manager rejects incompatible engines unless forced', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-engines-'));
  try {
    const cwd = join(root, 'project');
    const source = join(root, 'source', 'roxy-sensei');
    await writeCharacterPackageFixture(source, {
      manifestPatch: { engines: { roxycode: '>=999.0.0' } },
    });

    const manager = new CharacterPackageManager(cwd);
    await assert.rejects(
      () => manager.installPackage(source, { paths: testPaths(root, cwd) }),
      /requires RoxyCode >=999\.0\.0/i,
    );

    const forced = await manager.installPackage(source, {
      force: true,
      paths: testPaths(root, cwd),
    });
    assert.equal(forced.character.id, 'roxy-sensei');
    assert.match(forced.warnings.join('\n'), /Installed because --force was used/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character package manager allows missing engines with warning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-engines-missing-'));
  try {
    const cwd = join(root, 'project');
    const source = join(root, 'source', 'roxy-sensei');
    await writeCharacterPackageFixture(source, {
      manifestPatch: { engines: undefined },
    });

    const installed = await new CharacterPackageManager(cwd).installPackage(source, {
      paths: testPaths(root, cwd),
    });
    assert.match(installed.warnings.join('\n'), /Missing engines\.roxycode/);
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

test('character package manager rejects unsafe archive paths and duplicate entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-unsafe-archive-'));
  try {
    const cwd = join(root, 'project');
    const manager = new CharacterPackageManager(cwd);

    const escapeArchive = join(root, 'escape.roxychar');
    await writeUnsafeZipEntries(escapeArchive, [{ name: '../manifest.json', data: Buffer.from('{}') }]);
    await assert.rejects(
      () => manager.installPackage(escapeArchive, { paths: testPaths(root, cwd) }),
      /escapes base|Unsafe zip entry path/i,
    );

    const duplicateArchive = join(root, 'duplicate.roxychar');
    await writeUnsafeZipEntries(duplicateArchive, [
      { name: 'manifest.json', data: Buffer.from('{}') },
      { name: 'manifest.json', data: Buffer.from('{}') },
    ]);
    await assert.rejects(
      () => manager.installPackage(duplicateArchive, { paths: testPaths(root, cwd) }),
      /Duplicate zip entry/i,
    );

    const symlinkArchive = join(root, 'symlink.roxychar');
    await writeUnsafeZipEntries(symlinkArchive, [
      { name: 'manifest.json', data: Buffer.from('{}') },
      { name: 'link', data: Buffer.from('target'), externalAttr: (0o120000 << 16) >>> 0 },
    ]);
    await assert.rejects(
      () => manager.installPackage(symlinkArchive, { paths: testPaths(root, cwd) }),
      /symlinks/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character package manager rejects zip bomb style archives', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-zip-bomb-'));
  try {
    const cwd = join(root, 'project');
    const manager = new CharacterPackageManager(cwd);

    const tooLargeFile = join(root, 'too-large.roxychar');
    const tooLargeZip = new AdmZip();
    tooLargeZip.addFile('manifest.json', Buffer.from('{}'));
    tooLargeZip.addFile('big.bin', Buffer.alloc(10 * 1024 * 1024 + 1));
    tooLargeZip.writeZip(tooLargeFile);
    await assert.rejects(
      () => manager.installPackage(tooLargeFile, { paths: testPaths(root, cwd) }),
      /too large/i,
    );

    const tooManyEntries = join(root, 'too-many.roxychar');
    const tooManyZip = new AdmZip();
    for (let i = 0; i < 1001; i++) {
      tooManyZip.addFile(`files/${i}.txt`, Buffer.from('x'));
    }
    tooManyZip.writeZip(tooManyEntries);
    await assert.rejects(
      () => manager.installPackage(tooManyEntries, { paths: testPaths(root, cwd) }),
      /too many entries/i,
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

async function writeUnsafeZipEntries(
  archivePath: string,
  entries: Array<{ name: string; data: Buffer; externalAttr?: number }>,
): Promise<void> {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const crc32 = crc32Buffer(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc32, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc32, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((entry.externalAttr ?? 0) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(archivePath, Buffer.concat([...localParts, ...centralParts, end]));
}

function crc32Buffer(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
