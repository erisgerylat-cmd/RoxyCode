import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { parseCliArguments, renderCliHelp, resolveWorkspaceDirectory } from '../src/cli/WorkspaceCli.js';

test('workspace CLI accepts positional, --cwd, and -C paths', () => {
  assert.equal(parseCliArguments(['project']).workspace, 'project');
  assert.equal(parseCliArguments(['--cwd', 'project']).workspace, 'project');
  assert.equal(parseCliArguments(['-C', 'project']).workspace, 'project');
  assert.equal(parseCliArguments(['--cwd=project']).workspace, 'project');
});

test('workspace CLI rejects unknown options and duplicate workspaces', () => {
  assert.throws(() => parseCliArguments(['--unknown']), /Unknown option/);
  assert.throws(() => parseCliArguments(['first', 'second']), /Only one workspace/);
  assert.throws(() => parseCliArguments(['--cwd']), /requires a workspace/);
});

test('workspace resolver requires an existing directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-workspace-cli-'));
  try {
    assert.equal(await resolveWorkspaceDirectory(undefined, root), await resolveWorkspaceDirectory('.', root));
    await assert.rejects(resolveWorkspaceDirectory('missing', root), /Workspace does not exist/);
    await writeFile(join(root, 'file.txt'), 'not a directory', 'utf8');
    await assert.rejects(resolveWorkspaceDirectory('file.txt', root), /Workspace must be a directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace CLI help documents global path-based startup', () => {
  const help = renderCliHelp('0.1.0');
  assert.match(help, /roxycode \[workspace\]/);
  assert.match(help, /--cwd/);
  assert.match(help, /0\.1\.0/);
});
