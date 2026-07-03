import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectProjectProfile, type ProjectProfile } from '../../project/index.js';

export interface DependencyScanResult {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

export interface TestFrameworkInfo {
  framework: string;
  source: 'dependency' | 'config' | 'script';
}

export interface LintConfigInfo {
  tool: string;
  source: 'dependency' | 'config' | 'script';
  path?: string;
}

export class ProjectScanner {
  constructor(private readonly cwd: string = process.cwd()) {}

  async scanProject(): Promise<ProjectProfile> {
    return detectProjectProfile(this.cwd);
  }

  async scanDependencies(): Promise<DependencyScanResult> {
    const pkg = await this.readPackageJson();
    return {
      dependencies: readDependencyRecord(pkg?.dependencies),
      devDependencies: readDependencyRecord(pkg?.devDependencies),
      peerDependencies: readDependencyRecord(pkg?.peerDependencies),
    };
  }

  async detectFramework(): Promise<string[]> {
    return (await this.scanProject()).frameworks;
  }

  async detectLanguages(): Promise<string[]> {
    return (await this.scanProject()).languages;
  }

  async detectTestFramework(): Promise<TestFrameworkInfo[]> {
    const pkg = await this.readPackageJson();
    const deps = mergeDependencies(pkg);
    const scripts = readScripts(pkg);
    const result: TestFrameworkInfo[] = [];
    for (const candidate of ['vitest', 'jest', 'mocha', 'playwright', 'cypress', 'pytest', 'go test', 'cargo test']) {
      if (candidate in deps) result.push({ framework: candidate, source: 'dependency' });
    }
    if (existsSync(join(this.cwd, 'vitest.config.ts')) || existsSync(join(this.cwd, 'vitest.config.js'))) {
      result.push({ framework: 'vitest', source: 'config' });
    }
    if (existsSync(join(this.cwd, 'jest.config.ts')) || existsSync(join(this.cwd, 'jest.config.js'))) {
      result.push({ framework: 'jest', source: 'config' });
    }
    for (const [name, script] of Object.entries(scripts)) {
      if (name.includes('test') || /\b(vitest|jest|mocha|playwright|cypress|pytest|go test|cargo test)\b/.test(script)) {
        result.push({ framework: script, source: 'script' });
      }
    }
    return dedupeBy(result, item => `${item.framework}:${item.source}`);
  }

  async detectLintConfig(): Promise<LintConfigInfo[]> {
    const pkg = await this.readPackageJson();
    const deps = mergeDependencies(pkg);
    const scripts = readScripts(pkg);
    const result: LintConfigInfo[] = [];
    for (const [tool, configPaths] of Object.entries(LINT_CONFIG_FILES)) {
      if (tool in deps) result.push({ tool, source: 'dependency' });
      for (const configPath of configPaths) {
        if (existsSync(join(this.cwd, configPath))) result.push({ tool, source: 'config', path: configPath });
      }
    }
    for (const [name, script] of Object.entries(scripts)) {
      if (name.includes('lint') || /\b(eslint|biome|prettier|ruff|golangci-lint|clippy)\b/.test(script)) {
        result.push({ tool: script, source: 'script' });
      }
    }
    return dedupeBy(result, item => `${item.tool}:${item.source}:${item.path ?? ''}`);
  }

  private async readPackageJson(): Promise<Record<string, unknown> | null> {
    try {
      return JSON.parse(await readFile(join(this.cwd, 'package.json'), 'utf-8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

const LINT_CONFIG_FILES: Record<string, string[]> = {
  eslint: ['eslint.config.js', 'eslint.config.mjs', '.eslintrc', '.eslintrc.json'],
  prettier: ['prettier.config.js', 'prettier.config.mjs', '.prettierrc', '.prettierrc.json'],
  biome: ['biome.json', 'biome.jsonc'],
  ruff: ['ruff.toml', 'pyproject.toml'],
  'golangci-lint': ['.golangci.yml', '.golangci.yaml'],
  clippy: ['Cargo.toml'],
};

function mergeDependencies(pkg: Record<string, unknown> | null): Record<string, string> {
  return {
    ...readDependencyRecord(pkg?.dependencies),
    ...readDependencyRecord(pkg?.devDependencies),
    ...readDependencyRecord(pkg?.peerDependencies),
  };
}

function readDependencyRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function readScripts(pkg: Record<string, unknown> | null): Record<string, string> {
  if (!pkg?.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts)) return {};
  return Object.fromEntries(Object.entries(pkg.scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
