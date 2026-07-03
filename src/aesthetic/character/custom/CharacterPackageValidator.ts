import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { ZodError } from 'zod';
import {
  CharacterSchema,
  ManifestSchema,
  type CharacterJson,
  type Manifest,
} from '../CharacterSchema.js';
import { prepareCharacterPackageSource } from './CharacterPackageManager.js';

export type CharacterPackageValidationSeverity = 'error' | 'warning';

export interface CharacterPackageValidationIssue {
  severity: CharacterPackageValidationSeverity;
  path: string;
  message: string;
}

export interface CharacterPackageValidationResult {
  success: boolean;
  packagePath: string;
  packageRoot: string;
  manifest?: Manifest;
  character?: CharacterJson;
  errors: CharacterPackageValidationIssue[];
  warnings: CharacterPackageValidationIssue[];
}

const LARGE_PACKAGE_BYTES = 50 * 1024 * 1024;
const ICON_RECOMMENDED_PATHS = ['assets/icon.png', 'icon.png'];

export async function validateCharacterPackage(packagePath: string): Promise<CharacterPackageValidationResult> {
  const source = await prepareCharacterPackageSource(packagePath);
  const errors: CharacterPackageValidationIssue[] = [];
  const warnings: CharacterPackageValidationIssue[] = [];

  try {
    const manifest = await readManifest(source.path, errors);
    const character = manifest ? await readCharacter(source.path, manifest, errors) : undefined;

    if (manifest) {
      await addManifestWarnings(source.path, packagePath, manifest, warnings);
      await validateManifestContributions(source.path, manifest, errors);
    }
    if (character) {
      await validateReferencedFiles(source.path, character, errors, warnings);
    }

    return {
      success: errors.length === 0,
      packagePath,
      packageRoot: source.path,
      manifest,
      character,
      errors,
      warnings,
    };
  } finally {
    await source.cleanup?.();
  }
}

async function readManifest(packageRoot: string, errors: CharacterPackageValidationIssue[]): Promise<Manifest | undefined> {
  const manifestPath = join(packageRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    errors.push(issue('error', 'manifest.json', 'Missing manifest.json.'));
    return undefined;
  }

  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf-8')) as unknown;
    return ManifestSchema.parse(parsed);
  } catch (error) {
    pushParseError(errors, 'manifest.json', error);
    return undefined;
  }
}

async function readCharacter(packageRoot: string, manifest: Manifest, errors: CharacterPackageValidationIssue[]): Promise<CharacterJson | undefined> {
  const characterPath = manifest.contributes?.character ?? manifest.main ?? 'character.json';
  const fullPath = resolvePackagePath(packageRoot, characterPath);
  if (!fullPath || !existsSync(fullPath)) {
    errors.push(issue('error', characterPath, 'Missing character definition file.'));
    return undefined;
  }

  try {
    const parsed = JSON.parse(await readFile(fullPath, 'utf-8')) as unknown;
    return CharacterSchema.parse(parsed) as CharacterJson;
  } catch (error) {
    pushParseError(errors, characterPath, error);
    return undefined;
  }
}

async function validateManifestContributions(
  packageRoot: string,
  manifest: Manifest,
  errors: CharacterPackageValidationIssue[],
): Promise<void> {
  const contributions = manifest.contributes;
  if (!contributions) return;

  const singlePaths = [
    contributions.character,
    contributions.hooks,
  ].filter((path): path is string => Boolean(path));

  for (const path of singlePaths) {
    await assertExistingPackageFile(packageRoot, path, errors);
  }

  for (const pattern of [
    ...(contributions.workflows ?? []),
    ...(contributions.themes ?? []),
  ]) {
    await assertExistingPackagePattern(packageRoot, pattern, errors);
  }
}

async function addManifestWarnings(
  packageRoot: string,
  sourcePath: string,
  manifest: Manifest,
  warnings: CharacterPackageValidationIssue[],
): Promise<void> {
  if (!existsSync(join(packageRoot, 'README.md'))) {
    warnings.push(issue('warning', 'README.md', 'Missing README.md. Character packages should explain usage and customization notes.'));
  }
  if (!existsSync(join(packageRoot, 'LICENSE'))) {
    warnings.push(issue('warning', 'LICENSE', 'Missing LICENSE. Character packages should declare redistribution terms.'));
  }
  if (!manifest.engines?.roxycode) {
    warnings.push(issue('warning', 'manifest.json#engines.roxycode', 'Missing engines.roxycode compatibility range.'));
  }

  const stats = await stat(sourcePath).catch(() => undefined);
  if (stats?.isFile() && stats.size > LARGE_PACKAGE_BYTES) {
    warnings.push(issue('warning', sourcePath, 'Package archive is larger than 50MB.'));
  }
}

async function validateReferencedFiles(
  packageRoot: string,
  character: CharacterJson,
  errors: CharacterPackageValidationIssue[],
  warnings: CharacterPackageValidationIssue[],
): Promise<void> {
  const assetPaths = collectAssetPaths(character);
  const extensionPaths = collectExtensionPaths(character);
  const i18nPaths = collectI18nPaths(character);

  for (const path of [...assetPaths, ...extensionPaths, ...i18nPaths]) {
    await assertExistingPackageFile(packageRoot, path, errors);
  }

  const hasIcon = Boolean(character.assets?.icon) || ICON_RECOMMENDED_PATHS.some(path => existsSync(join(packageRoot, path)));
  if (!hasIcon) {
    warnings.push(issue('warning', 'assets.icon', 'Missing icon. Recommended: assets/icon.png.'));
  }
}

function collectAssetPaths(character: CharacterJson): string[] {
  const assets = character.assets;
  if (!assets) return [];
  return [
    assets.icon,
    assets.avatar,
    ...(assets.splashArt ?? []),
    ...(assets.sprites?.idle ?? []),
    ...(assets.sprites?.thinking ?? []),
    ...(assets.sprites?.success ?? []),
    ...(assets.sprites?.warning ?? []),
    ...(assets.sprites?.error ?? []),
    assets.sounds?.notification,
    assets.sounds?.success,
    assets.sounds?.error,
  ].filter((path): path is string => Boolean(path));
}

function collectExtensionPaths(character: CharacterJson): string[] {
  const extensions = character.extensions;
  if (!extensions) return [];
  return [
    extensions.hooks,
    ...(extensions.workflows ?? []),
    extensions.prompts?.systemPrompt,
    extensions.prompts?.planPrompt,
    extensions.prompts?.verificationPrompt,
    ...(extensions.tools ?? []),
  ].filter((path): path is string => Boolean(path));
}

function collectI18nPaths(character: CharacterJson): string[] {
  if (!character.i18n) return [];
  return Object.values(character.i18n).filter((value): value is string => typeof value === 'string');
}

async function assertExistingPackageFile(
  packageRoot: string,
  packagePath: string,
  errors: CharacterPackageValidationIssue[],
): Promise<void> {
  const fullPath = resolvePackagePath(packageRoot, packagePath);
  if (!fullPath) {
    errors.push(issue('error', packagePath, 'Path escapes character package root.'));
    return;
  }
  const fileStat = await stat(fullPath).catch(() => undefined);
  if (!fileStat?.isFile()) {
    errors.push(issue('error', packagePath, 'Referenced file does not exist.'));
  }
}

async function assertExistingPackagePattern(
  packageRoot: string,
  packagePath: string,
  errors: CharacterPackageValidationIssue[],
): Promise<void> {
  if (!packagePath.includes('*')) {
    await assertExistingPackageFile(packageRoot, packagePath, errors);
    return;
  }

  const globPrefix = packagePath.slice(0, packagePath.indexOf('*'));
  const searchDir = globPrefix.endsWith('/') || globPrefix.endsWith('\\')
    ? globPrefix.slice(0, -1)
    : dirname(globPrefix);
  const fullDir = resolvePackagePath(packageRoot, searchDir === '.' ? '' : searchDir);
  if (!fullDir) {
    errors.push(issue('error', packagePath, 'Path escapes character package root.'));
    return;
  }

  const entries = await readdir(fullDir).catch(() => undefined);
  if (!entries?.some(entry => matchesSimpleGlob(packagePath, entry))) {
    errors.push(issue('error', packagePath, 'Referenced glob pattern does not match any package files.'));
  }
}

function resolvePackagePath(packageRoot: string, packagePath: string): string | undefined {
  const resolved = resolve(packageRoot, packagePath);
  const rel = relative(resolve(packageRoot), resolved);
  if (rel === '..' || rel.startsWith('..')) return undefined;
  return resolved;
}

function matchesSimpleGlob(pattern: string, fileName: string): boolean {
  const basename = pattern.split(/[\\/]/).pop() ?? pattern;
  const escaped = basename
    .split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`).test(fileName);
}

function pushParseError(errors: CharacterPackageValidationIssue[], path: string, error: unknown): void {
  if (error instanceof ZodError) {
    for (const item of error.issues) {
      errors.push(issue('error', `${path}${item.path.length ? `#${item.path.join('.')}` : ''}`, item.message));
    }
    return;
  }
  errors.push(issue('error', path, error instanceof Error ? error.message : String(error)));
}

function issue(
  severity: CharacterPackageValidationSeverity,
  path: string,
  message: string,
): CharacterPackageValidationIssue {
  return { severity, path, message };
}
