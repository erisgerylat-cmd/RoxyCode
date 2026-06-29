import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { McpServerDefinition } from './types.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: '2.0';
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly server: McpServerDefinition, private readonly cwd: string) {}

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
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MCP client closed.'));
      this.pending.delete(id);
    }
    const child = this.child;
    this.child = null;
    if (!child || child.killed) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1500);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
      child.kill('SIGTERM');
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.child) return;
    this.child = spawn(this.server.command, this.server.args ?? [], {
      cwd: this.cwd,
      env: { ...process.env, ...this.server.env },
      shell: false,
      windowsHide: true,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.onStdout(String(chunk)));
    this.child.on('error', error => this.rejectAll(error instanceof Error ? error : new Error(String(error))));
    this.child.on('exit', code => this.rejectAll(new Error(`MCP server exited: ${this.server.name} code=${code}`)));
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'RoxyCode', version: '0.1.0' },
    });
    this.notify('notifications/initialized', {});
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const timeoutMs = this.server.timeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.writeFrame(request);
    });
  }

  private notify(method: string, params?: unknown): void {
    this.writeFrame({ jsonrpc: '2.0', method, params });
  }

  private writeFrame(payload: JsonRpcRequest): void {
    if (!this.child) throw new Error('MCP server is not running.');
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let response: JsonRpcResponse;
      try {
        response = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue;
      }
      if (typeof response.id !== 'number') continue;
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (response.error) pending.reject(new Error(response.error.message ?? 'MCP request failed.'));
      else pending.resolve(response.result);
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