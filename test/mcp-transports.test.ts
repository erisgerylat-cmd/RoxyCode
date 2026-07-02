import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateConfigObject } from '../src/core/configSchema.js';
import { DEFAULT_CONFIG, type MCPServerConfig, type RoxyCodeConfig } from '../src/core/types/config.js';
import { describeMcpEndpoint, McpConfigLoader, McpToolAdapter } from '../src/mcp/index.js';
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

test('mcp loader validates and lists http and sse server configs', async () => {
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
  });

  const validation = validateConfigObject(config, { partial: false });
  assert.equal(validation.ok, true);

  const result = await new McpConfigLoader({ cwd: process.cwd(), config }).load();
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.servers.map(server => `${server.name}:${server.type}`), ['remotehttp:http', 'remotesse:sse']);
  assert.equal(describeMcpEndpoint(result.servers[0]), 'https://example.com/mcp');
  assert.equal(describeMcpEndpoint(result.servers[1]), 'https://example.com/sse');
});

test('mcp schema rejects invalid remote transport config with field paths', () => {
  const config = createConfigWithServers({
    badRemote: {
      type: 'http',
      headers: { ok: 'yes', broken: 123 } as unknown as Record<string, string>,
    },
    badType: {
      type: 'ws' as unknown as MCPServerConfig['type'],
      url: 'wss://example.com/mcp',
    },
  });

  const validation = validateConfigObject(config, { partial: false });
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some(issue => issue.path === 'mcp.servers.badRemote.url'));
  assert.ok(validation.issues.some(issue => issue.path === 'mcp.servers.badRemote.headers.broken'));
  assert.ok(validation.issues.some(issue => issue.path === 'mcp.servers.badType.type'));
});

test('remote mcp transports produce explicit runtime message until sdk client lands', async () => {
  const adapter = new McpToolAdapter(process.cwd());
  const server: McpServerDefinition = {
    name: 'remote',
    source: 'config',
    type: 'http',
    url: 'https://example.com/mcp',
    enabled: true,
  };

  const result = await adapter.discoverTools([server]);
  await adapter.close();

  assert.equal(result.tools.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /HTTP MCP transport is configured/);
  assert.match(result.errors[0].message, /配置校验和列表展示/);
});
