import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { DEFAULT_CONFIG } from '../src/core/types/config.js';
import type { RoxyCodeConfig } from '../src/core/types/config.js';
import { AuditLog } from '../src/tool/audit/AuditLog.js';
import { editFileTool } from '../src/tool/builtin/editFile.js';
import { readFileTool } from '../src/tool/builtin/readFile.js';
import { writeFileTool } from '../src/tool/builtin/writeFile.js';
import { ToolExecutor } from '../src/tool/executor/ToolExecutor.js';
import { PermissionGuard } from '../src/tool/permission/PermissionGuard.js';
import { ToolRegistry } from '../src/tool/registry/ToolRegistry.js';
import { createFileReadState } from '../src/tool/security/FileReadState.js';
import type { ToolExecutionContext } from '../src/tool/types.js';

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

function createExecutor(cwd: string) {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  return { registry, executor: new ToolExecutor(registry, new PermissionGuard(), new AuditLog(cwd)) };
}

function createContext(cwd: string, config = createConfig()): ToolExecutionContext {
  return {
    cwd,
    sessionId: 'tool-executor-integration',
    config,
    language: 'zh-CN',
    permissionMode: 'strict',
    explain: true,
    fileReadState: createFileReadState(),
  };
}

test('tool executor runs allowed read tools and writes audit records', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-tool-read-'));
  try {
    await writeFile(join(cwd, 'sample.txt'), 'alpha\nbeta\n', 'utf8');
    const { executor } = createExecutor(cwd);
    const ctx = createContext(cwd);

    const result = await executor.execute(
      { id: 'read-1', name: 'read_file', arguments: { path: 'sample.txt', offset: 1, limit: 1 } },
      ctx,
    );

    assert.equal(result.success, true);
    assert.match(result.output, /sample\.txt/);
    assert.match(result.output, /alpha/);
    assert.equal(result.metadata?.isPartialView, true);
    assert.equal(ctx.fileReadState?.snapshot().length, 1);

    const audit = await readAudit(cwd);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].id, 'read-1');
    assert.equal(audit[0].toolName, 'read_file');
    assert.equal(audit[0].success, true);
    assert.equal(audit[0].permission.behavior, 'allow');
    assert.equal(audit[0].readOnly, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('tool executor blocks existing file writes until the file has been fully read', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-tool-write-unread-'));
  try {
    await writeFile(join(cwd, 'target.txt'), 'before', 'utf8');
    const { executor } = createExecutor(cwd);
    const ctx = createContext(cwd);
    ctx.confirm = async () => true;
    ctx.confirmSecond = async () => true;

    const result = await executor.execute(
      { id: 'write-unread', name: 'write_file', arguments: { path: 'target.txt', content: 'after' } },
      ctx,
    );

    assert.equal(result.success, false);
    assert.equal(result.metadata?.phase, 'preflight');
    assert.match(result.error ?? '', /read_file|\u8bfb\u53d6|读/);
    assert.equal(await readFile(join(cwd, 'target.txt'), 'utf8'), 'before');
    const audit = await readAudit(cwd);
    assert.equal(audit[0].toolName, 'write_file');
    assert.equal(audit[0].success, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('tool executor asks for high-risk writes after full read, backs up, audits, and records diff metadata', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-tool-write-'));
  try {
    await writeFile(join(cwd, 'target.txt'), 'before', 'utf8');
    const { executor } = createExecutor(cwd);
    const ctx = createContext(cwd);
    await executor.execute(
      { id: 'read-before-write', name: 'read_file', arguments: { path: 'target.txt', offset: 1, limit: 50 } },
      ctx,
    );
    let confirmCount = 0;
    let secondConfirmCount = 0;
    ctx.confirm = async prompt => {
      confirmCount += 1;
      assert.match(prompt.details.join('\n'), /diff:/);
      assert.match(prompt.details.join('\n'), /\+after/);
      return true;
    };
    ctx.confirmSecond = async () => {
      secondConfirmCount += 1;
      return true;
    };

    const result = await executor.execute(
      { id: 'write-2', name: 'write_file', arguments: { path: 'target.txt', content: 'after' } },
      ctx,
    );

    assert.equal(result.success, true);
    assert.equal(confirmCount, 1);
    assert.equal(secondConfirmCount, 1);
    assert.equal(await readFile(join(cwd, 'target.txt'), 'utf8'), 'after');
    assert.ok(Array.isArray(result.metadata?.backups));
    assert.equal((result.metadata?.backups as unknown[]).length, 1);
    assert.equal((result.metadata?.diff as any).addedLines, 1);
    assert.equal((result.metadata?.diff as any).removedLines, 1);

    const audit = await readAudit(cwd);
    assert.equal(audit.length, 2);
    assert.equal(audit[1].permission.behavior, 'allow');
    assert.equal(audit[1].permission.decisionReason?.type, 'user');
    assert.equal(audit[1].metadata?.backups?.length, 1);
    assert.equal(audit[1].metadata?.diff?.addedLines, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('tool executor blocks stale edits when the file changes after read_file', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-tool-edit-stale-'));
  try {
    await writeFile(join(cwd, 'target.txt'), 'alpha\nold\nomega\n', 'utf8');
    const { executor } = createExecutor(cwd);
    const ctx = createContext(cwd);
    await executor.execute(
      { id: 'read-before-stale-edit', name: 'read_file', arguments: { path: 'target.txt', offset: 1, limit: 50 } },
      ctx,
    );
    await new Promise(resolve => setTimeout(resolve, 5));
    await writeFile(join(cwd, 'target.txt'), 'alpha\nold\nexternal\n', 'utf8');
    ctx.confirm = async () => true;
    ctx.confirmSecond = async () => true;

    const result = await executor.execute(
      { id: 'edit-stale', name: 'edit_file', arguments: { path: 'target.txt', old_string: 'old', new_string: 'new' } },
      ctx,
    );

    assert.equal(result.success, false);
    assert.equal(result.metadata?.phase, 'preflight');
    assert.match(result.error ?? '', /changed|修改|重新/);
    assert.equal(await readFile(join(cwd, 'target.txt'), 'utf8'), 'alpha\nold\nexternal\n');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

async function readAudit(cwd: string): Promise<Array<Record<string, any>>> {
  const content = await readFile(join(cwd, '.roxycode', 'audit', 'tools.jsonl'), 'utf8');
  return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
