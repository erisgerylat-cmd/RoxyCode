import type { BuiltInCharacterId } from '../../aesthetic/character/types.js';
import type { ConfigManager } from '../../core/ConfigManager.js';
import { normalizeLanguage } from '../../i18n/index.js';
import {
  ProfileInitializer,
  type ProfileInitOptions,
  type ProfileInitResult,
} from '../../profile/index.js';
import { ProjectScanner } from '../project/ProjectScanner.js';

export interface ProfileOnboardingOptions extends ProfileInitOptions {
  configManager: ConfigManager;
}

export interface ProfileSuggestion {
  techStack: string[];
  defaultCharacter: BuiltInCharacterId;
  explanationDepth: ProfileInitOptions['explanationDepth'];
  modelStrategy: ProfileInitOptions['modelStrategy'];
  reasons: string[];
}

export class ProfileOnboarding {
  constructor(private readonly cwd: string = process.cwd()) {}

  async runOnboarding(options: ProfileOnboardingOptions): Promise<ProfileInitResult> {
    const suggestion = await this.suggestProfile(options);
    return new ProfileInitializer(options.configManager, this.cwd).init({
      language: options.language ?? normalizeLanguage(options.configManager.get('ui.language')),
      techStack: options.techStack ?? suggestion.techStack,
      explanationDepth: options.explanationDepth ?? suggestion.explanationDepth,
      defaultCharacter: options.defaultCharacter ?? suggestion.defaultCharacter,
      modelStrategy: options.modelStrategy ?? suggestion.modelStrategy,
      aestheticMode: options.aestheticMode ?? 'balanced',
      force: options.force,
    });
  }

  async detectTechStack(): Promise<string[]> {
    const profile = await new ProjectScanner(this.cwd).scanProject();
    return Array.from(new Set([...profile.languages, ...profile.frameworks])).sort();
  }

  async suggestCharacter(techStack: string[] = []): Promise<BuiltInCharacterId> {
    const normalized = techStack.map(item => item.toLowerCase());
    if (normalized.some(item => item.includes('python') || item.includes('data'))) return 'nanahoshi';
    if (normalized.some(item => isJavaStack(item) || item.includes('spring'))) return 'roxy';
    if (normalized.some(item => item.includes('react') || item.includes('vue') || item.includes('frontend'))) return 'sylphiette';
    return 'roxy';
  }

  async suggestProfile(options: Pick<ProfileOnboardingOptions, 'configManager'>): Promise<ProfileSuggestion> {
    const techStack = await this.detectTechStack();
    const defaultCharacter = await this.suggestCharacter(techStack);
    const mode = options.configManager.get('mode');
    const modelStrategy = mode === 'economic' ? 'budget' : mode === 'ultimate' ? 'quality' : 'auto';
    return {
      techStack,
      defaultCharacter,
      explanationDepth: 'teaching',
      modelStrategy,
      reasons: buildReasons(techStack, defaultCharacter),
    };
  }
}

function isJavaStack(value: string): boolean {
  return value === 'java' || value.includes('jvm') || value.includes('maven') || value.includes('gradle');
}

function buildReasons(techStack: string[], character: BuiltInCharacterId): string[] {
  const reasons: string[] = [];
  if (techStack.length > 0) reasons.push(`Detected stack: ${techStack.join(', ')}`);
  reasons.push(`Suggested character: ${character}`);
  reasons.push('Default explanation depth is teaching for Chinese beginner-friendly workflows.');
  return reasons;
}
