import { isAbsolute } from 'node:path';

import type { MCPOAuthConfig, MCPServerConfig } from '../core/types/config.js';
import { createPluginSandboxGuard, renderPluginVariables } from '../plugin/PluginVariables.js';
import type { PluginSandboxMetadata } from '../plugin/types.js';
import type { McpServerDefinition } from './types.js';

type PluginMcpMetadata = {
  pluginId?: string;
  pluginRoot?: string;
  pluginSandbox?: PluginSandboxMetadata;
};

export function renderPluginMcpConfig<T extends MCPServerConfig & PluginMcpMetadata>(config: T, owner: string): T {
  const sandbox = config.pluginSandbox;
  if (!sandbox) return config;
  const render = (value: string, field: string) => renderPluginVariables(value, sandbox, `${owner} ${field}`);
  const renderedEnv = renderRecord(config.env, render, 'env');

  return {
    ...config,
    command: typeof config.command === 'string' ? render(config.command, 'command') : config.command,
    args: Array.isArray(config.args) ? config.args.map((arg, index) => render(String(arg), `arg ${index + 1}`)) : config.args,
    url: typeof config.url === 'string' ? render(config.url, 'url') : config.url,
    headers: renderRecord(config.headers, render, 'header'),
    oauth: renderOAuth(config.oauth, render),
    env: {
      ...(renderedEnv ?? {}),
      ROXY_PLUGIN_ID: sandbox.pluginId,
      ROXY_PLUGIN_ROOT: sandbox.pluginRoot,
    },
  };
}

export function assertPluginMcpServerAllowed(server: McpServerDefinition): void {
  const sandbox = server.pluginSandbox;
  if (!sandbox) return;
  const guard = createPluginSandboxGuard(sandbox);
  const type = server.type ?? 'stdio';

  if (type === 'stdio') {
    const command = server.command?.trim();
    if (command && isAbsolute(command)) {
      const validation = guard.validatePath(command);
      if (!validation.allowed) {
        throw new Error(`Plugin MCP server ${server.name} command executable is outside its sandbox: ${command}`);
      }
    }
    return;
  }

  if (server.url) {
    const validation = guard.validateNetworkAccess(server.url);
    if (!validation.allowed) {
      throw new Error(`Plugin MCP server ${server.name} network access denied: ${validation.reason ?? server.url}`);
    }
  }
}

export function getPluginMcpCwd(server: McpServerDefinition, fallbackCwd: string): string {
  return server.pluginSandbox?.pluginRoot ?? fallbackCwd;
}

function renderRecord(
  record: Record<string, string> | undefined,
  render: (value: string, field: string) => string,
  label: string,
): Record<string, string> | undefined {
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = render(String(value), `${label} ${key}`);
  }
  return out;
}

function renderOAuth(
  oauth: MCPOAuthConfig | undefined,
  render: (value: string, field: string) => string,
): MCPOAuthConfig | undefined {
  if (!oauth) return undefined;
  const out: MCPOAuthConfig = { ...oauth };
  for (const key of ['clientId', 'clientSecret', 'scope', 'issuerUrl', 'authServerMetadataUrl', 'authorizationUrl', 'tokenUrl'] as const) {
    if (typeof out[key] === 'string') out[key] = render(out[key], `oauth ${key}`);
  }
  return out;
}
