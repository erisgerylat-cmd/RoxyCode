import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { test } from 'node:test';

import { loadCharacterFromDirectory, loadCustomCharacters, normalizeCustomCharacter } from '../src/aesthetic/character/custom/CustomCharacterLoader.js';

test('normalizeCustomCharacter keeps legacy single-file characters compatible', () => {
  const character = normalizeCustomCharacter({
    id: 'legacy-dev',
    name: 'Legacy Dev',
    statusText: {
      reading: 'Reading {file}',
      step: 'Step {current}/{total}: {desc}',
    },
    errorMessages: {
      toolFailed: '{tool} failed',
    },
  }, 'project');

  assert.equal(character.id, 'legacy-dev');
  assert.equal(character.custom, true);
  assert.equal(character.source, 'project');
  assert.equal(character.statusText.reading('README.md'), 'Reading README.md');
  assert.equal(character.statusText.step(1, 3, 'inspect'), 'Step 1/3: inspect');
  assert.equal(character.errorMessages.toolFailed('read_file'), 'read_file failed');
});

test('loadCharacterFromDirectory loads manifest based character packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-package-'));
  try {
    const packageDir = join(root, 'roxy-sensei');
    await writeCharacterPackage(packageDir);

    const character = await loadCharacterFromDirectory(packageDir, 'project');

    assert.equal(character.id, 'roxy-sensei');
    assert.equal(character.source, 'project');
    assert.equal(character.custom, true);
    assert.equal(character.packageInfo?.packageName, 'roxy-sensei');
    assert.equal(character.packageInfo?.version, '1.2.0');
    assert.equal(character.statusText.reading('src/index.ts'), 'Reading src/index.ts');
    assert.equal(character.errorMessages.toolFailed('grep_search'), 'grep_search failed');
    assert.ok(character.assets?.icon && isAbsolute(character.assets.icon));
    assert.ok(character.assets?.icon?.endsWith(join('assets', 'icon.png')));
    assert.ok(character.extensions?.hooks && isAbsolute(character.extensions.hooks));
    assert.equal(character.i18n?.['en-US']?.name, 'Roxy Sensei');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loadCustomCharacters scans project packages, legacy files, and reports invalid packages without aborting', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-character-scan-'));
  try {
    const characterRoot = join(cwd, '.roxycode', 'characters');
    await mkdir(characterRoot, { recursive: true });
    await writeFile(join(characterRoot, 'legacy-dev.json'), JSON.stringify({ id: 'legacy-dev' }), 'utf8');
    await writeCharacterPackage(join(characterRoot, 'roxy-sensei'));
    await writeCharacterPackage(join(characterRoot, 'unsafe-package'), {
      characterPatch: { id: 'unsafe-package', assets: { icon: '../secret.png' } },
    });

    const result = await loadCustomCharacters(cwd);
    const ids = new Set(result.characters.map(character => String(character.id)));
    const projectErrors = result.errors.filter(error => error.path.startsWith(characterRoot));

    assert.equal(ids.has('legacy-dev'), true);
    assert.equal(ids.has('roxy-sensei'), true);
    assert.equal(ids.has('unsafe-package'), false);
    assert.equal(projectErrors.length, 1);
    assert.match(projectErrors[0]!.message, /Path must not contain|path/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

async function writeCharacterPackage(
  packageDir: string,
  options: { characterPatch?: Record<string, unknown> } = {},
): Promise<void> {
  await mkdir(packageDir, { recursive: true });
  await mkdir(join(packageDir, 'i18n'), { recursive: true });
  await writeFile(join(packageDir, 'i18n', 'en-US.json'), JSON.stringify({
    name: 'Roxy Sensei',
    statusText: { thinking: 'Thinking' },
  }), 'utf8');
  await writeFile(join(packageDir, 'manifest.json'), JSON.stringify({
    $schema: 'https://roxycode.dev/schemas/manifest.v1.json',
    name: 'roxy-sensei',
    version: '1.2.0',
    displayName: 'Roxy Sensei',
    description: 'Careful teaching character package for RoxyCode.',
    author: { name: 'RoxyCode Team', email: 'team@example.com' },
    license: 'MIT',
    repository: { type: 'git', url: 'https://github.com/roxycode/character-roxy-sensei' },
    main: 'character.json',
    contributes: {
      character: 'character.json',
      hooks: 'behaviors/hooks.json',
      workflows: ['behaviors/workflows/code-review.yml'],
    },
    metadata: {
      source: 'RoxyCode original',
      characterType: 'teacher',
      tags: ['teacher', 'anime'],
      ageRating: 'everyone',
    },
  }), 'utf8');

  await writeFile(join(packageDir, 'character.json'), JSON.stringify({
    id: 'roxy-sensei',
    name: 'Roxy Sensei',
    nameEn: 'Roxy Sensei',
    title: 'Careful Coding Teacher',
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
    behavior: {
      explanationStyle: 'teaching',
      reviewFocus: ['correctness', 'testing', 'learning'],
      riskPreference: 'conservative',
      preferredMode: 'standard',
      workflowBias: ['explain before editing'],
      responseRules: ['use clear Chinese'],
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
    assets: {
      icon: 'assets/icon.png',
      avatar: 'assets/avatar.png',
      splashArt: ['assets/splash-art.txt'],
      sprites: {
        idle: ['assets/sprites/idle-1.txt'],
        thinking: ['assets/sprites/thinking.txt'],
        success: ['assets/sprites/success.txt'],
        error: ['assets/sprites/error.txt'],
      },
    },
    extensions: {
      hooks: 'behaviors/hooks.json',
      workflows: ['behaviors/workflows/code-review.yml'],
      prompts: { systemPrompt: 'behaviors/prompts/system-prompt.md' },
    },
    i18n: {
      'en-US': 'i18n/en-US.json',
    },
    metadata: {
      source: 'RoxyCode original',
      characterType: 'teacher',
      tags: ['teacher', 'anime'],
      ageRating: 'everyone',
    },
    ...options.characterPatch,
  }), 'utf8');
}
