import { DEFAULT_CONFIG } from './types/config.js';

export type ConfigSourceKind = 'default' | 'global' | 'project' | 'local' | 'env' | 'session';
export type ConfigIssueSeverity = 'error' | 'warning';

export interface ConfigValidationIssue {
  path: string;
  message: string;
  severity: ConfigIssueSeverity;
  source?: ConfigSourceKind;
  file?: string;
  env?: string;
  expected?: string;
  actual?: string;
}

export interface ConfigValidationResult {
  ok: boolean;
  issues: ConfigValidationIssue[];
}

type FieldType = 'string' | 'boolean' | 'number' | 'array' | 'object';

interface FieldRule {
  type: FieldType;
  enumValues?: readonly string[];
  optional?: boolean;
  min?: number;
  max?: number;
}

const CONFIG_RULES: Record<string, FieldRule> = {
  'character.current': { type: 'string' },
  'character.showStartupQuote': { type: 'boolean' },
  'character.demonEye': { type: 'boolean' },
  'character.telepathy': { type: 'boolean' },
  'llm.provider': { type: 'string' },
  'llm.model': { type: 'string' },
  'llm.fallbackModels': { type: 'array' },
  'llm.apiKey': { type: 'string', optional: true },
  'llm.baseUrl': { type: 'string', optional: true },
  'ui.language': { type: 'string', enumValues: ['zh-CN', 'en-US'] },
  'ui.aestheticMode': { type: 'string', enumValues: ['minimal', 'balanced', 'immersive'] },
  mode: { type: 'string', enumValues: ['auto', 'lite', 'economic', 'standard', 'ultimate'] },
  'questioning.mode': { type: 'string', enumValues: ['always', 'smart', 'minimal', 'never'] },
  'cost.pricingMethod': { type: 'string', enumValues: ['token', 'plan', 'none'] },
  'cost.tokenPricing.inputPricePer1K': { type: 'number', optional: true, min: 0 },
  'cost.tokenPricing.outputPricePer1K': { type: 'number', optional: true, min: 0 },
  'mcp.enabled': { type: 'boolean' },
  'mcp.servers': { type: 'object' },
  'mcp.directories': { type: 'array' },
  'security.apiKeyEncryption': { type: 'boolean' },
  'security.fileAccess.mode': { type: 'string', enumValues: ['project-only', 'unrestricted'] },
  'security.fileAccess.backupBeforeWrite': { type: 'boolean' },
  'security.shell.mode': { type: 'string', enumValues: ['whitelist', 'unrestricted'] },
  'security.shell.requireConfirmation': { type: 'boolean' },
  'security.shell.whitelist': { type: 'array' },
  'security.highRisk.requireSecondConfirmation': { type: 'boolean' },
  'tools.builtin': { type: 'boolean' },
  'tools.disabled': { type: 'array' },
  'skills.builtin': { type: 'boolean' },
  'skills.directories': { type: 'array' },
  'workflows.builtin': { type: 'boolean' },
  'workflows.directories': { type: 'array' },
  'memory.auto': { type: 'boolean' },
  'context.maxTokens': { type: 'number', min: 0 },
  'context.enableCompression': { type: 'boolean' },
  'context.compressThreshold': { type: 'number', min: 0, max: 1 },
  'hooks.enabled': { type: 'boolean' },
  'hooks.directories': { type: 'array' },
  'plugins.enabled': { type: 'boolean' },
  'plugins.directories': { type: 'array' },
  'plugins.trust': { type: 'string', enumValues: ['project-only', 'allow-local'] },
};

const REQUIRED_OBJECT_PATHS = [
  'character',
  'llm',
  'ui',
  'questioning',
  'cost',
  'mcp',
  'security',
  'security.fileAccess',
  'security.shell',
  'security.highRisk',
  'tools',
  'skills',
  'workflows',
  'memory',
  'context',
  'hooks',
  'plugins',
];

const KNOWN_TOP_LEVEL_KEYS = new Set(Object.keys(DEFAULT_CONFIG));
const SECRET_PATH_PATTERN = /(^|\.)(apiKey|token|secret|password|authorization|credential|cookie)(\.|$)/i;

export function validateConfigObject(
  config: unknown,
  options: { source?: ConfigSourceKind; partial?: boolean } = {},
): ConfigValidationResult {
  const issues: ConfigValidationIssue[] = [];
  const source = options.source;

  if (!isPlainObject(config)) {
    return {
      ok: false,
      issues: [{
        path: '',
        message: 'Config must be a JSON object.',
        severity: 'error',
        source,
        expected: 'object',
        actual: describeType(config),
      }],
    };
  }

  for (const key of Object.keys(config)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      issues.push({
        path: key,
        message: `Unknown top-level config key "${key}". RoxyCode keeps it but does not use it.`,
        severity: 'warning',
        source,
      });
    }
  }

  if (!options.partial) {
    for (const objectPath of REQUIRED_OBJECT_PATHS) {
      const value = getNestedValue(config, objectPath);
      if (!isPlainObject(value)) {
        issues.push({
          path: objectPath,
          message: 'Required config object is missing.',
          severity: 'error',
          source,
          expected: 'object',
          actual: describeType(value),
        });
      }
    }
  }

  for (const [path, rule] of Object.entries(CONFIG_RULES)) {
    const exists = hasNestedValue(config, path);
    const value = getNestedValue(config, path);
    if (!exists) {
      if (!options.partial && !rule.optional) {
        issues.push({
          path,
          message: 'Required config value is missing.',
          severity: 'error',
          source,
          expected: ruleToExpected(rule),
          actual: 'undefined',
        });
      }
      continue;
    }
    validateRule(path, value, rule, source, issues);
  }

  validateStringArray('mcp.directories', config, source, issues);
  validateStringArray('security.shell.whitelist', config, source, issues);
  validateStringArray('tools.disabled', config, source, issues);
  validateStringArray('llm.fallbackModels', config, source, issues);
  validateStringArray('skills.directories', config, source, issues);
  validateStringArray('workflows.directories', config, source, issues);
  validateStringArray('hooks.directories', config, source, issues);
  validateStringArray('plugins.directories', config, source, issues);
  validateMcpServers(config, source, issues);

  return {
    ok: issues.every(issue => issue.severity !== 'error'),
    issues,
  };
}

export function isSecretConfigPath(path: string): boolean {
  return SECRET_PATH_PATTERN.test(path);
}

export function redactConfigValue(path: string, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (isSecretConfigPath(path)) return value ? '[redacted]' : value;
  if (Array.isArray(value)) return value.map((item, index) => redactConfigValue(`${path}.${index}`, item));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = redactConfigValue(path ? `${path}.${key}` : key, nested);
    }
    return out;
  }
  return value;
}

export function getKnownConfigPaths(): string[] {
  return Object.keys(CONFIG_RULES).sort();
}

function validateRule(
  path: string,
  value: unknown,
  rule: FieldRule,
  source: ConfigSourceKind | undefined,
  issues: ConfigValidationIssue[],
): void {
  if (!matchesType(value, rule.type)) {
    issues.push({
      path,
      message: `Invalid config type. Expected ${rule.type}.`,
      severity: 'error',
      source,
      expected: rule.type,
      actual: describeType(value),
    });
    return;
  }

  if (rule.enumValues && typeof value === 'string' && !rule.enumValues.includes(value)) {
    issues.push({
      path,
      message: `Unsupported value "${value}".`,
      severity: 'error',
      source,
      expected: rule.enumValues.join(' | '),
      actual: value,
    });
  }

  if (typeof value === 'number') {
    if (rule.min !== undefined && value < rule.min) {
      issues.push({
        path,
        message: `Number must be >= ${rule.min}.`,
        severity: 'error',
        source,
        expected: `>= ${rule.min}`,
        actual: String(value),
      });
    }
    if (rule.max !== undefined && value > rule.max) {
      issues.push({
        path,
        message: `Number must be <= ${rule.max}.`,
        severity: 'error',
        source,
        expected: `<= ${rule.max}`,
        actual: String(value),
      });
    }
  }
}

function validateStringArray(
  path: string,
  config: unknown,
  source: ConfigSourceKind | undefined,
  issues: ConfigValidationIssue[],
): void {
  if (!hasNestedValue(config, path)) return;
  const value = getNestedValue(config, path);
  if (!Array.isArray(value)) return;
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      issues.push({
        path: `${path}.${i}`,
        message: 'Array items must be strings.',
        severity: 'error',
        source,
        expected: 'string',
        actual: describeType(value[i]),
      });
    }
  }
}

function validateMcpServers(
  config: unknown,
  source: ConfigSourceKind | undefined,
  issues: ConfigValidationIssue[],
): void {
  const servers = getNestedValue(config, 'mcp.servers');
  if (!isPlainObject(servers)) return;
  const supportedTypes = new Set(['stdio', 'sse', 'http']);
  for (const [name, value] of Object.entries(servers)) {
    const base = `mcp.servers.${name}`;
    if (!isPlainObject(value)) {
      issues.push({
        path: base,
        message: 'MCP server config must be an object.',
        severity: 'error',
        source,
        expected: 'object',
        actual: describeType(value),
      });
      continue;
    }

    const rawType = value.type;
    const type = rawType === undefined ? 'stdio' : typeof rawType === 'string' ? rawType : '';
    if (rawType !== undefined && typeof rawType !== 'string') {
      issues.push({
        path: `${base}.type`,
        message: 'MCP server type must be a string.',
        severity: 'error',
        source,
        expected: 'stdio | sse | http',
        actual: describeType(rawType),
      });
    } else if (!supportedTypes.has(type)) {
      issues.push({
        path: `${base}.type`,
        message: 'Unsupported MCP transport type.',
        severity: 'error',
        source,
        expected: 'stdio | sse | http',
        actual: String(rawType),
      });
    }

    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
      issues.push({
        path: `${base}.enabled`,
        message: 'enabled must be a boolean.',
        severity: 'error',
        source,
        expected: 'boolean',
        actual: describeType(value.enabled),
      });
    }
    if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || value.timeoutMs < 0)) {
      issues.push({
        path: `${base}.timeoutMs`,
        message: 'timeoutMs must be a non-negative number.',
        severity: 'error',
        source,
        expected: 'number >= 0',
        actual: describeType(value.timeoutMs),
      });
    }
    if (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every(item => typeof item === 'string'))) {
      issues.push({
        path: `${base}.args`,
        message: 'args must be a string array.',
        severity: 'error',
        source,
        expected: 'string[]',
        actual: describeType(value.args),
      });
    }
    if (value.env !== undefined) validateStringRecord(`${base}.env`, value.env, source, issues);
    if (value.headers !== undefined) validateStringRecord(`${base}.headers`, value.headers, source, issues);

    if (type === 'stdio') {
      if (typeof value.command !== 'string' || value.command.trim() === '') {
        issues.push({
          path: `${base}.command`,
          message: 'stdio MCP server requires command.',
          severity: 'error',
          source,
          expected: 'non-empty string',
          actual: describeType(value.command),
        });
      }
      continue;
    }

    if (type === 'sse' || type === 'http') {
      if (typeof value.url !== 'string' || !isValidHttpUrl(value.url)) {
        issues.push({
          path: `${base}.url`,
          message: `${type.toUpperCase()} MCP server requires an http(s) URL.`,
          severity: 'error',
          source,
          expected: 'http(s) URL',
          actual: describeType(value.url),
        });
      }
    }
  }
}

function validateStringRecord(
  path: string,
  value: unknown,
  source: ConfigSourceKind | undefined,
  issues: ConfigValidationIssue[],
): void {
  if (!isPlainObject(value)) {
    issues.push({
      path,
      message: 'Value must be an object with string values.',
      severity: 'error',
      source,
      expected: 'Record<string, string>',
      actual: describeType(value),
    });
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested !== 'string') {
      issues.push({
        path: `${path}.${key}`,
        message: 'Record values must be strings.',
        severity: 'error',
        source,
        expected: 'string',
        actual: describeType(nested),
      });
    }
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
function ruleToExpected(rule: FieldRule): string {
  return rule.enumValues ? rule.enumValues.join(' | ') : rule.type;
}

function matchesType(value: unknown, type: FieldType): boolean {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isPlainObject(value);
  return typeof value === type;
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function hasNestedValue(target: unknown, path: string): boolean {
  const keys = path.split('.').filter(Boolean);
  if (keys.length === 0) return false;
  let obj: unknown = target;
  for (const key of keys) {
    if (!isPlainObject(obj) || !(key in obj)) return false;
    obj = obj[key];
  }
  return true;
}

function getNestedValue(target: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce((obj: unknown, key) => {
    return isPlainObject(obj) || Array.isArray(obj) ? (obj as Record<string, unknown>)[key] : undefined;
  }, target);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
