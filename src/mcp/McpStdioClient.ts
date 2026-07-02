import type { McpServerDefinition } from './types.js';
import { JsonRpcMcpClient } from './transports/JsonRpcMcpClient.js';
import { StdioTransport } from './transports/StdioTransport.js';

export class McpStdioClient extends JsonRpcMcpClient {
  constructor(server: McpServerDefinition, cwd: string) {
    super(server, new StdioTransport(server, cwd));
  }
}
