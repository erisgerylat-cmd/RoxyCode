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
      const normalized = normalizeServer(name, server, 'config');
      if (normalized) servers.set(normalized.name, normalized);
      else errors.push({ source: name, message: 'MCP server config must include command.' });
    }

    for (const file of await this.resolveMcpFiles()) {
      files.push(file);
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8')) as McpJsonFile;
        const rawServers = parsed.mcpServers ?? parsed.servers ?? {};
        for (const [name, server] of Object.entries(rawServers)) {
          const normalized = normalizeServer(name, server, 'config');
          if (normalized) servers.set(normalized.name, normalized);
          else errors.push({ source: file, message: `MCP server "${name}" must include command.` });
        }
      } catch (error) {
        errors.push({ source: file, message: error instanceof Error ? error.message : String(error) });
      }
    }

    for (const [name, server] of Object.entries(this.pluginServers)) {
      const normalized = normalizeServer(name, server, 'plugin');
      if (normalized) servers.set(normalized.name, normalized);
      else errors.push({ source: name, message: 'Plugin MCP server config must include command.' });
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

function normalizeServer(name: string, config: MCPServerConfig, source: 'config' | 'plugin'): McpServerDefinition | null {
  if (!config || typeof config.command !== 'string' || config.command.trim().length === 0) return null;
  return {
    ...config,
    type: config.type ?? 'stdio',
    name: normalizeServerName(name),
    command: config.command.trim(),
    args: Array.isArray(config.args) ? config.args.map(String) : [],
    env: normalizeEnv(config.env),
    enabled: config.enabled !== false,
    source,
  };
}

function normalizeEnv(env: unknown): Record<string, string> | undefined {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) out[key] = String(value);
  return out;
}

export function normalizeServerName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp';
}