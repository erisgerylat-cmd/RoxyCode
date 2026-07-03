import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Character } from '../types.js';
import type { Manifest } from '../CharacterSchema.js';
import { createCustomCharacterTemplate } from './CharacterTemplate.js';
import { loadCharacterFromDirectory } from './CustomCharacterLoader.js';
import { validateCharacterPackage } from './CharacterPackageValidator.js';

export interface CharacterPackageTemplateOptions {
  id: string;
  directory: string;
  character?: Character;
  force?: boolean;
  authorName?: string;
}

export interface CharacterPackageTemplateResult {
  packageDir: string;
  manifest: Manifest;
  character: Character;
}

export async function createCharacterPackageTemplate(
  options: CharacterPackageTemplateOptions,
): Promise<CharacterPackageTemplateResult> {
  const packageDir = resolve(options.directory);
  if (existsSync(packageDir) && !options.force) {
    throw new Error(`Character package directory already exists: ${packageDir}. Use --force to overwrite files.`);
  }
  if (existsSync(packageDir) && options.force) {
    await rm(packageDir, { recursive: true, force: true });
  }

  const source = options.character;
  const characterJson = source ? characterToPackageJson(source, options.id) : createCustomCharacterTemplate({ id: options.id });
  const manifest = createManifest(options.id, characterJson, options.authorName);

  await mkdir(join(packageDir, 'assets'), { recursive: true });
  await mkdir(join(packageDir, 'behaviors', 'workflows'), { recursive: true });
  await mkdir(join(packageDir, 'behaviors', 'prompts'), { recursive: true });
  await mkdir(join(packageDir, 'i18n'), { recursive: true });

  await writeJson(join(packageDir, 'manifest.json'), manifest);
  await writeJson(join(packageDir, 'character.json'), {
    ...characterJson,
    assets: {
      ...(isRecord(characterJson.assets) ? characterJson.assets : {}),
      splashArt: ['assets/splash-art.txt'],
    },
    extensions: {
      ...(isRecord(characterJson.extensions) ? characterJson.extensions : {}),
      prompts: {
        systemPrompt: 'behaviors/prompts/system-prompt.md',
      },
    },
    i18n: {
      'zh-CN': 'i18n/zh-CN.json',
    },
  });
  await writeFile(join(packageDir, 'README.md'), renderReadme(manifest), 'utf-8');
  await writeFile(join(packageDir, 'LICENSE'), 'MIT\n', 'utf-8');
  await writeFile(join(packageDir, 'assets', 'splash-art.txt'), `${(readSplashArt(characterJson).join('\n') || 'ROXY CODE')}\n`, 'utf-8');
  await writeFile(join(packageDir, 'behaviors', 'prompts', 'system-prompt.md'), `${String(characterJson.systemPromptPersona ?? '')}\n`, 'utf-8');
  await writeJson(join(packageDir, 'i18n', 'zh-CN.json'), {
    name: characterJson.name,
    title: characterJson.title,
    description: characterJson.description,
    personality: characterJson.personality,
  });
  await writeFile(join(packageDir, '.roxycharignore'), DEFAULT_ROXYCHARIGNORE, 'utf-8');

  const validation = await validateCharacterPackage(packageDir);
  if (!validation.success) {
    const details = validation.errors.map(error => `${error.path}: ${error.message}`).join('; ');
    throw new Error(`Generated character package is invalid: ${details}`);
  }

  return {
    packageDir,
    manifest,
    character: await loadCharacterFromDirectory(packageDir, 'project'),
  };
}

export function characterToPackageJson(character: Character, id: string = String(character.id)): Record<string, unknown> {
  return {
    id,
    name: character.name,
    nameEn: character.nameEn,
    title: character.title,
    description: character.description,
    personality: character.personality,
    theme: character.theme,
    behavior: character.behavior,
    statusText: {
      thinking: character.statusText.thinking,
      analyzing: character.statusText.analyzing,
      planning: character.statusText.planning,
      executing: character.statusText.executing,
      reading: 'Reading {file}',
      writing: 'Writing {file}',
      running: 'Running {cmd}',
      searching: character.statusText.searching,
      waiting: character.statusText.waiting,
      done: character.statusText.done,
      error: character.statusText.error,
      step: 'Step {current}/{total}: {desc}',
    },
    splash: character.splash,
    companion: character.companion,
    easterEggs: character.easterEggs,
    errorMessages: {
      generic: character.errorMessages.generic,
      networkError: character.errorMessages.networkError,
      tokenLimit: character.errorMessages.tokenLimit,
      toolFailed: '{tool} failed',
      permissionDenied: character.errorMessages.permissionDenied,
      rateLimit: character.errorMessages.rateLimit,
      contextOverflow: character.errorMessages.contextOverflow,
    },
    systemPromptPersona: character.systemPromptPersona,
    metadata: character.metadata,
  };
}

function createManifest(id: string, characterJson: Record<string, unknown>, authorName = 'RoxyCode User'): Manifest {
  return {
    $schema: 'https://roxycode.dev/schemas/manifest.v1.json',
    name: id,
    version: '0.1.0',
    displayName: readString(characterJson.name) || id,
    description: readString(characterJson.description) || `Custom RoxyCode character package for ${id}.`,
    author: { name: authorName },
    license: 'MIT',
    engines: { roxycode: '>=0.1.0' },
    main: 'character.json',
    contributes: {
      character: 'character.json',
    },
    metadata: createManifestMetadata(characterJson.metadata),
  };
}

function createManifestMetadata(value: unknown): NonNullable<Manifest['metadata']> {
  const existing = isRecord(value) ? value : {};
  const tags = Array.isArray(existing.tags)
    ? existing.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  return {
    source: readString(existing.source) || undefined,
    characterType: readString(existing.characterType) || 'custom',
    tags: [...new Set([...tags, 'roxycode', 'character', 'custom'])],
    ageRating: isAgeRating(existing.ageRating) ? existing.ageRating : 'everyone',
  };
}

function renderReadme(manifest: Manifest): string {
  return [
    `# ${manifest.displayName}`,
    '',
    manifest.description,
    '',
    '## 安装',
    '',
    `\`\`\`text`,
    `/character install ./${manifest.name}`,
    `/character ${manifest.name}`,
    `\`\`\``,
    '',
    '## 打包',
    '',
    `\`\`\`text`,
    `/character pack ./${manifest.name}`,
    `\`\`\``,
    '',
  ].join('\n');
}

function readSplashArt(characterJson: Record<string, unknown>): string[] {
  const splash = characterJson.splash;
  if (!isRecord(splash) || !Array.isArray(splash.asciiArt)) return [];
  return splash.asciiArt.filter((line): line is string => typeof line === 'string');
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAgeRating(value: unknown): value is NonNullable<Manifest['metadata']>['ageRating'] {
  return value === 'everyone' || value === '13+' || value === '16+' || value === '18+';
}

const DEFAULT_ROXYCHARIGNORE = [
  '.git/',
  'node_modules/',
  '.DS_Store',
  'Thumbs.db',
  '*.tmp',
  '*.log',
  '*.bak',
  '.env',
  '*.key',
  '',
].join('\n');
