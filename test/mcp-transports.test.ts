import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { validateConfigObject } from '../src/core/configSchema.js';
import { DEFAULT_CONFIG, type MCPServerConfig, type RoxyCodeConfig } from '../src/core/types/config.js';
import { createMcpTransport, createPkcePair, describeMcpEndpoint, McpConfigLoader, McpToolAdapter, OAuthFlow, TokenStore } from '../src/mcp/index.js';
import type { McpServerDefinition } from '../src/mcp/types.js';

function createConfigWithServers(servers: Record<string, MCPServerConfig>): RoxyCodeConfig {
  const config = structuredClone(DEFAULT_CONFIG) as RoxyCodeConfig;
  config.mcp = {
    ...config.mcp,
    directories: [],
    servers,
  };
  return config;
}

test('mcp loader preserves stdio server behavior', async () => {
  const config = createConfigWithServers({
    LocalTools: {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { ROXY_TEST: '1' },
      enabled: true,
      timeoutMs: 5000,
    },
  });

  const validation = validateConfigObject(config, { partial: false });
  assert.equal(validation.ok, true);

  const result = await new McpConfigLoader({ cwd: process.cwd(), config }).load();
  assert.equal(result.errors.length, 0);
  assert.equal(result.servers.length, 1);
  assert.equal(result.servers[0].name, 'localtools');
  assert.equal(result.servers[0].type, 'stdio');
  assert.equal(result.servers[0].command, 'node');
  assert.deepEqual(result.servers[0].args, ['server.js']);
  assert.equal(describeMcpEndpoint(result.servers[0]), 'node server.js');
});

test('mcp loader resolves plugin sandbox variables and rejects root escapes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-mcp-plugin-loader-'));
  try {
    const pluginRoot = join(cwd, 'plugins', 'demo');
    const config = createConfigWithServers({});
    const result = await new McpConfigLoader({
      cwd,
      config,
      pluginServers: {
        plugin_demo_local: {
          type: 'stdio',
          command: 'node',
          args: ['${ROXY_PLUGIN_ROOT}/server.cjs', '${ROXY_PLUGIN_ID}'],
          env: {
            ROXY_PLUGIN_ROOT: 'spoofed',
            DATA_DIR: '${ROXY_PLUGIN_ROOT}/data',
          },
          pluginId: 'demo',
          pluginRoot,
          pluginSandbox: createPluginSandbox(pluginRoot),
        } as unknown as MCPServerConfig,
      },
    }).load();

    assert.equal(result.errors.length, 0);
    const server = result.servers[0];
    assert.equal(server.name, 'plugin_demo_local');
    assert.equal(server.source, 'plugin');
    assert.ok(server.args?.[0].includes(pluginRoot));
    assert.match(server.args?.[0] ?? '', /server\.cjs$/);
    assert.equal(server.args?.[1], 'demo');
    assert.equal(server.env?.ROXY_PLUGIN_ROOT, pluginRoot);
    assert.equal(server.env?.ROXY_PLUGIN_ID, 'demo');
    assert.ok(server.env?.DATA_DIR.includes(pluginRoot));

    const rejected = await new McpConfigLoader({
      cwd,
      config,
      pluginServers: {
        plugin_demo_bad: {
          type: 'stdio',
          command: 'node',
          args: ['${ROXY_PLUGIN_ROOT}/../secret.cjs'],
          pluginId: 'demo',
          pluginRoot,
          pluginSandbox: createPluginSandbox(pluginRoot),
        } as unknown as MCPServerConfig,
      },
    }).load();

    assert.equal(rejected.servers.length, 0);
    assert.equal(rejected.errors.length, 1);
    assert.match(rejected.errors[0].message, /outside its sandbox/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('mcp loader validates and lists six transport protocol configs', async () => {
  const config = createConfigWithServers({
    remoteHttp: {
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { 'x-roxy-test': 'yes' },
      enabled: false,
      timeoutMs: 5000,
    },
    remoteSse: {
      type: 'sse',
      url: 'https://example.com/sse',
      headers: {},
      enabled: false,
    },
    remoteStreamable: {
      type: 'streamable-http',
      url: 'https://example.com/streamable',
      enabled: false,
    },
    remoteWs: {
      type: 'ws',
      url: 'wss://example.com/mcp',
      enabled: false,
    },
    remoteWebSocket: {
      type: 'websocket',
      url: 'https://example.com/socket',
      oauth: { clientId: 'roxy-client', callbackPort: 39001 },
      enabled: false,
    },
  });

  const validation = validateConfigObject(config, { partial: false });
  assert.equal(validation.ok, true);

  const result = await new McpConfigLoader({ cwd: process.cwd(), config }).load();
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.servers.map(server => `${server.name}:${server.type}`), [
    'remotehttp:http',
    'remotesse:sse',
    'remotestreamable:streamable-http',
    'remotews:ws',
    'remotewebsocket:websocket',
  ]);
  assert.equal(describeMcpEndpoint(result.servers[0]), 'https://example.com/mcp');
  assert.equal(describeMcpEndpoint(result.servers[1]), 'https://example.com/sse');
  assert.equal(describeMcpEndpoint(result.servers[2]), 'https://example.com/streamable');
  assert.equal(describeMcpEndpoint(result.servers[3]), 'wss://example.com/mcp');
  assert.equal(result.servers[4].oauth?.clientId, 'roxy-client');
});

test('mcp schema rejects invalid remote transport config with field paths', () => {
  const config = createConfigWithServers({
    badRemote: {
      type: 'http',
      headers: { ok: 'yes', broken: 123 } as unknown as Record<string, string>,
    },
    badType: {
      type: 'unknown' as unknown as MCPServerConfig['type'],
      url: 'wss://example.com/mcp',
    },
  });

  const validation = validateConfigObject(config, { partial: false });
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some(issue => issue.path === 'mcp.servers.badRemote.url'));
  assert.ok(validation.issues.some(issue => issue.path === 'mcp.servers.badRemote.headers.broken'));
  assert.ok(validation.issues.some(issue => issue.path === 'mcp.servers.badType.type'));
});

test('remote mcp transports surface connection failures through discovery errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('mock remote unavailable');
  }) as typeof fetch;
  const adapter = new McpToolAdapter(process.cwd());
  const server: McpServerDefinition = {
    name: 'remote',
    source: 'config',
    type: 'http',
    url: 'https://example.com/mcp',
    enabled: true,
  };

  try {
    const result = await adapter.discoverTools([server]);
    assert.equal(result.tools.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /mock remote unavailable/);
  } finally {
    await adapter.close();
    globalThis.fetch = originalFetch;
  }
});
test('mcp transport factory creates clients for six configured protocols', () => {
  const base: McpServerDefinition = { name: 'demo', source: 'config', enabled: false };
  const configs: McpServerDefinition[] = [
    { ...base, name: 'stdio', type: 'stdio', command: 'node', args: ['server.js'] },
    { ...base, name: 'sse', type: 'sse', url: 'https://example.com/sse' },
    { ...base, name: 'http', type: 'http', url: 'https://example.com/mcp' },
    { ...base, name: 'streamable', type: 'streamable-http', url: 'https://example.com/mcp' },
    { ...base, name: 'ws', type: 'ws', url: 'wss://example.com/mcp' },
    { ...base, name: 'websocket', type: 'websocket', url: 'https://example.com/mcp' },
  ];

  for (const server of configs) {
    const client = createMcpTransport(server, process.cwd());
    assert.equal(client.server.name, server.name);
  }
});

test('mcp transport factory enforces plugin sandbox boundaries', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-mcp-plugin-transport-'));
  try {
    const pluginRoot = join(cwd, 'plugins', 'demo');
    const pluginSandbox = createPluginSandbox(pluginRoot);

    assert.throws(() => createMcpTransport({
      name: 'plugin_remote',
      source: 'plugin',
      type: 'http',
      url: 'https://example.com/mcp',
      pluginId: 'demo',
      pluginRoot,
      pluginSandbox,
    }, cwd), /network access denied/);

    assert.throws(() => createMcpTransport({
      name: 'plugin_local',
      source: 'plugin',
      type: 'stdio',
      command: join(cwd, 'outside-server.cjs'),
      args: [],
      pluginId: 'demo',
      pluginRoot,
      pluginSandbox,
    }, cwd), /outside its sandbox/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('http mcp transport performs initialize, tools/list, and tools/call JSON-RPC requests', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    requests.push({ url: String(url), body, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (body.method === 'initialize') {
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} } } });
    }
    if (body.method === 'notifications/initialized') {
      return jsonResponse('');
    }
    if (body.method === 'tools/list') {
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } }] } });
    }
    if (body.method === 'tools/call') {
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok' }] } });
    }
    return jsonResponse({ jsonrpc: '2.0', id: body.id, error: { message: 'unknown method' } }, 400);
  }) as typeof fetch;

  try {
    const server: McpServerDefinition = {
      name: 'remotehttp',
      source: 'config',
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { 'x-roxy-test': 'yes' },
    };
    const client = createMcpTransport(server, process.cwd());
    const tools = await client.listTools();
    const result = await client.callTool('echo', { text: 'hi' });
    await client.close();

    assert.equal(tools.length, 1);
    assert.deepEqual(result, { content: [{ type: 'text', text: 'ok' }] });
    assert.ok(requests.some(request => request.body.method === 'initialize'));
    assert.ok(requests.some(request => request.body.method === 'tools/list'));
    assert.ok(requests.some(request => request.body.method === 'tools/call'));
    assert.equal(requests[0].headers['x-roxy-test'], 'yes');
    assert.match(requests[0].headers.accept, /text\/event-stream/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('oauth pkce flow builds authorization URL, exchanges token, and stores credentials', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-mcp-oauth-'));
  const originalFetch = globalThis.fetch;
  try {
    const tokenStore = new TokenStore(join(cwd, 'tokens.json'));
    const mockedFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('client_id'), 'client-1');
      return jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 3600 });
    }) as typeof fetch;
    const flow = new OAuthFlow({ tokenStore, fetchFn: mockedFetch });
    const server: McpServerDefinition = {
      name: 'oauthdemo',
      source: 'config',
      type: 'http',
      url: 'https://mcp.example.com/mcp',
      oauth: {
        clientId: 'client-1',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        callbackPort: 39111,
        scope: 'tools.read',
      },
    };

    const request = flow.createAuthorizationRequest(server, { state: 'fixed-state' });
    assert.match(request.authorizationUrl, /code_challenge_method=S256/);
    assert.match(request.authorizationUrl, /state=fixed-state/);
    assert.equal(new URL(request.authorizationUrl).searchParams.get('scope'), 'tools.read');


    const tokens = await flow.exchangeAuthorizationCode(server, 'code-1', request.verifier, request.redirectUri);
    const stored = await tokenStore.load('oauthdemo');
    assert.equal(tokens.accessToken, 'access-1');
    assert.equal(stored?.refreshToken, 'refresh-1');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(cwd, { recursive: true, force: true });
  }
});

test('pkce verifier and challenge are url-safe', () => {
  const pkce = createPkcePair();
  assert.equal(pkce.method, 'S256');
  assert.match(pkce.verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(pkce.challenge, /^[A-Za-z0-9_-]+$/);
});

function jsonResponse(value: unknown, status = 200): Response {
  if (value === '') return new Response('', { status });
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function createPluginSandbox(pluginRoot: string) {
  return {
    pluginId: 'demo',
    pluginRoot,
    manifestPath: join(pluginRoot, 'plugin.json'),
    allowedPaths: [pluginRoot],
    allowNetworkAccess: false,
    allowedHosts: [],
  };
}
