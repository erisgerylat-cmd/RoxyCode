import { existsSync, statSync, type Stats } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ZodError } from 'zod';
import { validateCharacterPackage } from '../custom/CharacterPackageValidator.js';
import {
  CharacterMarketplaceSchema,
  type CharacterMarketplace,
  type CharacterMarketplaceEntry,
  type CharacterMarketplaceSource,
} from './CharacterMarketplaceSchema.js';

export type CharacterMarketplaceIssueSeverity = 'error' | 'warning';

export interface CharacterMarketplaceIssue {
  severity: CharacterMarketplaceIssueSeverity;
  path: string;
  message: string;
}

export interface CharacterMarketplaceValidationResult {
  success: boolean;
  marketplacePath: string;
  marketplace?: CharacterMarketplace;
  errors: CharacterMarketplaceIssue[];
  warnings: CharacterMarketplaceIssue[];
}

export interface CharacterMarketplaceListItem {
  name: string;
  version: string;
  displayName: string;
  description: string;
  source: string;
  installHint: string;
  sha256?: string;
  categories: string[];
  tags: string[];
}

export async function loadCharacterMarketplaceIndex(marketplacePath: string): Promise<CharacterMarketplace> {
  const parsed = JSON.parse(await readFile(resolveMarketplaceJsonPath(marketplacePath), 'utf-8')) as unknown;
  return CharacterMarketplaceSchema.parse(parsed);
}

export async function validateCharacterMarketplaceIndex(marketplacePath: string): Promise<CharacterMarketplaceValidationResult> {
  const resolvedPath = resolveMarketplaceJsonPath(marketplacePath);
  const errors: CharacterMarketplaceIssue[] = [];
  const warnings: CharacterMarketplaceIssue[] = [];

  if (!existsSync(resolvedPath)) {
    return {
      success: false,
      marketplacePath: resolvedPath,
      errors: [issue('error', 'marketplace.json', 'Marketplace file does not exist.')],
      warnings,
    };
  }

  let marketplace: CharacterMarketplace | undefined;
  try {
    marketplace = await loadCharacterMarketplaceIndex(resolvedPath);
  } catch (error) {
    pushParseError(errors, 'marketplace.json', error);
    return { success: false, marketplacePath: resolvedPath, errors, warnings };
  }

  if (marketplace.packages.length === 0) {
    warnings.push(issue('warning', 'packages', 'Marketplace has no character packages.'));
  }

  const seenNames = new Map<string, number>();
  for (const [index, entry] of marketplace.packages.entries()) {
    const key = `${entry.name}@${entry.version}`;
    const firstIndex = seenNames.get(key);
    if (firstIndex !== undefined) {
      errors.push(issue('error', `packages[${index}].name`, `Duplicate package/version also appears at packages[${firstIndex}].`));
    } else {
      seenNames.set(key, index);
    }

    await validateMarketplaceEntry(resolvedPath, entry, index, errors, warnings);
  }

  if (!marketplace.description && !marketplace.metadata?.homepage) {
    warnings.push(issue('warning', 'description', 'Marketplace should include a description or homepage for discovery.'));
  }

  return {
    success: errors.length === 0,
    marketplacePath: resolvedPath,
    marketplace,
    errors,
    warnings,
  };
}

export function listCharacterMarketplacePackages(marketplace: CharacterMarketplace, marketplacePath: string): CharacterMarketplaceListItem[] {
  const marketplaceDir = dirname(resolveMarketplaceJsonPath(marketplacePath));
  return marketplace.packages.map(entry => {
    const source = describeSource(entry.source);
    return {
      name: entry.name,
      version: entry.version,
      displayName: entry.displayName,
      description: entry.description,
      source,
      installHint: buildInstallHint(entry, marketplaceDir),
      sha256: entry.sha256 ?? sourceSha(entry.source),
      categories: entry.categories ?? [],
      tags: entry.tags ?? entry.metadata?.tags ?? [],
    };
  });
}

export function resolveMarketplacePackageSource(marketplacePath: string, entry: CharacterMarketplaceEntry): string | undefined {
  const marketplaceDir = dirname(resolveMarketplaceJsonPath(marketplacePath));
  const source = entry.source;
  if (typeof source === 'string') return safeResolve(marketplaceDir, source);
  if (source.type === 'file' || source.type === 'directory') return safeResolve(marketplaceDir, source.path);
  return undefined;
}

function resolveMarketplaceJsonPath(inputPath: string): string {
  const resolved = resolve(inputPath);
  if (existsSync(resolved)) {
    const stats = statSyncSafe(resolved);
    if (stats?.isDirectory()) return join(resolved, 'marketplace.json');
  }
  return extname(resolved).toLowerCase() === '.json' ? resolved : join(resolved, 'marketplace.json');
}

async function validateMarketplaceEntry(
  marketplacePath: string,
  entry: CharacterMarketplaceEntry,
  index: number,
  errors: CharacterMarketplaceIssue[],
  warnings: CharacterMarketplaceIssue[],
): Promise<void> {
  const localSource = resolveMarketplacePackageSource(marketplacePath, entry);
  if (!localSource) {
    if (!entry.sha256 && !sourceSha(entry.source)) {
      warnings.push(issue('warning', `packages[${index}].sha256`, 'Remote package should include sha256 before install is enabled.'));
    }
    return;
  }

  if (!existsSync(localSource)) {
    errors.push(issue('error', `packages[${index}].source`, `Package source does not exist: ${describeSource(entry.source)}`));
    return;
  }

  const validation = await validateCharacterPackage(localSource);
  for (const error of validation.errors) {
    errors.push(issue('error', `packages[${index}].source:${error.path}`, error.message));
  }
  for (const warning of validation.warnings) {
    warnings.push(issue('warning', `packages[${index}].source:${warning.path}`, warning.message));
  }

  if (validation.manifest) {
    if (validation.manifest.name !== entry.name) {
      errors.push(issue('error', `packages[${index}].name`, `Marketplace entry name "${entry.name}" does not match manifest "${validation.manifest.name}".`));
    }
    if (validation.manifest.version !== entry.version) {
      warnings.push(issue('warning', `packages[${index}].version`, `Entry version "${entry.version}" differs from manifest "${validation.manifest.version}". Install uses manifest version.`));
    }
    if (validation.manifest.displayName !== entry.displayName) {
      warnings.push(issue('warning', `packages[${index}].displayName`, 'Entry displayName differs from manifest displayName.'));
    }
  } else {
    errors.push(issue('error', `packages[${index}].source`, 'Package validation did not return a manifest.'));
  }
}

function buildInstallHint(entry: CharacterMarketplaceEntry, marketplaceDir: string): string {
  const source = entry.source;
  if (typeof source === 'string') return `/character install ${safeResolve(marketplaceDir, source) ?? source}`;
  if (source.type === 'file' || source.type === 'directory') return `/character install ${safeResolve(marketplaceDir, source.path) ?? source.path}`;
  return `下载 ${source.url} 后执行 /character verify <file> --sha256 ${source.sha256 ?? '<sha256>'}`;
}

function describeSource(source: CharacterMarketplaceSource): string {
  if (typeof source === 'string') return source;
  if (source.type === 'file' || source.type === 'directory') return `${source.type}:${source.path}`;
  return `url:${source.url}`;
}

function sourceSha(source: CharacterMarketplaceSource): string | undefined {
  return typeof source === 'object' && source.type === 'url' ? source.sha256 : undefined;
}

function safeResolve(baseDir: string, packagePath: string): string | undefined {
  if (isAbsolute(packagePath) || /^[a-zA-Z]:[\\/]/.test(packagePath) || /^https?:\/\//i.test(packagePath)) return undefined;
  const target = resolve(baseDir, packagePath);
  const base = resolve(baseDir);
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return target;
}

function pushParseError(errors: CharacterMarketplaceIssue[], path: string, error: unknown): void {
  if (error instanceof ZodError) {
    for (const item of error.issues) {
      errors.push(issue('error', `${path}${item.path.length ? `#${item.path.join('.')}` : ''}`, item.message));
    }
    return;
  }
  errors.push(issue('error', path, error instanceof Error ? error.message : String(error)));
}

function issue(
  severity: CharacterMarketplaceIssueSeverity,
  path: string,
  message: string,
): CharacterMarketplaceIssue {
  return { severity, path, message };
}

function statSyncSafe(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}
