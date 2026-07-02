import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { DEFAULT_CONFIG } from '../src/core/types/config.js';
import type { RoxyCodeConfig } from '../src/core/types/config.js';
import type { Tool, ToolExecutionContext, ToolProgressEvent, ToolResult } from '../src/tool/types.js';
import { buildTool } from '../src/tool/builder/ToolBuilder.js';
import { getBuiltinTools } from '../src/tool/builtin/index.js';
import { editFileTool } from '../src/tool/builtin/editFile.js';
import { listDirectoryTool } from '../src/tool/builtin/listDirectory.js';
import { writeFileTool } from '../src/tool/builtin/writeFile.js';
import { PermissionClassifier } from '../src/tool/permission/PermissionClassifier.js';
import { classifyShellCommand } from '../src/tool/security/ShellSafety.js';
import { classifyShellRuntime } from '../src/tool/utils/shellRisk.js';
import { executeCommandTool } from '../src/tool/builtin/executeCommand.js';
import { gitTool } from '../src/tool/builtin/git.js';
import { grepSearchTool } from '../src/tool/builtin/grepSearch.js';
import { readFileTool } from '../src/tool/builtin/readFile.js';
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

function createContext(config = createConfig(), overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    cwd: process.cwd(),
    sessionId: 'test-session',
    config,
    language: 'zh-CN',
    permissionMode: 'strict',
    ...overrides,
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
  assert.equal(readOnlyTool.isDestructive?.({}, createContext()), false);
  assert.equal(destructiveTool.isDestructive?.({}, createContext()), true);
});


test('read_file emits structured file progress events', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-tool-progress-read-'));
  try {
    const target = join(cwd, 'sample.txt');
    await writeFile(target, ['alpha', 'beta', 'gamma'].join('\n'), 'utf8');
    const progress: ToolProgressEvent[] = [];

    const result = await readFileTool.execute({ path: 'sample.txt', offset: 2, limit: 1 }, createContext(createConfig(), {
      cwd,
      onProgress: event => progress.push(event),
    }));

    assert.equal(result.success, true);
    assert.deepEqual(progress.map(event => event.type), ['file_read', 'file_read']);
    const complete = progress.at(-1);
    assert.equal(complete?.type, 'file_read');
    if (complete?.type === 'file_read') {
      assert.equal(complete.stage, 'complete');
      assert.equal(complete.totalLines, 3);
      assert.equal(complete.selectedLines, 1);
      assert.equal(complete.partial, true);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('grep_search emits structured search progress events', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-tool-progress-grep-'));
  try {
    await mkdir(join(cwd, 'src'), { recursive: true });
    await writeFile(join(cwd, 'src', 'a.txt'), ['Roxy one', 'nothing', 'Roxy two'].join('\n'), 'utf8');
    const progress: ToolProgressEvent[] = [];

    const result = await grepSearchTool.execute({ pattern: 'Roxy', path: 'src', max_results: 5 }, createContext(createConfig(), {
      cwd,
      onProgress: event => progress.push(event),
    }));

    assert.equal(result.success, true);
    assert.equal(progress[0]?.type, 'search_start');
    assert.equal(progress.filter(event => event.type === 'search_match').length, 2);
    assert.equal(progress.at(-1)?.type, 'search_complete');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('execute_command emits command start, output, and completion progress', async () => {
  const progress: ToolProgressEvent[] = [];
  const command = process.platform === 'win32'
    ? `& "${process.execPath}" -e "console.log('roxy-progress')"`
    : `"${process.execPath}" -e "console.log('roxy-progress')"`;

  const result = await executeCommandTool.execute({ command, timeout_ms: 10_000 }, createContext(createConfig(), {
    onProgress: event => progress.push(event),
  }));

  assert.equal(result.success, true);
  assert.equal(progress[0]?.type, 'command_start');
  assert.ok(progress.some(event => event.type === 'output_chunk' && event.stream === 'stdout' && event.text.includes('roxy-progress')));
  assert.equal(progress.at(-1)?.type, 'command_complete');
});


test('tool builder consumes async generator progress and exposes static scheduling hints', async () => {
  const tool = buildTool({
    definition: {
      name: 'stream_only',
      description: 'stream only tool',
      parameters: { type: 'object', properties: {} },
    },
    isReadOnly: true,
    riskLevel: 'low',
    async *stream() {
      yield { type: 'progress', progress: { type: 'status', toolName: 'stream_only', phase: 'execute', message: 'halfway' } };
      return { success: true, output: 'stream result', duration: 3, metadata: { streamed: true } };
    },
  });
  const progress: ToolProgressEvent[] = [];
  const result = await tool.execute?.({}, createContext(createConfig(), { onProgress: event => progress.push(event) }));

  assert.equal(result?.success, true);
  assert.equal(tool.concurrencySafe, true);
  assert.equal(tool.destructive, false);
  assert.equal(progress[0]?.type, 'status');
});

test('builtin tools expose static concurrency and destructive hints', () => {
  for (const tool of getBuiltinTools()) {
    assert.equal(typeof tool.concurrencySafe, 'boolean', tool.definition.name);
    assert.equal(typeof tool.destructive, 'boolean', tool.definition.name);
  }

  const read = getBuiltinTools().find(tool => tool.definition.name === 'read_file');
  const write = getBuiltinTools().find(tool => tool.definition.name === 'write_file');
  assert.equal(read?.concurrencySafe, true);
  assert.equal(read?.destructive, false);
  assert.equal(write?.concurrencySafe, false);
  assert.equal(write?.destructive, true);
});

test('write, edit, list, and git tools emit structured progress events', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-tool-progress-all-'));
  try {
    await writeFile(join(cwd, 'existing.txt'), 'old value\n', 'utf8');
    const ctx = createContext(createConfig(), { cwd });

    const writeProgress: ToolProgressEvent[] = [];
    const writeResult = await writeFileTool.execute?.({ path: 'new.txt', content: 'created\n' }, { ...ctx, onProgress: event => writeProgress.push(event) });
    assert.equal(writeResult?.success, true);
    assert.deepEqual(writeProgress.map(event => event.type), ['status', 'status']);

    await readFileTool.execute({ path: 'existing.txt' }, ctx);
    const editProgress: ToolProgressEvent[] = [];
    const editResult = await editFileTool.execute?.({ path: 'existing.txt', old_string: 'old', new_string: 'new' }, { ...ctx, onProgress: event => editProgress.push(event) });
    assert.equal(editResult?.success, true);
    assert.deepEqual(editProgress.map(event => event.type), ['status', 'status']);

    const listProgress: ToolProgressEvent[] = [];
    const listResult = await listDirectoryTool.execute?.({ path: '.', max_entries: 10 }, { ...ctx, onProgress: event => listProgress.push(event) });
    assert.equal(listResult?.success, true);
    assert.deepEqual(listProgress.map(event => event.type), ['status', 'status']);

    const gitProgress: ToolProgressEvent[] = [];
    const gitResult = await gitTool.execute?.({ operation: 'status' }, { ...createContext(createConfig(), { onProgress: event => gitProgress.push(event) }) });
    assert.equal(typeof gitResult?.success, 'boolean');
    assert.equal(gitProgress[0]?.type, 'command_start');
    assert.equal(gitProgress.at(-1)?.type, 'command_complete');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('streaming executor forwards tool progress events before tool_result', async () => {
  const executor = new StreamingToolExecutor({
    tools: [createScheduledTool('progress_tool', true)],
    context: createContext(),
    toolExecutor: {
      async execute(invocation, ctx) {
        ctx.onProgress?.({ type: 'status', toolName: invocation.name, phase: 'execute', message: 'halfway' });
        return { success: true, output: 'done', duration: 1, metadata: { tool: invocation.name } };
      },
    },
  });

  executor.addTool({ id: 'progress-1', name: 'progress_tool', arguments: {} });
  const events = [];
  for await (const event of executor.run()) events.push(event);

  assert.deepEqual(events.map(event => event.type), ['tool_execution_start', 'tool_progress', 'tool_result']);
  assert.equal(events[1].type, 'tool_progress');
  if (events[1].type === 'tool_progress') assert.equal(events[1].progress.type, 'status');
});

test('streaming executor uses static concurrencySafe when dynamic hook is absent', async () => {
  const tools = [
    createStaticScheduledTool('static_read_a', true),
    createStaticScheduledTool('static_read_b', true),
    createStaticScheduledTool('static_write_c', false),
  ];
  const executor = new StreamingToolExecutor({
    tools,
    context: createContext(),
    maxConcurrency: 3,
    toolExecutor: {
      async execute(invocation) {
        const delayMs = Number(invocation.arguments.delayMs ?? 0);
        if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
        return { success: true, output: `${invocation.name} done`, duration: delayMs };
      },
    },
  });

  executor.addTool({ id: 'static-1', name: 'static_read_a', arguments: { delayMs: 30 } });
  executor.addTool({ id: 'static-2', name: 'static_read_b', arguments: { delayMs: 5 } });
  executor.addTool({ id: 'static-3', name: 'static_write_c', arguments: { delayMs: 0 } });

  const events = [];
  for await (const event of executor.run()) events.push(event);

  const startNames = events.filter(event => event.type === 'tool_execution_start').map(event => event.toolCall.name);
  assert.deepEqual(startNames.slice(0, 2), ['static_read_a', 'static_read_b']);
  assert.equal(startNames[2], 'static_write_c');
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

function createStaticScheduledTool(name: string, concurrencySafe: boolean): Tool {
  return {
    definition: {
      name,
      description: `${name} static test tool`,
      parameters: { type: 'object', properties: {} },
    },
    isReadOnly: false,
    riskLevel: 'high',
    concurrencySafe,
    destructive: !concurrencySafe,
    interruptBehavior: concurrencySafe ? 'cancel' : 'block',
    async execute(): Promise<ToolResult> {
      return { success: true, output: `${name} static`, duration: 0 };
    },
  };
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
