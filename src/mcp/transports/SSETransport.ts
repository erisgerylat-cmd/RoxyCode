import type { McpServerDefinition } from '../types.js';
import { parseJsonRpcPayload, type JsonRpcMessage, type McpTransport, type McpTransportCallbacks } from './Transport.js';
import { buildRemoteHeaders, parseSseChunk } from './HTTPTransport.js';

export class SSETransport implements McpTransport {
  readonly kind = 'sse' as const;
  readonly server: McpServerDefinition;
  private callbacks: McpTransportCallbacks | null = null;
  private controller: AbortController | null = null;
  private endpointUrl: string | null = null;
  private streamStarted: Promise<void> | null = null;

  constructor(server: McpServerDefinition) {
    this.server = server;
  }

  async start(callbacks: McpTransportCallbacks): Promise<void> {
    if (!this.server.url) throw new Error(`SSE MCP server requires url: ${this.server.name}`);
    this.callbacks = callbacks;
    this.controller = new AbortController();
    this.streamStarted = this.openEventStream(this.server.url, this.controller.signal);
    await this.streamStarted;
  }

  async send(message: JsonRpcMessage): Promise<void> {
    const target = this.endpointUrl ?? this.server.url;
    if (!target) throw new Error(`SSE MCP server requires url: ${this.server.name}`);
    const headers = await buildRemoteHeaders(this.server, {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    });
    const response = await fetch(resolveSseEndpoint(this.server.url!, target), {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`SSE MCP send failed: ${response.status} ${body || response.statusText}`);
    if (!body.trim()) return;
    try {
      for (const rpcMessage of parseJsonRpcPayload(body)) this.callbacks?.onMessage(rpcMessage);
    } catch {
      for (const rpcMessage of parseSseChunk(body)) this.callbacks?.onMessage(rpcMessage);
    }
  }

  async close(): Promise<void> {
    this.controller?.abort();
    this.controller = null;
    this.callbacks = null;
  }

  private async openEventStream(url: string, signal: AbortSignal): Promise<void> {
    const headers = await buildRemoteHeaders(this.server, { accept: 'text/event-stream' });
    const response = await fetch(url, { method: 'GET', headers, signal });
    if (!response.ok || !response.body) throw new Error(`SSE MCP connection failed: ${response.status} ${response.statusText}`);
    void this.consumeStream(response.body, signal).catch(error => {
      if (!signal.aborted) this.callbacks?.onError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private async consumeStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = findSseBoundary(buffer)) >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + (buffer[boundary] === '\r' ? 4 : 2));
          this.handleEvent(event);
        }
      }
    } finally {
      reader.releaseLock();
      this.callbacks?.onClose();
    }
  }

  private handleEvent(event: string): void {
    const lines = event.split(/\r?\n/);
    const eventName = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
    const data = lines
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
      .trim();
    if (eventName === 'endpoint' && data) {
      this.endpointUrl = data;
      return;
    }
    if (!data || data === '[DONE]') return;
    try {
      for (const message of parseJsonRpcPayload(data)) this.callbacks?.onMessage(message);
    } catch (error) {
      this.callbacks?.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function findSseBoundary(buffer: string): number {
  const crlf = buffer.indexOf('\r\n\r\n');
  const lf = buffer.indexOf('\n\n');
  if (crlf < 0) return lf;
  if (lf < 0) return crlf;
  return Math.min(crlf, lf);
}

function resolveSseEndpoint(baseUrl: string, endpoint: string): string {
  try {
    return new URL(endpoint, baseUrl).toString();
  } catch {
    return endpoint;
  }
}