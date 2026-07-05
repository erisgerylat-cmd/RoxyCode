import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CharacterId } from '../aesthetic/character/types.js';
import type { Language } from '../i18n/index.js';
import type {
  AestheticMode,
  ExplanationDepth,
  ModelStrategy,
  UserProfile,
} from './types.js';

export class ProfileManager {
  private profile: UserProfile | null = null;
  private readonly profilePath: string;

  constructor(private readonly cwd: string = process.cwd()) {
    this.profilePath = join(cwd, '.roxycode', 'profile.json');
  }

  async load(): Promise<UserProfile | null> {
    if (!existsSync(this.profilePath)) {
      this.profile = null;
      return null;
    }

    try {
      const raw = await readFile(this.profilePath, 'utf-8');
      const parsed = JSON.parse(raw) as UserProfile;
      if (parsed.schemaVersion === 1) {
        this.profile = parsed;
        return parsed;
      }
      this.profile = null;
      return null;
    } catch {
      this.profile = null;
      return null;
    }
  }

  get(): UserProfile | null {
    return this.profile;
  }

  async update(updates: Partial<Omit<UserProfile, 'schemaVersion' | 'createdAt' | 'updatedAt'>>): Promise<UserProfile> {
    if (!this.profile) {
      throw new Error('No profile loaded. Run /profile init first.');
    }

    const updated: UserProfile = {
      ...this.profile,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await writeFile(this.profilePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8');
    this.profile = updated;
    return updated;
  }

  async updateLanguage(language: Language): Promise<UserProfile> {
    return this.update({ language });
  }

  async updateTechStack(techStack: string[]): Promise<UserProfile> {
    return this.update({ techStack });
  }

  async updateExplanationDepth(explanationDepth: ExplanationDepth): Promise<UserProfile> {
    return this.update({ explanationDepth });
  }

  async updateDefaultCharacter(defaultCharacter: CharacterId): Promise<UserProfile> {
    return this.update({ defaultCharacter });
  }

  async updateModelStrategy(modelStrategy: ModelStrategy): Promise<UserProfile> {
    return this.update({ modelStrategy });
  }

  async updateAestheticMode(aestheticMode: AestheticMode): Promise<UserProfile> {
    return this.update({ aestheticMode });
  }

  async addNote(note: string): Promise<UserProfile> {
    if (!this.profile) {
      throw new Error('No profile loaded. Run /profile init first.');
    }
    return this.update({ notes: [...this.profile.notes, note] });
  }

  async removeNote(index: number): Promise<UserProfile> {
    if (!this.profile) {
      throw new Error('No profile loaded. Run /profile init first.');
    }
    const notes = [...this.profile.notes];
    notes.splice(index, 1);
    return this.update({ notes });
  }

  getPath(): string {
    return this.profilePath;
  }

  exists(): boolean {
    return existsSync(this.profilePath);
  }
}
