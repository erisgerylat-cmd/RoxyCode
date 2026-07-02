import type { McpServerDefinition } from '../types.js';
import { parseJsonRpcPayload, type JsonRpcMessage, type McpTransport, type McpTransportCallbacks } from './Transport.js';
import { buildRemoteHeaders } from './HTTPTransport.js';

const WS_CONNECTING = 0;
const WS_OPEN = 1;

interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: Event | MessageEvent) => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: Event | MessageEvent) => void): void;
}

export class WebSocketTransport implements McpTransport {
  readonly kind = 'websocket' as const;
  readonly server: McpServerDefinition;
  private ws: WebSocketLike | null = null;
  private callbacks: McpTransportCallbacks | null = null;

  constructor(server: McpServerDefinition) {
    this.server = server;
  }

  async start(callbacks: McpTransportCallbacks): Promise<void> {
    if (!this.server.url) throw new Error(`WebSocket MCP server requires url: ${this.server.name}`);
    const WebSocketCtor = (globalThis as { WebSocket?: new (url: string, protocols?: string | string[]) => WebSocketLike }).WebSocket;
    if (!WebSocketCtor) {
      throw new Error('WebSocket MCP transport requires a runtime with global WebSocket support. Upgrade Node or add a WebSocket adapter.');
    }
    this.callbacks = callbacks;
    const wsUrl = toWebSocketUrl(this.server.url);
    this.ws = new WebSocketCtor(wsUrl, ['mcp']);
    this.ws.addEventListener('message', this.onMessage);
    this.ws.addEventListener('error', this.onError);
    this.ws.addEventListener('close', this.onClose);
    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket was not created.'));
      if (this.ws.readyState === WS_OPEN) return resolve();
      const onOpen = () => {
        this.ws?.removeEventListener('open', onOpen);
        this.ws?.removeEventListener('error', onConnectError);
        resolve();
      };
      const onConnectError = () => {
        this.ws?.removeEventListener('open', onOpen);
        this.ws?.removeEventListener('error', onConnectError);
        reject(new Error(`WebSocket MCP connection failed: ${this.server.name}`));
      };
      this.ws.addEventListener('open', onOpen);
      this.ws.addEventListener('error', onConnectError);
    });
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) throw new Error('WebSocket MCP transport is not open.');
    this.ws.send(JSON.stringify(message));
  }

  async close(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    this.callbacks = null;
    if (!ws) return;
    ws.removeEventListener('message', this.onMessage);
    ws.removeEventListener('error', this.onError);
    ws.removeEventListener('close', this.onClose);
    if (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING) ws.close();
  }

  private onMessage = (event: Event | MessageEvent): void => {
    const data = (event as MessageEvent).data;
    const text = typeof data === 'string' ? data : String(data);
    try {
      for (const message of parseJsonRpcPayload(text)) this.callbacks?.onMessage(message);
    } catch (error) {
      this.callbacks?.onError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  private onError = (): void => {
    this.callbacks?.onError(new Error(`WebSocket MCP transport error: ${this.server.name}`));
  };

  private onClose = (): void => {
    this.callbacks?.onClose();
  };
}

export async function buildWebSocketHeaders(server: McpServerDefinition): Promise<Record<string, string>> {
  return buildRemoteHeaders(server);
}

function toWebSocketUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  return url.toString();
}
