import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { McpServerDefinition } from '../types.js';
import { isJsonRpcMessage, parseJsonRpcPayload, type JsonRpcMessage, type McpTransport, type McpTransportCallbacks } from './Transport.js';

export class StdioTransport implements McpTransport {
  readonly kind = 'stdio' as const;
  readonly server: McpServerDefinition;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private callbacks: McpTransportCallbacks | null = null;

  constructor(server: McpServerDefinition, private readonly cwd: string) {
    this.server = server;
  }

  async start(callbacks: McpTransportCallbacks): Promise<void> {
    if (this.child) return;
    if ((this.server.type ?? 'stdio') !== 'stdio') throw new Error(`StdioTransport cannot run ${this.server.type} transport.`);
    const command = this.server.command?.trim();
    if (!command) throw new Error(`stdio MCP server requires command: ${this.server.name}`);
    this.callbacks = callbacks;
    this.child = spawn(command, this.server.args ?? [], {
      cwd: this.cwd,
      env: { ...process.env, ...this.server.env },
      shell: false,
      windowsHide: true,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.onStdout(String(chunk)));
    this.child.on('error', error => callbacks.onError(error instanceof Error ? error : new Error(String(error))));
    this.child.on('exit', code => callbacks.onClose());
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.child) throw new Error('MCP stdio transport is not running.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.callbacks = null;
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

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        for (const message of parseJsonRpcPayload(line)) this.callbacks?.onMessage(message);
      } catch (error) {
        this.callbacks?.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}