import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { validateWorktreeSlug, WorktreeManager } from '../src/worktree/WorktreeManager.js';

const HAS_GIT = hasGit();

test('validateWorktreeSlug rejects path traversal and unsafe names', () => {
  assert.doesNotThrow(() => validateWorktreeSlug('agent-abc_123'));
  assert.throws(() => validateWorktreeSlug('../escape'));
  assert.throws(() => validateWorktreeSlug('bad:name'));
});

test('WorktreeManager creates, inspects, and removes a clean git worktree', { skip: HAS_GIT ? false : 'git not available' }, async () => {
  const repo = await createGitRepo('roxy-worktree-clean-');
  try {
    const manager = new WorktreeManager(repo);
    const lease = await manager.create({ slug: 'agent-clean' });

    assert.ok(existsSync(lease.path));
    assert.match(lease.branch, /roxy-worktree-agent-clean/);
    const listed = await manager.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].slug, 'agent-clean');
    assert.equal(listed[0].metadataFound, true);

    const status = await manager.status(lease);
    assert.equal(status.dirty, false);
    assert.equal(status.commitsAhead, 0);

    const removed = await manager.remove(lease);
    assert.equal(removed.removed, true);
    assert.equal(existsSync(lease.path), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('WorktreeManager keeps dirty worktrees unless discardChanges is explicit', { skip: HAS_GIT ? false : 'git not available' }, async () => {
  const repo = await createGitRepo('roxy-worktree-dirty-');
  try {
    const manager = new WorktreeManager(repo);
    const lease = await manager.create({ slug: 'agent-dirty' });
    await writeFile(join(lease.path, 'note.txt'), 'changed\n', 'utf8');

    const kept = await manager.remove(lease);
    assert.equal(kept.removed, false);
    assert.equal(kept.status?.dirty, true);
    assert.equal(existsSync(lease.path), true);

    const cleanup = await manager.cleanup({ slug: 'agent-dirty' });
    assert.equal(cleanup.length, 1);
    assert.equal(cleanup[0].removed, false);
    assert.equal(cleanup[0].status?.dirty, true);

    const removed = await manager.cleanup({ slug: 'agent-dirty', discardChanges: true });
    assert.equal(removed[0].removed, true);
    assert.equal(existsSync(lease.path), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('WorktreeManager detects merge conflicts before changing the main workspace', { skip: HAS_GIT ? false : 'git not available' }, async () => {
  const repo = await createGitRepo('roxy-worktree-merge-conflict-');
  try {
    const manager = new WorktreeManager(repo);
    const lease = await manager.create({ slug: 'agent-conflict' });

    await writeFile(join(lease.path, 'README.md'), '# from worktree\n', 'utf8');
    git(lease.path, ['add', 'README.md']);
    git(lease.path, ['commit', '-m', 'worktree change']);

    await writeFile(join(repo, 'README.md'), '# from main\n', 'utf8');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-m', 'main change']);

    const result = await manager.merge('agent-conflict');
    assert.equal(result.merged, false);
    assert.equal(result.conflict, true);
    assert.ok(result.conflicts.some(item => item.includes('README.md')));
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim(), '');

    const removed = await manager.cleanup({ slug: 'agent-conflict', discardChanges: true });
    assert.equal(removed[0].removed, true);
  } finally {
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
