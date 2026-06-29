import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  Character,
  CharacterBehavior,
  CharacterCompanion,
  CharacterId,
  CharacterSource,
  CharacterTheme,
  ErrorMessages,
  EasterEggPool,
  ExplanationStyle,
  PreferredAgentMode,
  ReviewFocus,
  RiskPreference,
  SplashConfig,
  StatusTextMap,
} from '../types.js';
import { createCustomCharacterTemplate } from './CharacterTemplate.js';

export interface CustomCharacterPaths {
  global: string;
  project: string;
}

export interface CustomCharacterLoadError {
  path: string;
  message: string;
}

export interface CustomCharacterLoadResult {
  characters: Character[];
  errors: CustomCharacterLoadError[];
  paths: CustomCharacterPaths;
}

const VALID_CHARACTER_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const EXPLANATION_STYLES = ['concise', 'structured', 'teaching', 'deep', 'playful'] as const;
const REVIEW_FOCUSES = ['correctness', 'security', 'performance', 'maintainability', 'testing', 'ux', 'learning'] as const;
const RISK_PREFERENCES = ['conservative', 'balanced', 'bold'] as const;
const PREFERRED_MODES = ['lite', 'economic', 'standard', 'ultimate'] as const;

export function getCustomCharacterPaths(cwd: string = process.cwd()): CustomCharacterPaths {
  return {
    global: join(homedir(), '.roxycode', 'characters'),
    project: join(cwd, '.roxycode', 'characters'),
  };
}

export function isValidCharacterId(id: string): boolean {
  return VALID_CHARACTER_ID.test(id);
}

export async function ensureProjectCharacterDirectory(cwd: string = process.cwd()): Promise<string> {
  const paths = getCustomCharacterPaths(cwd);
  await mkdir(paths.project, { recursive: true });
  return paths.project;
}

export async function loadCustomCharacters(cwd: string = process.cwd()): Promise<CustomCharacterLoadResult> {
  const paths = getCustomCharacterPaths(cwd);
  const errors: CustomCharacterLoadError[] = [];
  const characters: Character[] = [];

  for (const [source, dir] of [['global', paths.global], ['project', paths.project]] as Array<[CharacterSource, string]>) {
    const loaded = await loadDirectory(dir, source);
    errors.push(...loaded.errors);
    characters.push(...loaded.characters);
  }

  return { characters, errors, paths };
}

async function loadDirectory(dir: string, source: CharacterSource): Promise<{ characters: Character[]; errors: CustomCharacterLoadError[] }> {
  if (!existsSync(dir)) return { characters: [], errors: [] };

  const characters: Character[] = [];
  const errors: CustomCharacterLoadError[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const path = join(dir, entry.name);
    try {
      const raw = JSON.parse(await readFile(path, 'utf-8')) as unknown;
      characters.push(normalizeCustomCharacter(raw, source));
    } catch (error) {
      errors.push({ path, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return { characters, errors };
}

export function normalizeCustomCharacter(raw: unknown, source: CharacterSource): Character {
  if (!isRecord(raw)) throw new Error('Character file must contain a JSON object.');
  const id = readString(raw, 'id');
  if (!id || !isValidCharacterId(id)) {
    throw new Error('Character id must match /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.');
  }

  const defaults = createCustomCharacterTemplate({ id });
  const merged = deepMerge(defaults, raw);

  return {
    id: readString(merged, 'id') as CharacterId,
    name: readString(merged, 'name') || id,
    nameEn: readString(merged, 'nameEn') || id,
    title: readString(merged, 'title') || 'Custom Character',
    description: readString(merged, 'description') || 'Custom RoxyCode character.',
    personality: readString(merged, 'personality') || 'Customizable coding partner.',
    theme: normalizeTheme(merged.theme),
    statusText: normalizeStatusText(merged.statusText),
    splash: normalizeSplash(merged.splash),
    companion: normalizeCompanion(merged.companion),
    behavior: normalizeBehavior(merged.behavior),
    easterEggs: normalizeEasterEggs(merged.easterEggs),
    errorMessages: normalizeErrorMessages(merged.errorMessages),
    systemPromptPersona: readString(merged, 'systemPromptPersona') || 'You are a customized RoxyCode coding partner. Safety rules always override style.',
    custom: source !== 'builtin',
    source,
  };
}

function normalizeTheme(value: unknown): CharacterTheme {
  const raw = isRecord(value) ? value : {};
  return {
    primary: color(raw.primary, '#5B9BD5'),
    secondary: color(raw.secondary, '#7EC8E3'),
    accent: color(raw.accent, '#FFD166'),
    tagline: color(raw.tagline, '#98D8C8'),
    dim: color(raw.dim, '#888888'),
    error: color(raw.error, '#E85D75'),
    success: color(raw.success, '#4ECDC4'),
  };
}

function normalizeStatusText(value: unknown): StatusTextMap {
  const raw = isRecord(value) ? value : {};
  return {
    thinking: str(raw.thinking, 'Thinking'),
    analyzing: str(raw.analyzing, 'Analyzing'),
    planning: str(raw.planning, 'Planning'),
    executing: str(raw.executing, 'Executing'),
    reading: file => applyTemplate(str(raw.reading, 'Reading {file}'), { file }),
    writing: file => applyTemplate(str(raw.writing, 'Writing {file}'), { file }),
    running: cmd => applyTemplate(str(raw.running, 'Running {cmd}'), { cmd }),
    searching: str(raw.searching, 'Searching'),
    waiting: str(raw.waiting, 'Waiting'),
    done: str(raw.done, 'Done'),
    error: str(raw.error, 'Error'),
    step: (current, total, desc) => applyTemplate(str(raw.step, 'Step {current}/{total}: {desc}'), { current, total, desc }),
  };
}

function normalizeSplash(value: unknown): SplashConfig {
  const raw = isRecord(value) ? value : {};
  return {
    asciiArt: stringArray(raw.asciiArt),
    tagline: str(raw.tagline, 'Personal Anime Coding Workbench'),
    welcome: str(raw.welcome, 'Welcome back.'),
    tips: stringArray(raw.tips),
  };
}

function normalizeCompanion(value: unknown): CharacterCompanion | undefined {
  if (!isRecord(value)) return undefined;
  return {
    name: str(value.name, 'Companion'),
    kind: str(value.kind, 'pixel familiar'),
    art: stringArray(value.art),
    idleLines: stringArray(value.idleLines),
    thinkingLines: stringArray(value.thinkingLines),
    successLines: stringArray(value.successLines),
    warningLines: stringArray(value.warningLines),
  };
}

function normalizeBehavior(value: unknown): CharacterBehavior | undefined {
  if (!isRecord(value)) return undefined;
  return {
    explanationStyle: enumValue(value.explanationStyle, EXPLANATION_STYLES, 'teaching'),
    reviewFocus: enumArray(value.reviewFocus, REVIEW_FOCUSES, ['correctness', 'testing', 'learning']),
    riskPreference: enumValue(value.riskPreference, RISK_PREFERENCES, 'balanced'),
    preferredMode: enumValue(value.preferredMode, PREFERRED_MODES, 'standard'),
    workflowBias: stringArray(value.workflowBias),
    responseRules: stringArray(value.responseRules),
  };
}

function normalizeEasterEggs(value: unknown): EasterEggPool {
  const raw = isRecord(value) ? value : {};
  return {
    startup: nonEmptyArray(raw.startup, ['Ready.']),
    success: nonEmptyArray(raw.success, ['Done.']),
    error: nonEmptyArray(raw.error, ['Something went wrong.']),
    idle: nonEmptyArray(raw.idle, ['Need anything?']),
    special: isRecord(raw.special) ? Object.fromEntries(Object.entries(raw.special).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {},
  };
}

function normalizeErrorMessages(value: unknown): ErrorMessages {
  const raw = isRecord(value) ? value : {};
  return {
    generic: str(raw.generic, 'Something went wrong.'),
    networkError: str(raw.networkError, 'Network error.'),
    tokenLimit: str(raw.tokenLimit, 'Context limit reached.'),
    toolFailed: tool => applyTemplate(str(raw.toolFailed, '{tool} failed.'), { tool }),
    permissionDenied: str(raw.permissionDenied, 'Permission denied.'),
    rateLimit: str(raw.rateLimit, 'Rate limit reached.'),
    contextOverflow: str(raw.contextOverflow, 'Context overflow.'),
  };
}

function color(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readString(value: Record<string, unknown>, key: string): string {
  const raw = value[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.length > 0) : [];
}

function nonEmptyArray(value: unknown, fallback: string[]): string[] {
  const arr = stringArray(value);
  return arr.length > 0 ? arr : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function enumArray<T extends string>(value: unknown, allowed: readonly T[], fallback: T[]): T[] {
  if (!Array.isArray(value)) return fallback;
  const result = value.filter((item): item is T => typeof item === 'string' && allowed.includes(item as T));
  return result.length > 0 ? result : fallback;
}

function applyTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
