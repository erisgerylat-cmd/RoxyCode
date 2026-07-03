import AdmZip from 'adm-zip';
import { existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ManifestSchema, type Manifest } from '../CharacterSchema.js';
import type { Character } from '../types.js';
import { getCustomCharacterPaths, loadCharacterFromDirectory } from './CustomCharacterLoader.js';

export interface InstallOptions {
  global?: boolean;
  force?: boolean;
  cwd?: string;
  paths?: CharacterPackageInstallPaths;
}

export interface UninstallOptions {
  global?: boolean;
  cwd?: string;
  paths?: CharacterPackageInstallPaths;
}

export interface UpdateOptions extends InstallOptions {}

export interface CharacterPackageInstallPaths {
  global: string;
  project: string;
}

export interface InstalledCharacterPackage {
  name: string;
  version: string;
  displayName: string;
  description: string;
  installPath: string;
  scope: 'global' | 'project';
  manifest: Manifest;
}

export interface InstallResult {
  manifest: Manifest;
  character: Character;
  installPath: string;
  scope: 'global' | 'project';
  updated: boolean;
}

export interface UninstallResult {
  packageName: string;
  installPath: string;
  scope: 'global' | 'project';
}

export interface UpdateResult extends InstallResult {
  previousVersion?: string;
}

type PackageSource = {
  path: string;
  cleanup?: () => Promise<void>;
};

export class CharacterPackageManager {
  constructor(private readonly cwd: string = process.cwd()) {}

  async installPackage(packagePath: string, options: InstallOptions = {}): Promise<InstallResult> {
    const scope = options.global ? 'global' : 'project';
    const installRoot = await this.getInstallRoot(options);
    const source = await preparePackageSource(packagePath);

    try {
      const manifest = await readPackageManifest(source.path);
      const targetDir = safeJoin(installRoot, manifest.name);
      const existed = existsSync(targetDir);

      if (existed && !options.force) {
        throw new Error(`Character package already installed: ${manifest.name}. Use force to overwrite.`);
      }

      const stagedParent = await mkdtemp(join(installRoot, `.install-${manifest.name}-`));
      const stagedDir = join(stagedParent, manifest.name);
      try {
        await cp(source.path, stagedDir, { recursive: true });
        const character = await loadCharacterFromDirectory(stagedDir, scope);
        await writeInstallMetadata(stagedDir, {
          packageName: manifest.name,
          version: manifest.version,
          scope,
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourcePath: resolve(packagePath),
        });

        if (existed) await rm(targetDir, { recursive: true, force: true });
        await rename(stagedDir, targetDir);
        await rm(stagedParent, { recursive: true, force: true });

        const installedCharacter = await loadCharacterFromDirectory(targetDir, scope);
        return {
          manifest,
          character: installedCharacter,
          installPath: targetDir,
          scope,
          updated: existed,
        };
      } catch (error) {
        await rm(stagedParent, { recursive: true, force: true });
        throw error;
      }
    } finally {
      await source.cleanup?.();
    }
  }

  async updatePackage(packagePath: string, options: UpdateOptions = {}): Promise<UpdateResult> {
    const manifest = await readManifestFromAnyPackage(packagePath);
    const existing = await this.getInstalledPackage(manifest.name, options);
    if (!existing) {
      throw new Error(`Character package is not installed: ${manifest.name}`);
    }

    const result = await this.installPackage(packagePath, { ...options, global: existing.scope === 'global', force: true });
    return {
      ...result,
      previousVersion: existing.version,
    };
  }

  async uninstallPackage(packageName: string, options: UninstallOptions = {}): Promise<UninstallResult> {
    const scope = options.global ? 'global' : 'project';
    const installRoot = await this.getInstallRoot(options);
    const targetDir = safeJoin(installRoot, packageName);

    if (!existsSync(targetDir)) {
      throw new Error(`Character package is not installed: ${packageName}`);
    }

    await rm(targetDir, { recursive: true, force: true });
    return { packageName, installPath: targetDir, scope };
  }

  async listInstalledPackages(options: { cwd?: string; paths?: CharacterPackageInstallPaths } = {}): Promise<InstalledCharacterPackage[]> {
    const paths = options.paths ?? getCustomCharacterPaths(options.cwd ?? this.cwd);
    const result: InstalledCharacterPackage[] = [];
    result.push(...await listInstalledFromRoot(paths.global, 'global'));
    result.push(...await listInstalledFromRoot(paths.project, 'project'));
    return result;
  }

  async getInstalledPackage(packageName: string, options: { cwd?: string; paths?: CharacterPackageInstallPaths } = {}): Promise<InstalledCharacterPackage | undefined> {
    const packages = await this.listInstalledPackages(options);
    return packages.find(pkg => pkg.name === packageName);
  }

  private async getInstallRoot(options: InstallOptions | UninstallOptions): Promise<string> {
    const paths = options.paths ?? getCustomCharacterPaths(options.cwd ?? this.cwd);
    const installRoot = options.global ? paths.global : paths.project;
    await mkdir(installRoot, { recursive: true });
    return installRoot;
  }
}

export async function installCharacterPackage(packagePath: string, options: InstallOptions = {}): Promise<InstallResult> {
  return new CharacterPackageManager(options.cwd).installPackage(packagePath, options);
}

export async function updateCharacterPackage(packagePath: string, options: UpdateOptions = {}): Promise<UpdateResult> {
  return new CharacterPackageManager(options.cwd).updatePackage(packagePath, options);
}

export async function uninstallCharacterPackage(packageName: string, options: UninstallOptions = {}): Promise<UninstallResult> {
  return new CharacterPackageManager(options.cwd).uninstallPackage(packageName, options);
}

export async function readPackageManifest(packageRoot: string): Promise<Manifest> {
  const manifestPath = join(packageRoot, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('Missing manifest.json');
  const parsed = JSON.parse(await readFile(manifestPath, 'utf-8')) as unknown;
  return ManifestSchema.parse(parsed);
}

async function readManifestFromAnyPackage(packagePath: string): Promise<Manifest> {
  const source = await preparePackageSource(packagePath);
  try {
    return await readPackageManifest(source.path);
  } finally {
    await source.cleanup?.();
  }
}

async function preparePackageSource(packagePath: string): Promise<PackageSource> {
  const resolved = resolve(packagePath);
  if (!existsSync(resolved)) throw new Error(`Character package source does not exist: ${packagePath}`);

  const extension = extname(resolved).toLowerCase();
  if (extension === '.roxychar' || extension === '.zip') {
    const tempRoot = await mkdtemp(join(tmpdir(), 'roxy-character-package-'));
    await extractZipSafely(resolved, tempRoot);
    const packageRoot = await findExtractedPackageRoot(tempRoot);
    return {
      path: packageRoot,
      cleanup: () => rm(tempRoot, { recursive: true, force: true }),
    };
  }

  return { path: resolved };
}

async function extractZipSafely(zipPath: string, destination: string): Promise<void> {
  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    const entryName = entry.entryName.replace(/\\/g, '/');
    if (!entryName || entryName.startsWith('/') || entryName.includes('\0')) {
      throw new Error(`Unsafe zip entry path: ${entry.entryName}`);
    }
    const targetPath = safeJoin(destination, entryName);
    if (entry.isDirectory) {
      await mkdir(targetPath, { recursive: true });
      continue;
    }
    await mkdir(resolve(targetPath, '..'), { recursive: true });
    await writeFile(targetPath, entry.getData());
  }
}

async function findExtractedPackageRoot(tempRoot: string): Promise<string> {
  if (existsSync(join(tempRoot, 'manifest.json'))) return tempRoot;
  const entries = await readdir(tempRoot, { withFileTypes: true });
  const dirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
  if (dirs.length === 1 && existsSync(join(tempRoot, dirs[0]!.name, 'manifest.json'))) {
    return join(tempRoot, dirs[0]!.name);
  }
  throw new Error('Character archive must contain manifest.json at root or in a single top-level directory.');
}

async function listInstalledFromRoot(root: string, scope: 'global' | 'project'): Promise<InstalledCharacterPackage[]> {
  if (!existsSync(root)) return [];
  const packages: InstalledCharacterPackage[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const installPath = join(root, entry.name);
    try {
      const manifest = await readPackageManifest(installPath);
      packages.push({
        name: manifest.name,
        version: manifest.version,
        displayName: manifest.displayName,
        description: manifest.description,
        installPath,
        scope,
        manifest,
      });
    } catch {
      // Legacy single-file custom characters are intentionally not package-manager entries.
    }
  }

  return packages;
}

async function writeInstallMetadata(packageDir: string, metadata: Record<string, unknown>): Promise<void> {
  await mkdir(join(packageDir, '.roxycode'), { recursive: true });
  await writeFile(join(packageDir, '.roxycode', 'install.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
}

function safeJoin(baseDir: string, relativePath: string): string {
  if (isAbsolute(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
    throw new Error(`Path must be relative: ${relativePath}`);
  }
  const target = resolve(baseDir, relativePath);
  const base = resolve(baseDir);
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path escapes base directory: ${relativePath}`);
  }
  return target;
}
