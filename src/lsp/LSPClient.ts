import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LspClientOptions, LspDiagnostic, LspInitializeResult } from './types.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class LSPClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private stdoutBuffer = Buffer.alloc(0);
  private readonly pending = new Map<number, PendingRequest>();
  private readonly diagnostics = new Map<string, LspDiagnostic[]>();
  private readonly diagnosticWaiters = new Map<string, Array<(items: LspDiagnostic[]) => void>>();
  private initialized = false;

  constructor(private readonly options: LspClientOptions) {}

  async start(): Promise<LspInitializeResult> {
    if (this.process) throw new Error('LSP client already started.');
    const child = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...(this.options.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.process = child;
    child.stdout.on('data', chunk => this.onStdout(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on('data', () => undefined);
    child.on('exit', (code, signal) => this.rejectAll(new Error(`LSP server exited: code=${code ?? 'null'} signal=${signal ?? 'null'}`)));
    child.on('error', error => this.rejectAll(error));

    const result = await this.request<LspInitializeResult>('initialize', {
      processId: process.pid,
      rootPath: this.options.cwd,
      rootUri: this.options.rootUri ?? pathToFileURL(this.options.cwd).toString(),
      workspaceFolders: [{
        uri: this.options.rootUri ?? pathToFileURL(this.options.cwd).toString(),
        name: basename(this.options.cwd),
      }],
      capabilities: {
        workspace: {
          configuration: true,
          workspaceFolders: true,
        },
        textDocument: {
          publishDiagnostics: {
            relatedInformation: true,
            versionSupport: false,
          },
        },
      },
      initializationOptions: this.options.initializationOptions ?? {},
    });
    this.notify('initialized', {});
    this.initialized = true;
    return result;
  }

  async openDocument(input: { uri: string; languageId: string; version?: number; text: string }): Promise<void> {
    if (!this.initialized) throw new Error('LSP client is not initialized.');
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: input.uri,
        languageId: input.languageId,
        version: input.version ?? 1,
        text: input.text,
      },
    });
  }

  async waitForDiagnostics(uri: string, timeoutMs = 2000): Promise<LspDiagnostic[]> {
    const existing = this.diagnostics.get(uri);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const waiters = this.diagnosticWaiters.get(uri) ?? [];
        this.diagnosticWaiters.set(uri, waiters.filter(waiter => waiter !== resolve));
        reject(new Error(`Timed out waiting for diagnostics: ${uri}`));
      }, timeoutMs);
      const waiter = (items: LspDiagnostic[]) => {
        clearTimeout(timeout);
        resolve(items);
      };
      const waiters = this.diagnosticWaiters.get(uri) ?? [];
      waiters.push(waiter);
      this.diagnosticWaiters.set(uri, waiters);
    });
  }

  getDiagnostics(uri: string): LspDiagnostic[] {
    return this.diagnostics.get(uri) ?? [];
  }

  async stop(): Promise<void> {
    const child = this.process;
    if (!child) return;
    try {
      await this.request('shutdown', null, 1000).catch(() => undefined);
      this.notify('exit', undefined);
      await waitForExit(child, 1000);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      this.process = null;
      this.initialized = false;
      this.rejectAll(new Error('LSP client stopped.'));
    }
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs = 5000): Promise<T> {
    const id = this.nextId++;
    const message: JsonRpcMessage = { jsonrpc: '2.0', id, method, params };
    const promise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject,
        timeout,
      });
    });
    this.send(message);
    return promise;
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(message: JsonRpcMessage): void {
    if (!this.process) throw new Error('LSP client is not started.');
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii');
    this.process.stdin.write(Buffer.concat([header, body]));
  }

  private onStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.stdoutBuffer.slice(0, headerEnd).toString('ascii');
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.stdoutBuffer = this.stdoutBuffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number.parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.stdoutBuffer.length < bodyEnd) return;
      const body = this.stdoutBuffer.slice(bodyStart, bodyEnd).toString('utf8');
      this.stdoutBuffer = this.stdoutBuffer.slice(bodyEnd);
      this.handleMessage(JSON.parse(body) as JsonRpcMessage);
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (typeof message.id === 'number' && typeof message.method === 'string') {
      this.handleServerRequest(message);
      return;
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }

    if (message.method === 'textDocument/publishDiagnostics' && isPublishDiagnosticsParams(message.params)) {
      this.diagnostics.set(message.params.uri, message.params.diagnostics);
      const waiters = this.diagnosticWaiters.get(message.params.uri) ?? [];
      this.diagnosticWaiters.delete(message.params.uri);
      for (const waiter of waiters) waiter(message.params.diagnostics);
    }
  }

  private handleServerRequest(message: JsonRpcMessage): void {
    let result: unknown = null;
    if (message.method === 'workspace/configuration') {
      const items = readWorkspaceConfigurationItems(message.params);
      result = items.map(() => null);
    }
    this.send({ jsonrpc: '2.0', id: message.id, result });
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      child.kill();
      resolve();
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function isPublishDiagnosticsParams(value: unknown): value is { uri: string; diagnostics: LspDiagnostic[] } {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { uri?: unknown }).uri === 'string'
    && Array.isArray((value as { diagnostics?: unknown }).diagnostics);
}

function readWorkspaceConfigurationItems(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [];
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}
