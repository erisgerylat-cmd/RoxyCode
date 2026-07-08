import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { roxy } from '../src/aesthetic/character/characters/index.js';
import type { LLMCallOptions, LLMProvider, LLMUsage } from '../src/core/types/llm.js';
import { MultiAgentRuntime } from '../src/engine/multi-agent/index.js';

const HAS_GIT = hasGit();
const USAGE: LLMUsage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

test('MultiAgentRuntime creates and cleans a worktree for sub-agent isolation', { skip: HAS_GIT ? false : 'git not available' }, async () => {
  const repo = await createGitRepo('roxy-multi-agent-worktree-');
  try {
    const provider = new ScriptedProvider([
      'not json, use fallback plan',
      'architect analysis done',
    ]);
    const runtime = new MultiAgentRuntime({
      llmProvider: provider,
      cwd: repo,
      sessionId: 'multi-agent-worktree-test',
      language: 'en-US',
      character: roxy,
      maxConcurrency: 1,
    });

    const events = [];
    for await (const event of runtime.run({ userInput: 'Plan a tiny change', runtimeContext: null })) events.push(event);

    const started = events.find(event => event.type === 'multi_agent_task_start');
    assert.ok(started && started.type === 'multi_agent_task_start');
    assert.match(started.worktree?.path ?? '', /\.roxycode/);

    const done = events.find(event => event.type === 'multi_agent_done');
    assert.ok(done && done.type === 'multi_agent_done');
    assert.equal(done.result.results.length, 1);
    assert.equal(done.result.results[0].worktree?.cleanup, 'removed');
    assert.match(done.result.results[0].worktree?.branch ?? '', /roxy-worktree-/);
    assert.match(done.result.mergeReport, /Worktree: removed/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

class ScriptedProvider implements LLMProvider {
  readonly id = 'scripted';
  readonly name = 'Scripted Provider';
  readonly maxContextTokens = 128_000;
  readonly supportsTools = false;
  readonly calls: LLMCallOptions[] = [];

  constructor(private readonly responses: string[]) {}

  async chat(options: LLMCallOptions): Promise<{ text: string; usage: LLMUsage }> {
    this.calls.push(options);
    return { text: this.responses.shift() ?? 'ok', usage: USAGE };
  }

  async *chatStream(): AsyncIterable<never> {
    throw new Error('not used');
  }

  async countTokens(text: string): Promise<number> {
    return text.length;
  }

  async validate(): Promise<boolean> {
    return true;
  }
}

async function createGitRepo(prefix: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'roxy@example.test']);
  git(repo, ['config', 'user.name', 'Roxy Test']);
  await writeFile(join(repo, 'README.md'), '# test\n', 'utf8');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'init']);
  return repo;
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' } });
}

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
