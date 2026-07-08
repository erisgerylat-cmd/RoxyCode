import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { handleWorktreeCommand } from '../src/commands/builtin/worktree.js';
import { WorktreeManager } from '../src/worktree/WorktreeManager.js';

const HAS_GIT = hasGit();

test('worktree command lists and safely cleans RoxyCode worktrees', { skip: HAS_GIT ? false : 'git not available' }, async () => {
  const repo = await createGitRepo('roxy-worktree-command-');
  const previousCwd = process.cwd();
  try {
    process.chdir(repo);
    const manager = new WorktreeManager(repo);
    const clean = await manager.create({ slug: 'agent-clean' });
    const dirty = await manager.create({ slug: 'agent-dirty' });
    await writeFile(join(dirty.path, 'note.txt'), 'dirty\n', 'utf8');

    const listOutput = await captureConsole(() => handleWorktreeCommand(['list'], 'zh-CN'));
    assert.match(listOutput, /agent-clean/);
    assert.match(listOutput, /agent-dirty/);

    const cleanupOutput = await captureConsole(() => handleWorktreeCommand(['cleanup'], 'zh-CN'));
    assert.match(cleanupOutput, /agent-clean/);
    assert.match(cleanupOutput, /agent-dirty/);
    assert.equal(existsSync(clean.path), false);
    assert.equal(existsSync(dirty.path), true);

    const discardOutput = await captureConsole(() => handleWorktreeCommand(['cleanup', 'agent-dirty', '--discard'], 'zh-CN'));
    assert.match(discardOutput, /agent-dirty/);
    assert.equal(existsSync(dirty.path), false);
  } finally {
    process.chdir(previousCwd);
    await rm(repo, { recursive: true, force: true });
  }
});

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
