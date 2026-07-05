import type { McpServerDefinition } from './types.js';
import { JsonRpcMcpClient } from './transports/JsonRpcMcpClient.js';
import { StdioTransport } from './transports/StdioTransport.js';
import { HTTPTransport } from './transports/HTTPTransport.js';
import { SSETransport } from './transports/SSETransport.js';
import { WebSocketTransport } from './transports/WebSocketTransport.js';
import { canonicalTransportType, normalizeTransportType } from './transports/Transport.js';
import type { McpClientTransport } from './transports/types.js';
import { assertPluginMcpServerAllowed, getPluginMcpCwd, renderPluginMcpConfig } from './McpPluginSandbox.js';

export function createMcpTransport(server: McpServerDefinition, cwd: string): McpClientTransport {
  const preparedServer = renderPluginMcpConfig(server, `MCP server ${server.name}`);
  assertPluginMcpServerAllowed(preparedServer);
  const transportCwd = getPluginMcpCwd(preparedServer, cwd);
  const type = normalizeTransportType(preparedServer.type);
  if (type === 'stdio') return new JsonRpcMcpClient(preparedServer, new StdioTransport(preparedServer, transportCwd));
  if (type === 'sse') return new JsonRpcMcpClient(preparedServer, new SSETransport(preparedServer));
  if (type === 'http' || type === 'streamable-http') return new JsonRpcMcpClient(preparedServer, new HTTPTransport(preparedServer));
  if (type === 'ws' || type === 'websocket') return new JsonRpcMcpClient(preparedServer, new WebSocketTransport(preparedServer));
  throw new Error(`Unsupported MCP transport type: ${String(preparedServer.type)}`);
}

export { canonicalTransportType, normalizeTransportType };
