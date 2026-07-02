import type { McpServerDefinition } from '../types.js';

export interface McpClientTransport {
  readonly server: McpServerDefinition;
  listTools(): Promise<unknown[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export function getMcpTransportType(server: McpServerDefinition): 'stdio' | 'sse' | 'http' {
  return server.type ?? 'stdio';
}

export function describeMcpEndpoint(server: McpServerDefinition): string {
  const type = getMcpTransportType(server);
  if (type === 'stdio') return `${server.command ?? '<missing command>'} ${(server.args ?? []).join(' ')}`.trim();
  return server.url ?? '<missing url>';
}
