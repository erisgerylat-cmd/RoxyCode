import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CharacterPackageFixtureOptions {
  version?: string;
  title?: string;
  includeIcon?: boolean;
  writeReadme?: boolean;
  writeLicense?: boolean;
  manifestPatch?: Record<string, unknown>;
  characterPatch?: Record<string, unknown>;
}

export async function writeCharacterPackageFixture(
  dir: string,
  options: CharacterPackageFixtureOptions = {},
): Promise<void> {
  const version = options.version ?? '1.0.0';
  const title = options.title ?? 'Careful Coding Teacher';
  const includeIcon = options.includeIcon ?? true;
  const writeReadme = options.writeReadme ?? true;
  const writeLicense = options.writeLicense ?? true;

  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    $schema: 'https://roxycode.dev/schemas/manifest.v1.json',
    name: 'roxy-sensei',
    version,
    displayName: 'Roxy Sensei',
    description: 'Careful teaching character package for RoxyCode.',
    author: { name: 'RoxyCode Team', email: 'team@example.com' },
    license: 'MIT',
    repository: { type: 'git', url: 'https://github.com/roxycode/character-roxy-sensei' },
    engines: { roxycode: '>=0.2.0' },
    main: 'character.json',
    ...options.manifestPatch,
  }), 'utf8');

  await writeFile(join(dir, 'character.json'), JSON.stringify({
    id: 'roxy-sensei',
    name: 'Roxy Sensei',
    nameEn: 'Roxy Sensei',
    title,
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
    assets: includeIcon ? { icon: 'assets/icon.png' } : undefined,
    ...options.characterPatch,
  }), 'utf8');

  if (includeIcon) await writeFile(join(dir, 'assets', 'icon.png'), 'fake-png', 'utf8');
  if (writeReadme) await writeFile(join(dir, 'README.md'), '# Roxy Sensei\n', 'utf8');
  if (writeLicense) await writeFile(join(dir, 'LICENSE'), 'MIT\n', 'utf8');
}
