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
import {
  readCharacterPackageInstallMetadata,
  writeCharacterPackageInstallMetadata,
} from './CharacterPackageInstallMetadata.js';
import { checkRoxyCodeVersionCompatibility } from './VersionCompatibility.js';
import {
  StoreClient,
  type StoreClientOptions,
  type StoreDownloadResult,
} from '../marketplace/StoreClient.js';

export interface InstallOptions {
  global?: boolean;
  force?: boolean;
  cwd?: string;
  paths?: CharacterPackageInstallPaths;
}

export interface RemoteInstallOptions extends InstallOptions {
  /** StoreClient 配置（baseUrl 必须） */
  storeOptions: StoreClientOptions;
  /** 指定版本，省略则安装最新 */
  version?: string;
}

export interface RemoteInstallResult extends InstallResult {
  download: StoreDownloadResult;
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
  warnings: string[];
}

export interface UninstallResult {
  packageName: string;
  installPath: string;
  scope: 'global' | 'project';
  characterId?: string;
}

export interface UpdateResult extends InstallResult {
  previousVersion?: string;
}

export type PreparedCharacterPackageSource = {
  path: string;
  cleanup?: () => Promise<void>;
};

const MAX_ARCHIVE_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1000;
const UNIX_SYMLINK_MODE = 0o120000;

export class CharacterPackageManager {
  constructor(private readonly cwd: string = process.cwd()) {}

  async installPackage(packagePath: string, options: InstallOptions = {}): Promise<InstallResult> {
    const scope = options.global ? 'global' : 'project';
    const installRoot = await this.getInstallRoot(options);
    const source = await prepareCharacterPackageSource(packagePath);

    try {
      const manifest = await readPackageManifest(source.path);
      const compatibility = await checkRoxyCodeVersionCompatibility(manifest.engines?.roxycode);
      const warnings: string[] = [];
      if (compatibility.warning) warnings.push(compatibility.warning);
      if (!compatibility.compatible) {
        const message = `Character package ${manifest.name}@${manifest.version} requires RoxyCode ${compatibility.range ?? 'unknown'}, current version is ${compatibility.currentVersion}.`;
        if (!options.force) throw new Error(`${message} Use --force to install anyway.`);
        warnings.push(`${message} Installed because --force was used.`);
      }

      const targetDir = safeJoin(installRoot, manifest.name);
      const existed = existsSync(targetDir);
      const previousMetadata = existed
        ? await readCharacterPackageInstallMetadata(targetDir).catch(() => undefined)
        : undefined;

      if (existed && !options.force) {
        throw new Error(`Character package already installed: ${manifest.name}. Use force to overwrite.`);
      }

      const stagedParent = await mkdtemp(join(installRoot, `.install-${manifest.name}-`));
      const stagedDir = join(stagedParent, manifest.name);
      try {
        await cp(source.path, stagedDir, { recursive: true });
        const character = await loadCharacterFromDirectory(stagedDir, scope);
        const now = new Date().toISOString();
        const installedAt = previousMetadata?.installedAt ?? now;
        await writeCharacterPackageInstallMetadata(stagedDir, {
          packageName: manifest.name,
          version: manifest.version,
          scope,
          installPath: targetDir,
          installedAt,
          updatedAt: previousMetadata ? nextTimestampAfter(now, installedAt) : now,
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
          warnings,
        };
      } catch (error) {
        await rm(stagedParent, { recursive: true, force: true });
        throw error;
      }
    } finally {
      await source.cleanup?.();
    }
  }

  /**
   * 从 RoxyStore 商城安装：下载到本地缓存 → 强制本地 SHA-256 校验 → 走本地安装。
   *
   * 安全约定：即便 StoreClient 已在下载时比对过 sha256，这里仍以"下载得到的本地
   * .roxychar 文件"为准走完整的本地安装校验链（manifest/character schema、版本兼容、
   * Zip Slip 防护）。服务端返回的风险等级仅作为提示透传给调用方展示。
   */
  async installFromStore(packageName: string, options: RemoteInstallOptions): Promise<RemoteInstallResult> {
    const client = new StoreClient(options.storeOptions);
    const download = await client.downloadToCache(packageName, options.version);

    if (download.expectedSha256 && !download.verified) {
      await rm(download.filePath, { force: true });
      throw new Error(`SHA-256 校验失败，已放弃安装：${packageName}@${download.version}。`);
    }

    const result = await this.installPackage(download.filePath, {
      global: options.global,
      force: options.force,
      cwd: options.cwd,
      paths: options.paths,
    });

    return { ...result, download };
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

    const character = await loadCharacterFromDirectory(targetDir, scope).catch(() => undefined);
    await rm(targetDir, { recursive: true, force: true });
    return { packageName, installPath: targetDir, scope, characterId: character?.id };
  }

  async listInstalledPackages(options: { cwd?: string; paths?: CharacterPackageInstallPaths } = {}): Promise<InstalledCharacterPackage[]> {
    const paths = options.paths ?? getCustomCharacterPaths(options.cwd ?? this.cwd);
    const result: InstalledCharacterPackage[] = [];
    result.push(...await listInstalledFromRoot(paths.project, 'project'));
    result.push(...await listInstalledFromRoot(paths.global, 'global'));
    return result;
  }

  async getInstalledPackage(packageName: string, options: { cwd?: string; paths?: CharacterPackageInstallPaths; global?: boolean } = {}): Promise<InstalledCharacterPackage | undefined> {
    const packages = await this.listInstalledPackages(options);
    const requiredScope = typeof options.global === 'boolean'
      ? options.global ? 'global' : 'project'
      : undefined;
    return packages.find(pkg => pkg.name === packageName && (!requiredScope || pkg.scope === requiredScope));
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
  const source = await prepareCharacterPackageSource(packagePath);
  try {
    return await readPackageManifest(source.path);
  } finally {
    await source.cleanup?.();
  }
}

export async function prepareCharacterPackageSource(packagePath: string): Promise<PreparedCharacterPackageSource> {
  const resolved = resolve(packagePath);
  if (!existsSync(resolved)) throw new Error(`Character package source does not exist: ${packagePath}`);

  const extension = extname(resolved).toLowerCase();
  if (extension === '.roxychar' || extension === '.zip') {
    const tempRoot = await mkdtemp(join(tmpdir(), 'roxy-character-package-'));
    try {
      await extractZipSafely(resolved, tempRoot);
      const packageRoot = await findExtractedPackageRoot(tempRoot);
      return {
        path: packageRoot,
        cleanup: () => rm(tempRoot, { recursive: true, force: true }),
      };
    } catch (error) {
      await rm(tempRoot, { recursive: true, force: true });
      throw error;
    }
  }

  return { path: resolved };
}

async function extractZipSafely(zipPath: string, destination: string): Promise<void> {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`Character archive has too many entries: ${entries.length} > ${MAX_ARCHIVE_ENTRIES}.`);
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  const preparedEntries: Array<{ entry: AdmZip.IZipEntry; targetPath: string }> = [];

  for (const entry of entries) {
    const entryName = entry.entryName.replace(/\\/g, '/');
    if (
      !entryName
      || entryName.startsWith('/')
      || entryName.includes('\0')
      || hasControlCharacters(entryName)
      || entryName.split('/').includes('..')
    ) {
      throw new Error(`Unsafe zip entry path: ${entry.entryName}`);
    }
    if (isZipSymlink(entry)) {
      throw new Error(`Character archive must not contain symlinks: ${entry.entryName}`);
    }

    const normalizedEntryName = normalizeZipEntryName(entryName);
    if (seen.has(normalizedEntryName)) {
      throw new Error(`Duplicate zip entry would overwrite a previous file: ${entry.entryName}`);
    }
    seen.add(normalizedEntryName);

    const targetPath = safeJoin(destination, entryName);
    if (entry.isDirectory) {
      preparedEntries.push({ entry, targetPath });
      continue;
    }

    const entrySize = entry.header.size;
    if (entrySize > MAX_ARCHIVE_FILE_BYTES) {
      throw new Error(`Character archive file is too large: ${entry.entryName} (${entrySize} bytes).`);
    }
    totalBytes += entrySize;
    if (totalBytes > MAX_ARCHIVE_TOTAL_BYTES) {
      throw new Error(`Character archive uncompressed size is larger than 50MB.`);
    }

    preparedEntries.push({ entry, targetPath });
  }

  for (const { entry, targetPath } of preparedEntries) {
    if (entry.isDirectory) {
      await mkdir(targetPath, { recursive: true });
      continue;
    }
    await mkdir(resolve(targetPath, '..'), { recursive: true });
    await writeFile(targetPath, entry.getData());
  }
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value);
}

function normalizeZipEntryName(value: string): string {
  return value.replace(/\/+$/, '').toLowerCase();
}

function isZipSymlink(entry: AdmZip.IZipEntry): boolean {
  const attr = entry.header.attr ?? 0;
  const unixMode = (attr >>> 16) & 0o170000;
  return unixMode === UNIX_SYMLINK_MODE;
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

function nextTimestampAfter(candidate: string, previous: string): string {
  if (candidate !== previous) return candidate;
  return new Date(new Date(previous).getTime() + 1).toISOString();
}
