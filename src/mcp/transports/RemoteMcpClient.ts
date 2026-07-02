import type { McpServerDefinition } from '../types.js';
import { HTTPTransport } from './HTTPTransport.js';
import { JsonRpcMcpClient } from './JsonRpcMcpClient.js';
import { SSETransport } from './SSETransport.js';
import { normalizeTransportType, type McpTransport } from './Transport.js';
import { WebSocketTransport } from './WebSocketTransport.js';

export class RemoteMcpClient extends JsonRpcMcpClient {
  constructor(server: McpServerDefinition) {
    super(server, createRemoteTransport(server));
  }
}

function createRemoteTransport(server: McpServerDefinition): McpTransport {
  const type = normalizeTransportType(server.type);
  if (type === 'sse') return new SSETransport(server);
  if (type === 'http' || type === 'streamable-http') return new HTTPTransport(server);
  if (type === 'ws' || type === 'websocket') return new WebSocketTransport(server);
  throw new Error(`RemoteMcpClient only supports remote MCP transports: ${String(server.type)}`);
}