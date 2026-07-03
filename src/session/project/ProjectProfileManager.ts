import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ProjectProfile } from '../../project/index.js';
import { ProjectScanner, type LintConfigInfo, type TestFrameworkInfo } from './ProjectScanner.js';
import { RoxyManifest, type RoxyManifestSummary } from './RoxyManifest.js';

export const SESSION_PROJECT_PROFILE_PATH = join('.roxycode', 'project.json');

export type ProjectProfilePatch = Partial<Omit<ProjectProfile, 'schemaVersion' | 'generatedAt'>>;

export class ProjectProfileManager {
  private readonly scanner: ProjectScanner;
  private readonly manifest: RoxyManifest;

  constructor(private readonly cwd: string = process.cwd()) {
    this.scanner = new ProjectScanner(cwd);
    this.manifest = new RoxyManifest(cwd);
  }

  getProjectProfilePath(): string {
    return join(this.cwd, SESSION_PROJECT_PROFILE_PATH);
  }

  getRoxyManifestPath(): string {
    return this.manifest.getPath();
  }

  async exists(): Promise<boolean> {
    return existsSync(this.getProjectProfilePath());
  }

  async load(): Promise<ProjectProfile | null> {
    const path = this.getProjectProfilePath();
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as unknown;
    return normalizeProjectProfile(parsed);
  }

  async save(profile: ProjectProfile): Promise<ProjectProfile> {
    const normalized = normalizeProjectProfile(profile);
    if (!normalized) throw new Error('Invalid RoxyCode project profile.');
    const path = this.getProjectProfilePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
    return normalized;
  }

  async update(patch: ProjectProfilePatch): Promise<ProjectProfile> {
    const existing = await this.load();
    if (!existing) throw new Error('Cannot update project profile before /project init or scanProject().');
    return this.save({
      ...existing,
      ...patch,
      generatedAt: new Date().toISOString(),
    });
  }

  async scanProject(): Promise<ProjectProfile> {
    return this.scanner.scanProject();
  }

  async refresh(): Promise<ProjectProfile> {
    return this.save(await this.scanProject());
  }

  async getProjectType(): Promise<ProjectProfile['structure']['kind']> {
    return (await this.load())?.structure.kind ?? (await this.scanProject()).structure.kind;
  }

  async getTestFramework(): Promise<TestFrameworkInfo[]> {
    return this.scanner.detectTestFramework();
  }

  async getLintConfig(): Promise<LintConfigInfo[]> {
    return this.scanner.detectLintConfig();
  }

  async loadRoxyManifest(): Promise<RoxyManifestSummary> {
    return this.manifest.load();
  }
}

export function normalizeProjectProfile(value: unknown): ProjectProfile | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.name !== 'string' || typeof value.root !== 'string') return null;
  const structure = isRecord(value.structure) ? value.structure : {};
  const roxy = isRecord(value.roxy) ? value.roxy : {};
  return {
    schemaVersion: 1,
    name: value.name,
    root: value.root,
    packageManager: asPackageManager(value.packageManager),
    languages: asStringArray(value.languages),
    frameworks: asStringArray(value.frameworks),
    scripts: asStringRecord(value.scripts),
    structure: {
      kind: asProjectKind(structure.kind),
      sourceDirs: asStringArray(structure.sourceDirs),
      testDirs: asStringArray(structure.testDirs),
      configFiles: asStringArray(structure.configFiles),
      aiInstructionFiles: asStringArray(structure.aiInstructionFiles),
    },
    roxy: {
      instructionsFile: roxy.instructionsFile === 'ROXY.md' ? 'ROXY.md' : 'ROXY.md',
      generatedBy: roxy.generatedBy === 'RoxyCode /project init' ? 'RoxyCode /project init' : 'RoxyCode /project init',
    },
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : new Date().toISOString(),
  };
}

function asPackageManager(value: unknown): ProjectProfile['packageManager'] {
  return value === 'pnpm' || value === 'npm' || value === 'yarn' || value === 'bun' || value === 'maven' ||
    value === 'gradle' || value === 'cargo' || value === 'go' || value === 'unknown'
    ? value
    : 'unknown';
}

function asProjectKind(value: unknown): ProjectProfile['structure']['kind'] {
  return value === 'single-package' || value === 'monorepo' || value === 'multi-module' || value === 'unknown'
    ? value
    : 'unknown';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
