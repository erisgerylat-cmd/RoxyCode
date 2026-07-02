import type { McpServerDefinition, McpTransportType } from '../types.js';
import { canonicalTransportType } from './Transport.js';

export interface McpClientTransport {
  readonly server: McpServerDefinition;
  listTools(): Promise<unknown[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export function getMcpTransportType(server: McpServerDefinition): McpTransportType {
  return server.type ?? 'stdio';
}

export function describeMcpEndpoint(server: McpServerDefinition): string {
  const type = canonicalTransportType(server.type);
  if (type === 'stdio') return `${server.command ?? '<missing command>'} ${(server.args ?? []).join(' ')}`.trim();
  return server.url ?? '<missing url>';
}