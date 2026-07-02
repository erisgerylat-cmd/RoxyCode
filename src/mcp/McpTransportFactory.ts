import type { McpServerDefinition } from './types.js';
import { JsonRpcMcpClient } from './transports/JsonRpcMcpClient.js';
import { StdioTransport } from './transports/StdioTransport.js';
import { HTTPTransport } from './transports/HTTPTransport.js';
import { SSETransport } from './transports/SSETransport.js';
import { WebSocketTransport } from './transports/WebSocketTransport.js';
import { canonicalTransportType, normalizeTransportType } from './transports/Transport.js';
import type { McpClientTransport } from './transports/types.js';

export function createMcpTransport(server: McpServerDefinition, cwd: string): McpClientTransport {
  const type = normalizeTransportType(server.type);
  if (type === 'stdio') return new JsonRpcMcpClient(server, new StdioTransport(server, cwd));
  if (type === 'sse') return new JsonRpcMcpClient(server, new SSETransport(server));
  if (type === 'http' || type === 'streamable-http') return new JsonRpcMcpClient(server, new HTTPTransport(server));
  if (type === 'ws' || type === 'websocket') return new JsonRpcMcpClient(server, new WebSocketTransport(server));
  throw new Error(`Unsupported MCP transport type: ${String(server.type)}`);
}

export { canonicalTransportType, normalizeTransportType };