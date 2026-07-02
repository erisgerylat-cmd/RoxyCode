import type { McpServerDefinition } from '../types.js';
import { getMcpAuthorizationHeader } from '../auth/OAuthFlow.js';
import { parseJsonRpcPayload, type JsonRpcMessage, type McpTransport, type McpTransportCallbacks } from './Transport.js';

const MCP_STREAMABLE_HTTP_ACCEPT = 'application/json, text/event-stream';

export class HTTPTransport implements McpTransport {
  readonly kind = 'http' as const;
  readonly server: McpServerDefinition;
  private callbacks: McpTransportCallbacks | null = null;

  constructor(server: McpServerDefinition) {
    this.server = server;
  }

  async start(callbacks: McpTransportCallbacks): Promise<void> {
    if (!this.server.url) throw new Error(`HTTP MCP server requires url: ${this.server.name}`);
    this.callbacks = callbacks;
  }

  async send(message: JsonRpcMessage): Promise<void> {
    const url = this.server.url;
    if (!url) throw new Error(`HTTP MCP server requires url: ${this.server.name}`);
    const headers = await buildRemoteHeaders(this.server, {
      accept: MCP_STREAMABLE_HTTP_ACCEPT,
      'content-type': 'application/json',
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.server.timeoutMs ?? 30_000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP MCP request failed: ${response.status} ${body || response.statusText}`);
      if (!body.trim()) return;
      for (const rpcMessage of parseHttpResponse(body, response.headers.get('content-type'))) {
        this.callbacks?.onMessage(rpcMessage);
      }
    } catch (error) {
      this.callbacks?.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    this.callbacks = null;
  }
}

export async function buildRemoteHeaders(server: McpServerDefinition, defaults: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...defaults, ...(server.headers ?? {}) };
  const authorization = await getMcpAuthorizationHeader(server);
  if (authorization && !hasHeader(headers, 'authorization')) headers.Authorization = authorization;
  return headers;
}

function parseHttpResponse(body: string, contentType: string | null): JsonRpcMessage[] {
  if (contentType?.toLowerCase().includes('text/event-stream')) return parseSseChunk(body);
  return parseJsonRpcPayload(body);
}

export function parseSseChunk(chunk: string): JsonRpcMessage[] {
  const messages: JsonRpcMessage[] = [];
  const events = chunk.split(/\r?\n\r?\n/);
  for (const event of events) {
    const data = event
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') continue;
    try {
      messages.push(...parseJsonRpcPayload(data));
    } catch {
      continue;
    }
  }
  return messages;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some(key => key.toLowerCase() === lower);
}