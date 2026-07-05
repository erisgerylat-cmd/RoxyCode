import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { PluginSandbox } from '../src/plugin/PluginSandbox.js';

test('plugin sandbox rejects sibling paths with shared string prefixes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-plugin-sandbox-'));
  try {
    const pluginRoot = join(cwd, 'plugin');
    const sandbox = new PluginSandbox({
      pluginRoot,
      allowedPaths: [join(cwd, 'shared')],
    });

    assert.equal(sandbox.validatePath(join(pluginRoot, 'config.json')).allowed, true);
    assert.equal(sandbox.validatePath(join(cwd, 'plugin-evil', 'config.json')).allowed, false);
    assert.equal(sandbox.validatePath(join(cwd, 'shared', 'data.json')).allowed, true);
    assert.equal(sandbox.validatePath(join(cwd, 'shared-evil', 'data.json')).allowed, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
