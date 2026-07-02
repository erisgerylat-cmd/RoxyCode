import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_CONFIG } from '../src/core/types/config.js';
import type { RoxyCodeConfig } from '../src/core/types/config.js';
import type { Tool, ToolExecutionContext, ToolResult } from '../src/tool/types.js';
import { PermissionClassifier } from '../src/tool/permission/PermissionClassifier.js';
import { classifyShellCommand } from '../src/tool/security/ShellSafety.js';
import { classifyShellRuntime } from '../src/tool/utils/shellRisk.js';
import { executeCommandTool } from '../src/tool/builtin/executeCommand.js';
import { gitTool } from '../src/tool/builtin/git.js';
import { McpToolAdapter } from '../src/mcp/McpToolAdapter.js';
import type { McpServerDefinition, McpToolDefinition } from '../src/mcp/types.js';
import { StreamingToolExecutor } from '../src/engine/agent/StreamingToolExecutor.js';
import type { ToolCall } from '../src/core/types/message.js';

function createConfig(overrides: Partial<RoxyCodeConfig> = {}): RoxyCodeConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  return {
    ...config,
    ...overrides,
    security: {
      ...config.security,
      ...overrides.security,
      fileAccess: { ...config.security.fileAccess, ...overrides.security?.fileAccess },
      shell: { ...config.security.shell, ...overrides.security?.shell },
      highRisk: { ...config.security.highRisk, ...overrides.security?.highRisk },
    },
  };
}

function createContext(config = createConfig()): ToolExecutionContext {
  return {
    cwd: process.cwd(),
    sessionId: 'test-session',
    config,
    language: 'zh-CN',
    permissionMode: 'strict',
  };
}

test('shell runtime classifies read-only commands as concurrency-safe', () => {
  const result = classifyShellRuntime('git status', createContext());

  assert.equal(result.safetyLevel, 'allow');
  assert.equal(result.concurrencySafe, true);
  assert.equal(result.interruptBehavior, 'cancel');
  assert.equal(result.matchedRule, 'git status');
});

test('shell runtime keeps dependency mutation commands exclusive', () => {
  const result = classifyShellRuntime('pnpm install', createContext());

  assert.equal(result.safetyLevel, 'ask');
  assert.equal(result.concurrencySafe, false);
  assert.equal(result.interruptBehavior, 'block');
});

test('dangerous shell commands require second confirmation', () => {
  const result = classifyShellCommand('rm -rf dist', DEFAULT_CONFIG.security.shell.whitelist);

  assert.equal(result.level, 'dangerous');
  assert.equal(result.requiresSecondConfirmation, true);
  assert.ok(result.reasons.length > 0);
});

test('execute_command exposes input-aware concurrency safety', () => {
  const ctx = createContext();

  assert.equal(executeCommandTool.isConcurrencySafe?.({ command: 'git status' }, ctx), true);
  assert.equal(executeCommandTool.isConcurrencySafe?.({ command: 'pnpm install' }, ctx), false);
});

test('git tool allows read-only git operations to run concurrently', () => {
  const ctx = createContext();

  assert.equal(gitTool.isConcurrencySafe?.({ operation: 'status' }, ctx), true);
  assert.equal(gitTool.isConcurrencySafe?.({ operation: 'diff', target: 'src/index.ts' }, ctx), true);
  assert.equal(gitTool.isConcurrencySafe?.({ operation: 'checkout' }, ctx), false);
});

test('permission classifier marks dangerous shell commands as high-risk second-confirmation asks', () => {
  const classifier = new PermissionClassifier();
  const result = classifier.classify(executeCommandTool, { command: 'git reset --hard HEAD' }, createContext());

  assert.equal(result.behavior, 'ask');
  assert.equal(result.source, 'shell-safety');
  assert.equal(result.riskLevel, 'high');
  assert.equal(result.shellLevel, 'dangerous');
  assert.equal(result.requiresSecondConfirmation, true);
});

test('mcp annotations map read-only and destructive tools to scheduling metadata', () => {
  const adapter = new McpToolAdapter(process.cwd());
  const server: McpServerDefinition = {
    name: 'demo',
    source: 'config',
    command: 'node',
    args: ['server.js'],
  };

  const readOnlyTool = createMcpTool(adapter, server, {
    serverName: 'demo',
    originalName: 'search',
    roxyName: 'mcp__demo__search',
    description: 'Search data',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  });
  const destructiveTool = createMcpTool(adapter, server, {
    serverName: 'demo',
    originalName: 'delete_record',
    roxyName: 'mcp__demo__delete_record',
    description: 'Delete data',
    inputSchema: { type: 'object', properties: {} },
    annotations: { destructiveHint: true },
  });

  assert.equal(readOnlyTool.isReadOnly, true);
  assert.equal(readOnlyTool.riskLevel, 'low');
  assert.equal(readOnlyTool.concurrency, 'safe');
  assert.equal(readOnlyTool.interruptBehavior, 'cancel');
  assert.equal(readOnlyTool.isConcurrencySafe?.({}, createContext()), true);

  assert.equal(destructiveTool.isReadOnly, false);
  assert.equal(destructiveTool.riskLevel, 'high');
  assert.equal(destructiveTool.concurrency, 'exclusive');
  assert.equal(destructiveTool.interruptBehavior, 'block');
  assert.equal(destructiveTool.isConcurrencySafe?.({}, createContext()), false);
});

test('streaming executor overlaps safe tools but preserves tool_result order', async () => {
  const tools = [
    createScheduledTool('read_a', true),
    createScheduledTool('read_b', true),
    createScheduledTool('write_c', false),
  ];
  const executor = new StreamingToolExecutor({
    tools,
    context: createContext(),
    maxConcurrency: 3,
    toolExecutor: {
      async execute(invocation) {
        const delayMs = Number(invocation.arguments.delayMs ?? 0);
        if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
        return {
          success: true,
          output: `${invocation.name} done`,
          duration: delayMs,
          metadata: { tool: invocation.name },
        };
      },
    },
  });

  const calls: ToolCall[] = [
    { id: '1', name: 'read_a', arguments: { delayMs: 30 } },
    { id: '2', name: 'read_b', arguments: { delayMs: 5 } },
    { id: '3', name: 'write_c', arguments: { delayMs: 0 } },
  ];
  for (const call of calls) executor.addTool(call);

  const events = [];
  for await (const event of executor.run()) events.push(event);

  const startNames = events.filter(event => event.type === 'tool_execution_start').map(event => event.toolCall.name);
  const resultNames = events.filter(event => event.type === 'tool_result').map(event => event.toolCall.name);

  assert.deepEqual(startNames.slice(0, 2), ['read_a', 'read_b']);
  assert.deepEqual(resultNames, ['read_a', 'read_b', 'write_c']);
});

function createMcpTool(adapter: McpToolAdapter, server: McpServerDefinition, tool: McpToolDefinition): Tool {
  return (adapter as unknown as {
    toRoxyTool(server: McpServerDefinition, mcpTool: McpToolDefinition): Tool;
  }).toRoxyTool(server, tool);
}

function createScheduledTool(name: string, concurrencySafe: boolean): Tool {
  return {
    definition: {
      name,
      description: `${name} test tool`,
      parameters: { type: 'object', properties: {} },
    },
    isReadOnly: concurrencySafe,
    riskLevel: concurrencySafe ? 'low' : 'high',
    concurrency: concurrencySafe ? 'safe' : 'exclusive',
    interruptBehavior: concurrencySafe ? 'cancel' : 'block',
    isConcurrencySafe: () => concurrencySafe,
    async execute(): Promise<ToolResult> {
      return {
        success: true,
        output: `${name} direct`,
        duration: 0,
      };
    },
  };
}