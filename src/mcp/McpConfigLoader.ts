import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';
import type { MCPServerConfig, RoxyCodeConfig } from '../core/types/config.js';
import type { McpJsonFile, McpLoadError, McpLoadResult, McpServerDefinition } from './types.js';

export interface McpConfigLoaderOptions {
  cwd?: string;
  config: RoxyCodeConfig;
  pluginServers?: Record<string, MCPServerConfig>;
}

type NormalizeResult = { server: McpServerDefinition; error?: undefined } | { server?: undefined; error: string };

export class McpConfigLoader {
  private readonly cwd: string;
  private readonly config: RoxyCodeConfig;
  private readonly pluginServers: Record<string, MCPServerConfig>;

  constructor(options: McpConfigLoaderOptions) {
    this.cwd = options.cwd ?? process.cwd();
    this.config = options.config;
    this.pluginServers = options.pluginServers ?? {};
  }

  async load(): Promise<McpLoadResult> {
    const servers = new Map<string, McpServerDefinition>();
    const errors: McpLoadError[] = [];
    const files: string[] = [];

    if (this.config.mcp.enabled === false) return { servers: [], errors, files };

    for (const [name, server] of Object.entries(this.config.mcp.servers ?? {})) {
      addNormalizedServer(servers, errors, name, normalizeServer(name, server, 'config'));
    }

    for (const file of await this.resolveMcpFiles()) {
      files.push(file);
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8')) as McpJsonFile;
        const rawServers = parsed.mcpServers ?? parsed.servers ?? {};
        for (const [name, server] of Object.entries(rawServers)) {
          addNormalizedServer(servers, errors, file, normalizeServer(name, server, 'config'), name);
        }
      } catch (error) {
        errors.push({ source: file, message: error instanceof Error ? error.message : String(error) });
      }
    }

    for (const [name, server] of Object.entries(this.pluginServers)) {
      addNormalizedServer(servers, errors, name, normalizeServer(name, server, 'plugin'));
    }

    return { servers: Array.from(servers.values()), errors, files };
  }

  private async resolveMcpFiles(): Promise<string[]> {
    const files: string[] = [];
    const directories = this.config.mcp.directories?.length ? this.config.mcp.directories : ['.roxycode'];
    for (const raw of directories) {
      const dir = isAbsolute(raw) ? raw : resolve(this.cwd, raw);
      if (!existsSync(dir)) continue;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const lower = entry.name.toLowerCase();
          if (lower === 'mcp.json' || lower === '.mcp.json' || lower === 'roxy-mcp.json') {
            files.push(resolve(dir, entry.name));
          } else if (lower.startsWith('mcp.') && extname(lower) === '.json') {
            files.push(resolve(dir, entry.name));
          }
        }
      } catch {
        continue;
      }
    }
    return files;
  }
}

function addNormalizedServer(
  servers: Map<string, McpServerDefinition>,
  errors: McpLoadError[],
  source: string,
  result: NormalizeResult,
  serverName?: string,
): void {
  if (result.server) {
    servers.set(result.server.name, result.server);
    return;
  }
  errors.push({ source, message: serverName ? `MCP server "${serverName}": ${result.error}` : result.error });
}

function normalizeServer(name: string, config: MCPServerConfig, source: 'config' | 'plugin'): NormalizeResult {
  if (!config || typeof config !== 'object') return { error: 'MCP server config must be an object.' };
  const type = config.type ?? 'stdio';
  const normalizedName = normalizeServerName(name);
  const base = {
    ...config,
    type,
    name: normalizedName,
    enabled: config.enabled !== false,
    timeoutMs: typeof config.timeoutMs === 'number' ? config.timeoutMs : undefined,
    env: normalizeEnv(config.env),
    headers: normalizeHeaders(config.headers),
    source,
  };

  if (type === 'stdio') {
    if (typeof config.command !== 'string' || config.command.trim().length === 0) {
      return { error: 'stdio transport requires command.' };
    }
    return {
      server: {
        ...base,
        type: 'stdio',
        command: config.command.trim(),
        args: Array.isArray(config.args) ? config.args.map(String) : [],
      },
    };
  }

  if (type === 'sse' || type === 'http') {
    if (typeof config.url !== 'string' || !isValidHttpUrl(config.url)) {
      return { error: `${type.toUpperCase()} transport requires an http(s) url.` };
    }
    return {
      server: {
        ...base,
        type,
        url: config.url.trim(),
        args: Array.isArray(config.args) ? config.args.map(String) : undefined,
      },
    };
  }

  return { error: `unsupported MCP transport type: ${String(type)}.` };
}

function normalizeEnv(env: unknown): Record<string, string> | undefined {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) out[key] = String(value);
  return out;
}

function normalizeHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key] = String(value);
  return out;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeServerName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp';
}
