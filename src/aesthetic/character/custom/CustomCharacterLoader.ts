import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ZodError } from 'zod';
import {
  CharacterSchema,
  ManifestSchema,
  type CharacterJson,
  type Manifest,
} from '../CharacterSchema.js';
import type {
  Character,
  CharacterAssets,
  CharacterBehavior,
  CharacterCompanion,
  CharacterId,
  CharacterI18n,
  CharacterPackageInfo,
  CharacterSource,
  CharacterTheme,
  ErrorMessages,
  EasterEggPool,
  PreferredAgentMode,
  ReviewFocus,
  RiskPreference,
  SplashConfig,
  StatusTextMap,
} from '../types.js';
import { readCharacterPackageInstallMetadata } from './CharacterPackageInstallMetadata.js';
import { createCustomCharacterTemplate } from './CharacterTemplate.js';

export interface CustomCharacterPaths {
  global: string;
  project: string;
}

export interface CustomCharacterLoadError {
  path: string;
  message: string;
  reason?: string;
  details?: unknown;
}

export interface CustomCharacterLoadResult {
  characters: Character[];
  errors: CustomCharacterLoadError[];
  paths: CustomCharacterPaths;
}

const VALID_CHARACTER_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const EXPLANATION_STYLES = ['concise', 'structured', 'teaching', 'deep', 'playful'] as const;
const REVIEW_FOCUSES = ['correctness', 'security', 'performance', 'maintainability', 'testing', 'ux', 'learning'] as const;
const RISK_PREFERENCES = ['conservative', 'balanced', 'bold'] as const;
const PREFERRED_MODES = ['lite', 'economic', 'standard', 'ultimate'] as const;

export function getCustomCharacterPaths(cwd: string = process.cwd()): CustomCharacterPaths {
  return {
    global: join(homedir(), '.roxycode', 'characters'),
    project: join(cwd, '.roxycode', 'characters'),
  };
}

export function isValidCharacterId(id: string): boolean {
  return VALID_CHARACTER_ID.test(id);
}

export async function ensureProjectCharacterDirectory(cwd: string = process.cwd()): Promise<string> {
  const paths = getCustomCharacterPaths(cwd);
  await mkdir(paths.project, { recursive: true });
  return paths.project;
}

export async function loadCustomCharacters(cwd: string = process.cwd()): Promise<CustomCharacterLoadResult> {
  const paths = getCustomCharacterPaths(cwd);
  const errors: CustomCharacterLoadError[] = [];
  const characters: Character[] = [];

  for (const [source, dir] of [['global', paths.global], ['project', paths.project]] as Array<[CharacterSource, string]>) {
    const loaded = await loadDirectory(dir, source);
    errors.push(...loaded.errors);
    characters.push(...loaded.characters);
  }

  return { characters, errors, paths };
}

async function loadDirectory(dir: string, source: CharacterSource): Promise<{ characters: Character[]; errors: CustomCharacterLoadError[] }> {
  if (!existsSync(dir)) return { characters: [], errors: [] };

  const characters: Character[] = [];
  const errors: CustomCharacterLoadError[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    errors.push(toLoadError(dir, error, 'Failed to read character directory.'));
    return { characters, errors };
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const entryPath = join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        characters.push(await loadCharacterFromDirectory(entryPath, source));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        characters.push(await loadLegacyCharacterFile(entryPath, source));
      }
    } catch (error) {
      errors.push(toLoadError(entryPath, error));
    }
  }

  return { characters, errors };
}

async function loadLegacyCharacterFile(filePath: string, source: CharacterSource): Promise<Character> {
  const raw = await readJsonFile(filePath);
  return normalizeCustomCharacter(raw, source);
}

export async function loadCharacterFromDirectory(characterDir: string, source: CharacterSource): Promise<Character> {
  const manifest = await readOptionalManifest(characterDir);
  const characterJsonPath = resolveCharacterEntryPath(characterDir, manifest);
  const raw = await readJsonFile(characterJsonPath);
  const validatedCharacter = CharacterSchema.parse(raw) as CharacterJson;
  const packageInfo = manifest ? await createPackageInfo(manifest, characterDir) : validatedCharacter.packageInfo;

  return normalizeValidatedCharacter(validatedCharacter, {
    source,
    characterDir,
    packageInfo,
  });
}

export function normalizeCustomCharacter(raw: unknown, source: CharacterSource): Character {
  if (!isRecord(raw)) throw new Error('Character file must contain a JSON object.');
  const id = readString(raw, 'id');
  if (!id || !isValidCharacterId(id)) {
    throw new Error('Character id must match /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.');
  }

  const defaults = createCustomCharacterTemplate({ id });
  const merged = deepMerge(defaults, raw);

  return {
    id: readString(merged, 'id') as CharacterId,
    name: readString(merged, 'name') || id,
    nameEn: readString(merged, 'nameEn') || id,
    title: readString(merged, 'title') || 'Custom Character',
    description: readString(merged, 'description') || 'Custom RoxyCode character.',
    personality: readString(merged, 'personality') || 'Customizable coding partner.',
    theme: normalizeTheme(merged.theme),
    statusText: normalizeStatusText(merged.statusText),
    splash: normalizeSplash(merged.splash),
    companion: normalizeCompanion(merged.companion),
    behavior: normalizeBehavior(merged.behavior),
    easterEggs: normalizeEasterEggs(merged.easterEggs),
    errorMessages: normalizeErrorMessages(merged.errorMessages),
    systemPromptPersona: readString(merged, 'systemPromptPersona') || 'You are a customized RoxyCode coding partner. Safety rules always override style.',
    custom: source !== 'builtin',
    source,
    packageInfo: isCharacterPackageInfo(merged.packageInfo) ? merged.packageInfo : undefined,
    assets: isCharacterAssets(merged.assets) ? merged.assets : undefined,
    extensions: isRecord(merged.extensions) ? merged.extensions as Character['extensions'] : undefined,
    i18n: isRecord(merged.i18n) ? merged.i18n as CharacterI18n : undefined,
    metadata: isRecord(merged.metadata) ? merged.metadata as Character['metadata'] : undefined,
  };
}

async function readOptionalManifest(characterDir: string): Promise<Manifest | undefined> {
  const manifestPath = join(characterDir, 'manifest.json');
  if (!existsSync(manifestPath)) return undefined;
  return ManifestSchema.parse(await readJsonFile(manifestPath));
}

function resolveCharacterEntryPath(characterDir: string, manifest?: Manifest): string {
  const entryPath = manifest?.contributes?.character ?? manifest?.main ?? 'character.json';
  const fullPath = resolvePackagePath(characterDir, entryPath, 'character entry');
  if (!existsSync(fullPath)) {
    throw new Error(manifest ? `Character entry not found: ${entryPath}` : 'Missing character.json');
  }
  return fullPath;
}

async function createPackageInfo(manifest: Manifest, characterDir: string): Promise<CharacterPackageInfo> {
  const metadata = await readCharacterPackageInstallMetadata(characterDir).catch(() => undefined);
  const stats = await stat(characterDir);
  return {
    packageName: metadata?.packageName ?? manifest.name,
    version: metadata?.version ?? manifest.version,
    author: manifest.author,
    license: manifest.license,
    repository: manifest.repository?.url,
    installPath: metadata?.installPath ?? characterDir,
    installedAt: metadata?.installedAt ?? stats.birthtime.toISOString(),
    updatedAt: metadata?.updatedAt,
  };
}

async function normalizeValidatedCharacter(
  character: CharacterJson,
  options: { source: CharacterSource; characterDir: string; packageInfo?: CharacterPackageInfo },
): Promise<Character> {
  return {
    ...character,
    id: character.id as CharacterId,
    statusText: normalizeStatusText(character.statusText),
    errorMessages: normalizeErrorMessages(character.errorMessages),
    splash: normalizeSplash(character.splash),
    companion: normalizeCompanion(character.companion),
    behavior: normalizeBehavior(character.behavior),
    easterEggs: normalizeEasterEggs(character.easterEggs),
    custom: options.source !== 'builtin',
    source: options.source,
    packageInfo: options.packageInfo,
    assets: character.assets ? resolveAssetPaths(character.assets, options.characterDir) : undefined,
    extensions: character.extensions ? resolveExtensionPaths(character.extensions, options.characterDir) : undefined,
    i18n: await loadI18n(character.i18n, options.characterDir),
  };
}

function resolveAssetPaths(assets: CharacterAssets, baseDir: string): CharacterAssets {
  const resolveOne = (value?: string) => value ? resolvePackagePath(baseDir, value, 'asset') : undefined;
  const resolveMany = (values?: string[]) => values?.map(value => resolvePackagePath(baseDir, value, 'asset'));

  return {
    icon: resolveOne(assets.icon),
    avatar: resolveOne(assets.avatar),
    splashArt: resolveMany(assets.splashArt),
    sprites: assets.sprites ? {
      idle: resolveMany(assets.sprites.idle),
      thinking: resolveMany(assets.sprites.thinking),
      success: resolveMany(assets.sprites.success),
      warning: resolveMany(assets.sprites.warning),
      error: resolveMany(assets.sprites.error),
    } : undefined,
    sounds: assets.sounds ? {
      notification: resolveOne(assets.sounds.notification),
      success: resolveOne(assets.sounds.success),
      error: resolveOne(assets.sounds.error),
    } : undefined,
  };
}

function resolveExtensionPaths(extensions: NonNullable<Character['extensions']>, baseDir: string): NonNullable<Character['extensions']> {
  const resolveOne = (value?: string) => value ? resolvePackagePath(baseDir, value, 'extension') : undefined;
  const resolveMany = (values?: string[]) => values?.map(value => resolvePackagePath(baseDir, value, 'extension'));

  return {
    hooks: resolveOne(extensions.hooks),
    workflows: resolveMany(extensions.workflows),
    prompts: extensions.prompts ? {
      systemPrompt: resolveOne(extensions.prompts.systemPrompt),
      planPrompt: resolveOne(extensions.prompts.planPrompt),
      verificationPrompt: resolveOne(extensions.prompts.verificationPrompt),
    } : undefined,
    tools: resolveMany(extensions.tools),
  };
}

async function loadI18n(value: unknown, baseDir: string): Promise<CharacterI18n | undefined> {
  if (!isRecord(value)) return undefined;

  const i18n: CharacterI18n = {};
  for (const [locale, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      const fullPath = resolvePackagePath(baseDir, entry, 'i18n');
      const parsed = await readJsonFile(fullPath);
      if (!isRecord(parsed)) throw new Error(`i18n file must contain an object: ${entry}`);
      i18n[locale] = parsed as CharacterI18n[string];
    } else if (isRecord(entry)) {
      i18n[locale] = entry as CharacterI18n[string];
    }
  }

  return Object.keys(i18n).length > 0 ? i18n : undefined;
}

function resolvePackagePath(baseDir: string, packagePath: string, label: string): string {
  if (isAbsolute(packagePath) || /^[a-zA-Z]:[\\/]/.test(packagePath) || /^https?:\/\//i.test(packagePath)) {
    throw new Error(`Unsafe ${label} path: ${packagePath}`);
  }

  const resolved = resolve(baseDir, packagePath);
  const normalizedBase = resolve(baseDir);
  const relativePath = relative(normalizedBase, resolved);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Unsafe ${label} path escapes character package: ${packagePath}`);
  }

  return resolved;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON: ${error.message}`);
    throw error;
  }
}

function normalizeTheme(value: unknown): CharacterTheme {
  const raw = isRecord(value) ? value : {};
  return {
    primary: color(raw.primary, '#5B9BD5'),
    secondary: color(raw.secondary, '#7EC8E3'),
    accent: color(raw.accent, '#FFD166'),
    tagline: color(raw.tagline, '#98D8C8'),
    dim: color(raw.dim, '#888888'),
    error: color(raw.error, '#E85D75'),
    success: color(raw.success, '#4ECDC4'),
  };
}

function normalizeStatusText(value: unknown): StatusTextMap {
  const raw = isRecord(value) ? value : {};
  return {
    thinking: str(raw.thinking, 'Thinking'),
    analyzing: str(raw.analyzing, 'Analyzing'),
    planning: str(raw.planning, 'Planning'),
    executing: str(raw.executing, 'Executing'),
    reading: toRenderer(raw.reading, 'Reading {file}', ['file']),
    writing: toRenderer(raw.writing, 'Writing {file}', ['file']),
    running: toRenderer(raw.running, 'Running {cmd}', ['cmd']),
    searching: str(raw.searching, 'Searching'),
    waiting: str(raw.waiting, 'Waiting'),
    done: str(raw.done, 'Done'),
    error: str(raw.error, 'Error'),
    step: (current, total, desc) => {
      if (typeof raw.step === 'function') return String(raw.step(current, total, desc));
      return applyTemplate(str(raw.step, 'Step {current}/{total}: {desc}'), { current, total, desc });
    },
  };
}

function normalizeSplash(value: unknown): SplashConfig {
  const raw = isRecord(value) ? value : {};
  return {
    asciiArt: stringArray(raw.asciiArt),
    tagline: str(raw.tagline, 'Personal Anime Coding Workbench'),
    welcome: str(raw.welcome, 'Welcome back.'),
    tips: stringArray(raw.tips),
  };
}

function normalizeCompanion(value: unknown): CharacterCompanion | undefined {
  if (!isRecord(value)) return undefined;
  return {
    name: str(value.name, 'Companion'),
    kind: str(value.kind, 'pixel familiar'),
    art: stringArray(value.art),
    idleLines: stringArray(value.idleLines),
    thinkingLines: stringArray(value.thinkingLines),
    successLines: stringArray(value.successLines),
    warningLines: stringArray(value.warningLines),
  };
}

function normalizeBehavior(value: unknown): CharacterBehavior | undefined {
  if (!isRecord(value)) return undefined;
  return {
    explanationStyle: enumValue(value.explanationStyle, EXPLANATION_STYLES, 'teaching'),
    reviewFocus: enumArray(value.reviewFocus, REVIEW_FOCUSES, ['correctness', 'testing', 'learning']),
    riskPreference: enumValue(value.riskPreference, RISK_PREFERENCES, 'balanced'),
    preferredMode: enumValue(value.preferredMode, PREFERRED_MODES, 'standard'),
    workflowBias: stringArray(value.workflowBias),
    responseRules: stringArray(value.responseRules),
  };
}

function normalizeEasterEggs(value: unknown): EasterEggPool {
  const raw = isRecord(value) ? value : {};
  return {
    startup: nonEmptyArray(raw.startup, ['Ready.']),
    success: nonEmptyArray(raw.success, ['Done.']),
    error: nonEmptyArray(raw.error, ['Something went wrong.']),
    idle: nonEmptyArray(raw.idle, ['Need anything?']),
    special: isRecord(raw.special) ? Object.fromEntries(Object.entries(raw.special).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {},
  };
}

function normalizeErrorMessages(value: unknown): ErrorMessages {
  const raw = isRecord(value) ? value : {};
  return {
    generic: str(raw.generic, 'Something went wrong.'),
    networkError: str(raw.networkError, 'Network error.'),
    tokenLimit: str(raw.tokenLimit, 'Context limit reached.'),
    toolFailed: toRenderer(raw.toolFailed, '{tool} failed.', ['tool']),
    permissionDenied: str(raw.permissionDenied, 'Permission denied.'),
    rateLimit: str(raw.rateLimit, 'Rate limit reached.'),
    contextOverflow: str(raw.contextOverflow, 'Context overflow.'),
  };
}

function toRenderer(value: unknown, fallback: string, keys: string[]): (...args: string[]) => string {
  if (typeof value === 'function') {
    return (...args: string[]) => String(value(...args));
  }
  const template = str(value, fallback);
  return (...args: string[]) => applyTemplate(template, Object.fromEntries(keys.map((key, index) => [key, args[index] ?? ''])));
}

function color(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readString(value: Record<string, unknown>, key: string): string {
  const raw = value[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.length > 0) : [];
}

function nonEmptyArray(value: unknown, fallback: string[]): string[] {
  const arr = stringArray(value);
  return arr.length > 0 ? arr : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function enumArray<T extends string>(value: unknown, allowed: readonly T[], fallback: T[]): T[] {
  if (!Array.isArray(value)) return fallback;
  const result = value.filter((item): item is T => typeof item === 'string' && allowed.includes(item as T));
  return result.length > 0 ? result : fallback;
}

function applyTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return out;
}

function isCharacterPackageInfo(value: unknown): value is CharacterPackageInfo {
  return isRecord(value) && typeof value.packageName === 'string' && typeof value.version === 'string' && isRecord(value.author);
}

function isCharacterAssets(value: unknown): value is CharacterAssets {
  return isRecord(value);
}

function toLoadError(path: string, error: unknown, fallback?: string): CustomCharacterLoadError {
  const reason = formatError(error, fallback);
  return { path, message: reason, reason, details: error };
}

function formatError(error: unknown, fallback = 'Character load failed.'): string {
  if (error instanceof ZodError) {
    return error.issues.map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ');
  }
  if (error instanceof Error) return error.message;
  return String(error || fallback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
