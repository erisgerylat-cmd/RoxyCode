import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BuiltInCharacterId, CharacterId } from '../aesthetic/character/types.js';
import { CHARACTER_ORDER, isBuiltInCharacterId } from '../aesthetic/character/characters/index.js';
import type { ConfigManager } from '../core/ConfigManager.js';
import { normalizeLanguage } from '../i18n/index.js';
import type {
  AestheticMode,
  ExplanationDepth,
  ModelStrategy,
  ProfileInitOptions,
  ProfileInitResult,
  UserProfile,
} from './types.js';

const PROFILE_PATH = join('.roxycode', 'profile.json');
const PROFILE_GITIGNORE_ENTRY = '.roxycode/profile.json';

export class ProfileInitializer {
  constructor(
    private readonly configManager: ConfigManager,
    private readonly cwd: string = process.cwd(),
  ) {}

  getProfilePath(): string {
    return join(this.cwd, PROFILE_PATH);
  }

  async init(options: ProfileInitOptions = {}): Promise<ProfileInitResult> {
    const path = this.getProfilePath();
    const now = new Date().toISOString();
    const existing = await this.readExisting(path);

    if (existing && !options.force) {
      const gitignoreUpdated = await this.ensureProfileGitignored();
      return { created: false, path, gitignoreUpdated, profile: existing };
    }

    const language = options.language ?? normalizeLanguage(this.configManager.get('ui.language'));

    const profile: UserProfile = {
      schemaVersion: 1,
      language,
      techStack: options.techStack?.length ? options.techStack : await inferTechStack(this.cwd),
      explanationDepth: options.explanationDepth ?? 'teaching',
      defaultCharacter: options.defaultCharacter ?? normalizeCharacter(this.configManager.get('character.current')),
      modelStrategy: options.modelStrategy ?? inferModelStrategy(this.configManager),
      aestheticMode: options.aestheticMode ?? 'balanced',
      notes: defaultProfileNotes(language),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(profile, null, 2)}\n`, 'utf-8');
    const gitignoreUpdated = await this.ensureProfileGitignored();

    return { created: true, path, gitignoreUpdated, profile };
  }

  private async readExisting(path: string): Promise<UserProfile | null> {
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw) as UserProfile;
      return parsed && parsed.schemaVersion === 1 ? parsed : null;
    } catch {
      return null;
    }
  }

  private async ensureProfileGitignored(): Promise<boolean> {
    const path = join(this.cwd, '.gitignore');
    const entry = PROFILE_GITIGNORE_ENTRY;

    if (!existsSync(path)) {
      await writeFile(path, `${entry}\n`, 'utf-8');
      return true;
    }

    const raw = await readFile(path, 'utf-8');
    const lines = raw.split(/\r?\n/).map(line => line.trim());
    if (lines.includes(entry)) {
      return false;
    }

    const suffix = raw.endsWith('\n') || raw.length === 0 ? '' : '\n';
    await writeFile(path, `${raw}${suffix}${entry}\n`, 'utf-8');
    return true;
  }
}

async function inferTechStack(cwd: string): Promise<string[]> {
  const stack = new Set<string>();

  if (existsSync(join(cwd, 'package.json'))) {
    stack.add('Node.js');
    const pkg = await readJson(join(cwd, 'package.json'));
    const deps = {
      ...(pkg?.dependencies as Record<string, unknown> | undefined),
      ...(pkg?.devDependencies as Record<string, unknown> | undefined),
    };
    if ('typescript' in deps || existsSync(join(cwd, 'tsconfig.json'))) stack.add('TypeScript');
    if ('react' in deps) stack.add('React');
    if ('vue' in deps) stack.add('Vue');
    if ('next' in deps) stack.add('Next.js');
    if ('vite' in deps || existsSync(join(cwd, 'vite.config.ts'))) stack.add('Vite');
  }

  if (existsSync(join(cwd, 'pom.xml'))) stack.add('Spring Boot / Maven');
  if (existsSync(join(cwd, 'build.gradle')) || existsSync(join(cwd, 'build.gradle.kts'))) stack.add('Gradle');
  if (existsSync(join(cwd, 'pyproject.toml'))) stack.add('Python');
  if (existsSync(join(cwd, 'go.mod'))) stack.add('Go');
  if (existsSync(join(cwd, 'Cargo.toml'))) stack.add('Rust');

  return Array.from(stack).sort();
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeCharacter(value: unknown): CharacterId {
  return typeof value === 'string' && isBuiltInCharacterId(value)
    ? value
    : 'roxy';
}

function defaultProfileNotes(language: UserProfile['language']): string[] {
  if (language === 'zh-CN') {
    return [
      'RoxyCode 个人画像用于记录你的私人偏好，不作为团队共享项目规则。',
      '密钥、账号、本地沙箱地址等私人信息不要写入 ROXY.md，应放在个人画像或更安全的位置。',
    ];
  }

  return [
    'RoxyCode profile captures personal preferences, not team-shared project rules.',
    'Keep secrets and private sandbox details out of ROXY.md; put personal hints here instead.',
  ];
}
function inferModelStrategy(configManager: ConfigManager): ModelStrategy {
  const mode = configManager.get('mode');
  if (mode === 'lite') return 'fast';
  if (mode === 'economic') return 'budget';
  if (mode === 'ultimate') return 'quality';
  return 'auto';
}

export function isExplanationDepth(value: string): value is ExplanationDepth {
  return ['concise', 'balanced', 'teaching', 'deep'].includes(value);
}

export function isModelStrategy(value: string): value is ModelStrategy {
  return ['auto', 'fast', 'balanced', 'quality', 'budget'].includes(value);
}

export function isAestheticMode(value: string): value is AestheticMode {
  return ['minimal', 'balanced', 'immersive'].includes(value);
}

export function isCharacterId(value: string): value is BuiltInCharacterId {
  return isBuiltInCharacterId(value);
}

