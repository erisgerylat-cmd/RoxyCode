import type { MCPOAuthConfig, MCPServerConfig, MCPTransportType } from '../core/types/config.js';
import type { PluginSandboxMetadata } from '../plugin/types.js';
import type { ToolParameterSchema } from '../tool/types.js';

export type McpTransportType = MCPTransportType;
export type McpOAuthConfig = MCPOAuthConfig;

export interface McpServerDefinition extends MCPServerConfig {
  name: string;
  source: 'config' | 'plugin';
  pluginId?: string;
  pluginRoot?: string;
  pluginSandbox?: PluginSandboxMetadata;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDefinition {
  serverName: string;
  originalName: string;
  roxyName: string;
  description: string;
  inputSchema: ToolParameterSchema;
  annotations?: McpToolAnnotations;
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
