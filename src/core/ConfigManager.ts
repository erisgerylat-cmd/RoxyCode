import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  redactConfigValue,
  validateConfigObject,
  type ConfigSourceKind,
  type ConfigValidationIssue,
  type ConfigValidationResult,
} from './configSchema.js';
import { DEFAULT_CONFIG, type RoxyCodeConfig } from './types/config.js';

export type ConfigScope = 'global' | 'project' | 'local';

export interface ConfigSetOptions {
  scope?: ConfigScope;
}

export interface ConfigPathSnapshot {
  global: string;
  project: string;
  local: string;
}

export interface ConfigSourceInfo {
  path: string;
  source: ConfigSourceKind;
  file?: string;
  env?: string;
  value?: unknown;
}

export interface ConfigSourceSnapshot {
  precedence: ConfigSourceKind[];
  paths: ConfigPathSnapshot;
  entries: ConfigSourceInfo[];
  issues: ConfigValidationIssue[];
}

interface ConfigFileReadResult {
  config: Partial<RoxyCodeConfig>;
  issues: ConfigValidationIssue[];
}

const SOURCE_PRECEDENCE: ConfigSourceKind[] = ['default', 'global', 'project', 'local', 'env', 'session'];

export class ConfigManager {
  private config: RoxyCodeConfig;
  private globalConfig: Partial<RoxyCodeConfig> = {};
  private projectConfig: Partial<RoxyCodeConfig> = {};
  private localConfig: Partial<RoxyCodeConfig> = {};
  private envConfig: Partial<RoxyCodeConfig> = {};
  private sessionConfig: Partial<RoxyCodeConfig> = {};
  private sourceMap = new Map<string, ConfigSourceInfo>();
  private envSourceMap = new Map<string, string>();
  private issues: ConfigValidationIssue[] = [];
  private readonly globalConfigPath: string;
  private readonly projectConfigPath: string;
  private readonly localConfigPath: string;
  private readonly cwd: string;

  constructor(cwd: string = process.cwd(), home: string = homedir()) {
    this.cwd = cwd;
    this.globalConfigPath = join(home, '.roxycode', 'config.json');
    this.projectConfigPath = join(cwd, '.roxycode', 'config.json');
    this.localConfigPath = join(cwd, '.roxycode', 'config.local.json');
    this.config = structuredClone(DEFAULT_CONFIG);
    this.rebuildEffectiveConfig();
  }

  async load(): Promise<void> {
    const global = await this.readConfigFile(this.globalConfigPath, 'global');
    const project = await this.readConfigFile(this.projectConfigPath, 'project');
    const local = await this.readConfigFile(this.localConfigPath, 'local');
    this.globalConfig = global.config;
    this.projectConfig = project.config;
    this.localConfig = local.config;

    const base = deepMerge(
      deepMerge(deepMerge(structuredClone(DEFAULT_CONFIG), this.globalConfig), this.projectConfig),
      this.localConfig,
    );
    const env = this.readEnvConfig(base);
    this.envConfig = env.config;
    this.envSourceMap = env.sources;
    this.issues = [...global.issues, ...project.issues, ...local.issues, ...env.issues];
    this.rebuildEffectiveConfig();
  }

  async reload(): Promise<void> {
    await this.load();
  }

  get(path: string): unknown {
    return path.split('.').filter(Boolean).reduce((obj: unknown, key) => {
      return isPlainObject(obj) || Array.isArray(obj) ? (obj as Record<string, unknown>)[key] : undefined;
    }, this.config);
  }

  getSource(path: string): ConfigSourceInfo | undefined {
    const direct = this.sourceMap.get(path);
    if (direct) return { ...direct, value: redactConfigValue(path, this.get(path)) };

    const nested = [...this.sourceMap.entries()]
      .filter(([entryPath]) => entryPath.startsWith(`${path}.`))
      .sort((a, b) => sourceRank(b[1].source) - sourceRank(a[1].source))[0]?.[1];
    if (!nested) return undefined;
    return { path, source: nested.source, file: nested.file, env: nested.env, value: redactConfigValue(path, this.get(path)) };
  }

  getSources(): ConfigSourceSnapshot {
    const entries = [...this.sourceMap.values()]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(entry => ({ ...entry, value: redactConfigValue(entry.path, this.get(entry.path)) }));
    return {
      precedence: SOURCE_PRECEDENCE,
      paths: this.getPaths(),
      entries,
      issues: this.getLoadIssues(),
    };
  }

  async set(path: string, value: unknown, options: ConfigSetOptions = {}): Promise<void> {
    const scope = options.scope ?? (hasNestedValue(this.projectConfig as Record<string, unknown>, path) ? 'project' : 'global');
    const target = scope === 'local' ? this.localConfig : scope === 'project' ? this.projectConfig : this.globalConfig;
    const candidate = structuredClone(target);
    setNestedValue(candidate as Record<string, unknown>, path, value);

    const validation = validateConfigObject(candidate, { source: scope, partial: true });
    const errors = validation.issues.filter(issue => issue.severity === 'error');
    if (errors.length > 0) {
      const first = errors[0];
      throw new Error(`Invalid config ${first.path}: ${first.message}`);
    }

    setNestedValue(target as Record<string, unknown>, path, value);
    await this.saveScope(scope);
    await this.load();
  }

  getPaths(): ConfigPathSnapshot {
    return {
      global: this.globalConfigPath,
      project: this.projectConfigPath,
      local: this.localConfigPath,
    };
  }

  snapshot(): Readonly<RoxyCodeConfig> {
    return structuredClone(this.config);
  }

  validate(): ConfigValidationResult {
    const effective = validateConfigObject(this.config, { partial: false }).issues.map(issue => {
      const source = this.getSource(issue.path);
      return {
        ...issue,
        source: issue.source ?? source?.source,
        file: issue.file ?? source?.file,
      };
    });
    const issues = [...this.getLoadIssues(), ...effective];
    return {
      ok: issues.every(issue => issue.severity !== 'error'),
      issues,
    };
  }

  exportEffectiveConfig(options: { includeSecrets?: boolean } = {}): RoxyCodeConfig | unknown {
    const snapshot = this.snapshot();
    if (options.includeSecrets) return snapshot;
    return redactConfigValue('', snapshot);
  }

  getLoadIssues(): ConfigValidationIssue[] {
    return this.issues.map(issue => ({ ...issue }));
  }

  private rebuildEffectiveConfig(): void {
    this.sourceMap.clear();
    this.config = structuredClone(DEFAULT_CONFIG);
    this.recordLayerSources(DEFAULT_CONFIG, 'default');

    this.config = deepMerge(this.config, this.globalConfig);
    this.recordLayerSources(this.globalConfig, 'global', { file: this.globalConfigPath });

    this.config = deepMerge(this.config, this.projectConfig);
    this.recordLayerSources(this.projectConfig, 'project', { file: this.projectConfigPath });

    this.config = deepMerge(this.config, this.localConfig);
    this.recordLayerSources(this.localConfig, 'local', { file: this.localConfigPath });

    this.config = deepMerge(this.config, this.envConfig);
    this.recordLayerSources(this.envConfig, 'env');

    this.config = deepMerge(this.config, this.sessionConfig);
    this.recordLayerSources(this.sessionConfig, 'session');
  }

  private recordLayerSources(
    layer: Partial<RoxyCodeConfig>,
    source: ConfigSourceKind,
    options: { file?: string } = {},
  ): void {
    for (const [path, value] of flattenConfig(layer)) {
      this.sourceMap.set(path, {
        path,
        source,
        file: options.file,
        env: source === 'env' ? this.envSourceMap.get(path) : undefined,
        value: redactConfigValue(path, value),
      });
    }
  }

  private async readConfigFile(path: string, source: ConfigSourceKind): Promise<ConfigFileReadResult> {
    if (!existsSync(path)) {
      return { config: {}, issues: [] };
    }

    try {
      const raw = await readFile(path, 'utf-8');
      if (raw.trim() === '') {
        return { config: {}, issues: [] };
      }

      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) {
        return {
          config: {},
          issues: [{
            path: '',
            file: path,
            source,
            severity: 'error',
            message: 'Config file must be a JSON object.',
            expected: 'object',
            actual: Array.isArray(parsed) ? 'array' : typeof parsed,
          }],
        };
      }

      const validation = validateConfigObject(parsed, { source, partial: true });
      const issues = validation.issues.map(issue => ({ ...issue, file: path }));
      if (!validation.ok) {
        return { config: {}, issues };
      }
      return { config: parsed as Partial<RoxyCodeConfig>, issues };
    } catch (error) {
      return {
        config: {},
        issues: [{
          path: '',
          file: path,
          source,
          severity: 'error',
          message: `Config file cannot be parsed: ${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }

  private readEnvConfig(base: RoxyCodeConfig): {
    config: Partial<RoxyCodeConfig>;
    sources: Map<string, string>;
    issues: ConfigValidationIssue[];
  } {
    const config: Partial<RoxyCodeConfig> = {};
    const sources = new Map<string, string>();
    const set = (path: string, value: unknown, envName: string | undefined) => {
      if (value === undefined || envName === undefined) return;
      setNestedValue(config as Record<string, unknown>, path, value);
      sources.set(path, envName);
    };

    const explicitProvider = firstEnv(['ROXY_LLM_PROVIDER', 'ROXY_PROVIDER']);
    if (explicitProvider) set('llm.provider', normalizeProviderId(explicitProvider.value), explicitProvider.name);

    const hasOpenAIEnv = Boolean(firstEnv(['ROXY_OPENAI_API_KEY', 'OPENAI_API_KEY', 'ROXY_OPENAI_BASE_URL', 'OPENAI_BASE_URL']));
    const hasOtherProviderEnv = Boolean(firstEnv([
      'ROXY_QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'QWEN_API_KEY', 'ROXY_QWEN_BASE_URL', 'DASHSCOPE_BASE_URL',
      'ROXY_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY', 'ROXY_DEEPSEEK_BASE_URL', 'DEEPSEEK_BASE_URL',
      'ROXY_GLM_API_KEY', 'BIGMODEL_API_KEY', 'GLM_API_KEY', 'ROXY_GLM_BASE_URL', 'BIGMODEL_BASE_URL',
    ]));
    if (!explicitProvider && hasOpenAIEnv && !hasOtherProviderEnv && normalizeProviderId(base.llm.provider) === DEFAULT_CONFIG.llm.provider) {
      set('llm.provider', 'compatible', 'ROXY_OPENAI_API_KEY');
    }

    const model = firstEnv(['ROXY_LLM_MODEL', 'ROXY_MODEL']);
    if (model) set('llm.model', model.value, model.name);

    const language = firstEnv(['ROXY_UI_LANGUAGE', 'ROXY_LANGUAGE']);
    if (language) set('ui.language', normalizeLanguageValue(language.value), language.name);

    const aesthetic = firstEnv(['ROXY_AESTHETIC_MODE', 'ROXY_AESTHETIC']);
    if (aesthetic) set('ui.aestheticMode', aesthetic.value.trim().toLowerCase(), aesthetic.name);

    const character = firstEnv(['ROXY_CHARACTER_CURRENT', 'ROXY_CHARACTER']);
    if (character) set('character.current', character.value, character.name);

    const mode = firstEnv(['ROXY_MODE', 'ROXY_AGENT_MODE']);
    if (mode) set('mode', mode.value.trim().toLowerCase(), mode.name);

    const providerForSecret = normalizeProviderId(
      (explicitProvider?.value || (this.getNestedConfigValue(config, 'llm.provider') as string) || base.llm.provider),
    );

    const genericApiKey = firstEnv(['ROXY_LLM_API_KEY', 'ROXY_API_KEY']);
    if (genericApiKey) set('llm.apiKey', genericApiKey.value, genericApiKey.name);

    const genericBaseUrl = firstEnv(['ROXY_LLM_BASE_URL', 'ROXY_BASE_URL']);
    if (genericBaseUrl) set('llm.baseUrl', genericBaseUrl.value, genericBaseUrl.name);

    const providerApiKey = firstEnv(apiKeyEnvCandidates(providerForSecret));
    if (providerApiKey) set('llm.apiKey', providerApiKey.value, providerApiKey.name);

    const providerBaseUrl = firstEnv(baseUrlEnvCandidates(providerForSecret));
    if (providerBaseUrl) set('llm.baseUrl', providerBaseUrl.value, providerBaseUrl.name);

    const validation = validateConfigObject(config, { source: 'env', partial: true });
    const issues = validation.issues.map(issue => ({ ...issue, env: sources.get(issue.path) }));
    return { config, sources, issues };
  }

  private getNestedConfigValue(config: Partial<RoxyCodeConfig>, path: string): unknown {
    return path.split('.').filter(Boolean).reduce((obj: unknown, key) => {
      return isPlainObject(obj) || Array.isArray(obj) ? (obj as Record<string, unknown>)[key] : undefined;
    }, config);
  }

  private async saveScope(scope: ConfigScope): Promise<void> {
    const path = scope === 'local' ? this.localConfigPath : scope === 'project' ? this.projectConfigPath : this.globalConfigPath;
    const data = scope === 'local' ? this.localConfig : scope === 'project' ? this.projectConfig : this.globalConfig;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    if (scope === 'local') await this.ensureLocalConfigGitignored();
  }

  private async ensureLocalConfigGitignored(): Promise<void> {
    const gitignorePath = join(this.cwd, '.gitignore');
    const current = existsSync(gitignorePath) ? await readFile(gitignorePath, 'utf-8') : '';
    const rules = current
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
    const alreadyIgnored = rules.some(rule =>
      rule === '.roxycode' || rule === '.roxycode/' || rule === '.roxycode/*' || rule === '.roxycode/config.local.json'
    );
    if (alreadyIgnored) return;

    const prefix = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`;
    await writeFile(gitignorePath, `${prefix}# RoxyCode local machine config\n.roxycode/config.local.json\n`, 'utf-8');
  }
}

function firstEnv(names: string[]): { name: string; value: string } | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.trim() !== '') return { name, value };
  }
  return undefined;
}

function apiKeyEnvCandidates(providerId: string): string[] {
  if (providerId === 'qwen' || providerId === 'dashscope') return ['ROXY_QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'QWEN_API_KEY'];
  if (providerId === 'deepseek') return ['ROXY_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'];
  if (providerId === 'glm' || providerId === 'bigmodel') return ['ROXY_GLM_API_KEY', 'BIGMODEL_API_KEY', 'GLM_API_KEY'];
  if (providerId === 'openai' || providerId === 'compatible') return ['ROXY_OPENAI_API_KEY', 'OPENAI_API_KEY'];
  return [];
}

function baseUrlEnvCandidates(providerId: string): string[] {
  if (providerId === 'qwen' || providerId === 'dashscope') return ['ROXY_QWEN_BASE_URL', 'DASHSCOPE_BASE_URL'];
  if (providerId === 'deepseek') return ['ROXY_DEEPSEEK_BASE_URL', 'DEEPSEEK_BASE_URL'];
  if (providerId === 'glm' || providerId === 'bigmodel') return ['ROXY_GLM_BASE_URL', 'BIGMODEL_BASE_URL'];
  if (providerId === 'openai' || providerId === 'compatible') return ['ROXY_OPENAI_BASE_URL', 'OPENAI_BASE_URL'];
  return [];
}

function normalizeProviderId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'aliyun' || normalized === 'tongyi') return 'qwen';
  if (normalized === 'zhipu' || normalized === 'bigmodel') return 'glm';
  if (normalized === 'openai-compatible' || normalized === 'openai_compatible') return 'compatible';
  return normalized;
}

function normalizeLanguageValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (['zh', 'zh-cn', 'cn', 'chinese'].includes(normalized)) return 'zh-CN';
  if (['en', 'en-us', 'english'].includes(normalized)) return 'en-US';
  return value;
}

function sourceRank(source: ConfigSourceKind): number {
  return SOURCE_PRECEDENCE.indexOf(source);
}

function flattenConfig(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (!isPlainObject(value)) {
    return prefix ? [[prefix, value]] : [];
  }

  const entries = Object.entries(value);
  if (entries.length === 0 && prefix) {
    return [[prefix, value]];
  }

  const result: Array<[string, unknown]> = [];
  for (const [key, child] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(child) && Object.keys(child).length > 0) {
      result.push(...flattenConfig(child, path));
    } else {
      result.push([path, child]);
    }
  }
  return result;
}

function hasNestedValue(target: Record<string, unknown>, path: string): boolean {
  const keys = path.split('.').filter(Boolean);
  if (keys.length === 0) return false;

  let obj: unknown = target;
  for (const key of keys) {
    if (!isPlainObject(obj) || !(key in obj)) return false;
    obj = obj[key];
  }
  return true;
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.').filter(Boolean);
  if (keys.length === 0) {
    throw new Error('Config path cannot be empty');
  }

  let obj = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const current = obj[key];
    if (!isPlainObject(current)) {
      obj[key] = {};
    }
    obj = obj[key] as Record<string, unknown>;
  }

  obj[keys[keys.length - 1]] = value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMerge(targetVal as Record<string, any>, sourceVal as Record<string, any>) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}
