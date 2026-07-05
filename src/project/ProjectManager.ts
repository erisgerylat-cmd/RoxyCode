import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectProfile } from './types.js';

const PROJECT_JSON = join('.roxycode', 'project.json');

export class ProjectManager {
  private profile: ProjectProfile | null = null;
  private readonly projectPath: string;

  constructor(private readonly cwd: string = process.cwd()) {
    this.projectPath = join(cwd, PROJECT_JSON);
  }

  async load(): Promise<ProjectProfile | null> {
    if (!existsSync(this.projectPath)) {
      this.profile = null;
      return null;
    }
    try {
      const raw = await readFile(this.projectPath, 'utf-8');
      const parsed = JSON.parse(raw) as ProjectProfile;
      if (parsed.schemaVersion === 1) {
        this.profile = parsed;
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  get(): ProjectProfile | null {
    return this.profile;
  }

  exists(): boolean {
    return existsSync(this.projectPath);
  }

  getPath(): string {
    return this.projectPath;
  }

  /** Append a convention note that should be respected by the Agent. */
  async addConvention(convention: string): Promise<void> {
    const profile = this.profile;
    if (!profile) throw new Error('No project profile loaded.');
    const updated = {
      ...profile,
      roxy: {
        ...profile.roxy,
        conventions: [...((profile.roxy as any).conventions ?? []), convention],
      },
    };
    await this.save(updated);
  }

  private async save(profile: ProjectProfile): Promise<void> {
    await writeFile(this.projectPath, `${JSON.stringify(profile, null, 2)}\n`, 'utf-8');
    this.profile = profile;
  }
}
