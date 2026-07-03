import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CharacterPackageInstallMetadata {
  packageName: string;
  version: string;
  scope: 'global' | 'project';
  installPath: string;
  installedAt: string;
  updatedAt: string;
  sourcePath?: string;
}

const INSTALL_METADATA_PATH = ['.roxycode', 'install.json'] as const;

export async function readCharacterPackageInstallMetadata(packageDir: string): Promise<CharacterPackageInstallMetadata | undefined> {
  const metadataPath = getInstallMetadataPath(packageDir);
  if (!existsSync(metadataPath)) return undefined;

  const parsed = JSON.parse(await readFile(metadataPath, 'utf-8')) as unknown;
  return isInstallMetadata(parsed) ? parsed : undefined;
}

export async function writeCharacterPackageInstallMetadata(
  packageDir: string,
  metadata: CharacterPackageInstallMetadata,
): Promise<void> {
  await mkdir(join(packageDir, INSTALL_METADATA_PATH[0]), { recursive: true });
  await writeFile(getInstallMetadataPath(packageDir), `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
}

export function getInstallMetadataPath(packageDir: string): string {
  return join(packageDir, ...INSTALL_METADATA_PATH);
}

function isInstallMetadata(value: unknown): value is CharacterPackageInstallMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.packageName === 'string'
    && typeof raw.version === 'string'
    && (raw.scope === 'global' || raw.scope === 'project')
    && typeof raw.installPath === 'string'
    && typeof raw.installedAt === 'string'
    && typeof raw.updatedAt === 'string'
    && (raw.sourcePath === undefined || typeof raw.sourcePath === 'string');
}
