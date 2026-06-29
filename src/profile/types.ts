import type { CharacterId } from '../aesthetic/character/types.js';
import type { Language } from '../i18n/index.js';

export type ExplanationDepth = 'concise' | 'balanced' | 'teaching' | 'deep';
export type ModelStrategy = 'auto' | 'fast' | 'balanced' | 'quality' | 'budget';
export type AestheticMode = 'minimal' | 'balanced' | 'immersive';

export interface UserProfile {
  schemaVersion: 1;
  language: Language;
  techStack: string[];
  explanationDepth: ExplanationDepth;
  defaultCharacter: CharacterId;
  modelStrategy: ModelStrategy;
  aestheticMode: AestheticMode;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProfileInitOptions {
  force?: boolean;
  language?: Language;
  techStack?: string[];
  explanationDepth?: ExplanationDepth;
  defaultCharacter?: CharacterId;
  modelStrategy?: ModelStrategy;
  aestheticMode?: AestheticMode;
}

export interface ProfileInitResult {
  created: boolean;
  path: string;
  gitignoreUpdated: boolean;
  profile: UserProfile;
}
