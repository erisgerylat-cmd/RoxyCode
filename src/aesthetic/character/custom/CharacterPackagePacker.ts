import AdmZip from 'adm-zip';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readPackageManifest } from './CharacterPackageManager.js';
import { validateCharacterPackage, type CharacterPackageValidationIssue } from './CharacterPackageValidator.js';

export interface CharacterPackagePackOptions {
  outDir?: string;
  force?: boolean;
}

export interface CharacterPackagePackResult {
  packagePath: string;
  packageName: string;
  version: string;
  files: string[];
  warnings: CharacterPackageValidationIssue[];
  sizeBytes: number;
}

const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const DEFAULT_IGNORE_PATTERNS = [
  '.git/',
  'node_modules/',
  '.DS_Store',
  'Thumbs.db',
  '*.tmp',
  '*.temp',
  '*.log',
  '*.bak',
  '~$*',
];

export async function packCharacterPackage(
  packageDir: string,
  options: CharacterPackagePackOptions = {},
): Promise<CharacterPackagePackResult> {
  const root = resolve(packageDir);
  const validation = await validateCharacterPackage(root);
  if (!validation.success) {
    const details = validation.errors.map(error => `${error.path}: ${error.message}`).join('; ');
    throw new Error(`Character package validation failed: ${details}`);
  }

  const manifest = await readPackageManifest(root);
  const outDir = resolve(options.outDir ?? join(root, '..'));
  const outputPath = join(outDir, `${manifest.name}-${manifest.version}.roxychar`);
  if (existsSync(outputPath) && !options.force) {
    throw new Error(`Character archive already exists: ${outputPath}. Use --force to overwrite.`);
  }

  const ignorePatterns = await loadIgnorePatterns(root);
  const files = await collectPackageFiles(root, ignorePatterns);
  const sizeBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (sizeBytes > MAX_PACKAGE_BYTES) {
    throw new Error(`Character package is larger than 50MB: ${sizeBytes} bytes.`);
  }

  const zip = new AdmZip();
  for (const file of files) {
    zip.addLocalFile(file.fullPath, dirnameForZip(file.relativePath), basename(file.relativePath));
  }

  await mkdir(outDir, { recursive: true });
  zip.writeZip(outputPath);
  const archiveStat = await stat(outputPath);

  return {
    packagePath: outputPath,
    packageName: manifest.name,
    version: manifest.version,
    files: files.map(file => file.relativePath),
    warnings: validation.warnings,
    sizeBytes: archiveStat.size,
  };
}

async function collectPackageFiles(
  root: string,
  ignorePatterns: string[],
  relativeDir = '',
): Promise<Array<{ fullPath: string; relativePath: string; size: number }>> {
  const currentDir = relativeDir ? join(root, relativeDir) : root;
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: Array<{ fullPath: string; relativePath: string; size: number }> = [];

  for (const entry of entries) {
    const relativePath = toPackagePath(relativeDir ? join(relativeDir, entry.name) : entry.name);
    if (isIgnored(relativePath, entry.isDirectory(), ignorePatterns)) continue;

    const fullPath = join(currentDir, entry.name);
    if (!isInside(root, fullPath)) continue;

    if (entry.isDirectory()) {
      files.push(...await collectPackageFiles(root, ignorePatterns, relativePath));
      continue;
    }

    if (!entry.isFile()) continue;
    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_PACKAGE_BYTES) {
      throw new Error(`Character package file is larger than 50MB: ${relativePath}`);
    }
    files.push({ fullPath, relativePath, size: fileStat.size });
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function loadIgnorePatterns(root: string): Promise<string[]> {
  const ignorePath = join(root, '.roxycharignore');
  if (!existsSync(ignorePath)) return DEFAULT_IGNORE_PATTERNS;
  const custom = (await readFile(ignorePath, 'utf-8'))
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  return [...DEFAULT_IGNORE_PATTERNS, ...custom];
}

function isIgnored(relativePath: string, isDirectory: boolean, patterns: string[]): boolean {
  return patterns.some(pattern => matchesIgnorePattern(relativePath, isDirectory, pattern));
}

function matchesIgnorePattern(relativePath: string, isDirectory: boolean, pattern: string): boolean {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized) return false;

  if (normalized.endsWith('/')) {
    const dirPattern = normalized.slice(0, -1);
    return isDirectory
      ? relativePath === dirPattern || relativePath.startsWith(`${dirPattern}/`)
      : relativePath.startsWith(`${dirPattern}/`);
  }

  if (normalized.includes('*')) {
    return globToRegExp(normalized).test(relativePath) || globToRegExp(normalized).test(basename(relativePath));
  }

  return relativePath === normalized || basename(relativePath) === normalized;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

function dirnameForZip(relativePath: string): string {
  const index = relativePath.lastIndexOf('/');
  return index === -1 ? '' : relativePath.slice(0, index);
}

function toPackagePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
