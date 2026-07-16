import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CharacterManager } from '../src/aesthetic/character/CharacterManager.js';
import { handleMemoryCommand } from '../src/commands/builtin/memory.js';
import { ConfigManager } from '../src/core/ConfigManager.js';
import { MemoryStore } from '../src/session/memory/index.js';

test('memory review command approves queued automatic memories', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-memory-command-'));
  const previousCwd = process.cwd();
  try {
    process.chdir(cwd);
    const configManager = new ConfigManager(cwd, cwd);
    await configManager.load();
    const characterManager = new CharacterManager(configManager, cwd);
    const store = new MemoryStore({ cwd });
    await store.queuePending({
      type: 'learning',
      content: 'User prefers detailed TypeScript explanations with small examples.',
      tags: ['typescript', 'teaching'],
    });

    const output = await captureConsole(() => handleMemoryCommand(['review', 'approve', 'all'], {
      configManager,
      characterManager,
      sessionId: 'session-1',
    }));

    assert.match(output, /已确认|Approved/);
    const memories = await store.list({ type: 'learning' });
    assert.equal(memories.length, 1);
    assert.equal((await store.listPending()).length, 0);
  } finally {
    process.chdir(previousCwd);
    await rm(cwd, { recursive: true, force: true });
  }
});

async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}
