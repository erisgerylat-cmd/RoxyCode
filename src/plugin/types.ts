import type { MCPServerConfig } from '../core/types/config.js';
import type { RoxyHookDefinition } from '../hooks/types.js';

export interface RoxyPluginCommand {
  name: string;
  description: string;
  prompt: string;
  aliases?: string[];
  category?: 'basic' | 'dev' | 'workflow' | 'context' | 'character' | 'debug' | 'system';
  usage?: string;
  examples?: string[];
}

export interface RoxyPluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled?: boolean;
  author?: string;
  commands?: RoxyPluginCommand[];
  hooks?: RoxyHookDefinition[];
  mcpServers?: Record<string, MCPServerConfig>;
  workflows?: string[];
  characters?: string[];
}

export interface LoadedRoxyPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  root: string;
  manifestPath: string;
  manifest: RoxyPluginManifest;
}

export interface PluginLoadError {
  path: string;
  message: string;
}

export interface PluginLoadResult {
  enabled: LoadedRoxyPlugin[];
  disabled: LoadedRoxyPlugin[];
  errors: PluginLoadError[];
  directories: string[];
}

export interface PluginContributions {
  commands: RoxyPluginCommand[];
  hooks: RoxyHookDefinition[];
  mcpServers: Record<string, MCPServerConfig>;
}