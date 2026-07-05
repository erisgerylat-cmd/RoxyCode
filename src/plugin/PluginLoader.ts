import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { RoxyCodeConfig } from '../core/types/config.js';
import type { LoadedRoxyPlugin, PluginContributions, PluginLoadResult, PluginSandboxConfig, PluginSandboxMetadata, RoxyPluginCommand, RoxyPluginManifest } from './types.js';

export interface PluginLoaderOptions {
  cwd?: string;
  config: RoxyCodeConfig;
}

export class PluginLoader {
  private readonly cwd: string;
  private readonly config: RoxyCodeConfig;

  constructor(options: PluginLoaderOptions) {
    this.cwd = options.cwd ?? process.cwd();
    this.config = options.config;
  }

  async load(): Promise<PluginLoadResult> {
    const enabled: LoadedRoxyPlugin[] = [];
    const disabled: LoadedRoxyPlugin[] = [];
    const errors: PluginLoadResult['errors'] = [];
    const directories = this.resolveDirectories();

    if (this.config.plugins.enabled === false) return { enabled, disabled, errors, directories };

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
        if (!entry.isDirectory()) continue;
        const root = resolve(directory, entry.name);
        const manifestPath = resolve(root, 'plugin.json');
        if (!existsSync(manifestPath)) continue;
        try {
          const manifest = normalizeManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
          const sandbox = createPluginSandboxMetadata(manifest.id, root, manifestPath, manifest.sandbox);
          const plugin: LoadedRoxyPlugin = {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            enabled: manifest.enabled !== false,
            root,
            manifestPath,
            manifest,
            sandbox,
          };
          if (plugin.enabled) enabled.push(plugin);
          else disabled.push(plugin);
        } catch (error) {
          errors.push({ path: manifestPath, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    return { enabled: dedupePlugins(enabled), disabled: dedupePlugins(disabled), errors, directories };
  }

  private resolveDirectories(): string[] {
    const directories = this.config.plugins.directories?.length ? this.config.plugins.directories : ['.roxycode/plugins'];
    return directories.map(raw => isAbsolute(raw) ? raw : resolve(this.cwd, raw));
  }
}

export function collectPluginContributions(plugins: LoadedRoxyPlugin[]): PluginContributions {
  const commands: RoxyPluginCommand[] = [];
  const hooks = [] as PluginContributions['hooks'];
  const mcpServers: PluginContributions['mcpServers'] = {};

  for (const plugin of plugins) {
    for (const command of plugin.manifest.commands ?? []) {
      commands.push({
        ...command,
        name: `${plugin.id}:${command.name}`,
        pluginId: plugin.id,
        pluginRoot: plugin.root,
        pluginSandbox: plugin.sandbox,
      });
    }
    for (const hook of plugin.manifest.hooks ?? []) {
      hooks.push({
        ...hook,
        id: `${plugin.id}-${hook.id}`,
        pluginId: plugin.id,
        pluginRoot: plugin.root,
        pluginSandbox: plugin.sandbox,
        source: plugin.manifestPath,
      });
    }
    for (const [name, server] of Object.entries(plugin.manifest.mcpServers ?? {})) {
      mcpServers[`plugin_${plugin.id}_${name}`] = {
        ...server,
        pluginId: plugin.id,
        pluginRoot: plugin.root,
        pluginSandbox: plugin.sandbox,
        env: {
          ...(server.env ?? {}),
          ROXY_PLUGIN_ID: plugin.id,
          ROXY_PLUGIN_ROOT: plugin.root,
        },
      };
    }
  }

  return { commands, hooks, mcpServers };
}

function normalizeManifest(raw: unknown): RoxyPluginManifest {
  if (!isRecord(raw)) throw new Error('Plugin manifest must be an object.');
  const id = normalizeId(asString(raw.id) || asString(raw.name));
  if (!id) throw new Error('Plugin manifest requires id or name.');
  const name = asString(raw.name) || id;
  const version = asString(raw.version) || '0.1.0';
  return {
    id,
    name,
    version,
    description: asString(raw.description),
    enabled: raw.enabled === undefined ? true : asBoolean(raw.enabled),
    author: asString(raw.author),
    commands: normalizeCommands(raw.commands),
    hooks: Array.isArray(raw.hooks) ? raw.hooks as RoxyPluginManifest['hooks'] : [],
    mcpServers: isRecord(raw.mcpServers) ? raw.mcpServers as RoxyPluginManifest['mcpServers'] : {},
    workflows: asStringArray(raw.workflows),
    characters: asStringArray(raw.characters),
    sandbox: normalizeSandbox(raw.sandbox ?? raw.permissions),
  };
}

function normalizeCommands(value: unknown): RoxyPluginCommand[] {
  if (!Array.isArray(value)) return [];
  const commands: RoxyPluginCommand[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = normalizeId(asString(item.name));
    const description = asString(item.description) || '';
    const prompt = asString(item.prompt);
    if (!name || !prompt) continue;
    commands.push({
      name,
      description,
      prompt,
      aliases: asStringArray(item.aliases),
      category: normalizeCategory(asString(item.category)),
      usage: asString(item.usage),
      examples: asStringArray(item.examples),
    });
  }
  return commands;
}

function dedupePlugins(plugins: LoadedRoxyPlugin[]): LoadedRoxyPlugin[] {
  const seen = new Set<string>();
  const result: LoadedRoxyPlugin[] = [];
  for (const plugin of plugins) {
    if (seen.has(plugin.id)) continue;
    seen.add(plugin.id);
    result.push(plugin);
  }
  return result;
}

function normalizeCategory(value: string | undefined): RoxyPluginCommand['category'] {
  const categories = ['basic', 'dev', 'workflow', 'context', 'character', 'debug', 'system'];
  return value && categories.includes(value) ? value as RoxyPluginCommand['category'] : 'workflow';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return undefined;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', 'yes', '1', 'on'].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function normalizeId(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSandbox(value: unknown): PluginSandboxConfig | undefined {
  if (!isRecord(value)) return undefined;
  const config: PluginSandboxConfig = {};
  const allowedPaths = asStringArray(value.allowedPaths ?? value.allowed_paths);
  const allowedHosts = asStringArray(value.allowedHosts ?? value.allowed_hosts);
  if (allowedPaths?.length) config.allowedPaths = allowedPaths;
  if (allowedHosts?.length) config.allowedHosts = allowedHosts.map(host => host.toLowerCase());
  if (typeof value.allowNetworkAccess === 'boolean') config.allowNetworkAccess = value.allowNetworkAccess;
  if (typeof value.allow_network_access === 'boolean') config.allowNetworkAccess = value.allow_network_access;
  return Object.keys(config).length > 0 ? config : undefined;
}

function createPluginSandboxMetadata(
  pluginId: string,
  pluginRoot: string,
  manifestPath: string,
  config: PluginSandboxConfig | undefined,
): PluginSandboxMetadata {
  const root = resolve(pluginRoot);
  const allowedPaths = [root];
  for (const raw of config?.allowedPaths ?? []) {
    const candidate = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
    if (isPathInside(root, candidate) && !allowedPaths.includes(candidate)) allowedPaths.push(candidate);
  }
  return {
    pluginId,
    pluginRoot: root,
    manifestPath: resolve(manifestPath),
    allowedPaths,
    allowNetworkAccess: config?.allowNetworkAccess === true,
    allowedHosts: [...new Set((config?.allowedHosts ?? []).map(host => host.toLowerCase()))],
  };
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const rel = relative(basePath, targetPath);
  return rel === '' || (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel));
}
