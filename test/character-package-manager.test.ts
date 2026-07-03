import AdmZip from 'adm-zip';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CharacterPackageManager } from '../src/aesthetic/character/custom/CharacterPackageManager.js';

test('character package manager installs, lists, updates, and uninstalls directory packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-manager-'));
  try {
    const cwd = join(root, 'project');
    const source = join(root, 'source', 'roxy-sensei');
    await writePackage(source, { version: '1.0.0', title: 'Teacher v1' });

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

    await writePackage(source, { version: '1.1.0', title: 'Teacher v2' });
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
    await writePackage(source, { version: '2.0.0', title: 'Archive Teacher' });
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

async function writePackage(
  dir: string,
  options: { version: string; title: string },
): Promise<void> {
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    $schema: 'https://roxycode.dev/schemas/manifest.v1.json',
    name: 'roxy-sensei',
    version: options.version,
    displayName: 'Roxy Sensei',
    description: 'Careful teaching character package for RoxyCode.',
    author: { name: 'RoxyCode Team', email: 'team@example.com' },
    license: 'MIT',
    repository: { type: 'git', url: 'https://github.com/roxycode/character-roxy-sensei' },
    main: 'character.json',
  }), 'utf8');

  await writeFile(join(dir, 'character.json'), JSON.stringify({
    id: 'roxy-sensei',
    name: 'Roxy Sensei',
    nameEn: 'Roxy Sensei',
    title: options.title,
    description: 'A patient programming partner for Chinese-first coding education.',
    personality: 'Patient, precise, and safety-aware.',
    theme: {
      primary: '#5B9BD5',
      secondary: '#7EC8E3',
      accent: '#FFD166',
      tagline: '#98D8C8',
      dim: '#888888',
      error: '#E85D75',
      success: '#4ECDC4',
    },
    statusText: {
      thinking: 'Thinking',
      analyzing: 'Analyzing',
      planning: 'Planning',
      executing: 'Executing',
      reading: 'Reading {file}',
      writing: 'Writing {file}',
      running: 'Running {cmd}',
      searching: 'Searching',
      waiting: 'Waiting',
      done: 'Done',
      error: 'Error',
      step: 'Step {current}/{total}: {desc}',
    },
    splash: {
      asciiArt: ['ROXY CODE'],
      tagline: 'Personal Anime Coding Workbench',
      welcome: 'Welcome back.',
      tips: ['Use /character to switch roles.'],
    },
    easterEggs: {
      startup: ['Ready.'],
      success: ['Done.'],
      error: ['Review the issue.'],
      idle: ['Need help?'],
      special: {},
    },
    errorMessages: {
      generic: 'Something went wrong.',
      networkError: 'Network error.',
      tokenLimit: 'Context limit reached.',
      toolFailed: '{tool} failed',
      permissionDenied: 'Permission denied.',
      rateLimit: 'Rate limit reached.',
      contextOverflow: 'Context overflow.',
    },
    systemPromptPersona: 'You are Roxy Sensei, a careful teaching coding partner.',
    assets: { icon: 'assets/icon.png' },
  }), 'utf8');

  await writeFile(join(dir, 'assets', 'icon.png'), 'fake-png', 'utf8');
}

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
