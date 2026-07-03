/**
 * Core character and aesthetic customization types.
 *
 * Claude Code keeps theme and companion mostly in the presentation layer.
 * RoxyCode keeps that safety boundary, but also lets a character influence
 * explanation style, review focus, risk preference, and preferred workflow.
 */

export type BuiltInCharacterId = 'roxy' | 'rudeus' | 'eris' | 'sylphiette' | 'nanahoshi';
export type CharacterId = BuiltInCharacterId | (string & {});

export type AestheticMode = 'minimal' | 'balanced' | 'immersive';
export type CharacterSource = 'builtin' | 'global' | 'project' | 'marketplace';
export type ReviewFocus = 'correctness' | 'security' | 'performance' | 'maintainability' | 'testing' | 'ux' | 'learning';
export type RiskPreference = 'conservative' | 'balanced' | 'bold';
export type ExplanationStyle = 'concise' | 'structured' | 'teaching' | 'deep' | 'playful';
export type PreferredAgentMode = 'lite' | 'economic' | 'standard' | 'ultimate';
export type CharacterAgeRating = 'everyone' | '13+' | '16+' | '18+';

export interface CharacterPackageInfo {
  packageName: string;
  version: string;
  author: {
    name: string;
    email?: string;
    url?: string;
  };
  license?: string;
  repository?: string;
  installPath: string;
  installedAt: string;
  updatedAt?: string;
}

export interface CharacterAssets {
  icon?: string;
  avatar?: string;
  splashArt?: string[];
  sprites?: {
    idle?: string[];
    thinking?: string[];
    success?: string[];
    warning?: string[];
    error?: string[];
  };
  sounds?: {
    notification?: string;
    success?: string;
    error?: string;
  };
}

export interface CharacterExtensions {
  hooks?: string;
  workflows?: string[];
  prompts?: {
    systemPrompt?: string;
    planPrompt?: string;
    verificationPrompt?: string;
  };
  tools?: string[];
}

export interface CharacterI18n {
  [locale: string]: {
    name?: string;
    title?: string;
    description?: string;
    personality?: string;
    statusText?: Partial<StatusTextMap>;
    easterEggs?: Partial<EasterEggPool>;
    errorMessages?: Partial<ErrorMessages>;
  };
}

export interface CharacterMetadata {
  source?: string;
  characterType?: string;
  tags?: string[];
  ageRating?: CharacterAgeRating;
}


export interface CharacterTheme {
  primary: string;
  secondary: string;
  accent: string;
  tagline: string;
  dim: string;
  error: string;
  success: string;
}

export interface StatusTextMap {
  thinking: string;
  analyzing: string;
  planning: string;
  executing: string;
  reading: (file: string) => string;
  writing: (file: string) => string;
  running: (cmd: string) => string;
  searching: string;
  waiting: string;
  done: string;
  error: string;
  step: (current: number, total: number, desc: string) => string;
}

export interface SplashConfig {
  asciiArt?: string[];
  tagline: string;
  welcome: string;
  tips?: string[];
}

export interface EasterEggPool {
  startup: string[];
  success: string[];
  error: string[];
  idle: string[];
  special: Record<string, string>;
}

export interface ErrorMessages {
  generic: string;
  networkError: string;
  tokenLimit: string;
  toolFailed: (tool: string) => string;
  permissionDenied: string;
  rateLimit: string;
  contextOverflow: string;
}

export interface CharacterCompanion {
  name: string;
  kind: string;
  art: string[];
  idleLines: string[];
  thinkingLines: string[];
  successLines: string[];
  warningLines: string[];
}

export interface CharacterBehavior {
  explanationStyle: ExplanationStyle;
  reviewFocus: ReviewFocus[];
  riskPreference: RiskPreference;
  preferredMode: PreferredAgentMode;
  workflowBias: string[];
  responseRules: string[];
}

export interface Character {
  id: CharacterId;
  name: string;
  nameEn: string;
  title: string;
  description: string;
  personality: string;
  theme: CharacterTheme;
  statusText: StatusTextMap;
  splash: SplashConfig;
  easterEggs: EasterEggPool;
  errorMessages: ErrorMessages;
  systemPromptPersona: string;
  custom?: boolean;
  source?: CharacterSource;
  companion?: CharacterCompanion;
  behavior?: CharacterBehavior;
  packageInfo?: CharacterPackageInfo;
  assets?: CharacterAssets;
  extensions?: CharacterExtensions;
  i18n?: CharacterI18n;
  metadata?: CharacterMetadata;
}

export interface CharacterSummary {
  id: CharacterId;
  name: string;
  title: string;
  description: string;
  primaryColor: string;
  isActive: boolean;
  source: CharacterSource;
  custom: boolean;
  companion?: string;
  behavior?: CharacterBehavior;
}

export interface CharacterPort {
  getCurrentCharacter(): Character;
  getCharacter(id: CharacterId): Character | undefined;
  switchCharacter(id: CharacterId): Promise<void>;
  getCharacterList(): CharacterSummary[];
  onCharacterChanged(callback: (character: Character) => void): void;
}
