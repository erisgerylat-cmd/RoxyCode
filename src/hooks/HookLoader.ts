import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, resolve } from 'node:path';
import type { RoxyCodeConfig } from '../core/types/config.js';
import { parseWorkflowYaml } from '../workflow/yaml.js';
import type { CharacterBehavior, ExplanationStyle, PreferredAgentMode, ReviewFocus, RiskPreference } from '../aesthetic/character/types.js';
import type { HookLoadResult, RoxyHookDefinition, RoxyHookEvent, RoxyHookKind } from './types.js';

const HOOK_EVENTS: RoxyHookEvent[] = ['session_start', 'before_prompt', 'after_response', 'before_tool', 'after_tool', 'command', 'agent_start', 'agent_done'];
const HOOK_KINDS: RoxyHookKind[] = ['command', 'prompt', 'http', 'agent', 'character'];
const EXPLANATION_STYLES: ExplanationStyle[] = ['concise', 'structured', 'teaching', 'deep', 'playful'];
const REVIEW_FOCUS: ReviewFocus[] = ['correctness', 'security', 'performance', 'maintainability', 'testing', 'ux', 'learning'];
const RISK_PREFERENCES: RiskPreference[] = ['conservative', 'balanced', 'bold'];
const PREFERRED_MODES: PreferredAgentMode[] = ['lite', 'economic', 'standard', 'ultimate'];

export interface HookLoaderOptions {
  cwd?: string;
  config: RoxyCodeConfig;
  pluginHooks?: RoxyHookDefinition[];
  files?: string[];
}

export class HookLoader {
  private readonly cwd: string;
  private readonly config: RoxyCodeConfig;
  private readonly pluginHooks: RoxyHookDefinition[];
  private readonly files: string[];

  constructor(options: HookLoaderOptions) {
    this.cwd = options.cwd ?? process.cwd();
    this.config = options.config;
    this.pluginHooks = options.pluginHooks ?? [];
    this.files = options.files ?? [];
  }

  async load(): Promise<HookLoadResult> {
    const hooks: RoxyHookDefinition[] = [];
    const errors: HookLoadResult['errors'] = [];
    const directories = this.resolveDirectories();

    if (this.config.hooks.enabled === false) return { hooks: [], errors, directories };

    for (const directory of directories) {
      if (!existsSync(directory)) continue;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        errors.push({ path: directory, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const extension = extname(entry.name).toLowerCase();
        if (!['.json', '.yml', '.yaml'].includes(extension)) continue;
        const path = resolve(directory, entry.name);
        try {
          const loaded = await this.loadFile(path);
          hooks.push(...loaded);
        } catch (error) {
          errors.push({ path, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    for (const path of this.resolveFiles()) {
      try {
        hooks.push(...await this.loadFile(path));
      } catch (error) {
        errors.push({ path, message: error instanceof Error ? error.message : String(error) });
      }
    }

    hooks.push(...this.pluginHooks.map(hook => ({ ...hook, source: hook.source ?? 'plugin' })));
    return { hooks: dedupeHooks(hooks), errors, directories };
  }

  private resolveDirectories(): string[] {
    const directories = this.config.hooks.directories?.length ? this.config.hooks.directories : ['.roxycode/hooks'];
    return directories.map(raw => isAbsolute(raw) ? raw : resolve(this.cwd, raw));
  }

  private resolveFiles(): string[] {
    return this.files.map(raw => isAbsolute(raw) ? raw : resolve(this.cwd, raw));
  }

  private async loadFile(path: string): Promise<RoxyHookDefinition[]> {
    const raw = await readFile(path, 'utf8');
    const extension = extname(path).toLowerCase();
    const parsed = extension === '.json' ? JSON.parse(raw) : parseWorkflowYaml(raw);
    const hooks = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.hooks) ? parsed.hooks : [parsed];
    return hooks.map((hook, index) => normalizeHook(hook, path, index)).filter((hook): hook is RoxyHookDefinition => hook !== null);
  }
}

function normalizeHook(raw: unknown, path: string, index: number): RoxyHookDefinition | null {
  if (!isRecord(raw)) return null;
  const event = asEnum(raw.event, HOOK_EVENTS);
  const kind = asEnum(raw.kind ?? raw.type, HOOK_KINDS);
  if (!event || !kind) throw new Error(`Hook ${path} must include valid event and kind.`);
  const id = asString(raw.id) || `${basename(path, extname(path))}-${index + 1}`;
  return {
    id: normalizeId(id),
    event,
    kind,
    description: asString(raw.description),
    matcher: asString(raw.matcher),
    enabled: raw.enabled === undefined ? true : asBoolean(raw.enabled),
    blocking: raw.blocking === undefined ? false : asBoolean(raw.blocking),
    timeoutMs: asNumber(raw.timeoutMs ?? raw.timeout_ms),
    command: asString(raw.command),
    args: asStringArray(raw.args),
    prompt: asString(raw.prompt),
    url: asString(raw.url),
    method: 'POST',
    headers: normalizeHeaders(raw.headers),
    allowedEnvVars: asStringArray(raw.allowedEnvVars ?? raw.allowed_env_vars),
    allowInsecureHttp: asBoolean(raw.allowInsecureHttp ?? raw.allow_insecure_http),
    statusMessage: asString(raw.statusMessage ?? raw.status_message),
    characterId: asString(raw.characterId ?? raw.character_id ?? raw.character),
    behavior: normalizeCharacterBehavior(raw.behavior ?? raw.characterBehavior ?? raw.character_behavior ?? raw.overlay),
    explanationStyle: asEnum(raw.explanationStyle ?? raw.explanation_style, EXPLANATION_STYLES),
    reviewFocus: asEnumArray(raw.reviewFocus ?? raw.review_focus, REVIEW_FOCUS),
    riskPreference: asEnum(raw.riskPreference ?? raw.risk_preference, RISK_PREFERENCES),
    preferredMode: asEnum(raw.preferredMode ?? raw.preferred_mode, PREFERRED_MODES),
    workflowBias: asStringArray(raw.workflowBias ?? raw.workflow_bias),
    responseRules: asStringArray(raw.responseRules ?? raw.response_rules),
    source: path,
  };
}

function normalizeCharacterBehavior(value: unknown): Partial<CharacterBehavior> | undefined {
  if (!isRecord(value)) return undefined;
  const behavior: Partial<CharacterBehavior> = {};
  const explanationStyle = asEnum(value.explanationStyle ?? value.explanation_style, EXPLANATION_STYLES);
  const reviewFocus = asEnumArray(value.reviewFocus ?? value.review_focus, REVIEW_FOCUS);
  const riskPreference = asEnum(value.riskPreference ?? value.risk_preference, RISK_PREFERENCES);
  const preferredMode = asEnum(value.preferredMode ?? value.preferred_mode, PREFERRED_MODES);
  const workflowBias = asStringArray(value.workflowBias ?? value.workflow_bias);
  const responseRules = asStringArray(value.responseRules ?? value.response_rules);
  if (explanationStyle) behavior.explanationStyle = explanationStyle;
  if (reviewFocus) behavior.reviewFocus = reviewFocus;
  if (riskPreference) behavior.riskPreference = riskPreference;
  if (preferredMode) behavior.preferredMode = preferredMode;
  if (workflowBias) behavior.workflowBias = workflowBias;
  if (responseRules) behavior.responseRules = responseRules;
  return Object.keys(behavior).length > 0 ? behavior : undefined;
}

function dedupeHooks(hooks: RoxyHookDefinition[]): RoxyHookDefinition[] {
  const seen = new Set<string>();
  const result: RoxyHookDefinition[] = [];
  for (const hook of hooks) {
    const key = `${hook.event}:${hook.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(hook);
  }
  return result;
}

function asEnum<T extends string>(value: unknown, candidates: readonly T[]): T | undefined {
  return typeof value === 'string' && (candidates as readonly string[]).includes(value) ? value as T : undefined;
}

function asEnumArray<T extends string>(value: unknown, candidates: readonly T[]): T[] | undefined {
  const raw = asStringArray(value);
  if (!raw) return undefined;
  const result = raw.filter((item): item is T => (candidates as readonly string[]).includes(item));
  return result.length > 0 ? result : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(item => String(item));
  if (typeof value === 'string' && value.trim()) return value.split(/\s+/);
  return undefined;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', 'yes', '1', 'on'].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value);
  return undefined;
}

function normalizeHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value)) headers[key] = String(headerValue);
  return headers;
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'hook';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
