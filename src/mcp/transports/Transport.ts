import type { McpServerDefinition } from '../types.js';

export type JsonRpcId = number | string;

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export type McpTransportKind = 'stdio' | 'sse' | 'http' | 'streamable-http' | 'ws' | 'websocket';

export interface McpTransportCallbacks {
  onMessage(message: JsonRpcMessage): void;
  onError(error: Error): void;
  onClose(): void;
}

export interface McpTransport {
  readonly kind: McpTransportKind;
  readonly server: McpServerDefinition;
  start(callbacks: McpTransportCallbacks): Promise<void>;
  send(message: JsonRpcMessage): Promise<void>;
  close(): Promise<void>;
}

export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as { jsonrpc?: unknown }).jsonrpc === '2.0';
}

export function parseJsonRpcPayload(payload: string): JsonRpcMessage[] {
  const parsed = JSON.parse(payload) as unknown;
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  return messages.filter(isJsonRpcMessage);
}

export function normalizeTransportType(type: string | undefined): McpTransportKind {
  const normalized = (type ?? 'stdio').trim().toLowerCase();
  if (normalized === 'websocket') return 'websocket';
  if (normalized === 'ws') return 'ws';
  if (normalized === 'streamable-http') return 'streamable-http';
  if (normalized === 'http') return 'http';
  if (normalized === 'sse') return 'sse';
  return 'stdio';
}

export function canonicalTransportType(type: string | undefined): 'stdio' | 'sse' | 'http' | 'ws' {
  const normalized = normalizeTransportType(type);
  if (normalized === 'websocket') return 'ws';
  if (normalized === 'streamable-http') return 'http';
  return normalized;
}