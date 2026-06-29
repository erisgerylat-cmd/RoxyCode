import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Language } from '../i18n/index.js';
import type {
  ProjectInitOptions,
  ProjectInitResult,
  ProjectProfile,
  ProjectScripts,
  ProjectStructureSummary,
} from './types.js';

const PROJECT_JSON_PATH = join('.roxycode', 'project.json');
const ROXY_MD = 'ROXY.md';

export class ProjectInitializer {
  constructor(private readonly cwd: string = process.cwd()) {}

  async init(options: ProjectInitOptions = {}, language: Language = 'zh-CN'): Promise<ProjectInitResult> {
    const profile = await detectProject(this.cwd);
    const projectPath = join(this.cwd, PROJECT_JSON_PATH);
    const roxyPath = join(this.cwd, ROXY_MD);

    await mkdir(dirname(projectPath), { recursive: true });
    await writeFile(projectPath, `${JSON.stringify(profile, null, 2)}\n`, 'utf-8');

    let roxyWritten = false;
    if (options.force || !existsSync(roxyPath)) {
      await writeFile(roxyPath, renderRoxyMarkdown(profile, language), 'utf-8');
      roxyWritten = true;
    }

    return {
      roxyPath,
      projectPath,
      roxyWritten,
      projectWritten: true,
      profile,
    };
  }
}

async function detectProject(cwd: string): Promise<ProjectProfile> {
  const packageJson = await readJson(join(cwd, 'package.json'));
  const packageScripts = readPackageScripts(packageJson);
  const dependencies = readPackageDependencies(packageJson);
  const rootEntries = await safeReadDir(cwd);
  const configFiles = rootEntries.filter(entry => isConfigFile(entry));
  const aiInstructionFiles = rootEntries.filter(entry => isAiInstructionFile(entry));

  return {
    schemaVersion: 1,
    name: readProjectName(packageJson) ?? basename(cwd),
    root: cwd,
    packageManager: detectPackageManager(cwd),
    languages: detectLanguages(cwd, packageJson),
    frameworks: detectFrameworks(cwd, dependencies),
    scripts: packageScripts,
    structure: {
      kind: detectProjectKind(cwd, packageJson),
      sourceDirs: await detectDirs(cwd, ['src', 'app', 'pages', 'components', 'lib', 'packages', 'apps']),
      testDirs: await detectDirs(cwd, ['test', 'tests', '__tests__', 'spec', 'e2e']),
      configFiles,
      aiInstructionFiles,
    },
    roxy: {
      instructionsFile: 'ROXY.md',
      generatedBy: 'RoxyCode /project init',
    },
    generatedAt: new Date().toISOString(),
  };
}

function readProjectName(packageJson: Record<string, unknown> | null): string | undefined {
  return typeof packageJson?.name === 'string' ? packageJson.name : undefined;
}

function readPackageScripts(packageJson: Record<string, unknown> | null): ProjectScripts {
  const raw = packageJson?.scripts;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const scripts: ProjectScripts = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string') scripts[name] = value;
  }
  return scripts;
}

function readPackageDependencies(packageJson: Record<string, unknown> | null): Record<string, unknown> {
  return {
    ...readRecord(packageJson?.dependencies),
    ...readRecord(packageJson?.devDependencies),
    ...readRecord(packageJson?.peerDependencies),
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function safeReadDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function detectDirs(cwd: string, candidates: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const candidate of candidates) {
    if (existsSync(join(cwd, candidate))) result.push(candidate);
  }
  return result;
}

function detectPackageManager(cwd: string): ProjectProfile['packageManager'] {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun';
  if (existsSync(join(cwd, 'pom.xml'))) return 'maven';
  if (existsSync(join(cwd, 'build.gradle')) || existsSync(join(cwd, 'build.gradle.kts'))) return 'gradle';
  if (existsSync(join(cwd, 'Cargo.toml'))) return 'cargo';
  if (existsSync(join(cwd, 'go.mod'))) return 'go';
  return 'unknown';
}

function detectLanguages(cwd: string, packageJson: Record<string, unknown> | null): string[] {
  const languages = new Set<string>();
  if (packageJson) languages.add('JavaScript');
  if (existsSync(join(cwd, 'tsconfig.json'))) languages.add('TypeScript');
  if (existsSync(join(cwd, 'pom.xml')) || existsSync(join(cwd, 'build.gradle')) || existsSync(join(cwd, 'build.gradle.kts'))) languages.add('Java');
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'requirements.txt'))) languages.add('Python');
  if (existsSync(join(cwd, 'go.mod'))) languages.add('Go');
  if (existsSync(join(cwd, 'Cargo.toml'))) languages.add('Rust');
  return Array.from(languages).sort();
}

function detectFrameworks(cwd: string, deps: Record<string, unknown>): string[] {
  const frameworks = new Set<string>();
  if ('react' in deps) frameworks.add('React');
  if ('vue' in deps) frameworks.add('Vue');
  if ('svelte' in deps) frameworks.add('Svelte');
  if ('next' in deps) frameworks.add('Next.js');
  if ('nuxt' in deps) frameworks.add('Nuxt');
  if ('vite' in deps || existsSync(join(cwd, 'vite.config.ts')) || existsSync(join(cwd, 'vite.config.js'))) frameworks.add('Vite');
  if ('express' in deps) frameworks.add('Express');
  if ('fastify' in deps) frameworks.add('Fastify');
  if (existsSync(join(cwd, 'pom.xml'))) frameworks.add('Maven Java');
  return Array.from(frameworks).sort();
}

function detectProjectKind(cwd: string, packageJson: Record<string, unknown> | null): ProjectStructureSummary['kind'] {
  if (packageJson?.workspaces) return 'monorepo';
  if (existsSync(join(cwd, 'pnpm-workspace.yaml'))) return 'monorepo';
  if (existsSync(join(cwd, 'pom.xml')) && existsSync(join(cwd, 'src'))) return 'single-package';
  if (existsSync(join(cwd, 'packages')) || existsSync(join(cwd, 'apps'))) return 'multi-module';
  if (packageJson) return 'single-package';
  return 'unknown';
}

function isConfigFile(name: string): boolean {
  return [
    'package.json', 'tsconfig.json', 'pnpm-workspace.yaml', 'vite.config.ts', 'vite.config.js',
    'pom.xml', 'build.gradle', 'build.gradle.kts', 'pyproject.toml', 'go.mod', 'Cargo.toml',
    '.eslintrc', '.eslintrc.json', 'eslint.config.js', 'prettier.config.js', 'biome.json',
  ].includes(name);
}

function isAiInstructionFile(name: string): boolean {
  return [
    'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'ROXY.md', '.cursorrules', '.windsurfrules', '.clinerules',
  ].includes(name);
}

function renderRoxyMarkdown(profile: ProjectProfile, language: Language): string {
  if (language === 'en-US') {
    return renderEnglishRoxyMarkdown(profile);
  }
  return renderChineseRoxyMarkdown(profile);
}

function renderChineseRoxyMarkdown(profile: ProjectProfile): string {
  const scripts = renderScriptLines(profile.scripts, '  -');
  return `# ROXY.md

这个文件为 RoxyCode 在本仓库工作时提供项目级指令。它类似 Claude Code 的 CLAUDE.md，但配合 .roxycode/project.json 提供结构化项目画像。

## 项目概览
- 项目名称：${profile.name}
- 项目类型：${profile.structure.kind}
- 包管理器：${profile.packageManager ?? 'unknown'}
- 语言：${profile.languages.join(', ') || '未检测到'}
- 框架：${profile.frameworks.join(', ') || '未检测到'}

## 常用命令
${scripts || '  - 暂未检测到 package scripts，请按项目实际情况补充。'}

## 项目结构
- 源码目录：${profile.structure.sourceDirs.join(', ') || '未检测到'}
- 测试目录：${profile.structure.testDirs.join(', ') || '未检测到'}
- 配置文件：${profile.structure.configFiles.join(', ') || '未检测到'}

## RoxyCode 工作规则
- 优先读取 .roxycode/project.json 获取结构化项目画像。
- 修改代码前先说明计划；涉及多文件修改时先列出影响范围。
- 不要把个人偏好、密钥、账号或本地环境细节写入本文件；这些内容应放入 .roxycode/profile.json。
- 若命令、目录或框架检测不准确，请直接修正本文件和 .roxycode/project.json。
`;
}

function renderEnglishRoxyMarkdown(profile: ProjectProfile): string {
  const scripts = renderScriptLines(profile.scripts, '  -');
  return `# ROXY.md

This file gives RoxyCode project-level guidance for this repository. It is similar to Claude Code's CLAUDE.md, while .roxycode/project.json provides a structured project profile.

## Project Overview
- Name: ${profile.name}
- Kind: ${profile.structure.kind}
- Package manager: ${profile.packageManager ?? 'unknown'}
- Languages: ${profile.languages.join(', ') || 'not detected'}
- Frameworks: ${profile.frameworks.join(', ') || 'not detected'}

## Common Commands
${scripts || '  - No package scripts detected. Add project-specific commands here.'}

## Structure
- Source directories: ${profile.structure.sourceDirs.join(', ') || 'not detected'}
- Test directories: ${profile.structure.testDirs.join(', ') || 'not detected'}
- Config files: ${profile.structure.configFiles.join(', ') || 'not detected'}

## RoxyCode Rules
- Prefer .roxycode/project.json for structured project context.
- Explain the plan before editing code; list affected areas for multi-file changes.
- Do not store personal preferences, secrets, accounts, or local-only setup details here; use .roxycode/profile.json instead.
- If detection is wrong, update this file and .roxycode/project.json directly.
`;
}

function renderScriptLines(scripts: ProjectScripts, prefix: string): string {
  const important = ['dev', 'start', 'build', 'test', 'lint', 'format'];
  const lines: string[] = [];
  for (const name of important) {
    const command = scripts[name];
    if (command) lines.push(`${prefix} ${name}: ${command}`);
  }
  return lines.join('\n');
}
