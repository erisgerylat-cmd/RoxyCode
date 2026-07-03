import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CharacterId } from '../../aesthetic/character/types.js';
import type { Language } from '../../i18n/index.js';
import type {
  AestheticMode,
  ExplanationDepth,
  ModelStrategy,
  UserProfile,
} from '../../profile/index.js';

export const SESSION_PROFILE_PATH = join('.roxycode', 'profile.json');

export interface ProfileWorkflowPreferences {
  language: Language;
  explanationDepth: ExplanationDepth;
  defaultCharacter: CharacterId;
  modelStrategy: ModelStrategy;
  aestheticMode: AestheticMode;
  techStack: string[];
  notes: string[];
}

export type UserProfilePatch = Partial<Omit<UserProfile, 'schemaVersion' | 'createdAt' | 'updatedAt'>>;

export class ProfileManager {
  constructor(private readonly cwd: string = process.cwd()) {}

  getProfilePath(): string {
    return join(this.cwd, SESSION_PROFILE_PATH);
  }

  async exists(): Promise<boolean> {
    return existsSync(this.getProfilePath());
  }

  async load(): Promise<UserProfile | null> {
    const path = this.getProfilePath();
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as unknown;
    return normalizeUserProfile(parsed);
  }

  async save(profile: UserProfile): Promise<UserProfile> {
    const normalized = normalizeUserProfile(profile);
    if (!normalized) throw new Error('Invalid RoxyCode profile.');
    const path = this.getProfilePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
    return normalized;
  }

  async update(patch: UserProfilePatch): Promise<UserProfile> {
    const now = new Date().toISOString();
    const existing = await this.load();
    const next = normalizeUserProfile({
      schemaVersion: 1,
      language: existing?.language ?? 'zh-CN',
      techStack: existing?.techStack ?? [],
      explanationDepth: existing?.explanationDepth ?? 'teaching',
      defaultCharacter: existing?.defaultCharacter ?? 'roxy',
      modelStrategy: existing?.modelStrategy ?? 'auto',
      aestheticMode: existing?.aestheticMode ?? 'balanced',
      notes: existing?.notes ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...patch,
    });
    if (!next) throw new Error('Invalid RoxyCode profile patch.');
    return this.save(next);
  }

  async getTechStack(): Promise<string[]> {
    return (await this.load())?.techStack ?? [];
  }

  async getWorkflowPreferences(): Promise<ProfileWorkflowPreferences | null> {
    const profile = await this.load();
    if (!profile) return null;
    return {
      language: profile.language,
      explanationDepth: profile.explanationDepth,
      defaultCharacter: profile.defaultCharacter,
      modelStrategy: profile.modelStrategy,
      aestheticMode: profile.aestheticMode,
      techStack: profile.techStack,
      notes: profile.notes,
    };
  }
}

export function normalizeUserProfile(value: unknown): UserProfile | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const language = value.language === 'en-US' ? 'en-US' : 'zh-CN';
  const explanationDepth = asExplanationDepth(value.explanationDepth);
  const modelStrategy = asModelStrategy(value.modelStrategy);
  const aestheticMode = asAestheticMode(value.aestheticMode);
  const defaultCharacter = typeof value.defaultCharacter === 'string' && value.defaultCharacter.trim()
    ? value.defaultCharacter as CharacterId
    : 'roxy';
  return {
    schemaVersion: 1,
    language,
    techStack: asStringArray(value.techStack),
    explanationDepth,
    defaultCharacter,
    modelStrategy,
    aestheticMode,
    notes: asStringArray(value.notes),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
}

function asExplanationDepth(value: unknown): ExplanationDepth {
  return value === 'concise' || value === 'balanced' || value === 'teaching' || value === 'deep'
    ? value
    : 'teaching';
}

function asModelStrategy(value: unknown): ModelStrategy {
  return value === 'auto' || value === 'fast' || value === 'balanced' || value === 'quality' || value === 'budget'
    ? value
    : 'auto';
}

function asAestheticMode(value: unknown): AestheticMode {
  return value === 'minimal' || value === 'balanced' || value === 'immersive'
    ? value
    : 'balanced';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
