import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import type { LLMCallOptions, LLMChunk, LLMProvider, LLMUsage } from '../src/core/types/llm.js';
import { assistantMessage, userMessage } from '../src/core/types/message.js';
import {
  AutoMemoryExtractor,
  MEMORY_INDEX_MAX_ENTRIES,
  MEMORY_INDEX_MAX_LINES,
  MemoryPolicyError,
  MemoryStore,
  MemoryRetriever,
  buildMemoryGraph,
  extractMemoryLinks,
  extractPreferenceMemoryCandidates,
  renderMemoriesForPrompt,
  renderMemoryIndex,
  selectRelevantMemories,
  type MemoryRecord,
  type MemoryScope,
  type MemoryType,
} from '../src/session/memory/index.js';

test('memory store applies default scopes, lists records, and reports stats', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-memory-default-'));
  const globalDir = await mkdtemp(join(tmpdir(), 'roxy-memory-global-'));
  try {
    const store = new MemoryStore({ cwd, globalDir });

    const user = await store.saveMemory({
      type: 'user',
      content: 'User prefers concise Chinese answers with direct file references.',
      tags: ['style', 'ZH'],
    });
    const reference = await store.add({
      type: 'reference',
      content: 'Payment API reference lives at https://docs.example.test/payments and should be checked before integration work.',
      tags: ['payments', 'docs'],
    });

    assert.equal(user.record.scope, 'global');
    assert.equal(reference.record.scope, 'project');
    assert.equal(user.created, true);
    assert.equal(reference.created, true);

    assert.equal((await store.listMemories()).length, 2);
    assert.equal((await store.listMemories({ scope: 'global' })).length, 1);
    assert.equal((await store.listMemories({ scope: 'project' })).length, 1);

    const stats = await store.getStats({ enabled: true, language: 'en-US' });
    assert.equal(stats.enabled, true);
    assert.equal(stats.total, 2);
    assert.equal(stats.global, 1);
    assert.equal(stats.project, 1);
    assert.equal(stats.byType.user, 1);
    assert.equal(stats.byType.reference, 1);
    assert.equal(stats.manual, 2);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
});

test('memory store deduplicates by type, scope, and normalized content', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-memory-dedupe-'));
  const globalDir = await mkdtemp(join(tmpdir(), 'roxy-memory-global-'));
  try {
    const store = new MemoryStore({ cwd, globalDir });
    const first = await store.add({ type: 'feedback', content: 'Prefer one focused patch per turn.' });
    const duplicate = await store.add({ type: 'feedback', content: '  prefer   one focused patch per turn.  ' });
    const differentScope = await store.add({ type: 'feedback', scope: 'project', content: 'Prefer one focused patch per turn.' });

    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.record.id, first.record.id);
    assert.equal(differentScope.created, true);
    assert.equal((await store.list()).length, 2);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
});


test('memory store maintains MEMORY.md index and exposes store-level recall', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-memory-index-'));
  const globalDir = await mkdtemp(join(tmpdir(), 'roxy-memory-global-'));
  try {
    const store = new MemoryStore({ cwd, globalDir });
    const learning = await store.add({
      type: 'learning',
      content: 'When learning TypeScript, use [[typescript-style]]: explain concepts first, then give a minimal example.',
      summary: 'typescript-style',
      tags: ['typescript', 'teaching'],
    });
    await store.add({
      type: 'workflow',
      content: 'Before commit, run pnpm test and explain verification results in Chinese.',
      tags: ['verification'],
    });

    const indexPath = store.getIndexPaths().global;
    const index = await readFile(indexPath, 'utf8');
    assert.match(index, /# RoxyCode Memory Index/);
    assert.match(index, /learning\/global/);
    assert.match(index, /\[\[typescript-style\]\]/);

    const parsed = await store.loadIndex('global');
    assert.equal(parsed.length, 2);
    assert.equal(parsed.some(entry => entry.id === learning.record.id), true);
    assert.equal(parsed.some(entry => entry.links.includes('typescript-style')), true);
    assert.equal((await store.loadIndex()).global.length, 2);

    const recalled = await store.recallRelevant('TypeScript 鏁欏鏂瑰紡', { limit: 1 });
    assert.equal(recalled.length, 1);
    assert.equal(recalled[0].id, learning.record.id);

    await store.deleteMemory(learning.record.id);
    const afterArchive = await readFile(indexPath, 'utf8');
    assert.doesNotMatch(afterArchive, new RegExp(learning.record.id));
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
});

test('memory graph extracts cross links and index rendering caps entries', () => {
  const now = Date.now();
  const records = [
    createMemoryRecord({ id: 'learning-ts', type: 'learning', summary: 'typescript-style', content: 'Use [[workflow-review]] when explaining TypeScript.', updatedAt: now }),
    createMemoryRecord({ id: 'workflow-review', type: 'workflow', summary: 'workflow-review', content: 'Run tests before final response.', updatedAt: now - 1 }),
    ...Array.from({ length: MEMORY_INDEX_MAX_ENTRIES + 5 }, (_, index) => createMemoryRecord({
      id: 'user-extra-' + index,
      type: 'user',
      content: 'extra memory ' + index,
      updatedAt: now - 10 - index,
    })),
  ];

  assert.deepEqual(extractMemoryLinks('See [[workflow-review]] and [[workflow-review]].'), ['workflow-review']);
  const graph = buildMemoryGraph(records.slice(0, 2));
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].from, 'learning-ts');
  assert.equal(graph.edges[0].to, 'workflow-review');
  assert.equal(graph.edges[0].resolved, true);

  const rendered = renderMemoryIndex(records, { scope: 'global', generatedAt: now });
  const bulletCount = rendered.split('\n').filter(line => line.startsWith('- [')).length;
  assert.equal(bulletCount, MEMORY_INDEX_MAX_ENTRIES);
});

test('memory store archives records and supports query search over content, summary, and tags', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-memory-archive-'));
  const globalDir = await mkdtemp(join(tmpdir(), 'roxy-memory-global-'));
  try {
    const store = new MemoryStore({ cwd, globalDir });
    const learning = await store.add({
      type: 'learning',
      content: 'Explain TypeScript generics from concept to small examples.',
      summary: 'TypeScript learning style',
      tags: ['typescript', 'examples'],
    });
    await store.add({
      type: 'workflow',
      content: 'Before final response, always run the relevant build or test command when available.',
      tags: ['verification'],
    });

    assert.equal((await store.list({ query: 'typescript' })).length, 1);
    assert.equal((await store.list({ query: 'examples' })).length, 1);
    assert.equal((await store.list({ query: 'build' })).length, 1);

    assert.equal(await store.archive(learning.record.id.slice(0, 12), 'test archive'), true);
    assert.equal(await store.get(learning.record.id), null);
    assert.equal((await store.list()).some(record => record.id === learning.record.id), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
});

test('memory store queues automatic memories for review before saving', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-memory-pending-'));
  const globalDir = await mkdtemp(join(tmpdir(), 'roxy-memory-global-'));
  try {
    const store = new MemoryStore({ cwd, globalDir });
    const queued = await store.queuePending({
      type: 'user',
      content: 'User prefers Chinese explanations with clear engineering tradeoffs.',
      tags: ['language', 'style'],
      sessionId: 'session-1',
      characterId: 'roxy',
    });

    assert.equal(queued.queued, true);
    assert.equal((await store.list()).length, 0);
    assert.equal((await store.listPending()).length, 1);

    const approved = await store.approvePending(queued.pending!.id.slice(0, 14));
    assert.ok(approved);
    assert.equal(approved.result.created, true);
    assert.equal((await store.list()).length, 1);
    assert.equal((await store.listPending()).length, 0);

    const duplicate = await store.queuePending({
      type: 'user',
      content: 'User prefers Chinese explanations with clear engineering tradeoffs.',
    });
    assert.equal(duplicate.duplicate, true);

    const rejected = await store.queuePending({
      type: 'user',
      content: 'api_key=sk-test_secret_value_1234567890',
    });
    assert.equal(rejected.rejected, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
});

test('memory policy blocks secrets, raw code, stack traces, temporary state, activity logs, and dangerous workflows', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-memory-policy-'));
  const globalDir = await mkdtemp(join(tmpdir(), 'roxy-memory-global-'));
  try {
    const store = new MemoryStore({ cwd, globalDir });

    await assert.rejects(
      store.add({ type: 'user', content: 'api_key=sk-test_secret_value_1234567890' }),
      MemoryPolicyError,
    );
    await assert.rejects(
      store.add({ type: 'project', content: '```ts\nexport const answer = 42;\n```' }),
      MemoryPolicyError,
    );
    await assert.rejects(
      store.add({ type: 'feedback', content: 'Error: failed\n    at runTask (src/app.ts:10:2)' }),
      MemoryPolicyError,
    );
    await assert.rejects(
      store.add({ type: 'project', content: 'currently fixing login page; todo for this turn is button style.' }),
      MemoryPolicyError,
    );
    await assert.rejects(
      store.add({ type: 'project', content: 'recent changes activity log says commit abcdef1 merged PR #12 yesterday.' }),
      MemoryPolicyError,
    );
    await assert.rejects(
      store.add({ type: 'workflow', content: 'Before each build, always run rm -rf dist to reset generated files.' }),
      MemoryPolicyError,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
});

test('memory policy allows RoxyCode learning/workflow memories and blocks local reference paths', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-memory-roxy-'));
  const globalDir = await mkdtemp(join(tmpdir(), 'roxy-memory-global-'));
  try {
    const store = new MemoryStore({ cwd, globalDir });

    const learning = await store.add({
      type: 'learning',
      content: 'When explaining Vue pages, explain business intent first, then give a minimal example for beginners.',
      tags: ['vue', 'teaching'],
    });
    const workflow = await store.add({
      type: 'workflow',
      content: 'After each code change, check test output and explain verification results and residual risk in Chinese.',
      tags: ['review'],
    });
    const reference = await store.add({
      type: 'reference',
      content: 'Team UI guidelines are at https://docs.example.test/ui-guidelines and should be checked before page work.',
    });

    assert.equal(learning.created, true);
    assert.equal(workflow.created, true);
    assert.equal(reference.record.scope, 'project');
    await assert.rejects(
      store.add({ type: 'reference', content: 'Reference src/server/auth.ts for login flow.' }),
      MemoryPolicyError,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
});

test('renderMemoriesForPrompt groups by type and adds stale-memory warnings', () => {
  const now = Date.now();
  const records: MemoryRecord[] = [
    createMemoryRecord({
      type: 'learning',
      content: 'Explain TypeScript concepts first, then give code examples.',
      tags: ['typescript'],
      updatedAt: now - 3 * 86_400_000,
    }),
    createMemoryRecord({
      type: 'workflow',
      content: 'Before final response, run pnpm test and explain failure reasons.',
      source: 'auto',
      updatedAt: now,
    }),
  ];

  const zh = renderMemoriesForPrompt(records, 'zh-CN');
  assert.match(zh, /RoxyCode 记忆系统/);
  assert.match(zh, /### learning/);
  assert.match(zh, /### workflow/);
  assert.match(zh, /旧快照/);

  const en = renderMemoriesForPrompt(records, 'en-US');
  assert.match(en, /RoxyCode Memory System/);
  assert.match(en, /This memory is \d+ days old/);
});

test('selectRelevantMemories prioritizes tagged and task-relevant memories', () => {
  const now = Date.now();
  const records: MemoryRecord[] = [
    createMemoryRecord({
      id: 'workflow-build',
      type: 'workflow',
      content: 'Before final response, run pnpm test when tests exist.',
      tags: ['verification'],
      updatedAt: now,
    }),
    createMemoryRecord({
      id: 'learning-ts',
      type: 'learning',
      content: 'Explain generics with beginner-friendly TypeScript examples.',
      tags: ['typescript', 'teaching'],
      updatedAt: now - 10 * 86_400_000,
    }),
    createMemoryRecord({
      id: 'reference-ui',
      type: 'reference',
      content: 'UI guidelines live at https://docs.example.test/ui.',
      tags: ['ui'],
      updatedAt: now,
    }),
  ];

  const selected = selectRelevantMemories('Please explain TypeScript generics with beginner-friendly teaching style.', records, { limit: 2, now });

  assert.equal(selected[0].id, 'learning-ts');
  assert.ok(selected.every(record => record.id !== 'workflow-build'));
});

test('preference extractor detects explicit language tech stack and explanation preferences', () => {
  const memories = extractPreferenceMemoryCandidates([
    userMessage('我希望以后都用中文，技术栈常用 Vue TypeScript Spring Boot，解释详细一点，方便我学习工程思路。'),
  ], { language: 'zh-CN', sessionId: 'session-1', characterId: 'roxy' });

  assert.ok(memories.some(memory => memory.type === 'user' && memory.tags?.includes('zh-cn')));
  assert.ok(memories.some(memory => memory.type === 'user' && memory.tags?.includes('tech-stack')));
  assert.ok(memories.some(memory => memory.type === 'learning' && memory.tags?.includes('deep')));
  assert.ok(memories.every(memory => memory.source === 'auto'));
});

test('memory retriever can bias relevant results by character preferred types', () => {
  const now = Date.now();
  const records: MemoryRecord[] = [
    createMemoryRecord({
      id: 'learning-testing',
      type: 'learning',
      content: 'When discussing testing, explain concepts with beginner-friendly examples.',
      updatedAt: now,
    }),
    createMemoryRecord({
      id: 'feedback-testing',
      type: 'feedback',
      content: 'When discussing testing, prioritize review findings and regression risk.',
      updatedAt: now,
    }),
  ];

  const ranked = new MemoryRetriever(records, { now }).retrieve('testing', { preferredTypes: ['feedback'], limit: 2 });
  assert.equal(ranked[0].record.id, 'feedback-testing');
  assert.ok(ranked[0].reasons.includes('character-prefers:feedback'));
});

test('memory retriever uses TF-IDF style ranking and store recall caps top five', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-memory-retriever-'));
  const globalDir = await mkdtemp(join(tmpdir(), 'roxy-memory-global-'));
  try {
    const store = new MemoryStore({ cwd, globalDir });
    const target = await store.add({
      type: 'reference',
      content: 'Payment gateway reconciliation docs are at https://docs.example.test/payments/reconcile.',
      summary: 'payment reconciliation reference',
      tags: ['payments', 'reconciliation'],
    });
    for (let i = 0; i < 8; i++) {
      await store.add({
        type: 'user',
        content: `User preference filler memory ${i} for concise status replies.`,
        tags: ['style', `filler-${i}`],
      });
    }

    const recalled = await store.recallRelevant('Where are the payment reconciliation docs?', { limit: 5 });
    assert.equal(recalled.length <= 5, true);
    assert.equal(recalled[0].id, target.record.id);

    const ranked = new MemoryRetriever(await store.list(), { now: Date.now() }).retrieve('payment reconciliation docs', { limit: 1 });
    assert.equal(ranked[0].record.id, target.record.id);
    assert.ok(ranked[0].matchedTerms.includes('payment') || ranked[0].matchedTerms.includes('reconciliation'));
    assert.ok(ranked[0].reasons.some(reason => reason.startsWith('tag:') || reason.startsWith('summary:')));
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
});
test('auto memory extractor parses fenced JSON and filters invalid candidates', async () => {
  const provider = new FakeProvider([
    '```json',
    JSON.stringify({
      memories: [
        {
          type: 'learning',
          scope: 'global',
          content: 'User wants TypeScript explanations to start with concepts and then minimal examples.',
          summary: 'TypeScript explanation style',
          tags: ['typescript', 'teaching'],
          confidence: 0.8,
        },
        { type: 'unknown', content: 'invalid type' },
        { type: 'workflow', content: '' },
      ],
    }),
    '```',
  ].join('\n'));
  const extractor = new AutoMemoryExtractor({
    llmProvider: provider,
    language: 'zh-CN',
    characterId: 'roxy',
    sessionId: 'session-1',
  });

  const memories = await extractor.extract([
    userMessage('Explain TypeScript concepts before examples.'),
    assistantMessage('Okay, I will use that explanation order.'),
  ]);

  assert.equal(provider.calls, 1);
  assert.equal(memories.length, 1);
  assert.equal(memories[0].type, 'learning');
  assert.equal(memories[0].source, 'auto');
  assert.equal(memories[0].sessionId, 'session-1');
  assert.equal(memories[0].characterId, 'roxy');
  assert.deepEqual(memories[0].tags, ['typescript', 'teaching']);
});

test('auto memory extractor can extract Claude-style core memory types with no tools', async () => {
  const provider = new FakeProvider(JSON.stringify({
    memories: [
      { type: 'user', scope: 'global', content: 'User prefers concise Chinese explanations.', tags: ['style'], confidence: 0.9 },
      { type: 'feedback', scope: 'global', content: 'Do not add trailing summaries when the diff is obvious.', tags: ['response'], confidence: 0.8 },
      { type: 'project', scope: 'project', content: 'Checkout rewrite is driven by compliance deadline 2026-08-01.', tags: ['checkout'], confidence: 0.7 },
      { type: 'reference', scope: 'project', content: 'Payment runbook lives at https://docs.example.test/payments.', tags: ['payments'], confidence: 0.9 },
    ],
  }));
  const extractor = new AutoMemoryExtractor({ llmProvider: provider, language: 'zh-CN', characterId: 'roxy' });

  const memories = await extractor.extract([
    userMessage('I prefer concise Chinese. Payment docs are at https://docs.example.test/payments.'),
    assistantMessage('Noted. I will only save durable information.'),
  ]);

  assert.deepEqual(memories.map(memory => memory.type), ['user', 'feedback', 'project', 'reference']);
  assert.equal(provider.chatCalls.length, 1);
  assert.deepEqual(provider.chatCalls[0].tools, []);
  assert.equal(provider.chatCalls[0].toolChoice, 'none');
  assert.match(JSON.stringify(provider.chatCalls[0].messages), /鍙楅檺鐨勯暱鏈熻蹇嗘彁鍙栧瓙 Agent|restricted child agent/i);
});

test('auto memory extractor supports turn interval gating', async () => {
  const provider = new FakeProvider(JSON.stringify({ memories: [{ type: 'user', content: 'Prefers concise replies.' }] }));
  const extractor = new AutoMemoryExtractor({ llmProvider: provider, language: 'en-US', intervalTurns: 10 });
  const nineTurns = Array.from({ length: 9 }, (_, index) => userMessage(`turn ${index + 1}`));
  const tenTurns = Array.from({ length: 10 }, (_, index) => userMessage(`turn ${index + 1}`));

  assert.equal(extractor.shouldExtract(nineTurns), false);
  assert.deepEqual(await extractor.extract(nineTurns), []);
  assert.equal(extractor.shouldExtract(tenTurns), true);
  assert.equal((await extractor.extract(tenTurns)).length, 1);
});

test('auto memory extractor returns empty candidates on provider failure or short transcript', async () => {
  const failing = new FakeProvider('', true);
  const extractor = new AutoMemoryExtractor({ llmProvider: failing, language: 'zh-CN' });

  assert.deepEqual(await extractor.extract([userMessage('Remember that I prefer Chinese.')]), []);
  assert.deepEqual(await extractor.extract([userMessage('Remember that I prefer Chinese.'), assistantMessage('Okay.')]), []);
});

function createMemoryRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = Date.now();
  return {
    id: overrides.id ?? `${overrides.type ?? 'user'}-test`,
    type: overrides.type ?? 'user',
    scope: overrides.scope ?? defaultScope(overrides.type ?? 'user'),
    source: overrides.source ?? 'manual',
    content: overrides.content ?? 'test memory',
    summary: overrides.summary,
    tags: overrides.tags ?? [],
    confidence: overrides.confidence ?? 1,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    archivedAt: overrides.archivedAt,
    sessionId: overrides.sessionId,
    characterId: overrides.characterId,
    metadata: overrides.metadata,
  };
}

function defaultScope(type: MemoryType): MemoryScope {
  return type === 'project' || type === 'reference' ? 'project' : 'global';
}

class FakeProvider implements LLMProvider {
  readonly id = 'fake';
  readonly name = 'Fake Provider';
  readonly maxContextTokens = 8_000;
  readonly supportsTools = false;
  calls = 0;
  readonly chatCalls: LLMCallOptions[] = [];

  constructor(private readonly text: string, private readonly shouldThrow = false) {}

  async chat(options: LLMCallOptions): Promise<{ text: string; usage: LLMUsage }> {
    this.calls += 1;
    this.chatCalls.push(options);
    if (this.shouldThrow) throw new Error('provider failed');
    return {
      text: this.text,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    };
  }

  async *chatStream(): AsyncIterable<LLMChunk> {
    if (this.shouldThrow) throw new Error('provider failed');
    yield { type: 'text', text: this.text };
    yield {
      type: 'done',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      toolCalls: [],
      finishReason: 'stop',
    };
  }

  async countTokens(text: string): Promise<number> {
    return text.length;
  }

  async validate(): Promise<boolean> {
    return !this.shouldThrow;
  }
}
