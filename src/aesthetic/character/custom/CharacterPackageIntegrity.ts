import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export interface CharacterPackageIntegrityResult {
  path: string;
  sha256: string;
  algorithm: 'sha256';
  sidecarPath?: string;
}

export interface CharacterPackageVerifyOptions {
  sha256?: string;
  sidecarPath?: string;
}

export interface CharacterPackageVerifyResult extends CharacterPackageIntegrityResult {
  expectedSha256?: string;
  verified: boolean;
}

export async function computeCharacterPackageSha256(packagePath: string): Promise<CharacterPackageIntegrityResult> {
  const resolvedPath = resolve(packagePath);
  const sha256 = await hashFile(resolvedPath);
  return {
    path: resolvedPath,
    sha256,
    algorithm: 'sha256',
  };
}

export async function writeCharacterPackageSha256Sidecar(packagePath: string, sha256?: string): Promise<CharacterPackageIntegrityResult> {
  const integrity = sha256
    ? { path: resolve(packagePath), sha256, algorithm: 'sha256' as const }
    : await computeCharacterPackageSha256(packagePath);
  assertSha256(integrity.sha256);
  const sidecarPath = `${integrity.path}.sha256`;
  await writeFile(sidecarPath, `${integrity.sha256}  ${basenameForSidecar(integrity.path)}\n`, 'utf-8');
  return { ...integrity, sidecarPath };
}

export async function verifyCharacterPackageIntegrity(
  packagePath: string,
  options: CharacterPackageVerifyOptions = {},
): Promise<CharacterPackageVerifyResult> {
  const integrity = await computeCharacterPackageSha256(packagePath);
  const expectedSha256 = options.sha256 ?? await readExpectedSha256(packagePath, options.sidecarPath);
  if (!expectedSha256) {
    return {
      ...integrity,
      verified: false,
    };
  }

  assertSha256(expectedSha256);
  return {
    ...integrity,
    expectedSha256: expectedSha256.toLowerCase(),
    verified: integrity.sha256.toLowerCase() === expectedSha256.toLowerCase(),
  };
}

export function assertSha256(value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error('sha256 must be a 64-character hex digest.');
  }
}

async function readExpectedSha256(packagePath: string, sidecarPath?: string): Promise<string | undefined> {
  const resolvedSidecar = resolve(sidecarPath ?? `${resolve(packagePath)}.sha256`);
  if (!existsSync(resolvedSidecar)) return undefined;
  const content = await readFile(resolvedSidecar, 'utf-8');
  const firstToken = content.trim().split(/\s+/)[0];
  return firstToken || undefined;
}

async function hashFile(filePath: string): Promise<string> {
  if (!existsSync(filePath)) throw new Error(`Character package file does not exist: ${filePath}`);

  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function basenameForSidecar(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}
