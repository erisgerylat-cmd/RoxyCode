import { McpStdioClient } from './McpStdioClient.js';
import type { McpServerDefinition } from './types.js';
import { RemoteMcpClient } from './transports/RemoteMcpClient.js';
import type { McpClientTransport } from './transports/types.js';

export function createMcpTransport(server: McpServerDefinition, cwd: string): McpClientTransport {
  const type = server.type ?? 'stdio';
  if (type === 'stdio') return new McpStdioClient(server, cwd);
  if (type === 'sse' || type === 'http') return new RemoteMcpClient(server);
  throw new Error(`Unsupported MCP transport type: ${String(type)}`);
}
