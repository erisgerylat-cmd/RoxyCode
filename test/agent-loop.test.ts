import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { roxy } from '../src/aesthetic/character/characters/index.js';
import { DEFAULT_CONFIG, type RoxyCodeConfig } from '../src/core/types/config.js';
import type { LLMCallOptions, LLMChunk, LLMProvider, LLMUsage } from '../src/core/types/llm.js';
import type { Message, ToolCall, ToolResult } from '../src/core/types/message.js';
import { AgentLoop } from '../src/engine/agent/AgentLoop.js';
import type { AgentLoopOptions } from '../src/engine/agent/types.js';
import { AuditLog } from '../src/tool/audit/AuditLog.js';
import { editFileTool } from '../src/tool/builtin/editFile.js';
import { executeCommandTool } from '../src/tool/builtin/executeCommand.js';
import { readFileTool } from '../src/tool/builtin/readFile.js';
import { writeFileTool } from '../src/tool/builtin/writeFile.js';
import { ToolExecutor as RealToolExecutor } from '../src/tool/executor/ToolExecutor.js';
import { PermissionGuard } from '../src/tool/permission/PermissionGuard.js';
import { ToolRegistry } from '../src/tool/registry/ToolRegistry.js';
import type { HookRunPayload, HookRunResult, RoxyHookEvent } from '../src/hooks/types.js';
import type { ContextStatus } from '../src/session/context/ContextManager.js';
import type { Tool, ToolExecutionContext, ToolInvocation } from '../src/tool/types.js';
import type { CodeDiagnosticsReport, CodeDiagnosticsRunner } from '../src/lsp/index.js';

const USAGE: LLMUsage = { inputTokens: 3, outputTokens: 5, totalTokens: 8 };

test('economic agent loop feeds tool_result back to the model and yields Claude-style lifecycle events', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-agent-loop-'));
  try {
    const toolCall: ToolCall = { id: 'call-read', name: 'fake_read', arguments: { path: 'README.md' } };
    const provider = new ScriptedProvider([
      [
        { type: 'text', text: '我先读取文件。' },
        { type: 'tool_call_start', toolCall },
        { type: 'done', usage: USAGE, toolCalls: [toolCall], finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', text: '读取完成：README.md 包含 RoxyCode 项目说明。' },
        { type: 'done', usage: USAGE, toolCalls: [], finishReason: 'stop' },
      ],
    ]);
    const executor = new FakeToolExecutor({
      success: true,
      output: '<tool_result name="fake_read" status="success">README.md contains RoxyCode project notes.</tool_result>',
      duration: 7,
      metadata: { path: 'README.md' },
    });
    const hooks = new RecordingHooks();
    const loop = createLoop({ cwd, provider, executor, hooks });

    const events = [];
    for await (const event of loop.run({ userInput: '请读取 README 并总结。', history: [], mode: 'economic' })) events.push(event);

    assert.deepEqual(events.map(event => event.type).filter(type => [
      'mode_start',
      'model_request_start',
      'tool_call_start',
      'tool_execution_start',
      'tool_result',
      'assistant_message',
      'usage',
      'done',
    ].includes(type)), [
      'mode_start',
      'model_request_start',
      'tool_call_start',
      'tool_execution_start',
      'tool_result',
      'model_request_start',
      'assistant_message',
      'usage',
      'done',
    ]);

    assert.equal(provider.streamCalls.length, 2);
    assert.equal(executor.invocations.length, 1);
    assert.equal(executor.invocations[0].name, 'fake_read');
    assert.deepEqual(executor.invocations[0].arguments, { path: 'README.md' });

    const secondRequestMessages = provider.streamCalls[1].messages;
    assert.ok(secondRequestMessages.some(message => message.role === 'tool'));
    assert.ok(JSON.stringify(secondRequestMessages).includes('README.md contains RoxyCode project notes'));

    const done = events.find(event => event.type === 'done');
    assert.ok(done && done.type === 'done');
    assert.ok(done.messages.some(message => message.role === 'assistant' && JSON.stringify(message.content).includes('tool_use')));
    assert.ok(done.messages.some(message => message.role === 'tool'));
    assert.equal(done.usage.totalTokens, 16);

    assert.deepEqual(hooks.events, ['agent_start', 'before_prompt', 'after_response', 'agent_done']);
    const responseText = hooks.payloads.after_response?.responseText ?? '';
    assert.match(responseText, /我先读取文件。/);
    assert.match(responseText, /读取完成：README\.md 包含 RoxyCode 项目说明。/);
    assert.ok(responseText.indexOf('我先读取文件。') < responseText.indexOf('读取完成'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('economic agent loop emits layered tool UX events and compacts oversized model tool results', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-agent-loop-summary-'));
  try {
    const toolCall: ToolCall = { id: 'call-large', name: 'fake_read', arguments: { path: 'large.log' } };
    const largeOutput = `<tool_result name="fake_read" status="success">\n${'alpha\n'.repeat(6000)}TAIL_MARKER_SHOULD_NOT_REACH_MODEL\n</tool_result>`;
    const provider = new ScriptedProvider([
      [
        { type: 'text', text: '我需要读取大文件。' },
        { type: 'tool_call_start', toolCall },
        { type: 'done', usage: USAGE, toolCalls: [toolCall], finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', text: '大文件结果已按摘要处理。' },
        { type: 'done', usage: USAGE, toolCalls: [], finishReason: 'stop' },
      ],
    ]);
    const executor = new FakeToolExecutor({
      success: true,
      output: largeOutput,
      duration: 12,
      metadata: { path: 'large.log', totalLines: 6001 },
    });
    const loop = createLoop({ cwd, provider, executor });

    const events = [];
    for await (const event of loop.run({ userInput: '读取 large.log 并总结。', history: [], mode: 'economic' })) events.push(event);

    assert.ok(events.some(event => event.type === 'agent_phase' && event.phase === 'analyze'));
    const intent = events.find(event => event.type === 'tool_intent');
    assert.ok(intent && intent.type === 'tool_intent');
    assert.match(intent.intent, /fake_read/);

    const summary = events.find(event => event.type === 'tool_result_summary');
    assert.ok(summary && summary.type === 'tool_result_summary');
    assert.equal(summary.success, true);
    assert.match(summary.summary, /large\.log/);

    const rawToolResult = events.find(event => event.type === 'tool_result');
    assert.ok(rawToolResult && rawToolResult.type === 'tool_result');
    assert.match(rawToolResult.result.output, /TAIL_MARKER_SHOULD_NOT_REACH_MODEL/);

    const secondRequest = JSON.stringify(provider.streamCalls[1].messages);
    assert.match(secondRequest, /compactedForModel/);
    assert.match(secondRequest, /model tool result preview truncated/);
    assert.doesNotMatch(secondRequest, /TAIL_MARKER_SHOULD_NOT_REACH_MODEL/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('economic agent loop emits recovery suggestion for failed tools', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-agent-loop-recovery-'));
  try {
    const toolCall: ToolCall = { id: 'call-denied', name: 'fake_read', arguments: { path: '../secret.txt' } };
    const provider = new ScriptedProvider([
      [
        { type: 'text', text: '我先读取文件。' },
        { type: 'tool_call_start', toolCall },
        { type: 'done', usage: USAGE, toolCalls: [toolCall], finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', text: '权限被拒绝，我会缩小范围。' },
        { type: 'done', usage: USAGE, toolCalls: [], finishReason: 'stop' },
      ],
    ]);
    const executor = new FakeToolExecutor({
      success: false,
      output: '<tool_result name="fake_read" status="error">Permission denied</tool_result>',
      error: 'Permission denied',
      duration: 5,
      metadata: { phase: 'permission', errorCategory: 'permission' },
    });
    const loop = createLoop({ cwd, provider, executor });

    const events = [];
    for await (const event of loop.run({ userInput: '读取项目外文件。', history: [], mode: 'economic' })) events.push(event);

    const summary = events.find(event => event.type === 'tool_result_summary');
    assert.ok(summary && summary.type === 'tool_result_summary');
    assert.equal(summary.success, false);
    assert.match(summary.summary, /失败|failed/);
    assert.match(summary.recoverySuggestion ?? '', /权限|permission/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});



test('economic agent loop executes real read_file tool and returns tool_result to the model', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-agent-real-tool-'));
  try {
    await writeFile(join(cwd, 'README.md'), '# RoxyCode\nreal tool loop smoke\n', 'utf8');
    const toolCall: ToolCall = { id: 'call-real-read', name: 'read_file', arguments: { path: 'README.md', limit: 5 } };
    const provider = new ScriptedProvider([
      [
        { type: 'text', text: 'I will read README first.' },
        { type: 'tool_call_start', toolCall },
        { type: 'done', usage: USAGE, toolCalls: [toolCall], finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', text: 'README says this is a RoxyCode real tool loop smoke.' },
        { type: 'done', usage: USAGE, toolCalls: [], finishReason: 'stop' },
      ],
    ]);
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    const executor = new RealToolExecutor(registry, new PermissionGuard(), new AuditLog(cwd));
    const hooks = new RecordingHooks();
    const loop = createLoop({
      cwd,
      provider,
      executor,
      hooks,
      tools: registry.definitions(),
      runtimeTools: registry.list(),
    });

    const events = [];
    for await (const event of loop.run({ userInput: 'Read README and explain the project.', history: [], mode: 'economic' })) events.push(event);

    const toolResult = events.find(event => event.type === 'tool_result');
    assert.ok(toolResult && toolResult.type === 'tool_result');
    assert.equal(toolResult.result.success, true);
    assert.match(toolResult.result.output, /RoxyCode/);
    assert.match(toolResult.result.output, /real tool loop smoke/);

    assert.equal(provider.streamCalls.length, 2);
    const secondRequest = JSON.stringify(provider.streamCalls[1].messages);
    assert.match(secondRequest, /tool_result/);
    assert.match(secondRequest, /real tool loop smoke/);

    const finalMessage = events.find(event => event.type === 'assistant_message');
    assert.ok(finalMessage && finalMessage.type === 'assistant_message');
    assert.match(finalMessage.text, /real tool loop smoke/);

    const audit = await readFile(join(cwd, '.roxycode', 'audit', 'tools.jsonl'), 'utf8');
    const records = audit.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 1);
    assert.equal(records[0].toolName, 'read_file');
    assert.equal(records[0].success, true);
    assert.equal(records[0].permission.behavior, 'allow');
    assert.equal(records[0].readOnly, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});


test('economic agent loop executes real write_file tool with confirmation, backup, audit, and tool_result roundtrip', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-agent-real-write-'));
  try {
    await writeFile(join(cwd, 'target.txt'), 'before\n', 'utf8');
    const readCall: ToolCall = { id: 'call-real-write-read', name: 'read_file', arguments: { path: 'target.txt', offset: 1, limit: 50 } };
    const toolCall: ToolCall = {
      id: 'call-real-write',
      name: 'write_file',
      arguments: { path: 'target.txt', content: 'after\n' },
    };
    const provider = new ScriptedProvider([
      [
        { type: 'text', text: 'I will read and update target.txt.' },
        { type: 'tool_call_start', toolCall: readCall },
        { type: 'tool_call_start', toolCall },
        { type: 'done', usage: USAGE, toolCalls: [readCall, toolCall], finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', text: 'target.txt has been updated.' },
        { type: 'done', usage: USAGE, toolCalls: [], finishReason: 'stop' },
      ],
    ]);
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(writeFileTool);
    const executor = new RealToolExecutor(registry, new PermissionGuard(), new AuditLog(cwd));
    let confirmCount = 0;
    let secondConfirmCount = 0;
    const loop = createLoop({
      cwd,
      provider,
      executor,
      tools: registry.definitions(),
      runtimeTools: registry.list(),
      confirm: async prompt => {
        confirmCount++;
        assert.equal(prompt.riskLevel, 'medium');
        assert.equal(prompt.requiresSecondConfirmation ?? false, false);
        assert.match(prompt.details.join('\n'), /diff:/);
        return true;
      },
      confirmSecond: async prompt => {
        secondConfirmCount++;
        assert.equal(prompt.riskLevel, 'medium');
        assert.equal(prompt.requiresSecondConfirmation ?? false, false);
        return true;
      },
    });

    const events = [];
    for await (const event of loop.run({ userInput: 'Overwrite target.txt with new content.', history: [], mode: 'economic' })) events.push(event);

    assert.equal(confirmCount, 1);
    assert.equal(secondConfirmCount, 0);
    assert.equal(await readFile(join(cwd, 'target.txt'), 'utf8'), 'after\n');

    const writeResult = events.filter(event => event.type === 'tool_result').at(-1);
    assert.ok(writeResult && writeResult.type === 'tool_result');
    assert.equal(writeResult.result.success, true);
    assert.match(writeResult.result.output, /write_file/);
    assert.match(writeResult.result.output, /backups/);
    assert.match(writeResult.result.output, /diff:/);

    const finalWriteAssistant = events.filter(event => event.type === 'assistant_message').at(-1);
    assert.ok(finalWriteAssistant && finalWriteAssistant.type === 'assistant_message');
    assert.match(finalWriteAssistant.text, /\u672c\u8f6e\u5de5\u4f5c\u533a\u53d8\u66f4/);
    assert.match(finalWriteAssistant.text, /target\.txt/);

    assert.equal(provider.streamCalls.length, 2);
    const secondRequest = JSON.stringify(provider.streamCalls[1].messages);
    assert.match(secondRequest, /tool_result/);
    assert.match(secondRequest, /write_file/);
    assert.match(secondRequest, /backups/);

    const audit = await readFile(join(cwd, '.roxycode', 'audit', 'tools.jsonl'), 'utf8');
    const records = audit.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 2);
    assert.equal(records[0].toolName, 'read_file');
    assert.equal(records[1].toolName, 'write_file');
    assert.equal(records[1].success, true);
    assert.equal(records[1].permission.behavior, 'allow');
    assert.equal(records[1].permission.decisionReason.type, 'user');
    assert.equal(records[1].permission.classifier.requiresSecondConfirmation ?? false, false);
    assert.equal(records[1].readOnly, false);
    assert.equal(records[1].metadata.backups.length, 1);
    assert.equal(records[1].metadata.diff.addedLines, 1);
    const backupPath = records[1].metadata.backups[0].backupPath;
    assert.equal(await readFile(backupPath, 'utf8'), 'before\n');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('economic agent loop executes real edit_file tool with confirmation, backup, audit, and tool_result roundtrip', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-agent-real-edit-'));
  try {
    await writeFile(join(cwd, 'target.txt'), 'alpha\nold value\nomega\n', 'utf8');
    const readCall: ToolCall = { id: 'call-real-edit-read', name: 'read_file', arguments: { path: 'target.txt', offset: 1, limit: 50 } };
    const toolCall: ToolCall = {
      id: 'call-real-edit',
      name: 'edit_file',
      arguments: { path: 'target.txt', old_string: 'old value', new_string: 'new value' },
    };
    const provider = new ScriptedProvider([
      [
        { type: 'text', text: 'I will read and edit target.txt.' },
        { type: 'tool_call_start', toolCall: readCall },
        { type: 'tool_call_start', toolCall },
        { type: 'done', usage: USAGE, toolCalls: [readCall, toolCall], finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', text: 'target.txt now contains the new value.' },
        { type: 'done', usage: USAGE, toolCalls: [], finishReason: 'stop' },
      ],
    ]);
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(editFileTool);
    const executor = new RealToolExecutor(registry, new PermissionGuard(), new AuditLog(cwd));
    let confirmCount = 0;
    let secondConfirmCount = 0;
    const loop = createLoop({
      cwd,
      provider,
      executor,
      tools: registry.definitions(),
      runtimeTools: registry.list(),
      confirm: async prompt => {
        confirmCount++;
        assert.equal(prompt.riskLevel, 'medium');
        assert.equal(prompt.requiresSecondConfirmation ?? false, false);
        assert.match(prompt.details.join('\n'), /diff:/);
        return true;
      },
      confirmSecond: async prompt => {
        secondConfirmCount++;
        assert.equal(prompt.riskLevel, 'medium');
        assert.equal(prompt.requiresSecondConfirmation ?? false, false);
        return true;
      },
    });

    const events = [];
    for await (const event of loop.run({ userInput: 'Replace old value in target.txt.', history: [], mode: 'economic' })) events.push(event);

    assert.equal(confirmCount, 1);
    assert.equal(secondConfirmCount, 0);
    assert.equal(await readFile(join(cwd, 'target.txt'), 'utf8'), 'alpha\nnew value\nomega\n');

    const editResult = events.filter(event => event.type === 'tool_result').at(-1);
    assert.ok(editResult && editResult.type === 'tool_result');
    assert.equal(editResult.result.success, true);
    assert.match(editResult.result.output, /edit_file/);
    assert.match(editResult.result.output, /backups/);
    assert.match(editResult.result.output, /diff:/);

    const finalEditAssistant = events.filter(event => event.type === 'assistant_message').at(-1);
    assert.ok(finalEditAssistant && finalEditAssistant.type === 'assistant_message');
    assert.match(finalEditAssistant.text, /\u672c\u8f6e\u5de5\u4f5c\u533a\u53d8\u66f4/);
    assert.match(finalEditAssistant.text, /target\.txt/);

    assert.equal(provider.streamCalls.length, 2);
    const secondRequest = JSON.stringify(provider.streamCalls[1].messages);
    assert.match(secondRequest, /tool_result/);
    assert.match(secondRequest, /edit_file/);
    assert.match(secondRequest, /backups/);

    const audit = await readFile(join(cwd, '.roxycode', 'audit', 'tools.jsonl'), 'utf8');
    const records = audit.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 2);
    assert.equal(records[0].toolName, 'read_file');
    assert.equal(records[1].toolName, 'edit_file');
    assert.equal(records[1].success, true);
    assert.equal(records[1].permission.behavior, 'allow');
    assert.equal(records[1].permission.decisionReason.type, 'user');
    assert.equal(records[1].permission.classifier.requiresSecondConfirmation ?? false, false);
    assert.equal(records[1].readOnly, false);
    assert.equal(records[1].metadata.backups.length, 1);
    assert.equal(records[1].metadata.diff.addedLines, 1);
    const backupPath = records[1].metadata.backups[0].backupPath;
    assert.equal(await readFile(backupPath, 'utf8'), 'alpha\nold value\nomega\n');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('agent loop injects TypeScript diagnostics into a repair pass after workspace edits', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-agent-diagnostics-'));
  try {
    const target = join(cwd, 'src', 'index.ts');
    const writeCall: ToolCall = {
      id: 'call-write-ts',
      name: 'write_file',
      arguments: { path: 'src/index.ts', content: 'const value: string = 1;\n' },
    };
    const editCall: ToolCall = {
      id: 'call-fix-ts',
      name: 'edit_file',
      arguments: { path: 'src/index.ts', old_string: 'const value: string = 1;', new_string: 'const value: string = "1";' },
    };
    const provider = new ScriptedProvider([
      [
        { type: 'text', text: '我先创建 TypeScript 文件。' },
        { type: 'tool_call_start', toolCall: writeCall },
        { type: 'done', usage: USAGE, toolCalls: [writeCall], finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', text: '初版已写入。' },
        { type: 'done', usage: USAGE, toolCalls: [], finishReason: 'stop' },
      ],
      [
        { type: 'text', text: '我根据诊断修复类型错误。' },
        { type: 'tool_call_start', toolCall: editCall },
        { type: 'done', usage: USAGE, toolCalls: [editCall], finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', text: '诊断修复完成。' },
        { type: 'done', usage: USAGE, toolCalls: [], finishReason: 'stop' },
      ],
    ]);
    let diagnosticsCalls = 0;
    const runCodeDiagnostics: CodeDiagnosticsRunner = async input => {
      diagnosticsCalls++;
      return diagnosticsCalls === 1
        ? diagnosticsReport(input.cwd, 'failed', [{
            file: target,
            relativePath: 'src/index.ts',
            line: 1,
            column: 7,
            severity: 'error',
            source: 'tsc',
            code: 2322,
            message: 'Type number is not assignable to type string.',
          }])
        : diagnosticsReport(input.cwd, 'passed', []);
    };
    const executor = new FakeToolExecutor({
      success: true,
      output: '<tool_result name="write_file" status="success">ok</tool_result>',
      duration: 1,
      metadata: { path: target, operation: 'update', diff: { addedLines: 1, removedLines: 1 } },
    });
    const loop = createLoop({ cwd, provider, executor, runCodeDiagnostics });

    const events = [];
    for await (const event of loop.run({ userInput: '创建一个 TypeScript 文件。', history: [], mode: 'economic' })) events.push(event);

    const diagnosticEvents = events.filter(event => event.type === 'diagnostics_result');
    assert.equal(diagnosticEvents.length, 2);
    assert.equal(diagnosticEvents[0].type, 'diagnostics_result');
    assert.equal(diagnosticEvents[0].report.status, 'failed');
    assert.match(diagnosticEvents[0].repairPrompt ?? '', /2322|RoxyCode/);
    assert.equal(diagnosticEvents[1].type, 'diagnostics_result');
    assert.equal(diagnosticEvents[1].report.status, 'passed');
    assert.equal(diagnosticsCalls, 2);
    assert.equal(provider.streamCalls.length, 4);
    assert.match(JSON.stringify(provider.streamCalls[2].messages), /2322|RoxyCode/);

    const finalAssistant = events.filter(event => event.type === 'assistant_message').at(-1);
    assert.ok(finalAssistant && finalAssistant.type === 'assistant_message');
    assert.match(finalAssistant.text, /\u4ee3\u7801\u8bca\u65ad/);
    assert.match(finalAssistant.text, /\u9a8c\u8bc1\u901a\u8fc7/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('plan mode exposes only read-only tools and blocks write execution', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-agent-plan-mode-'));
  try {
    await writeFile(join(cwd, 'target.txt'), 'before\n', 'utf8');
    const toolCall: ToolCall = {
      id: 'call-plan-shell',
      name: 'execute_command',
      arguments: { command: `"${process.execPath}" -e "console.log('should-not-run')"` },
    };
    const provider = new ScriptedProvider([
      [
        { type: 'text', text: 'I should not write during planning.' },
        { type: 'tool_call_start', toolCall },
        { type: 'done', usage: USAGE, toolCalls: [toolCall], finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', text: 'Plan only: inspect files, then ask for approval before editing.' },
        { type: 'done', usage: USAGE, toolCalls: [], finishReason: 'stop' },
      ],
    ], 'Plan: inspect first, then request approval.');
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(executeCommandTool);
    const executor = new RealToolExecutor(registry, new PermissionGuard(), new AuditLog(cwd));
    const loop = createLoop({
      cwd,
      provider,
      executor,
      tools: registry.definitions(),
      runtimeTools: registry.list(),
    });

    const events = [];
    for await (const event of loop.run({ userInput: 'Plan an edit to target.txt.', history: [], mode: 'plan' })) events.push(event);

    assert.equal(provider.chatCalls.length, 1);
    assert.equal(provider.streamCalls.length, 2);
    const exposedTools = provider.streamCalls[0].tools?.map(tool => tool.name) ?? [];
    assert.deepEqual(exposedTools, ['read_file']);

    const toolResult = events.find(event => event.type === 'tool_result');
    assert.ok(toolResult && toolResult.type === 'tool_result');
    assert.equal(toolResult.result.success, false);
    assert.match(toolResult.result.output, /read-only|只读|permission/i);
    assert.equal(await readFile(join(cwd, 'target.txt'), 'utf8'), 'before\n');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('agent loop stops before model request when agent_start hook blocks', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-agent-hook-block-'));
  try {
    const provider = new ScriptedProvider([]);
    const hooks = new RecordingHooks({ agent_start: 'blocked by test hook' });
    const loop = createLoop({ cwd, provider, hooks });

    const events = [];
    for await (const event of loop.run({ userInput: '不要执行。', history: [], mode: 'economic' })) events.push(event);

    assert.equal(provider.streamCalls.length, 0);
    assert.equal(provider.chatCalls.length, 0);
    const error = events.find(event => event.type === 'error');
    assert.ok(error && error.type === 'error');
    assert.match(error.error.message, /blocked by test hook/);
    assert.deepEqual(hooks.events, ['agent_start']);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

function createLoop(options: {
  cwd: string;
  provider: ScriptedProvider;
  executor?: FakeToolExecutor | RealToolExecutor;
  hooks?: RecordingHooks;
  tools?: Tool['definition'][];
  runtimeTools?: Tool[];
  confirm?: AgentLoopOptions['confirm'];
  confirmSecond?: AgentLoopOptions['confirmSecond'];
  runCodeDiagnostics?: CodeDiagnosticsRunner;
}): AgentLoop {
  const config: RoxyCodeConfig = structuredClone(DEFAULT_CONFIG);
  config.context.enableCompression = false;
  config.workflows.builtin = false;
  config.workflows.directories = [];
  return new AgentLoop({
    llmProvider: options.provider,
    contextManager: new FakeContextManager(),
    toolExecutor: (options.executor ?? new FakeToolExecutor()) as never,
    tools: options.tools ?? [fakeTool.definition],
    toolRuntimeTools: options.runtimeTools ?? [fakeTool],
    config,
    cwd: options.cwd,
    sessionId: 'agent-loop-test',
    character: roxy,
    language: 'zh-CN',
    confirm: options.confirm,
    confirmSecond: options.confirmSecond,
    hooks: options.hooks,
    runCodeDiagnostics: options.runCodeDiagnostics,
  });
}

function diagnosticsReport(cwd: string, status: 'passed' | 'failed', diagnostics: CodeDiagnosticsReport['diagnostics']): CodeDiagnosticsReport {
  return {
    status,
    engine: 'typescript-compiler',
    language: 'typescript',
    cwd,
    filesChecked: ['src/index.ts'],
    diagnostics,
    counts: diagnostics.reduce<CodeDiagnosticsReport['counts']>((acc, diagnostic) => {
      acc[diagnostic.severity] += 1;
      return acc;
    }, { error: 0, warning: 0, info: 0, hint: 0 }),
    durationMs: 3,
    generatedAt: new Date().toISOString(),
    notes: ['test diagnostics'],
  };
}

const fakeTool: Tool = {
  definition: {
    name: 'fake_read',
    description: 'Read a fake file for AgentLoop tests.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to read.' },
      },
      required: ['path'],
    },
  },
  isReadOnly: true,
  riskLevel: 'low',
  concurrency: 'safe',
  interruptBehavior: 'cancel',
  isConcurrencySafe: () => true,
  async execute(): Promise<ToolResult> {
    return { success: true, output: 'fake direct result', duration: 0 };
  },
};

class ScriptedProvider implements LLMProvider {
  readonly id = 'scripted';
  readonly name = 'Scripted Provider';
  readonly maxContextTokens = 128_000;
  readonly supportsTools = true;
  readonly streamCalls: LLMCallOptions[] = [];
  readonly chatCalls: LLMCallOptions[] = [];

  constructor(private readonly streams: LLMChunk[][], private readonly chatText = 'ok') {}

  async chat(options: LLMCallOptions): Promise<{ text: string; usage: LLMUsage }> {
    this.chatCalls.push(options);
    return { text: this.chatText, usage: USAGE };
  }

  async *chatStream(options: LLMCallOptions): AsyncIterable<LLMChunk> {
    this.streamCalls.push(options);
    const chunks = this.streams.shift();
    if (!chunks) throw new Error('No scripted stream available');
    for (const chunk of chunks) yield chunk;
  }

  async countTokens(text: string): Promise<number> {
    return text.length;
  }

  async validate(): Promise<boolean> {
    return true;
  }
}

class FakeToolExecutor {
  readonly invocations: ToolInvocation[] = [];

  constructor(private readonly result: ToolResult = { success: true, output: '<tool_result name="fake_read" status="success">ok</tool_result>', duration: 0 }) {}

  async execute(invocation: ToolInvocation, _ctx: ToolExecutionContext): Promise<ToolResult> {
    this.invocations.push({ ...invocation, arguments: { ...invocation.arguments } });
    return this.result;
  }
}

class FakeContextManager {
  async getStatus(messages: Message[]): Promise<ContextStatus> {
    return {
      maxContextTokens: 128_000,
      currentTokens: messages.length * 10,
      usageRatio: 0,
      compressionEnabled: false,
      compressThreshold: 0.8,
      needsCompression: false,
      messageCount: messages.length,
      source: 'provider-default',
      registeredStrategies: [],
    };
  }

  async ensureWithinLimit(messages: Message[]): Promise<Message[]> {
    return messages;
  }
}

class RecordingHooks {
  readonly events: RoxyHookEvent[] = [];
  readonly payloads: Partial<Record<RoxyHookEvent, HookRunPayload>> = {};

  constructor(private readonly blocks: Partial<Record<RoxyHookEvent, string>> = {}) {}

  async run(event: RoxyHookEvent, payload: HookRunPayload): Promise<HookRunResult> {
    this.events.push(event);
    this.payloads[event] = payload;
    const reason = this.blocks[event];
    if (reason) return { blocked: true, reason, additionalContexts: [], executions: [] };
    return { blocked: false, additionalContexts: [], executions: [] };
  }
}


