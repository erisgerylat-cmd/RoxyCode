import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigManager } from '../src/core/ConfigManager.js';
import { DEFAULT_CONFIG } from '../src/core/types/config.js';

test('local config overrides project config and reports source paths', async () => {
  const env = await createConfigTestEnv();
  try {
    await mkdir(join(env.cwd, '.roxycode'), { recursive: true });
    await writeJson(join(env.cwd, '.roxycode', 'config.json'), {
      ui: { language: 'en-US' },
      llm: { model: 'project-model' },
    });
    await writeJson(join(env.cwd, '.roxycode', 'config.local.json'), {
      ui: { language: 'zh-CN' },
      llm: { model: 'local-model' },
    });

    const manager = new ConfigManager(env.cwd);
    await manager.load();

    assert.equal(manager.get('ui.language'), 'zh-CN');
    assert.equal(manager.get('llm.model'), 'local-model');

    const paths = manager.getPaths();
    assert.equal(paths.local, join(env.cwd, '.roxycode', 'config.local.json'));

    const languageSource = manager.getSource('ui.language');
    assert.equal(languageSource?.source, 'local');
    assert.equal(languageSource?.file, paths.local);

    const sources = manager.getSources();
    assert.deepEqual(sources.precedence, ['default', 'global', 'project', 'local', 'env', 'session']);
    assert.ok(sources.entries.some(entry => entry.path === 'llm.model' && entry.source === 'local'));
  } finally {
    await env.cleanup();
  }
});

test('invalid local config reports the local file without applying it', async () => {
  const env = await createConfigTestEnv();
  try {
    await mkdir(join(env.cwd, '.roxycode'), { recursive: true });
    await writeJson(join(env.cwd, '.roxycode', 'config.json'), {
      ui: { aestheticMode: 'minimal' },
    });
    await writeJson(join(env.cwd, '.roxycode', 'config.local.json'), {
      ui: { aestheticMode: 'maximal' },
    });

    const manager = new ConfigManager(env.cwd);
    await manager.load();

    assert.equal(manager.get('ui.aestheticMode'), 'minimal');
    const issue = manager.getLoadIssues().find(item => item.path === 'ui.aestheticMode');
    assert.equal(issue?.source, 'local');
    assert.equal(issue?.file, join(env.cwd, '.roxycode', 'config.local.json'));
    assert.equal(issue?.severity, 'error');
  } finally {
    await env.cleanup();
  }
});

test('setting local config writes config.local.json and gitignores it', async () => {
  const env = await createConfigTestEnv();
  try {
    const manager = new ConfigManager(env.cwd);
    await manager.load();

    await manager.set('llm.model', 'gpt-5.5', { scope: 'local' });

    const localPath = join(env.cwd, '.roxycode', 'config.local.json');
    const saved = JSON.parse(await readFile(localPath, 'utf-8')) as { llm?: { model?: string } };
    assert.equal(saved.llm?.model, 'gpt-5.5');
    assert.equal(manager.getSource('llm.model')?.source, 'local');

    const gitignorePath = join(env.cwd, '.gitignore');
    assert.equal(existsSync(gitignorePath), true);
    const gitignore = await readFile(gitignorePath, 'utf-8');
    assert.match(gitignore, /\.roxycode\/config\.local\.json/);
  } finally {
    await env.cleanup();
  }
});

async function createConfigTestEnv(): Promise<{ cwd: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'roxy-config-test-'));
  const cwd = join(root, 'workspace');
  const home = join(root, 'home');
  await mkdir(cwd, { recursive: true });
  await mkdir(home, { recursive: true });

  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  return {
    cwd,
    cleanup: async () => {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}