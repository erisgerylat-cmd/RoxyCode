import type { McpServerDefinition } from '../types.js';
import type { JsonRpcId, JsonRpcMessage, McpTransport } from './Transport.js';
import type { McpClientTransport } from './types.js';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class JsonRpcMcpClient implements McpClientTransport {
  private nextId = 1;
  private started = false;
  private closed = false;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();

  readonly server: McpServerDefinition;

  constructor(server: McpServerDefinition, private readonly transport: McpTransport) {
    this.server = server;
  }

  async listTools(): Promise<unknown[]> {
    await this.ensureStarted();
    const result = await this.request('tools/list', {});
    if (isRecord(result) && Array.isArray(result.tools)) return result.tools;
    return [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureStarted();
    return this.request('tools/call', { name, arguments: args });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MCP client closed.'));
      this.pending.delete(id);
    }
    await this.transport.close();
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    if (this.closed) throw new Error(`MCP client is closed: ${this.server.name}`);
    this.started = true;
    await this.transport.start({
      onMessage: message => this.onMessage(message),
      onError: error => this.rejectAll(error),
      onClose: () => this.rejectAll(new Error(`MCP transport closed: ${this.server.name}`)),
    });
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'RoxyCode', version: '0.1.0' },
    });
    await this.notify('notifications/initialized', {});
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const timeoutMs = this.server.timeoutMs ?? 30_000;
    const message: JsonRpcMessage = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send(message).catch(error => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    await this.transport.send({ jsonrpc: '2.0', method, params });
  }

  private onMessage(message: JsonRpcMessage): void {
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? 'MCP request failed.'));
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}