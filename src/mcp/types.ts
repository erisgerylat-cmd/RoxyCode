import type { MCPServerConfig } from '../core/types/config.js';
import type { ToolParameterSchema } from '../tool/types.js';

export interface McpServerDefinition extends MCPServerConfig {
  name: string;
  source: 'config' | 'plugin';
  pluginId?: string;
}

export interface McpToolDefinition {
  serverName: string;
  originalName: string;
  roxyName: string;
  description: string;
  inputSchema: ToolParameterSchema;
}

export interface McpLoadError {
  source: string;
  message: string;
}

export interface McpLoadResult {
  servers: McpServerDefinition[];
  errors: McpLoadError[];
  files: string[];
}

export interface McpJsonFile {
  mcpServers?: Record<string, MCPServerConfig>;
  servers?: Record<string, MCPServerConfig>;
}