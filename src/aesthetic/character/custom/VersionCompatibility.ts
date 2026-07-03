import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface VersionCompatibilityResult {
  currentVersion: string;
  range?: string;
  compatible: boolean;
  warning?: string;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const RANGE_PART = /^(>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

export async function checkRoxyCodeVersionCompatibility(range?: string): Promise<VersionCompatibilityResult> {
  const currentVersion = await getCurrentRoxyCodeVersion();
  const normalizedRange = range?.trim();

  if (!normalizedRange) {
    return {
      currentVersion,
      compatible: true,
      warning: 'Missing engines.roxycode. Character package compatibility cannot be checked.',
    };
  }

  try {
    return {
      currentVersion,
      range: normalizedRange,
      compatible: satisfiesRange(currentVersion, normalizedRange),
    };
  } catch (error) {
    return {
      currentVersion,
      range: normalizedRange,
      compatible: false,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getCurrentRoxyCodeVersion(): Promise<string> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    await findPackageJson(moduleDir),
    await findPackageJson(process.cwd()),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const parsed = JSON.parse(await readFile(candidate, 'utf-8')) as Record<string, unknown>;
    if (parsed.name === 'roxycode' && typeof parsed.version === 'string') return parsed.version;
  }

  return '0.0.0';
}

export function satisfiesRange(version: string, range: string): boolean {
  const normalized = range.trim();
  if (!normalized || normalized === '*') return true;

  if (normalized.startsWith('^')) {
    return satisfiesCaret(version, normalized.slice(1).trim());
  }

  const parts = normalized
    .replace(/(>=|<=|>|<|=)\s+(\d)/g, '$1$2')
    .split(/\s+/)
    .filter(Boolean);
  return parts.every(part => satisfiesComparator(version, part));
}

function satisfiesComparator(version: string, comparator: string): boolean {
  const match = comparator.match(RANGE_PART);
  if (!match) throw new Error(`Unsupported roxycode engine range: ${comparator}`);

  const operator = match[1] ?? '=';
  const target = match[2]!;
  const compared = compareSemver(version, target);

  switch (operator) {
    case '>':
      return compared > 0;
    case '>=':
      return compared >= 0;
    case '<':
      return compared < 0;
    case '<=':
      return compared <= 0;
    case '=':
      return compared === 0;
    default:
      return false;
  }
}

function satisfiesCaret(version: string, base: string): boolean {
  const baseParts = parseSemver(base);
  const upper = `${baseParts.major + 1}.0.0`;
  return compareSemver(version, base) >= 0 && compareSemver(version, upper) < 0;
}

function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  return 0;
}

function parseSemver(version: string): { major: number; minor: number; patch: number } {
  const match = version.match(SEMVER);
  if (!match) throw new Error(`Invalid SemVer: ${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

async function findPackageJson(startDir: string): Promise<string | undefined> {
  let current = resolve(startDir);
  while (true) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
