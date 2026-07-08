import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { handlePlanCommand } from '../src/commands/builtin/plan.js';
import { PlanStore, classifyPlanRisk, extractTodosFromPlan } from '../src/session/plan/index.js';

test('PlanStore creates a persisted current plan with extracted todos', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-plan-store-'));
  try {
    const store = new PlanStore({ cwd });
    const plan = await store.createPlan({
      task: 'Implement login validation',
      text: [
        '## Goal',
        'Validate login form.',
        '## Steps',
        '- Inspect existing login page',
        '- Modify validation rules',
        '- Run tests',
      ].join('\n'),
      sessionId: 'session-test',
      language: 'en-US',
    });

    assert.equal(plan.status, 'draft');
    assert.equal(plan.riskLevel, 'medium');
    assert.equal(plan.todoItems.length, 3);
    assert.equal(plan.todoItems[0].content, 'Inspect existing login page');
    assert.equal(plan.todoItems[2].priority, 'high');
    assert.equal(existsSync(store.getPlanPath(plan.id)), true);
    assert.equal(existsSync(join(cwd, '.roxycode', 'plans', 'current.json')), true);

    const current = await store.getCurrentPlan();
    assert.equal(current?.id, plan.id);
    assert.equal(current?.sessionId, 'session-test');

    const persisted = JSON.parse(await readFile(store.getPlanPath(plan.id), 'utf8'));
    assert.equal(persisted.id, plan.id);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('PlanStore supports approve reject edit and executed transitions', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-plan-transitions-'));
  try {
    const store = new PlanStore({ cwd });
    const created = await store.createPlan({
      task: 'Review code',
      text: '- Read files\n- Summarize risks',
      language: 'en-US',
    });

    const approved = await store.approveCurrentPlan();
    assert.equal(approved.status, 'approved');
    assert.ok(approved.approvedAt);

    const executed = await store.markExecuted(created.id);
    assert.equal(executed.status, 'executed');
    assert.ok(executed.executedAt);

    const edited = await store.editCurrentPlan({ text: '- Read files\n- Run validation', language: 'en-US' });
    assert.equal(edited.status, 'draft');
    assert.equal(edited.approvedAt, undefined);
    assert.equal(edited.executedAt, undefined);

    const rejected = await store.rejectCurrentPlan('too broad');
    assert.equal(rejected.status, 'rejected');
    assert.ok(rejected.riskReasons.some(reason => reason.includes('too broad')));

    await assert.rejects(() => store.approveCurrentPlan(), /rejected/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('plan risk and todo helpers identify high risk and fallback todos', () => {
  const high = classifyPlanRisk('Run git reset --hard and delete generated files.');
  assert.equal(high.level, 'high');
  assert.ok(high.reasons.some(reason => reason.includes('git reset')));

  const todos = extractTodosFromPlan('No bullet points here.', 'en-US');
  assert.equal(todos.length, 3);
  assert.equal(todos[0].status, 'pending');
});

test('handlePlanCommand routes productized plan mode actions', async () => {
  const calls: string[] = [];
  await handlePlanCommand(['approve'], {
    language: 'en-US',
    approvePlan: async () => { calls.push('approve'); },
  });
  await handlePlanCommand(['reject', 'not', 'now'], {
    language: 'en-US',
    rejectPlan: async reason => { calls.push(`reject:${reason}`); },
  });
  await handlePlanCommand(['edit', 'new', 'plan'], {
    language: 'en-US',
    editPlan: async text => { calls.push(`edit:${text}`); },
  });
  await handlePlanCommand(['status'], {
    language: 'en-US',
    showPlan: async () => { calls.push('status'); },
  });
  await handlePlanCommand(['implement', 'feature'], {
    language: 'en-US',
    runPlanPrompt: async prompt => { calls.push(`create:${prompt}`); },
  });

  assert.deepEqual(calls, [
    'approve',
    'reject:not now',
    'edit:new plan',
    'status',
    'create:implement feature',
  ]);
});
