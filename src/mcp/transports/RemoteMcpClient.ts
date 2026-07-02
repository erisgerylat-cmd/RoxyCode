import type { McpServerDefinition } from '../types.js';
import type { McpClientTransport } from './types.js';

export class RemoteMcpClient implements McpClientTransport {
  readonly server: McpServerDefinition;

  constructor(server: McpServerDefinition) {
    this.server = server;
  }

  async listTools(): Promise<unknown[]> {
    throw new Error(this.unsupportedMessage('tools/list'));
  }

  async callTool(name: string, _args: Record<string, unknown>): Promise<unknown> {
    throw new Error(this.unsupportedMessage(`tools/call ${name}`));
  }

  async close(): Promise<void> {
    // Remote transports are config-only in this phase, so there is no socket to close yet.
  }

  private unsupportedMessage(operation: string): string {
    const type = (this.server.type ?? 'stdio').toUpperCase();
    return `${type} MCP transport is configured for ${this.server.name}, but runtime connection is not implemented yet (${operation}). 当前版本已支持配置校验和列表展示，工具发现/调用将在下一阶段接入 MCP SDK 与 OAuth/重连策略。`;
  }
}
